const http = require('http');
const https = require('https');

const DOWNLOAD_REDIRECTS = new Set([301, 302, 303, 307, 308]);
const PUBLIC_DOWNLOAD_HEADERS = new Set(['accept', 'accept-encoding', 'user-agent', 'range', 'if-range']);

// WebDAV file GETs may redirect to a signed CDN URL. Keep authentication on
// the original origin only; never replay writes, downgrade TLS, or follow an
// unbounded chain. The same bounded response parsing applies on every hop.
function request(options) { return requestHop(options, new Set(), 0); }

function requestHop(options, visited, redirects) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        url.hash = '';
        visited.add(url.href);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: options.method, headers: options.headers, signal: options.signal,
            agent: url.protocol === 'https:' ? options.httpsAgent : options.httpAgent
        });
        req.setTimeout(60000, () => req.destroy(Object.assign(new Error('Request timeout'), { code: 'ETIMEDOUT' })));
        req.on('error', reject);
        req.on('response', res => {
            // The SDK throws for error statuses without consuming their bodies.
            // Close those responses here so an auth failure cannot occupy a pool
            // connection indefinitely or leave a large upload source running.
            if (res.statusCode >= 300) {
                const redirected = res.statusCode < 400;
                let next;
                if (DOWNLOAD_REDIRECTS.has(res.statusCode) && String(options.method).toUpperCase() === 'GET' && !options.data && redirects < 5 && res.headers.location) {
                    try {
                        const candidate = new URL(res.headers.location, url);
                        candidate.hash = '';
                        // An explicitly configured HTTP server can redirect
                        // within its origin, or upgrade to HTTPS.
                        const secure = candidate.protocol === 'https:' || (url.protocol === 'http:' && candidate.origin === url.origin);
                        if (secure && !candidate.username && !candidate.password && !visited.has(candidate.href)) next = candidate;
                    } catch { /* Invalid or unsupported Location is reported without its URL. */ }
                }
                const error = Object.assign(new Error(redirected ? 'Unsafe or excessive WebDAV redirect refused' : `WebDAV request failed (${res.statusCode})`), {
                    ...(redirected ? { code: 'REDIRECT_REFUSED' } : {}), status: res.statusCode,
                    response: { status: res.statusCode, headers: res.headers },
                });
                res.destroy();
                req.destroy();
                if (next) {
                    const headers = next.origin === url.origin ? options.headers : Object.fromEntries(
                        Object.entries(options.headers || {}).filter(([name]) => PUBLIC_DOWNLOAD_HEADERS.has(name.toLowerCase()))
                    );
                    // Continue below the SDK so it cannot re-attach credentials
                    // to the redirected URL. Dropped headers stay dropped.
                    resolve(requestHop({ ...options, url: next.href, headers }, visited, redirects + 1));
                    return;
                }
                reject(error);
                return;
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
            let textPromise;
            const response = {
                status: res.statusCode, statusText: http.STATUS_CODES[res.statusCode], ok: res.statusCode < 400,
                headers, body: res,
                text() {
                    return textPromise ||= (async () => {
                        const chunks = []; let size = 0;
                        for await (const chunk of res) {
                            size += chunk.length;
                            if (size > 16 * 1024 * 1024) { res.destroy(); throw new Error('WebDAV response exceeds 16 MiB'); }
                            chunks.push(chunk);
                        }
                        const text = Buffer.concat(chunks).toString('utf8');
                        if (res.statusCode === 207) {
                            // Never silently drop per-resource failures from a multistatus.
                            if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('WebDAV XML declarations are not supported');
                            let statuses = 0;
                            for (const match of text.matchAll(/<(?:[\w.-]+:)?status\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?status\s*>/gi)) {
                                const value = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1')
                                    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code))).trim();
                                const status = /^HTTP\/[\d.]+\s+(\d{3})(?:\s|$)/i.exec(value);
                                if (!status) throw new Error('WebDAV multistatus contains an invalid resource status');
                                statuses++;
                                if (Number(status[1]) >= 300) throw Object.assign(new Error('WebDAV multistatus contains a failed resource'), { status: Number(status[1]), response: { status: 207 }, code: 'MULTISTATUS_FAILED' });
                            }
                            if (!statuses) throw new Error('WebDAV multistatus omitted resource statuses');
                        }
                        return text;
                    })();
                }
            };
            // webdav's MKCOL and HEAD helpers do not read their response body.
            // Drain them before resolving, with the same size/207 checks as XML.
            if (['MKCOL', 'HEAD'].includes(String(options.method).toUpperCase())) response.text().then(() => resolve(response), reject);
            else resolve(response);
        });
        if (options.data && typeof options.data.pipe === 'function') {
            options.data.once('error', error => req.destroy(error));
            req.once('close', () => options.data.destroy());
            options.data.once('close', () => { if (!req.writableEnded) req.destroy(); });
            options.data.pipe(req);
        } else req.end(options.data);
    });
}
module.exports = { request };
