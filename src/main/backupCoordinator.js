const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const { listSnapshots, validateGameId, readSnapshot, inside } = require('./snapshotStore');

const gameLocks = new Map();
const protectedSnapshots = new Map();
let commitHook = null;
let intentProvider = null;
let libraryReaders = 0;
let libraryWriters = 0;
let libraryWriterTail = Promise.resolve();
const waitingLibraryReaders = new Set();
const waitingForLibraryDrain = new Set();

async function acquireLibraryRead() {
    while (libraryWriters > 0) await new Promise(resolve => waitingLibraryReaders.add(resolve));
    libraryReaders++;
    return () => {
        libraryReaders--;
        if (libraryReaders === 0) {
            for (const resolve of waitingForLibraryDrain) resolve();
            waitingForLibraryDrain.clear();
        }
    };
}

// Migration takes an exclusive library lock. Reserve it synchronously so new
// game operations cannot slip in while earlier operations are being drained.
function withLibraryLock(callback) {
    if (typeof callback !== 'function') throw new TypeError('Library operation must be a function');
    libraryWriters++;
    const pending = libraryWriterTail.catch(() => {}).then(async () => {
        if (libraryReaders > 0) await new Promise(resolve => waitingForLibraryDrain.add(resolve));
        return callback();
    });
    const result = pending.finally(() => {
        libraryWriters--;
        if (libraryWriters === 0) {
            for (const resolve of waitingLibraryReaders) resolve();
            waitingLibraryReaders.clear();
        }
    });
    libraryWriterTail = result.catch(() => {});
    return result;
}

function isLibraryBusy() { return libraryWriters > 0; }

async function withLibraryRead(callback) {
    if (typeof callback !== 'function') throw new TypeError('Library operation must be a function');
    const release = await acquireLibraryRead();
    try { return await callback(); } finally { release(); }
}

async function withGameLock(gameId, callback) {
    const key = validateGameId(gameId);
    const releaseLibrary = await acquireLibraryRead();
    try {
        const previous = gameLocks.get(key) || Promise.resolve();
        const pending = previous.catch(() => {}).then(callback);
        gameLocks.set(key, pending);
        try { return await pending; } finally { if (gameLocks.get(key) === pending) gameLocks.delete(key); }
    } finally { releaseLibrary(); }
}

const protectionKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

function protectSnapshot(snapshotPath) {
    const key = protectionKey(snapshotPath);
    protectedSnapshots.set(key, (protectedSnapshots.get(key) || 0) + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const count = protectedSnapshots.get(key) - 1;
        if (count > 0) protectedSnapshots.set(key, count); else protectedSnapshots.delete(key);
    };
}

const isProtected = snapshotPath => protectedSnapshots.has(protectionKey(snapshotPath));
function setCommitHook(hook) { commitHook = hook; }
function setIntentProvider(provider) { intentProvider = provider; }
async function getUploadIntent(game) { return intentProvider ? await intentProvider(game) : null; }
async function notifyCommitted(snapshot) { if (commitHook) await commitHook(snapshot); }

async function rotateSnapshots(root, gameId, maxBackups) {
    const maximum = Number.isInteger(Number(maxBackups)) ? Math.max(1, Number(maxBackups)) : 10;
    const snapshots = (await listSnapshots(root, gameId)).filter(snapshot => !snapshot.metadata.is_permanent && !snapshot.metadata.restoreProtection);
    for (const snapshot of snapshots.slice(maximum)) {
        if (isProtected(snapshot.path)) continue;
        const current = await readSnapshot(root, gameId, snapshot.folder);
        const intent = current.metadata.cloudUploadIntent;
        if (current.metadata.is_permanent || current.metadata.restoreProtection || (intent && intent.state !== 'completed' && intent.state !== 'cancelled')) continue;
        if (!inside(path.resolve(root, validateGameId(gameId)), current.path)) throw new Error('Unsafe rotation path');
        await fs.promises.rm(current.path, { recursive: true, force: true });
    }
}

module.exports = { withGameLock, withLibraryRead, withLibraryLock, isLibraryBusy, protectSnapshot, isProtected, setCommitHook, setIntentProvider, getUploadIntent, notifyCommitted, rotateSnapshots };
