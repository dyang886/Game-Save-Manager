const { contextBridge, ipcRenderer } = require('electron');

const channels = {
  send: new Set(['load-theme', 'update-app', 'update-status', 'show-row-menu', 'hide-row-menu', 'row-menu-measured',
    'row-menu-action', 'open-backup-folder', 'browse-local-save', 'migrate-backups', 'export-backups', 'import-backups', 'update-backup-table']),
  receive: new Set(['apply-theme', 'apply-language', 'show-alert', 'open-export-modal', 'open-import-modal', 'update-progress',
    'view_account_ids', 'app-update-ended', 'update-backup-table', 'update-restore-table', 'scan-full', 'open-hidden-games-modal',
    'auto-backup-started', 'auto-backup-stopped', 'auto-backup-performed', 'row-menu-action', 'render-row-menu']),
  invoke: new Set(['get-current-version', 'get-latest-version', 'translate', 'open-url', 'get-settings', 'start-scan-full',
    'fetch-backup-table-data', 'fetch-restore-table-data', 'save-settings', 'get-icon-map', 'get-auto-backup-state', 'backup-game',
    'update-database', 'get-uuid', 'get-platform', 'select-path', 'save-custom-entries', 'load-custom-entries', 'sort-games',
    'stop-auto-backup', 'start-auto-backup', 'confirm-delete-local-save', 'update-backup-info', 'confirm-delete-backup',
    'get-game-titles', 'restore-game', 'open-backup-dialog', 'get-detected-game-paths', 'open-dialog', 'get-account-data', 'get-status'])
};
function validateChannel(kind, channel) {
  if (!channels[kind].has(channel)) throw new Error('Unsupported IPC channel');
}
function subscribe(channel, listener) {
  if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
  const wrapped = (_event, ...args) => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}
const cloudMethods = ['getState', 'saveTarget', 'removeTarget', 'testConnection', 'discoverRepositories', 'createRepository',
  'selectRepository', 'setAutomatic', 'listLocalSnapshots', 'previewUpload', 'upload', 'uploadMany', 'refresh', 'download',
  'restore', 'deleteVersion', 'controlJob', 'setCacheBudget', 'setDevice', 'chooseRestoreMapping', 'confirmRestore'];
const cloud = Object.fromEntries(cloudMethods.map(method => [method, (payload = {}) => ipcRenderer.invoke(`cloud:${method}`, payload)]));
cloud.onState = listener => subscribe('cloud:state', listener);

contextBridge.exposeInMainWorld('api', {
  send: (channel, ...args) => { validateChannel('send', channel); ipcRenderer.send(channel, ...args); },
  receive: (channel, func) => { validateChannel('receive', channel); return subscribe(channel, func); },
  invoke: (channel, ...args) => { validateChannel('invoke', channel); return ipcRenderer.invoke(channel, ...args); },
  cloud: Object.freeze(cloud)
});

contextBridge.exposeInMainWorld('i18n', {
  changeLanguage: (lng) => ipcRenderer.invoke('change-language', lng),
  translate: (key, options) => ipcRenderer.invoke('translate', key, options)
});
