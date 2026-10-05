const {
    S3Client, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
    CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand
} = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { createAgent } = require('../config');
const { safeKey } = require('../format');
const { scopedKey, progressStream, probe } = require('./common');

async function* parts(body, partSize) {
    let chunks = [], size = 0;
    for await (const value of body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        let offset = 0;
        while (offset < chunk.length) {
            const length = Math.min(partSize - size, chunk.length - offset);
            chunks.push(chunk.subarray(offset, offset + length)); size += length; offset += length;
            if (size === partSize) { yield Buffer.concat(chunks, size); chunks = []; size = 0; }
        }
    }
    if (size) yield Buffer.concat(chunks, size);
}
function createS3(config, secrets = {}, options = {}) {
    if (!secrets.accessKeyId || !secrets.secretAccessKey) throw Object.assign(new Error('S3 credentials are required'), { code: 'CREDENTIALS_REQUIRED' });
    const agent = createAgent(config, secrets, options.resolveProxy);
    const client = options.client || new S3Client({
        endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey, ...(secrets.sessionToken ? { sessionToken: secrets.sessionToken } : {}) },
        requestHandler: new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent, connectionTimeout: 15000, socketTimeout: 60000 }),
        followRegionRedirects: false, maxAttempts: 3,
        requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED'
    });
    const params = key => ({ Bucket: config.bucket, Key: scopedKey(config, key) });
    const send = (Command, input, signal) => client.send(new Command(input), { abortSignal: signal });
    const provider = {
        capabilities: { conditionalCreate: true, reliableChecksum: false, multipart: true, range: false, delete: !config.readOnly },
        async ensureContainer() { /* The user supplies an existing bucket; never create buckets. */ },
        async list(prefix = 'gsm/', { cursor, signal } = {}) {
            safeKey(prefix.replace(/\/$/, ''));
            const fullPrefix = [config.prefix, prefix].filter(Boolean).join('/');
            const result = await send(ListObjectsV2Command, { Bucket: config.bucket, Prefix: fullPrefix, MaxKeys: 1000, ...(cursor ? { ContinuationToken: cursor } : {}) }, signal);
            const items = (result.Contents || []).filter(o => !o.Key.endsWith('/')).map(o => {
                if (!o.Key.startsWith(fullPrefix)) throw new Error('Out-of-scope S3 response');
                const key = config.prefix ? o.Key.slice(config.prefix.length + 1) : o.Key;
                safeKey(key); return { key, size: o.Size };
            });
            if (result.IsTruncated && !result.NextContinuationToken) throw new Error('Missing S3 pagination token');
            return { items, cursor: result.IsTruncated ? result.NextContinuationToken : null };
        },
        async stat(key, { signal } = {}) {
            try { const r = await send(HeadObjectCommand, params(key), signal); return { size: r.ContentLength, etag: r.ETag }; }
            catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return null; throw e; }
        },
        async put(key, { body, size, signal, onProgress, ifAbsent = false, onMultipart }) {
            if (config.readOnly) throw Object.assign(new Error('Read-only connection'), { code: 'READ_ONLY' });
            if (!Number.isSafeInteger(size) || size < 0) throw new Error('Known object size required');
            const input = progressStream(body, onProgress, { signal, expectedSize: size });
            try {
                // Manifests are small conditional PUTs. Large immutable payloads use bounded parts.
                if (size < (options.multipartThreshold || 64 * 1024 * 1024)) {
                    await send(PutObjectCommand, { ...params(key), Body: input, ContentLength: size, ...(ifAbsent ? { IfNoneMatch: '*' } : {}) }, signal);
                    return;
                }
                const created = await send(CreateMultipartUploadCommand, params(key), signal);
                const UploadId = created.UploadId;
                if (!UploadId) { input.destroy(); throw new Error('S3 omitted multipart upload ID'); }
                try {
                    await onMultipart?.({ key, uploadId: UploadId });
                    const uploaded = []; let number = 1, total = 0;
                    const partSize = Math.max(options.partSize || 8 * 1024 * 1024, Math.ceil(size / 9999));
                    if (partSize > 256 * 1024 * 1024) throw new Error('Archive exceeds multipart memory limit');
                    for await (const part of parts(input, partSize)) {
                        const result = await send(UploadPartCommand, { ...params(key), UploadId, PartNumber: number, Body: part, ContentLength: part.length }, signal);
                        if (!result.ETag) throw new Error('S3 omitted part ETag');
                        uploaded.push({ PartNumber: number++, ETag: result.ETag }); total += part.length;
                    }
                    if (total !== size) throw new Error('Upload size changed');
                    await send(CompleteMultipartUploadCommand, { ...params(key), UploadId, MultipartUpload: { Parts: uploaded }, ...(ifAbsent ? { IfNoneMatch: '*' } : {}) }, signal);
                    await onMultipart?.(null);
                } catch (e) {
                    // Only abort the ID created by this task, never enumerate or sweep others' uploads.
                    await provider.abortMultipart(key, UploadId, { signal: AbortSignal.timeout(15000) }).then(() => onMultipart?.(null)).catch(() => {});
                    throw e;
                }
            } finally { input.destroy(); }
        },
        async abortMultipart(key, uploadId, { signal } = {}) {
            if (typeof uploadId !== 'string' || !uploadId || uploadId.length > 2048 || /[\x00-\x1f]/.test(uploadId)) throw new Error('Invalid multipart upload ID');
            try { await send(AbortMultipartUploadCommand, { ...params(key), UploadId: uploadId }, signal); }
            catch (error) { if (error.name !== 'NoSuchUpload' && error.$metadata?.httpStatusCode !== 404) throw error; }
        },
        async get(key, { signal } = {}) {
            const result = await send(GetObjectCommand, params(key), signal);
            if (!result.Body || typeof result.Body.pipe !== 'function') { result.Body?.destroy?.(); throw new Error('S3 omitted streaming body'); }
            const aborted = () => result.Body.destroy(Object.assign(new Error('Download cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }));
            result.Body.on('error', () => {});
            result.Body.once('close', () => signal?.removeEventListener('abort', aborted));
            signal?.addEventListener('abort', aborted, { once: true });
            if (signal?.aborted) aborted();
            return result.Body;
        },
        async delete(key, { signal } = {}) {
            if (config.readOnly) throw Object.assign(new Error('Read-only connection'), { code: 'READ_ONLY' });
            await send(DeleteObjectCommand, params(key), signal);
        },
        close() { client.destroy(); agent.destroy(); }
    };
    provider.probe = options => probe(provider, { readOnly: config.readOnly, ...options });
    return provider;
}
module.exports = { createS3, parts };
