// Shared display rules contain no network or Electron dependencies.
function snapshotDate(snapshot, locale) {
    const value = snapshot?.createdAt || snapshot?.backupConfig?.createdAt;
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale);
}

function snapshotTime(snapshot) {
    return Date.parse(snapshot?.createdAt || snapshot?.backupConfig?.createdAt || '') || 0;
}

function byteSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
    return `${Number((value / (1024 ** unit)).toFixed(2))} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}

function versionData(version) {
    return { ...version, ...(version.manifest || {}), versionId: version.versionId, targetId: version.targetId, deviceName: version.deviceName };
}

function filterVersions(versions, { targetId, deviceId = '', search = '' }) {
    const needle = search.trim().toLocaleLowerCase();
    return versions.map(versionData).filter(version =>
        (!targetId || version.targetId === targetId) &&
        (!deviceId || (version.publisherDeviceId || version.originDeviceId) === deviceId) &&
        (!needle || [version.gameTitle, version.title, version.gameKey, version.customName, version.zh_CN]
            .some(value => String(value || '').toLocaleLowerCase().includes(needle)))
    ).sort((a, b) => snapshotTime(b) - snapshotTime(a));
}

function jobActions(stage) {
    if (['pending', 'packaging', 'uploading', 'verifying', 'committing', 'retry_wait', 'downloading', 'importing', 'deleting'].includes(stage)) return ['pause', 'cancel'];
    if (stage === 'paused') return ['resume', 'cancel'];
    if (stage === 'failed') return ['retry', 'cancel'];
    return [];
}

module.exports = { snapshotDate, snapshotTime, byteSize, versionData, filterVersions, jobActions };
