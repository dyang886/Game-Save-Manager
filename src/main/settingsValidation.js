const path = require('path');
const GAME = /^(?:\d+|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const text = value => typeof value === 'string' && value.length <= 32767 && !/[\x00-\x1f]/.test(value);
const boolean = value => typeof value === 'boolean';
const games = value => Array.isArray(value) && value.length <= 100000 && value.every(id => GAME.test(String(id)));
const VALIDATORS = {
    theme: value => ['dark', 'light', 'system'].includes(value),
    language: value => ['zh_CN', 'zh_TW', 'en_US', 'pt_BR'].includes(value),
    backupPath: value => text(value) && path.isAbsolute(value),
    exportPath: value => text(value) && (!value || path.isAbsolute(value)),
    maxBackups: value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000,
    launchAtStartup: boolean, autoAppUpdate: boolean, autoDbUpdate: boolean, backupAllAccounts: boolean, saveUninstalledGames: boolean,
    gameInstalls: value => value === 'uninitialized' || Array.isArray(value) && value.length <= 10000 && value.every(entry => text(entry) && path.isAbsolute(entry)),
    pinnedGames: games, hiddenGames: games, uninstalledGames: games,
    autoBackupGames: value => value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([id, item]) =>
        GAME.test(id) && item && typeof item === 'object' && Object.keys(item).every(key => ['mode', 'intervalMinutes', 'interval'].includes(key)) &&
        ['interval', 'watcher'].includes(item.mode) && (item.mode !== 'interval' || Number.isFinite(Number(item.intervalMinutes)) && Number(item.intervalMinutes) > 0)),
    uid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)
};
function validateSettingsUpdates(updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return false;
    return Object.entries(updates).every(([key, value]) => Object.hasOwn(VALIDATORS, key) && VALIDATORS[key](value));
}
function publicSettings(settings) {
    return Object.fromEntries(Object.entries(settings).filter(([key, value]) => Object.hasOwn(VALIDATORS, key) && VALIDATORS[key](value)));
}
module.exports = { validateSettingsUpdates, publicSettings };
