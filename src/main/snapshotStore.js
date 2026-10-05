const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const metadataLocks = new Map();

function validateGameId(value) {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new Error('Invalid game ID');
    return id;
}

function validateSegment(value) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.length > 240 ||
        /[\\/:*?"<>|\x00-\x1f]/.test(value) || /[. ]$/.test(value) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
        throw new Error('Invalid snapshot path');
    }
    return value;
}

function inside(root, candidate, allowRoot = false) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return (allowRoot || relative !== '') && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function snapshotPath(root, gameId, folder) {
    if (typeof folder !== 'string' || folder.startsWith('.')) throw new Error('Temporary snapshots are not accessible');
    const result = path.resolve(root, validateGameId(gameId), validateSegment(folder));
    if (!inside(root, result)) throw new Error('Snapshot is outside backup root');
    return result;
}

async function assertNoLinks(target, ancestor = path.parse(path.resolve(target)).root) {
    const resolved = path.resolve(target);
    const boundary = path.resolve(ancestor);
    if (!inside(boundary, resolved, true)) throw new Error('Path is outside permitted root');
    let current = boundary;
    const relative = path.relative(boundary, resolved);
    for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
        if (segment) current = path.join(current, segment);
        try {
            const stat = await fs.promises.lstat(current);
            if (stat.isSymbolicLink()) throw new Error('Symbolic links and reparse points are not supported');
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
    }
}

function normalizeMetadata(metadata, gameId, folder) {
    validateGameId(gameId);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid snapshot metadata');
    if ((metadata.schemaVersion ?? 1) > 1 || (metadata.minimumReaderVersion ?? 1) > 1) throw new Error('Snapshot format requires a newer application');
    if (!Array.isArray(metadata.backup_paths) || !metadata.backup_paths.length) throw new Error('Snapshot has no save paths');
    const folders = new Set();
    for (const entry of metadata.backup_paths) {
        if (!entry || !['file', 'folder', 'reg'].includes(entry.type) || typeof entry.template !== 'string' || entry.template.length > 32767) throw new Error('Invalid snapshot save path');
        validateSegment(entry.folder_name);
        const key = entry.folder_name.toLowerCase();
        if (folders.has(key)) throw new Error('Duplicate snapshot save path');
        folders.add(key);
        if (entry.file_name) validateSegment(entry.file_name);
        if (entry.originalMissing !== undefined && typeof entry.originalMissing !== 'boolean') throw new Error('Invalid missing-target record');
        if (entry.originalMissing && metadata.restoreProtection !== true) throw new Error('Missing-target records require a protection snapshot');
    }
    if (metadata.snapshotId && !UUID.test(metadata.snapshotId)) throw new Error('Invalid snapshot identity');
    const gameKey = `${/^\d+$/.test(String(gameId)) ? 'pcgw' : 'custom'}:${gameId}`;
    if (metadata.gameKey && metadata.gameKey !== gameKey) throw new Error('Snapshot game identity does not match its folder');
    let createdAt = metadata.createdAt;
    const legacy = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})$/.exec(folder);
    if (!createdAt && legacy) createdAt = new Date(+legacy[1], +legacy[2] - 1, +legacy[3], +legacy[4], +legacy[5]).toISOString();
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid snapshot creation time');
    return {
        ...metadata, gameKey, createdAt: new Date(createdAt).toISOString(),
        ...(legacy && !metadata.createdAt ? { legacyDate: folder, timezoneUncertain: true } : {}),
    };
}

async function readSnapshot(root, gameId, folder) {
    gameId = validateGameId(gameId);
    const directory = snapshotPath(root, gameId, folder);
    await assertNoLinks(directory);
    if (!(await fs.promises.stat(directory)).isDirectory()) throw new Error('Snapshot is not a directory');
    const config = path.join(directory, 'backup_info.json');
    await assertNoLinks(config, directory);
    if ((await fs.promises.stat(config)).size > 2 * 1024 * 1024) throw new Error('Snapshot metadata is too large');
    const metadata = normalizeMetadata(JSON.parse(await fs.promises.readFile(config, 'utf8')), gameId, folder);
    return { ...metadata, root: path.resolve(root), gameId, folder, date: folder, path: directory, metadata };
}

async function listSnapshots(root, gameId) {
    let games;
    try {
        await assertNoLinks(root);
        games = gameId === undefined || gameId === null ?
            (await fs.promises.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name) : [validateGameId(gameId)];
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const snapshots = [];
    for (const id of games) {
        let entries;
        try { entries = await fs.promises.readdir(path.join(root, id), { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            try { snapshots.push(await readSnapshot(root, id, entry.name)); }
            catch { /* Incomplete, quarantined, or invalid versions are never discoverable. */ }
        }
    }
    return snapshots.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.folder.localeCompare(a.folder));
}

async function atomicWriteJson(filename, data) {
    await assertNoLinks(path.dirname(filename));
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    let handle;
    try {
        handle = await fs.promises.open(temporary, 'wx');
        await handle.writeFile(`${JSON.stringify(data, null, 4)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.promises.rename(temporary, filename);
    } finally {
        if (handle) await handle.close().catch(() => {});
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
}

async function updateMetadata(snapshot, update) {
    const key = path.resolve(snapshot.path);
    const previous = metadataLocks.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
        const current = await readSnapshot(snapshot.root, snapshot.gameId, snapshot.folder);
        const metadata = normalizeMetadata(await update(current.metadata), current.gameId, current.folder);
        await atomicWriteJson(path.join(current.path, 'backup_info.json'), metadata);
        return readSnapshot(snapshot.root, snapshot.gameId, snapshot.folder);
    });
    metadataLocks.set(key, pending);
    try { return await pending; } finally { if (metadataLocks.get(key) === pending) metadataLocks.delete(key); }
}

async function ensureIdentity(snapshot, deviceId) {
    if (deviceId && !UUID.test(deviceId)) throw new Error('Invalid device identity');
    return updateMetadata(snapshot, metadata => ({
        ...metadata, schemaVersion: 1, minimumReaderVersion: 1,
        snapshotId: metadata.snapshotId || crypto.randomUUID(),
        ...(metadata.originDeviceId || deviceId ? { originDeviceId: metadata.originDeviceId || deviceId } : {}),
    }));
}

async function markUploadIntentCompleted(snapshot, errorCode) {
    return updateMetadata(snapshot, metadata => metadata.cloudUploadIntent ? {
        ...metadata,
        cloudUploadIntent: { ...metadata.cloudUploadIntent, state: 'completed', ...(errorCode ? { errorCode } : {}) },
    } : metadata);
}

function newSnapshotIdentity(now = new Date()) {
    const createdAt = now.toISOString();
    const snapshotId = crypto.randomUUID();
    return { createdAt, snapshotId, folder: `${createdAt.replace(/[:.]/g, '-')}_${snapshotId}` };
}

async function scanTree(directory, relative = '', { signal } = {}) {
    signal?.throwIfAborted();
    await assertNoLinks(directory);
    const entries = [];
    for (const child of (await fs.promises.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        signal?.throwIfAborted();
        validateSegment(child.name);
        const absolute = path.join(directory, child.name);
        const name = relative ? `${relative}/${child.name}` : child.name;
        const stat = await fs.promises.lstat(absolute);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Snapshot contains unsupported filesystem entries');
        if (stat.isDirectory()) { entries.push({ path: name, type: 'directory' }); entries.push(...await scanTree(absolute, name, { signal })); }
        else {
            const hash = crypto.createHash('sha256');
            for await (const chunk of fs.createReadStream(absolute, { signal })) hash.update(chunk);
            entries.push({ path: name, type: 'file', size: stat.size, sha256: hash.digest('hex') });
        }
    }
    return entries;
}

async function computeContentHash(directory, metadata, options = {}) {
    const entries = (await scanTree(directory, '', options)).filter(entry => entry.path !== 'backup_info.json');
    const paths = metadata.backup_paths.map(entry => ({
        folder_name: entry.folder_name, template: entry.template, type: entry.type,
        install_folder: entry.install_folder || null, file_name: entry.file_name || null,
        originalMissing: !!entry.originalMissing,
    })).sort((a, b) => a.folder_name.localeCompare(b.folder_name));
    return crypto.createHash('sha256').update(JSON.stringify({ paths, entries })).digest('hex');
}

async function copyTree(source, target, { signal } = {}) {
    signal?.throwIfAborted();
    const stat = await fs.promises.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links and reparse points are not supported');
    if (!stat.isDirectory()) {
        if (!stat.isFile()) throw new Error('Only regular files and directories can be backed up');
        if (signal) await pipeline(fs.createReadStream(source), fs.createWriteStream(target), { signal });
        else await fs.promises.copyFile(source, target);
        return;
    }
    await fs.promises.mkdir(target, { recursive: true });
    for (const entry of await fs.promises.readdir(source)) {
        validateSegment(entry);
        await copyTree(path.join(source, entry), path.join(target, entry), { signal });
    }
}

async function importSnapshotUnlocked(root, stagedDir, importedMetadata) {
    const gameId = validateGameId(importedMetadata.gameId ?? importedMetadata.gameKey?.split(':')[1]);
    const identity = newSnapshotIdentity(new Date(importedMetadata.createdAt));
    const folder = identity.folder.replace(identity.snapshotId, importedMetadata.snapshotId || identity.snapshotId);
    const metadata = normalizeMetadata({ ...importedMetadata, snapshotId: importedMetadata.snapshotId || identity.snapshotId, schemaVersion: importedMetadata.schemaVersion ?? 1, minimumReaderVersion: importedMetadata.minimumReaderVersion ?? 1, cloudImported: true }, gameId, folder);
    delete metadata.cloudUploadIntent;
    delete metadata.gameId;
    for (const entry of metadata.backup_paths) {
        const source = path.join(stagedDir, entry.folder_name);
        await assertNoLinks(source, stagedDir);
        if (!(await fs.promises.stat(source)).isDirectory()) throw new Error('Imported snapshot is incomplete');
        // Imported protection snapshots still require explicit destination
        // mapping/registry confirmation before they can remove a target.
        if (entry.originalMissing) {
            if ((await fs.promises.readdir(source)).length) throw new Error('Missing-target records must not contain payloads');
            continue;
        }
        if (entry.type === 'reg' && !(await fs.promises.stat(path.join(source, 'registry_backup.reg'))).isFile()) throw new Error('Imported registry snapshot is incomplete');
        if (entry.type === 'file') {
            const files = await fs.promises.readdir(source, { withFileTypes: true });
            if (files.length !== 1 || !files[0].isFile() || (entry.file_name && files[0].name !== entry.file_name)) throw new Error('Imported file snapshot is incomplete');
        }
    }
    const contentHash = await computeContentHash(stagedDir, metadata);
    const existing = (await listSnapshots(root, gameId)).find(snapshot => snapshot.snapshotId === metadata.snapshotId);
    if (existing && await computeContentHash(existing.path, existing.metadata) === contentHash) return { snapshot: existing, duplicate: true, conflict: false };
    const destination = existing ? path.join(path.resolve(root), '.conflicts', gameId, `${metadata.snapshotId}_${crypto.randomUUID()}`) : snapshotPath(root, gameId, folder);
    await assertNoLinks(path.dirname(destination));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const temporary = path.join(path.dirname(destination), `.import-${crypto.randomUUID()}`);
    try {
        await copyTree(stagedDir, temporary);
        await atomicWriteJson(path.join(temporary, 'backup_info.json'), metadata);
        if (existing) await atomicWriteJson(path.join(temporary, 'conflict.json'), { snapshotId: metadata.snapshotId, existingFolder: existing.folder, importedAt: new Date().toISOString(), contentHash });
        await fs.promises.rename(temporary, destination);
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
    if (existing) return { snapshot: existing, duplicate: false, conflict: true, quarantinedPath: destination };
    return { snapshot: await readSnapshot(root, gameId, folder), duplicate: false, conflict: false };
}

async function importSnapshot(root, stagedDir, metadata) {
    const gameId = validateGameId(metadata.gameId ?? metadata.gameKey?.split(':')[1]);
    return require('./backupCoordinator').withGameLock(gameId, () => importSnapshotUnlocked(root, stagedDir, metadata));
}

module.exports = {
    listSnapshots, readSnapshot, ensureIdentity, importSnapshot, normalizeMetadata, newSnapshotIdentity,
    validateGameId, validateSegment, snapshotPath, inside, assertNoLinks, atomicWriteJson,
    updateMetadata, markUploadIntentCompleted, scanTree, computeContentHash, copyTree,
};
