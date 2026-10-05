const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { assertNoLinks, inside } = require('./snapshotStore');
const { withLibraryLock } = require('./backupCoordinator');

function fail(code, message) { return Object.assign(new Error(message), { code }); }

function validateMigrationPaths(sourceDir, destinationDir) {
    for (const value of [sourceDir, destinationDir]) {
        if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw fail('INVALID_MIGRATION_PATH', 'Migration requires absolute local directory paths');
        if (value.startsWith('\\\\') || value.startsWith('//')) throw fail('INVALID_MIGRATION_PATH', 'Network and device paths are not supported for library migration');
    }
    const source = path.resolve(sourceDir);
    const destination = path.resolve(destinationDir);
    const same = process.platform === 'win32' ? source.toLowerCase() === destination.toLowerCase() : source === destination;
    if (same || inside(source, destination) || inside(destination, source)) throw fail('OVERLAPPING_MIGRATION_PATHS', 'Source and destination libraries must not contain each other');
    if (source === path.parse(source).root || destination === path.parse(destination).root) throw fail('INVALID_MIGRATION_PATH', 'A library cannot be a volume root');
    return { source, destination };
}

async function inventory(root, relative = '') {
    const rows = [];
    await assertNoLinks(path.join(root, relative), root);
    for (const entry of (await fs.promises.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const item = path.join(relative, entry.name);
        const absolute = path.join(root, item);
        const stat = await fs.promises.lstat(absolute);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw fail('UNSUPPORTED_MIGRATION_ENTRY', 'Library migration does not follow symbolic links or special files');
        if (stat.isDirectory()) {
            rows.push({ relative: item, type: 'directory' });
            rows.push(...await inventory(root, item));
        } else rows.push({ relative: item, type: 'file', size: stat.size, atime: stat.atime, mtime: stat.mtime });
    }
    return rows;
}

async function digest(filename) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex');
}

async function emptyDestination(destination) {
    await assertNoLinks(destination);
    try {
        const stat = await fs.promises.lstat(destination);
        if (!stat.isDirectory() || (await fs.promises.readdir(destination)).length !== 0) throw fail('MIGRATION_TARGET_CONFLICT', 'The destination already contains data; choose an empty directory');
        return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function sameInventory(first, second, checkModified = false) {
    return first.length === second.length && first.every((entry, index) => entry.relative === second[index].relative && entry.type === second[index].type && entry.size === second[index].size &&
        (!checkModified || entry.type !== 'file' || entry.mtime.getTime() === second[index].mtime.getTime()));
}

async function migrateUnlocked(sourceDir, destinationDir, { activate, onProgress } = {}) {
    if (typeof activate !== 'function') throw new TypeError('Migration requires a settings activation callback');
    const { source, destination } = validateMigrationPaths(sourceDir, destinationDir);
    await assertNoLinks(source);
    if (!(await fs.promises.stat(source)).isDirectory()) throw fail('INVALID_MIGRATION_SOURCE', 'The source library is not a directory');
    await emptyDestination(destination);
    const entries = await inventory(source);
    const files = entries.filter(entry => entry.type === 'file');
    const totalBytes = files.reduce((size, entry) => size + entry.size, 0);
    const parent = path.dirname(destination);
    await assertNoLinks(parent);
    await fs.promises.mkdir(parent, { recursive: true });
    const space = await fs.promises.statfs(parent);
    if (Number(space.bavail) * Number(space.bsize) < totalBytes + 16 * 1024 ** 2) throw fail('ENOSPC', 'Insufficient space for a complete verified library copy');
    const staged = path.join(parent, `.gsm-migrate-${randomUUID()}`);
    let committed = false;
    let removedEmptyTarget = false;
    try {
        await fs.promises.mkdir(staged);
        let copiedBytes = 0;
        onProgress?.({ stage: 'copying', completedBytes: 0, totalBytes });
        for (const entry of entries) {
            const src = path.join(source, entry.relative);
            const dst = path.join(staged, entry.relative);
            await assertNoLinks(src, source);
            if (entry.type === 'directory') await fs.promises.mkdir(dst);
            else {
                await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
                await fs.promises.utimes(dst, entry.atime, entry.mtime);
                copiedBytes += entry.size;
                onProgress?.({ stage: 'copying', completedBytes: copiedBytes, totalBytes });
            }
        }
        if (!sameInventory(entries, await inventory(source), true) || !sameInventory(entries, await inventory(staged))) throw fail('MIGRATION_SOURCE_CHANGED', 'Library contents changed while they were copied');
        let verifiedBytes = 0;
        for (const entry of files) {
            await assertNoLinks(path.join(source, entry.relative), source);
            const expected = await digest(path.join(source, entry.relative));
            const actual = await digest(path.join(staged, entry.relative));
            if (expected !== actual) throw fail('MIGRATION_VERIFICATION_FAILED', 'The copied library failed content verification');
            verifiedBytes += entry.size;
            onProgress?.({ stage: 'verifying', completedBytes: verifiedBytes, totalBytes });
        }
        if (!sameInventory(entries, await inventory(source), true)) throw fail('MIGRATION_SOURCE_CHANGED', 'Library contents changed during verification');
        if (await emptyDestination(destination)) {
            // rmdir fails atomically if another process populated the directory.
            await fs.promises.rmdir(destination);
            removedEmptyTarget = true;
        }
        await fs.promises.rename(staged, destination);
        committed = true;
        onProgress?.({ stage: 'committing', completedBytes: totalBytes, totalBytes });
        const activated = await activate(destination);
        if (activated === false || activated === null) throw fail('MIGRATION_SETTINGS_FAILED', 'The new library is verified but its setting could not be saved');
        return { source, destination, sourceRetained: true, fileCount: files.length, totalBytes };
    } catch (error) {
        if (committed) error.destinationCommitted = true;
        throw error;
    } finally {
        // The original library is intentionally retained, including after a
        // settings write failure. Only this operation's private staging is removed.
        if (!committed && inside(parent, staged)) {
            await assertNoLinks(staged, parent);
            await fs.promises.rm(staged, { recursive: true, force: true }).catch(() => {});
        }
        if (removedEmptyTarget && !committed) await fs.promises.mkdir(destination).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
}

function migrateBackupLibrary(sourceDir, destinationDir, options) {
    return withLibraryLock(() => migrateUnlocked(sourceDir, destinationDir, options));
}

module.exports = { migrateBackupLibrary, validateMigrationPaths };
