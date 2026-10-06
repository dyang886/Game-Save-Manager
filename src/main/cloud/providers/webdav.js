const path = require('path').posix;
const { createAgent } = require('../config');
const { safeKey } = require('../format');
const { scopedKey, progressStream, probe } = require('./common');
const { request } = require('./transport');
let sdkModule;
function sdk() {
    // Electron 44 / Node 24 supports synchronous require(ESM). Production main
    // modules run as bytenode cached vm.Script data without a dynamic-import
    // callback, so a native import() cannot be used here.
    if (!sdkModule) {
        const module = require('webdav');
        module.getPatcher().patch('request', request);
        sdkModule = module;
    }
    return sdkModule;
}
async function createWebDAV(config, secrets = {}, options = {}) {
    const { createClient } = sdk();
    const agent = createAgent(config, secrets, options.resolveProxy);
    const client = options.client || createClient(config.url, { username: secrets.username || '', password: secrets.password || '', httpAgent: agent, httpsAgent: agent });
    const remote = key => '/' + scopedKey(config, key);
    async function mkdir(dir, signal) {
        let current = '';
        for (const part of dir.split('/').filter(Boolean)) {
            current += '/' + part;
            try { await client.createDirectory(current, { signal }); }
            catch (e) {
                if (e.status !== 405 && e.status !== 409) throw e;
                const stat = await client.stat(current, { signal });
                if (stat.type !== 'directory') throw e;
            }
        }
    }
    const provider = {
        capabilities: { conditionalCreate: true, reliableChecksum: false, multipart: false, range: false, delete: !config.readOnly },
        async ensureContainer({ signal } = {}) { if (!config.readOnly && config.prefix) await mkdir('/' + config.prefix, signal); },
        async list(prefix = 'gsm/', { cursor, signal } = {}) {
            const clean = prefix.replace(/\/$/, ''); safeKey(clean);
            // Depth=1 only. Cursor holds a bounded traversal frontier, never a remote key outside scope.
            const pending = cursor ? JSON.parse(cursor) : [clean];
            if (!Array.isArray(pending) || pending.length > 100000 || pending.some(x => typeof x !== 'string' || !(x === clean || x.startsWith(clean + '/')))) throw new Error('Invalid listing cursor');
            const items = []; let requests = 0;
            while (pending.length && requests++ < 32 && items.length < 1000) {
                const directory = pending.shift();
                let children;
                try { children = await client.getDirectoryContents(remote(directory), { signal }); }
                catch (e) { if (e.status === 404 && e.response?.status !== 207) continue; throw e; }
                const hostname = new URL(config.url).hostname.toLowerCase();
                if ((hostname === 'jianguoyun.com' || hostname.endsWith('.jianguoyun.com')) && children.length >= 750) {
                    throw Object.assign(new Error('Jianguoyun listing reached its documented per-directory limit; completeness cannot be verified'), { code: 'LISTING_LIMIT' });
                }
                for (const entry of children) {
                    const full = entry.filename.replace(/^\//, '');
                    const key = config.prefix ? full.slice(config.prefix.length + 1) : full;
                    if (config.prefix && !full.startsWith(config.prefix + '/')) throw new Error('Out-of-scope WebDAV response');
                    safeKey(key);
                    if (!key.startsWith(directory + '/') || key.slice(directory.length + 1).includes('/')) throw new Error('Unexpected WebDAV child');
                    if (entry.type === 'directory') pending.push(key);
                    else items.push({ key, size: entry.size });
                }
                if (pending.length > 100000) throw new Error('Directory listing exceeds limit');
            }
            return { items, cursor: pending.length ? JSON.stringify(pending) : null };
        },
        async stat(key, { signal } = {}) {
            try { const s = await client.stat(remote(key), { signal }); return { size: s.size, etag: s.etag }; }
            catch (e) { if (e.status === 404 && e.response?.status !== 207) return null; throw e; }
        },
        async put(key, { body, size, signal, onProgress, ifAbsent = false }) {
            if (config.readOnly) throw Object.assign(new Error('Read-only connection'), { code: 'READ_ONLY' });
            if (!Number.isSafeInteger(size) || size < 0) throw new Error('Known object size required');
            const input = progressStream(body, onProgress, { signal, expectedSize: size });
            try {
                await mkdir(path.dirname(remote(key)), signal);
                const response = await client.customRequest(remote(key), { method: 'PUT', data: input, signal,
                    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), ...(ifAbsent ? { 'If-None-Match': '*' } : {}) } });
                await response.text();
            } finally { input.destroy(); }
        },
        async get(key, { signal } = {}) { return (await client.customRequest(remote(key), { method: 'GET', signal })).body; },
        async delete(key, { signal } = {}) {
            if (config.readOnly) throw Object.assign(new Error('Read-only connection'), { code: 'READ_ONLY' });
            try { const res = await client.customRequest(remote(key), { method: 'DELETE', signal }); await res.text(); }
            catch (e) { if (e.status !== 404 || e.response?.status === 207) throw e; }
        },
        close() { agent.destroy(); }
    };
    provider.probe = options => probe(provider, { readOnly: config.readOnly, ...options });
    return provider;
}
module.exports = { createWebDAV };
