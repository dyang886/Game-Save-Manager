const { cloudError, classifyError } = require('./queue');
const { UUID } = require('./repository');

const COMMANDS = Object.freeze({
    getState: [], saveTarget: ['config', 'secrets', 'sessionOnly'], removeTarget: ['targetId'],
    testConnection: ['targetId', 'config', 'secrets'], discoverRepositories: ['targetId'],
    createRepository: ['targetId'], selectRepository: ['targetId', 'repositoryId'],
    setAutomatic: ['targetId', 'gameKeys'], setCacheBudget: ['bytes'], setDevice: ['name'],
    listLocalSnapshots: ['gameId'], previewUpload: ['targetId', 'selection', 'gameIds'],
    upload: ['targetId', 'gameId', 'folder'], uploadMany: ['targetId', 'selection', 'gameIds'],
    refresh: ['targetId'], download: ['targetId', 'versionId', 'revision'], restore: ['targetId', 'versionId', 'revision'],
    deleteVersion: ['targetId', 'versionId', 'revision', 'confirmPermanent'], controlJob: ['jobId', 'action'],
    chooseRestoreMapping: ['jobId', 'folder'], confirmRestore: ['jobId', 'confirmRegistry']
});
const CLOUD_CHANNELS = Object.freeze(Object.keys(COMMANDS).map(command => `cloud:${command}`));

function validateInput(command, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw cloudError('INVALID_REQUEST');
    let encoded;
    try { encoded = JSON.stringify(input); } catch (_) { throw cloudError('INVALID_REQUEST'); }
    if (encoded.length > 256 * 1024 || Object.keys(input).some(key => !COMMANDS[command].includes(key))) throw cloudError('INVALID_REQUEST');
    for (const key of ['targetId', 'repositoryId', 'jobId']) if (input[key] !== undefined && !(key === 'targetId' && command === 'setAutomatic' && input[key] === null) && !UUID.test(input[key])) throw cloudError('INVALID_REQUEST');
    if (input.versionId !== undefined && !/^[a-f0-9]{64}$/.test(input.versionId)) throw cloudError('INVALID_REQUEST');
    if (input.folder !== undefined && (typeof input.folder !== 'string' || input.folder.length > 200 || !input.folder || /[\\/:\x00-\x1f]/.test(input.folder) || input.folder.startsWith('.') || input.folder.includes('..'))) throw cloudError('INVALID_REQUEST');
    if (input.gameId !== undefined && !/^\d{1,20}$|^[0-9a-f-]{36}$/i.test(String(input.gameId))) throw cloudError('INVALID_REQUEST');
    if (input.gameIds !== undefined && (!Array.isArray(input.gameIds) || input.gameIds.length > 10000 || input.gameIds.some(id => !/^\d{1,20}$|^[0-9a-f-]{36}$/i.test(String(id))))) throw cloudError('INVALID_REQUEST');
    if (input.selection !== undefined && !['latest', 'permanent', 'all'].includes(input.selection)) throw cloudError('INVALID_REQUEST');
    if (input.action !== undefined && !['pause', 'resume', 'cancel', 'retry'].includes(input.action)) throw cloudError('INVALID_REQUEST');
    if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 1)) throw cloudError('INVALID_REQUEST');
    for (const key of ['sessionOnly', 'confirmPermanent', 'confirmRegistry']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw cloudError('INVALID_REQUEST');
    return input;
}

function trustedSender(event, { getTrustedWebContents, trustedURL }) {
    const trusted = getTrustedWebContents();
    const candidates = Array.isArray(trusted) ? trusted : [trusted];
    if (!event?.sender || !candidates.some(contents => contents && !contents.isDestroyed?.() && contents === event.sender)) return false;
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    const url = event.senderFrame.url;
    if (typeof trustedURL === 'function') return trustedURL(url, event.sender);
    if (Array.isArray(trustedURL)) return trustedURL.includes(url);
    return typeof trustedURL === 'string' && url === trustedURL;
}

function registerCloudIpc(ipcMain, service, options) {
    if (!options || typeof options.getTrustedWebContents !== 'function' || !options.trustedURL) throw new Error('Cloud IPC requires an explicit trusted main frame');
    for (const command of Object.keys(COMMANDS)) {
        ipcMain.handle(`cloud:${command}`, async (event, input) => {
            try {
                if (!trustedSender(event, options)) throw cloudError('UNTRUSTED_SENDER');
                const data = await service[command](validateInput(command, input));
                return { ok: true, data };
            } catch (error) {
                const safe = classifyError(error);
                return { ok: false, error: { code: safe.code, message: safe.message } };
            }
        });
    }
    return () => { for (const channel of CLOUD_CHANNELS) ipcMain.removeHandler(channel); };
}

module.exports = { registerCloudIpc, CLOUD_CHANNELS, COMMANDS, validateInput, trustedSender };
