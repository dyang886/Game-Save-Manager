const { Readable, Transform } = require('stream');
const { randomUUID, createHash } = require('crypto');
const { safeKey } = require('../format');
function scopedKey(config, key) { return [config.prefix, safeKey(key)].filter(Boolean).join('/'); }
function progressStream(body, onProgress, { signal, expectedSize } = {}) {
    const stream = body && typeof body.pipe === 'function' ? body : Readable.from([body]);
    if (signal?.aborted) { stream.destroy(); signal.throwIfAborted(); }
    let transferred = 0;
    const counter = new Transform({
        transform(chunk, _encoding, callback) {
            try {
                transferred += chunk.length;
                if (expectedSize !== undefined && transferred > expectedSize) throw new Error('Upload size changed');
                onProgress?.(transferred);
                callback(null, chunk);
            } catch (error) { callback(error); }
        },
        flush(callback) { callback(expectedSize !== undefined && transferred !== expectedSize ? new Error('Upload size changed') : null); }
    });
    const sourceError = error => counter.destroy(error);
    const aborted = () => counter.destroy(Object.assign(new Error('Upload cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }));
    // The network handshake can finish after a source failure. Keep the error on
    // the stream until its consumer attaches rather than emitting it unhandled.
    counter.on('error', () => {});
    stream.once('error', sourceError);
    signal?.addEventListener('abort', aborted, { once: true });
    counter.once('close', () => {
        signal?.removeEventListener('abort', aborted);
        stream.removeListener('error', sourceError);
        stream.destroy();
    });
    return stream.pipe(counter);
}
async function probe(provider, { readOnly = false, signal } = {}) {
    const result = { authentication: false, list: false, write: null, readback: null, delete: null, residualKey: null };
    const failure = error => ({ code: error.code || 'PROBE_FAILED', status: error.status || error.$metadata?.httpStatusCode });
    try { await provider.list('gsm/', { signal }); }
    catch (error) { result.error = failure(error); return result; }
    result.authentication = result.list = true;
    if (readOnly) return result;
    const key = `gsm/probes/${randomUUID()}.bin`;
    const data = Buffer.from(randomUUID());
    result.residualKey = key;
    try {
        result.write = false;
        await provider.ensureContainer({ signal });
        await provider.put(key, { body: Readable.from([data]), size: data.length, signal, ifAbsent: true });
        result.write = true;
        result.readback = false;
        const hash = createHash('sha256'); let size = 0;
        for await (const chunk of await provider.get(key, { signal })) { size += chunk.length; if (size > data.length) throw Object.assign(new Error('Probe size mismatch'), { code: 'INTEGRITY_ERROR' }); hash.update(chunk); }
        if (size !== data.length || hash.digest('hex') !== createHash('sha256').update(data).digest('hex')) throw Object.assign(new Error('Probe checksum mismatch'), { code: 'INTEGRITY_ERROR' });
        result.readback = true;
    } catch (error) { result.error = failure(error); }
    try { await provider.delete(key, { signal }); result.delete = true; result.residualKey = null; }
    catch (error) { result.delete = false; result.error ||= failure(error); }
    return result;
}
module.exports = { scopedKey, progressStream, probe };
