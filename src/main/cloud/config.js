const { ProxyAgent } = require('proxy-agent');

function fail(message) { const error = new Error(message); error.code = 'INVALID_CONFIG'; throw error; }
function address(value, allowHttp, label) {
    if (typeof value !== 'string' || value.length > 2048) fail(`Invalid ${label}`);
    let url;
    try { url = new URL(value); } catch { fail(`Invalid ${label}`); }
    if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(url.protocol)) fail(`${label} requires HTTPS (or explicit HTTP consent)`);
    if (url.username || url.password || url.search || url.hash) fail(`${label} must not contain credentials, query or fragment`);
    return url.toString().replace(/\/$/, '');
}
function validateConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid connection');
    const type = input.type || input.provider;
    if (!['webdav', 's3'].includes(type)) fail('Unsupported protocol');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) fail('Connection name is required');
    const allowInsecureHttp = input.allowInsecureHttp === true;
    const prefix = String(input.prefix || '').replace(/^\/+|\/+$/g, '');
    if (prefix.length > 512 || prefix.split('/').some(p => p === '.' || p === '..' || /[\\\x00-\x1f\x7f?#%]/.test(p))) fail('Invalid remote prefix');
    const proxy = input.proxy || { mode: 'auto' };
    if (!['auto', 'direct', 'manual'].includes(proxy.mode)) fail('Invalid proxy mode');
    const result = { type, name, allowInsecureHttp, prefix, readOnly: input.readOnly === true, proxy: { mode: proxy.mode } };
    if (proxy.mode === 'manual') result.proxy.url = address(proxy.url, true, 'Proxy');
    if (type === 'webdav') result.url = address(input.url || input.endpoint, allowInsecureHttp, 'WebDAV URL');
    else {
        result.endpoint = address(input.endpoint, allowInsecureHttp, 'S3 endpoint');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(input.bucket || '')) fail('Invalid bucket');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.region || '')) fail('Region is required');
        result.bucket = input.bucket;
        result.region = input.region;
        result.forcePathStyle = input.forcePathStyle !== false;
    }
    if (input.repositoryId) {
        if (!/^[a-f0-9-]{36}$/i.test(input.repositoryId)) fail('Invalid repository ID');
        result.repositoryId = input.repositoryId;
    }
    return result;
}

// Both Node clients use the same policy; Electron's window proxy is not assumed.
function createAgent(config, secrets = {}, resolveProxy) {
    const proxy = config.proxy || { mode: 'auto' };
    const options = { keepAlive: true };
    if (proxy.mode === 'direct') options.getProxyForUrl = () => '';
    if (proxy.mode === 'manual') {
        const url = new URL(proxy.url);
        if (secrets.proxyUsername) url.username = secrets.proxyUsername;
        if (secrets.proxyPassword) url.password = secrets.proxyPassword;
        options.getProxyForUrl = () => url.toString();
    }
    if (proxy.mode === 'auto' && resolveProxy) options.getProxyForUrl = async url => {
        const rule = (await resolveProxy(url)).split(';')[0].trim();
        if (rule === 'DIRECT') return '';
        const match = /^(PROXY|HTTPS|SOCKS5?) (.+)$/.exec(rule);
        if (!match) fail('Unsupported system proxy');
        return `${match[1] === 'HTTPS' ? 'https' : match[1].startsWith('SOCKS') ? 'socks5' : 'http'}://${match[2]}`;
    };
    return new ProxyAgent(options);
}
module.exports = { validateConfig, createAgent };
