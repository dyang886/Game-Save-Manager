const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const snapshotStore = require('./snapshotStore');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const platforms = { win32: 'win', darwin: 'mac', linux: 'linux' };
const fileLocks = new Map();
const MAX_BYTES = 4 * 1024 * 1024;

function failure(code) { return Object.assign(new Error(code), { code }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function entriesPath(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw failure('CUSTOM_GAME_INVALID');
    return path.join(path.resolve(root), 'custom_entries.json');
}

// Every in-process writer uses the same file lock. Callers acquire the library
// read permission first; a restore already holds it through its game lock.
async function withCustomEntriesLock(root, callback) {
    if (typeof callback !== 'function') throw new TypeError('Custom entries operation must be a function');
    const filename = entriesPath(root);
    const key = process.platform === 'win32' ? filename.toLowerCase() : filename;
    const previous = fileLocks.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(callback);
    fileLocks.set(key, pending);
    try { return await pending; }
    finally { if (fileLocks.get(key) === pending) fileLocks.delete(key); }
}

function validateEntries(entries, code) {
    if (!Array.isArray(entries)) throw failure(code);
    const ids = new Set();
    for (const entry of entries) {
        if (!record(entry) || !UUID.test(entry.wiki_page_id) || typeof entry.title !== 'string' || !entry.title.trim() || !record(entry.save_location)) throw failure(code);
        const id = entry.wiki_page_id.toLowerCase();
        if (ids.has(id)) throw failure(code);
        ids.add(id);
        for (const [platform, locations] of Object.entries(entry.save_location)) {
            if (!['win', 'mac', 'linux', 'reg'].includes(platform) || !Array.isArray(locations)) throw failure(code);
            for (const location of locations) {
                if (!record(location) || typeof location.template !== 'string' || !location.template ||
                    !['file', 'folder', null].includes(location.type)) throw failure(code);
            }
        }
    }
    return entries;
}

async function readEntries(filename) {
    await snapshotStore.assertNoLinks(filename);
    let text;
    try {
        const stat = await fs.promises.stat(filename);
        if (!stat.isFile() || stat.size > MAX_BYTES) throw failure('CUSTOM_ENTRIES_CORRUPT');
        text = await fs.promises.readFile(filename, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    let entries;
    try { entries = JSON.parse(text); }
    catch { throw failure('CUSTOM_ENTRIES_CORRUPT'); }
    return validateEntries(entries, 'CUSTOM_ENTRIES_CORRUPT');
}

async function readCustomEntries(root) {
    return withCustomEntriesLock(root, () => readEntries(entriesPath(root)));
}

// The updater sees the latest complete file and must return the new array.
// A thrown conflict or a malformed file leaves the original bytes untouched.
async function updateCustomEntries(root, updater) {
    if (typeof updater !== 'function') throw new TypeError('Custom entries updater must be a function');
    return withCustomEntriesLock(root, async () => {
        const filename = entriesPath(root);
        const entries = await readEntries(filename);
        const previous = JSON.stringify(entries);
        const next = validateEntries(await updater(entries), 'CUSTOM_GAME_INVALID');
        const serialized = JSON.stringify(next);
        if (Buffer.byteLength(`${JSON.stringify(next, null, 4)}\n`, 'utf8') > MAX_BYTES) throw failure('CUSTOM_GAME_INVALID');
        if (serialized === previous) return { changed: false };
        await snapshotStore.assertNoLinks(filename);
        await fs.promises.mkdir(path.dirname(filename), { recursive: true });
        await snapshotStore.atomicWriteJson(filename, next);
        return { changed: true };
    });
}

function restoredDefinition(snapshot, plan, platform) {
    const definition = snapshot.metadata.customDefinition;
    if (!record(definition) || String(definition.wiki_page_id).toLowerCase() !== snapshot.gameId.toLowerCase()) throw failure('CUSTOM_GAME_INVALID');
    const title = snapshot.metadata.title || definition.title;
    if (typeof title !== 'string' || !title.trim() || /[\x00-\x1f]/.test(title) || title.length > 32767 || !platforms[platform]) throw failure('CUSTOM_GAME_INVALID');
    const expected = snapshot.metadata.backup_paths;
    if (!Array.isArray(plan) || !plan.length || !Array.isArray(expected) || plan.length !== expected.length) throw failure('CUSTOM_GAME_INVALID');
    const folders = new Set();
    const save_location = { win: [], reg: [], mac: [], linux: [] };
    for (const item of plan) {
        const entry = expected.find(value => value.folder_name === item.entry?.folder_name);
        const destination = item.destinationPath;
        if (!entry || folders.has(entry.folder_name) || item.backupType !== entry.type ||
            typeof destination !== 'string' || /[\x00-\x1f]|\{\{|\}\}/.test(destination)) throw failure('CUSTOM_GAME_INVALID');
        folders.add(entry.folder_name);
        if (item.backupType === 'reg') {
            if (platform !== 'win32' || !/^HKEY_CURRENT_USER\\Software\\[^\\]+(?:\\.+)*$/i.test(destination)) throw failure('CUSTOM_GAME_INVALID');
            save_location.reg.push({ template: destination, type: null });
        } else {
            if (!['file', 'folder'].includes(item.backupType) || !path.isAbsolute(destination)) throw failure('CUSTOM_GAME_INVALID');
            save_location[platforms[platform]].push({ template: destination, type: item.backupType });
        }
    }
    // Remote install folders, save templates, account IDs and extra fields never
    // become local configuration. Automatic backup settings are not touched.
    return { title, wiki_page_id: snapshot.gameId, install_folder: '', save_location };
}

// Only call after every preflighted destination has been restored successfully.
// Registration is secondary: its failure must not turn a completed restore into
// a failed restore or expose an exception containing a local filesystem path.
async function registerRestoredCustomGame(root, snapshot, plan, { platform = process.platform } = {}) {
    if (!snapshot?.metadata?.cloudImported || typeof snapshot.gameId !== 'string' || !UUID.test(snapshot.gameId) ||
        snapshot.metadata.gameKey !== `custom:${snapshot.gameId}` || !snapshot.metadata.customDefinition) return null;
    try {
        let status = 'existing';
        await updateCustomEntries(root, entries => {
            if (entries.some(entry => entry.wiki_page_id.toLowerCase() === snapshot.gameId.toLowerCase())) return entries;
            const definition = restoredDefinition(snapshot, plan, platform);
            status = 'registered';
            return [...entries, definition];
        });
        return { status };
    } catch (error) {
        const code = ['CUSTOM_ENTRIES_CORRUPT', 'CUSTOM_GAME_INVALID'].includes(error.code) ? error.code : 'CUSTOM_GAME_REGISTRATION_FAILED';
        return { status: 'failed', code };
    }
}

module.exports = { withCustomEntriesLock, readCustomEntries, updateCustomEntries, registerRestoredCustomGame };
