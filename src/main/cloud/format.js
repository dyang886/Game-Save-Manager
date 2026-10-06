const FORMAT_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
function invalid(message) { const e = new Error(message); e.code = 'INVALID_MANIFEST'; throw e; }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid('Invalid identity'); return value; }
function gameParts(value) {
    if (typeof value !== 'string') invalid('Invalid game identity');
    const [type, id, extra] = value.split(':');
    if (extra || !(type === 'pcgw' && /^\d{1,20}$/.test(id) || type === 'custom' && UUID.test(id))) invalid('Invalid game identity');
    return [type, id];
}
function safeKey(key) {
    if (typeof key !== 'string' || key.length > 2048 || !key || key.startsWith('/') || key.split('/').some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f\x7f?#%]/.test(p))) invalid('Unsafe object key');
    return key;
}
function snapshotPrefix(repositoryId, publisherDeviceId, gameKey, snapshotId) {
    return `gsm/v1/${uuid(repositoryId)}/devices/${uuid(publisherDeviceId)}/games/${gameParts(gameKey).join('/')}/${uuid(snapshotId)}`;
}
function validateManifest(m, expected = {}) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) invalid('Invalid manifest');
    if (m.schemaVersion !== 1 || m.minimumReaderVersion !== 1) { const e = new Error('Unsupported cloud format; update the application'); e.code = 'UNSUPPORTED_FORMAT'; throw e; }
    uuid(m.originDeviceId);
    const prefix = snapshotPrefix(m.repositoryId, m.publisherDeviceId, m.gameKey, m.snapshotId);
    for (const key of ['archiveSha256', 'contentHash']) if (!HASH.test(m[key] || '')) invalid(`Invalid ${key}`);
    if (m.archiveKey !== `${prefix}/payload-${m.archiveSha256}.gsmr`) invalid('Archive outside snapshot');
    for (const key of ['archiveSize', 'unpackedSize', 'fileCount']) if (!Number.isSafeInteger(m[key]) || m[key] < 0) invalid(`Invalid ${key}`);
    if (!m.archiveSize || !m.fileCount || m.fileCount > 1000000) invalid('Invalid archive limits');
    for (const key of ['createdAt', 'uploadedAt']) if (typeof m[key] !== 'string' || !Number.isFinite(Date.parse(m[key]))) invalid(`Invalid ${key}`);
    if (typeof m.title !== 'string' || m.title.length > 1000) invalid('Invalid title');
    if (!Array.isArray(m.backup_paths) || !m.backup_paths.length || m.backup_paths.length > 1000) invalid('Invalid backup paths');
    for (const p of m.backup_paths) {
        if (!p || !/^path[1-9]\d*$/.test(p.folder_name) || !['file', 'folder', 'reg'].includes(p.type) || typeof p.template !== 'string' || p.template.length > 32768) invalid('Invalid restore entry');
    }
    if (new Set(m.backup_paths.map(p => p.folder_name)).size !== m.backup_paths.length) invalid('Duplicate restore entry');
    for (const key of ['repositoryId', 'publisherDeviceId', 'snapshotId', 'gameKey', 'archiveKey']) if (expected[key] !== undefined && expected[key] !== m[key]) invalid(`Mismatched ${key}`);
    return m;
}
module.exports = { FORMAT_VERSION, UUID, HASH, uuid, gameParts, safeKey, snapshotPrefix, validateManifest };
