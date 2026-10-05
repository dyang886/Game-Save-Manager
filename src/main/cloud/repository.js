const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { cloudError } = require('./queue');
const { validateManifest, snapshotPrefix } = require('./format');

const MAX_JSON_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function consume(stream, { maxBytes = Infinity, signal, onProgress, destination } = {}) {
    const hash = createHash('sha256');
    let size = 0;
    const chunks = [];
    const verifier = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(cloudError('INTEGRITY_ERROR'));
        hash.update(chunk);
        onProgress?.(size);
        if (!destination) chunks.push(chunk);
        callback(null, chunk);
    } });
    if (destination) await pipeline(stream, verifier, destination, { signal });
    else {
        verifier.resume();
        await pipeline(stream, verifier, { signal });
    }
    return { size, sha256: hash.digest('hex'), ...(destination ? {} : { buffer: Buffer.concat(chunks) }) };
}

// Archive verification must remain constant-memory even for multi-GiB objects.
async function hashStream(stream, { expectedSize, signal, onProgress } = {}) {
    const hash = createHash('sha256');
    let size = 0;
    const sink = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        if (size > expectedSize) return callback(cloudError('INTEGRITY_ERROR'));
        hash.update(chunk);
        onProgress?.(size);
        callback();
    } });
    sink.resume();
    await pipeline(stream, sink, { signal });
    return { size, sha256: hash.digest('hex') };
}

class CloudRepository {
    constructor(provider, config, device) { this.provider = provider; this.config = config; this.device = device; }

    root() {
        if (!UUID.test(this.config.repositoryId || '')) throw cloudError('INVALID_CONFIG');
        return `gsm/v1/${this.config.repositoryId}`;
    }

    async readJSON(key, signal) {
        const { buffer } = await consume(await this.provider.get(key, { signal }), { maxBytes: MAX_JSON_BYTES, signal });
        try { return JSON.parse(buffer.toString('utf8')); }
        catch (_) { throw cloudError('INTEGRITY_ERROR'); }
    }

    async putJSON(key, value, { signal, ifAbsent = false } = {}) {
        const buffer = Buffer.from(JSON.stringify(value));
        if (buffer.length > MAX_JSON_BYTES) throw cloudError('INVALID_CONFIG');
        await this.provider.put(key, { body: Readable.from(buffer), size: buffer.length, signal, ifAbsent });
    }

    async keys(prefix, signal) {
        const keys = [];
        let cursor;
        const cursors = new Set();
        do {
            const page = await this.provider.list(prefix, { cursor, signal });
            for (const item of page.items || []) {
                if (typeof item.key !== 'string' || !item.key.startsWith(prefix) || item.key.includes('\\') || item.key.split('/').some(part => part === '..' || part === '.')) continue;
                keys.push(item.key);
                if (keys.length > 100000) throw cloudError('QUOTA_EXCEEDED');
            }
            cursor = page.cursor;
            if (cursor && cursors.has(cursor)) throw cloudError('INTEGRITY_ERROR');
            if (cursor) cursors.add(cursor);
        } while (cursor);
        return keys;
    }

    async discover(signal) {
        const keys = await this.keys('gsm/', signal);
        const repositories = new Set();
        for (const key of keys) {
            const parts = key.split('/');
            if (parts[1] === 'v1' && UUID.test(parts[2])) repositories.add(parts[2]);
        }
        return [...repositories].sort().map(id => ({ id, repositoryId: id }));
    }

    async assertWritable(signal) {
        if (this.config.readOnly) throw cloudError('READ_ONLY');
        const key = `${this.root()}/repository.json`;
        if (await this.provider.stat(key, { signal })) {
            const info = await this.readJSON(key, signal);
            if (info.schemaVersion !== 1 || Number(info.minimumReaderVersion || 1) > 1) throw cloudError('UNSUPPORTED_FORMAT');
            if (info.repositoryId !== this.config.repositoryId) throw cloudError('INTEGRITY_ERROR');
        }
    }

    async create(signal) {
        if (this.config.readOnly) throw cloudError('READ_ONLY');
        await this.provider.ensureContainer?.({ signal });
        const info = { schemaVersion: 1, minimumReaderVersion: 1, repositoryId: this.config.repositoryId, createdAt: new Date().toISOString() };
        await this.putJSON(`${this.root()}/repository.json`, info, { signal, ifAbsent: true });
        const saved = await this.readJSON(`${this.root()}/repository.json`, signal);
        if (saved.repositoryId !== info.repositoryId || saved.schemaVersion !== 1) throw cloudError('INTEGRITY_ERROR');
        return info;
    }

    prefix(manifest) { return snapshotPrefix(manifest.repositoryId, manifest.publisherDeviceId, manifest.gameKey, manifest.snapshotId); }

    async isDeleted(prefix, signal) { return Boolean(await this.provider.stat(`${prefix}/deleted.json`, { signal })); }

    async readManifest(key, signal) {
        const manifest = await this.readJSON(key, signal);
        validateManifest(manifest, { repositoryId: this.config.repositoryId });
        if (`${this.prefix(manifest)}/manifest.json` !== key) throw cloudError('INTEGRITY_ERROR');
        return manifest;
    }

    async verifyPayload(manifest, { signal, onProgress } = {}) {
        const stat = await this.provider.stat(manifest.archiveKey, { signal });
        if (!stat || stat.size !== manifest.archiveSize) throw cloudError('INTEGRITY_ERROR');
        const digest = await hashStream(await this.provider.get(manifest.archiveKey, { signal }), { expectedSize: manifest.archiveSize, signal, onProgress });
        if (digest.size !== manifest.archiveSize || digest.sha256 !== manifest.archiveSha256) throw cloudError('INTEGRITY_ERROR');
    }

    async publish(manifest, archivePath, { signal, update = async () => {}, reportProgress = () => {}, checkpointMultipart = multipart => update({ multipart }) } = {}) {
        validateManifest(manifest, { repositoryId: this.config.repositoryId });
        await this.assertWritable(signal);
        const prefix = this.prefix(manifest);
        if (await this.isDeleted(prefix, signal)) throw cloudError('SNAPSHOT_DELETED');
        const manifestKey = `${prefix}/manifest.json`;
        const existing = await this.provider.stat(manifestKey, { signal });
        if (existing) {
            const committed = await this.readManifest(manifestKey, signal);
            if (committed.archiveSha256 !== manifest.archiveSha256 || committed.contentHash !== manifest.contentHash || !isDeepStrictEqual(committed.snapshotMetadata, manifest.snapshotMetadata) || !isDeepStrictEqual(committed.backup_paths, manifest.backup_paths)) throw cloudError('CONFLICT');
            await update({ stage: 'verifying' });
            await this.verifyPayload(committed, { signal, onProgress: completed => reportProgress({ completed, total: committed.archiveSize }) });
            return committed;
        }
        await update({ stage: 'uploading', progress: { completed: 0, total: manifest.archiveSize } });
        let uploadError;
        try { await this.provider.put(manifest.archiveKey, { body: fs.createReadStream(archivePath), size: manifest.archiveSize, signal,
            onMultipart: checkpointMultipart,
            onProgress: completed => reportProgress({ completed, total: manifest.archiveSize })
        }); }
        catch (error) { uploadError = error; if (signal?.aborted) throw error; }
        await update({ stage: 'verifying', progress: { completed: 0, total: manifest.archiveSize } });
        try { await this.verifyPayload(manifest, { signal, onProgress: completed => reportProgress({ completed, total: manifest.archiveSize }) }); }
        catch (error) { throw uploadError || error; }
        // Device metadata aids discovery but a complete manifest remains sufficient.
        await this.putJSON(`${this.root()}/devices/${this.device.id}/device.json`, { schemaVersion: 1, deviceId: this.device.id, name: this.device.name }, { signal });
        if (await this.isDeleted(prefix, signal)) throw cloudError('SNAPSHOT_DELETED');
        await update({ stage: 'committing', progress: null });
        let commitError;
        try { await this.putJSON(manifestKey, manifest, { signal, ifAbsent: true }); }
        catch (error) { commitError = error; if (signal?.aborted) throw error; }
        let saved;
        try { saved = await this.readManifest(manifestKey, signal); }
        catch (error) { throw commitError || error; }
        if (saved.archiveSha256 !== manifest.archiveSha256 || saved.contentHash !== manifest.contentHash || saved.archiveSize !== manifest.archiveSize || !isDeepStrictEqual(saved.snapshotMetadata, manifest.snapshotMetadata) || !isDeepStrictEqual(saved.backup_paths, manifest.backup_paths)) throw cloudError('CONFLICT');
        if (await this.isDeleted(prefix, signal)) throw cloudError('SNAPSHOT_DELETED');
        return saved;
    }

    async browse(signal) {
        const keys = await this.keys(`${this.root()}/devices/`, signal);
        const manifests = [];
        let invalidCount = 0;
        for (const key of keys.filter(key => key.endsWith('/manifest.json'))) {
            try {
                if (await this.isDeleted(key.slice(0, -'/manifest.json'.length), signal)) continue;
                const manifest = await this.readManifest(key, signal);
                const payload = await this.provider.stat(manifest.archiveKey, { signal });
                if (!payload || payload.size !== manifest.archiveSize) { invalidCount++; continue; }
                manifests.push(manifest);
            } catch (error) {
                if (error.code === 'UNSUPPORTED_FORMAT') throw error;
                if (['INTEGRITY_ERROR', 'INVALID_MANIFEST', 'INVALID_KEY', 'NOT_FOUND'].includes(error.code) || error.statusCode === 404) invalidCount++;
                else throw error;
            }
        }
        const deviceNames = {};
        for (const deviceId of new Set(manifests.map(manifest => manifest.publisherDeviceId))) {
            if (!UUID.test(deviceId)) continue;
            try {
                const info = await this.readJSON(`${this.root()}/devices/${deviceId}/device.json`, signal);
                if (!info || Array.isArray(info) || info.schemaVersion !== 1 || info.deviceId !== deviceId ||
                    typeof info.name !== 'string' || !info.name.trim() || info.name.length > 100 || /[\x00-\x1f\x7f]/.test(info.name)) continue;
                deviceNames[deviceId] = info.name.trim();
            } catch (error) {
                // Device labels are optional. A missing or corrupt label cannot hide a committed snapshot.
                if (signal?.aborted) throw error;
            }
        }
        return { manifests, invalidCount, deviceNames };
    }

    async download(manifest, output, { signal, update = async () => {}, reportProgress = () => {} } = {}) {
        const current = await this.readManifest(`${this.prefix(manifest)}/manifest.json`, signal);
        if (await this.isDeleted(this.prefix(current), signal)) throw cloudError('SNAPSHOT_DELETED');
        if (current.archiveSha256 !== manifest.archiveSha256) throw cloudError('CONFLICT');
        await update({ stage: 'downloading', progress: { completed: 0, total: current.archiveSize } });
        const partial = `${output}.partial`;
        try {
            const result = await consume(await this.provider.get(current.archiveKey, { signal }), { maxBytes: current.archiveSize, signal, onProgress: completed => reportProgress({ completed, total: current.archiveSize }), destination: fs.createWriteStream(partial, { flags: 'w', mode: 0o600 }) });
            if (result.size !== current.archiveSize || result.sha256 !== current.archiveSha256) throw cloudError('INTEGRITY_ERROR');
            const handle = await fsp.open(partial, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
            await fsp.rename(partial, output);
            return current;
        } catch (error) { await fsp.unlink(partial).catch(() => {}); throw error; }
    }

    async delete(manifest, { signal, update = async () => {} } = {}) {
        await this.assertWritable(signal);
        const prefix = this.prefix(manifest);
        await update({ stage: 'deleting' });
        if (!await this.isDeleted(prefix, signal)) {
            const current = await this.readManifest(`${prefix}/manifest.json`, signal);
            if (current.archiveSha256 !== manifest.archiveSha256) throw cloudError('CONFLICT');
            const tombstone = { schemaVersion: 1, repositoryId: manifest.repositoryId, snapshotId: manifest.snapshotId, publisherDeviceId: manifest.publisherDeviceId, archiveSha256: manifest.archiveSha256, deletedAt: new Date().toISOString(), deletionId: randomUUID() };
            await this.putJSON(`${prefix}/deleted.json`, tombstone, { signal, ifAbsent: true });
        }
        const committed = await this.readJSON(`${prefix}/deleted.json`, signal);
        if (committed.schemaVersion !== 1 || committed.snapshotId !== manifest.snapshotId || committed.archiveSha256 !== manifest.archiveSha256) throw cloudError('INTEGRITY_ERROR');
        // Keep the tombstone even if any subsequent delete is interrupted.
        for (const key of [`${prefix}/manifest.json`, manifest.archiveKey]) {
            try { await this.provider.delete(key, { signal }); }
            catch (error) { if (error.statusCode !== 404 && error.status !== 404 && error.name !== 'NoSuchKey' && error.code !== 'NOT_FOUND') throw error; }
        }
        return { deleted: true, snapshotId: manifest.snapshotId };
    }
}

module.exports = { CloudRepository, consume, hashStream, UUID };
