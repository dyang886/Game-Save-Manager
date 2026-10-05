const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { isDeepStrictEqual } = require('util');
const snapshots = require('./snapshotStore');

const activeChildren = new Set();
const DEFAULT_LIMITS = { maxFiles: 1000000, maxBytes: 64 * 1024 ** 3, maxListingBytes: 64 * 1024 ** 2 };
function binary() { return require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked'); }
function child(args, { cwd, signal } = {}) {
    signal?.throwIfAborted();
    const process = spawn(binary(), args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(process);
    const abort = () => process.kill();
    signal?.addEventListener('abort', abort, { once: true });
    let stderr = '';
    process.stderr.on('data', data => { if (stderr.length < 4096) stderr += data.toString(); });
    const completion = new Promise((resolve, reject) => {
        process.once('error', reject);
        process.once('close', code => {
            activeChildren.delete(process); signal?.removeEventListener('abort', abort);
            if (signal?.aborted) reject(Object.assign(new Error('Archive operation cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }));
            else if (code !== 0) reject(new Error(`7-Zip failed (${code}): ${stderr.slice(0, 300)}`));
            else resolve();
        });
    });
    // Attach a handler immediately; the consumer still receives the rejection.
    completion.catch(() => {});
    return { process, completion };
}
async function run(args, options = {}) {
    const { process, completion } = child(args, options);
    const chunks = []; let size = 0;
    try {
        for await (const chunk of process.stdout) {
            size += chunk.length;
            if (size > (options.maxOutput || DEFAULT_LIMITS.maxListingBytes)) throw new Error('Archive listing exceeds limit');
            chunks.push(chunk);
        }
        await completion;
        return Buffer.concat(chunks).toString('utf8');
    } catch (error) { process.kill(); await completion.catch(() => {}); throw error; }
}
async function hashFile(file, { signal, maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of fs.createReadStream(file, { signal })) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Archive size limit exceeded');
        hash.update(chunk);
    }
    return { size, sha256: hash.digest('hex') };
}
function validateEntryName(value) {
    if (typeof value !== 'string' || !value || value.length > 32767 || /[\\\x00-\x1f\x7f]/.test(value) || value.startsWith('/')) throw new Error('Unsafe archive entry');
    for (const segment of value.split('/')) {
        if (segment === '.' || segment === '..') throw new Error('Unsafe archive traversal');
        snapshots.validateSegment(segment);
    }
    return value;
}
function parseListing(text, limits = {}) {
    limits = { ...DEFAULT_LIMITS, ...limits };
    const entries = [], seen = new Set(); let bytes = 0;
    for (const block of text.trim().split(/\r?\n\r?\n/)) {
        if (!block.trim()) continue;
        const fields = {};
        for (const line of block.split(/\r?\n/)) {
            const i = line.indexOf(' = ');
            if (i < 1) throw new Error('Ambiguous archive listing');
            const key = line.slice(0, i);
            if (Object.hasOwn(fields, key)) throw new Error('Duplicate archive field');
            fields[key] = line.slice(i + 3);
        }
        // 7-Zip on Windows prints native separators; normalize before validation.
        const name = validateEntryName((fields.Path || '').replace(/\\/g, '/'));
        const key = name.toLowerCase();
        if (seen.has(key)) throw new Error('Duplicate archive destination');
        seen.add(key);
        if (fields['Symbolic Link'] || fields['Hard Link'] || fields['Reparse Point'] || /(?:^|\s)l[rwx-]{9}/.test(fields.Attributes || '') || /reparse/i.test(fields.Attributes || '') || fields['Alternate Stream'] === '+') throw new Error('Archive links are not allowed');
        if (fields.Encrypted === '+') throw new Error('Encrypted archives are not supported');
        const directory = fields.Folder === '+' || /^D/.test(fields.Attributes || '');
        const size = Number(fields.Size || 0);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid expanded size');
        bytes += directory ? 0 : size;
        entries.push({ name, size, directory });
        if (entries.length > limits.maxFiles || bytes > limits.maxBytes) throw new Error('Expanded archive exceeds limits');
    }
    const files = new Set(entries.filter(e => !e.directory).map(e => e.name.toLowerCase()));
    for (const e of entries) {
        const parts = e.name.toLowerCase().split('/'); parts.pop();
        while (parts.length) { if (files.has(parts.join('/'))) throw new Error('Archive file shadows directory'); parts.pop(); }
    }
    if (!entries.length) throw new Error('Empty archive');
    return entries;
}
async function listArchive(archive, options = {}) {
    return parseListing(await run(['l', '-slt', '-ba', '-sccUTF-8', '--', path.resolve(archive)], options), options);
}
async function extractArchive(archive, destination, options = {}) {
    const entries = await listArchive(archive, options);
    const root = path.resolve(destination);
    await snapshots.assertNoLinks(root);
    await fs.promises.mkdir(root, { recursive: true });
    if ((await fs.promises.readdir(root)).length) throw new Error('Extraction requires an empty directory');
    const free = await fs.promises.statfs(root);
    const size = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.size), 0);
    if (free.bavail * free.bsize < size + 16 * 1024 * 1024) throw Object.assign(new Error('Insufficient extraction space'), { code: 'ENOSPC' });
    let written = 0;
    // Each file is extracted to stdout and written by us to a validated exclusive path.
    // The archive process never chooses filesystem destinations, even during extraction.
    try {
        for (const entry of entries) {
            options.signal?.throwIfAborted();
            const target = path.resolve(root, ...entry.name.split('/'));
            if (!snapshots.inside(root, target)) throw new Error('Archive destination escaped root');
            await snapshots.assertNoLinks(target, root);
            if (entry.directory) { await fs.promises.mkdir(target, { recursive: true }); continue; }
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            const process = child(['x', '-so', '-spd', '--', path.resolve(archive), entry.name], options);
            let count = 0;
            const limiter = new Transform({ transform(chunk, _encoding, done) {
                count += chunk.length; written += chunk.length;
                if (count > entry.size || written > size) return done(new Error('Expanded file exceeds advertised size'));
                try { options.onProgress?.(written, size); done(null, chunk); }
                catch (error) { done(error); }
            } });
            try {
                await pipeline(process.process.stdout, limiter, fs.createWriteStream(target, { flags: 'wx' }), { signal: options.signal });
                await process.completion;
                if (count !== entry.size) throw new Error('Expanded file size mismatch');
            } catch (error) { process.process.kill(); await process.completion.catch(() => {}); throw error; }
        }
    } catch (error) {
        // This directory was empty before we began, so every item is owned by
        // this extraction. Never leave a cancelled or corrupt partial import.
        await snapshots.assertNoLinks(root);
        await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
    return { entries, unpackedSize: size, fileCount: entries.filter(e => !e.directory).length };
}
async function createArchive(source, names, output, options = {}) {
    for (const name of names) validateEntryName(name.replace(/\\/g, '/'));
    const absolute = path.resolve(output);
    const partial = `${absolute}.${randomUUID()}.partial`;
    const list = path.join(path.dirname(absolute), `${randomUUID()}.files.txt`);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    try {
        await fs.promises.writeFile(list, names.join('\n'), { flag: 'wx' });
        await run(['a', '-t7z', '-mx=3', '-ms=off', '-y', '-scsUTF-8', partial, `@${list}`], { ...options, cwd: path.resolve(source) });
        await fs.promises.rename(partial, absolute);
    } finally {
        await fs.promises.rm(partial, { force: true }).catch(() => {});
        await fs.promises.rm(list, { force: true }).catch(() => {});
    }
}
async function createSnapshotArchive(snapshot, output, options = {}) {
    const metadata = options.metadata || snapshot.metadata;
    await fs.promises.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    const staged = await fs.promises.mkdtemp(path.join(path.dirname(path.resolve(output)), '.package-'));
    try {
        // Copy only the declared save entries. Mutable metadata is frozen by the queue.
        for (const p of metadata.backup_paths) {
            snapshots.validateSegment(p.folder_name);
            await snapshots.copyTree(path.join(snapshot.path, p.folder_name), path.join(staged, p.folder_name), options);
        }
        await snapshots.atomicWriteJson(path.join(staged, 'backup_info.json'), metadata);
        const tree = await snapshots.scanTree(staged, '', options);
        const files = tree.filter(e => e.type === 'file');
        const contentHash = await snapshots.computeContentHash(staged, metadata, options);
        await createArchive(staged, [...metadata.backup_paths.map(p => p.folder_name), 'backup_info.json'], output, options);
        const hash = await hashFile(output, options);
        return { archiveSize: hash.size, archiveSha256: hash.sha256, contentHash,
            unpackedSize: files.reduce((sum, e) => sum + e.size, 0), fileCount: files.length, metadata };
    } finally { await fs.promises.rm(staged, { recursive: true, force: true }); }
}
async function extractSnapshotArchive(file, destination, manifest, options = {}) {
    const hash = await hashFile(file, { ...options, maxBytes: manifest.archiveSize });
    if (hash.size !== manifest.archiveSize || hash.sha256 !== manifest.archiveSha256) throw new Error('Archive integrity check failed');
    const entries = await listArchive(file, { ...options, maxBytes: manifest.unpackedSize });
    const allowed = new Set(manifest.backup_paths.map(p => p.folder_name));
    for (const entry of entries) if (entry.name !== 'backup_info.json' && !allowed.has(entry.name.split('/')[0])) throw new Error('Unexpected file in snapshot archive');
    const stats = await extractArchive(file, destination, { ...options, maxBytes: manifest.unpackedSize });
    try {
        if (stats.unpackedSize !== manifest.unpackedSize || stats.fileCount !== manifest.fileCount) throw new Error('Expanded archive does not match manifest');
        const info = path.join(destination, 'backup_info.json');
        if ((await fs.promises.stat(info)).size > 4 * 1024 * 1024) throw new Error('Snapshot metadata exceeds limit');
        const metadata = JSON.parse(await fs.promises.readFile(info, 'utf8'));
        if (!isDeepStrictEqual(metadata, manifest.snapshotMetadata) || !isDeepStrictEqual(metadata.backup_paths, manifest.backup_paths)) throw new Error('Manifest and archive metadata differ');
        if (await snapshots.computeContentHash(destination, metadata, options) !== manifest.contentHash) throw new Error('Snapshot content hash mismatch');
        return { path: destination, metadata };
    } catch (error) {
        await snapshots.assertNoLinks(destination);
        await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}
function cancelAll() { for (const process of activeChildren) process.kill(); }
module.exports = { createArchive, extractArchive, createSnapshotArchive, extractSnapshotArchive, listArchive, parseListing, validateEntryName, hashFile, cancelAll };
