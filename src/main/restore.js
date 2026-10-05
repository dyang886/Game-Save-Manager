const { BrowserWindow, dialog } = require('electron');

const { execFile } = require('child_process');
const fsOriginal = require('original-fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const util = require('util');

const i18next = require('i18next');
const moment = require('moment');

const { resolvePlaceholder } = require('./gameData');
const { getAllAccountIds } = require('./gameData');
const { registryKeyExists } = require('./registry');
const snapshotStore = require('./snapshotStore');
const coordinator = require('./backupCoordinator');
const {
    getGameDisplayName, mapConcurrent, calculateDirectorySize,
    findGameInstallPath, getLatestModificationTime, getSettings
} = require('./global');

const execFilePromise = util.promisify(execFile);


// A sample restore game object: {
//     "wiki_page_id": "97395",
//     "latest_backup": "2024/09/08 15:23",
//     "title": "Control",
//     "zh_CN": "控制",
//     "backup_size": 132168,
//     "backups": [
//         {
//             "date": "2024-09-08_15-23",
//             "title": "Control",
//             "zh_CN": "控制",
//             "backup_size": 132168,
//             "backup_paths": [
//                 {
//                     "folder_name": "path1",
//                     "template": "{{p|steam}}\\userdata\\477235894\\870780\\remote",
//                     "type": "folder",
//                     "install_folder": "Control"
//                 },
//                 {
//                     "folder_name": "path2",
//                     "template": "{{p|game}}\\renderer.ini",
//                     "type": "file",
//                     "install_folder": "Control"
//                 }
//             ]
//         }
//     ]
// }

// ======================================================================
// Backup discovery
// ======================================================================
// A backup folder never changes once written, so its size is recorded on first sight
async function resolveBackupSize(snapshot, backup) {
    if (Number.isFinite(backup.backup_size)) return;

    backup.backup_size = await calculateDirectorySize(snapshot.path);

    try {
        // Share the metadata lock with identity assignment and user edits.
        await snapshotStore.updateMetadata(snapshot, metadata => ({ ...metadata, backup_size: backup.backup_size }));
    } catch (error) {
        console.error(`Could not record backup size at ${snapshot.path}: ${error.message}`);
    }
}

async function fetchBackups(wikiIdFolderPath, wikiId, errors, sizeAllBackups = false) {
    const backups = [];

    try {
        if (wikiId && !fsOriginal.existsSync(wikiIdFolderPath)) return null;
        const stats = fsOriginal.statSync(wikiIdFolderPath);
        if (!stats.isDirectory()) return null;

        const snapshots = await snapshotStore.listSnapshots(path.dirname(wikiIdFolderPath), wikiId);
        backups.push(...snapshots.map(snapshot => ({ ...snapshot.metadata, date: snapshot.folder, backup_size: snapshot.metadata.backup_size ?? null })));

        if (backups.length === 0) return null;

        // Sort by date and get the latest
        const latestBackup = backups[0];
        const latestBackupFormatted = moment(latestBackup.createdAt).format('YYYY/MM/DD HH:mm');

        // The table shows only the latest backup's size; the rest wait until the modal asks
        await Promise.all((sizeAllBackups ? snapshots : snapshots.slice(0, 1))
            .map((snapshot, index) => resolveBackupSize(snapshot, backups[index])));

        return {
            wiki_page_id: wikiId,
            latest_backup: latestBackupFormatted,
            title: latestBackup.title,
            zh_CN: latestBackup.zh_CN,
            backup_size: latestBackup.backup_size,
            backups: backups
        };

    } catch (error) {
        console.error(`Error processing ${wikiIdFolderPath} for restore table display: ${error.stack}`);
        errors.push(`${i18next.t('alert.restore_process_error_path', { backup_path: wikiIdFolderPath })}: ${error.message}`);
        return null;
    }
}

async function getGameDataForRestore(wikiId = null, sizeAllBackups = false) {
    const backupPath = getSettings().backupPath;
    fsOriginal.mkdirSync(backupPath, { recursive: true });

    const errors = [];

    // If specific wikiId is provided, fetch only that game
    if (wikiId) {
        const wikiIdFolderPath = path.join(backupPath, wikiId.toString());
        const gameData = await fetchBackups(wikiIdFolderPath, wikiId, errors, sizeAllBackups);

        return {
            games: gameData ? [gameData] : [],
            errors: errors
        };
    }

    // Otherwise fetch all games
    const gameFolders = fsOriginal.readdirSync(backupPath);
    const gameData = await mapConcurrent(gameFolders, (gameFolder) =>
        fetchBackups(path.join(backupPath, gameFolder), gameFolder, errors)
    );

    return { games: gameData.filter(Boolean), errors };
}

// ======================================================================
// Restoring
// ======================================================================
function restoreError(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, ...extra });
}

function validateDestination(destination, backupRoot) {
    if (typeof destination !== 'string' || !path.isAbsolute(destination) || /[\x00-\x1f]/.test(destination) ||
        destination.startsWith('\\\\') || destination.startsWith('//') || /[<>"|?*]/.test(destination)) {
        throw restoreError('PATH_MAPPING_REQUIRED', 'Choose an absolute local destination for this save path');
    }
    const resolved = path.resolve(destination);
    const segments = resolved.slice(path.parse(resolved).root.length).split(/[\\/]/).filter(Boolean);
    if (segments.some(segment => /[. ]$/.test(segment) || /:/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
        throw restoreError('UNSAFE_DESTINATION', 'The destination contains a reserved Windows path');
    }
    if (!segments.length || snapshotStore.inside(resolved, backupRoot, true) || snapshotStore.inside(backupRoot, resolved, true)) {
        throw restoreError('UNSAFE_DESTINATION', 'Restore destination overlaps the backup library or a volume root');
    }
    const windowsRoot = process.env.WINDIR || process.env.SystemRoot;
    if (windowsRoot && snapshotStore.inside(windowsRoot, resolved, true)) throw restoreError('UNSAFE_DESTINATION', 'Restoring into the Windows directory is not allowed');
    for (const sensitiveRoot of [process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean)) {
        if (snapshotStore.inside(resolved, sensitiveRoot, true)) throw restoreError('UNSAFE_DESTINATION', 'Choose a game save subdirectory rather than a system or profile root');
    }
    return resolved;
}

function validateRegistryDestination(destination) {
    if (typeof destination !== 'string' || !/^HKEY_CURRENT_USER\\Software\\[^\\\r\n\[\]]+(?:\\[^\r\n\[\]]+)*$/i.test(destination) ||
        /^HKEY_CURRENT_USER\\Software\\(?:Classes|Policies|Microsoft\\(?:Windows|Windows NT))(?:\\|$)/i.test(destination)) {
        throw restoreError('UNSAFE_REGISTRY_TARGET', 'Registry restore requires an explicit game key under HKEY_CURRENT_USER\\Software');
    }
    return destination.replace(/\\+$/, '');
}

function checkRegistryContent(buffer, sourceKey, destinationKey) {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8';
    let text = buffer.toString(encoding).replace(/^\uFEFF/, '');
    if (!/^(Windows Registry Editor Version 5\.00|REGEDIT4)\r?\n/.test(text)) throw restoreError('INVALID_REGISTRY', 'Invalid registry export header');
    if (text.includes('\0')) throw restoreError('INVALID_REGISTRY', 'Registry export contains NUL characters');
    let sections = 0;
    const expected = sourceKey.toLowerCase().replace(/\\+$/, '');
    text = text.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) return line;
        const match = /^\[([^\]\r\n]+)\]$/.exec(trimmed);
        if (!match) throw restoreError('INVALID_REGISTRY', 'Registry export contains an invalid key section');
        const key = match[1];
        if (key.startsWith('-') || (key.toLowerCase() !== expected && !key.toLowerCase().startsWith(`${expected}\\`))) {
            throw restoreError('INVALID_REGISTRY', 'Registry export contains keys outside its declared save path');
        }
        sections += 1;
        return `[${destinationKey}${key.slice(sourceKey.length)}]`;
    }).join('\r\n');
    if (!sections) throw restoreError('INVALID_REGISTRY', 'Registry export contains no keys');
    return Buffer.from(`\uFEFF${text}`, 'utf16le');
}

// Both rename operations stay on the destination volume. If installation of the
// prepared folder fails, put the previous directory back before reporting error.
async function replaceDirectory(source, destination) {
    const parent = path.dirname(destination);
    await snapshotStore.assertNoLinks(parent);
    await fsOriginal.promises.mkdir(parent, { recursive: true });
    const token = randomUUID();
    const staged = path.join(parent, `.gsm-restore-new-${token}`);
    const previous = path.join(parent, `.gsm-restore-old-${token}`);
    let movedPrevious = false;
    let installed = false;
    try {
        await snapshotStore.copyTree(source, staged);
        await snapshotStore.assertNoLinks(destination);
        try {
            await fsOriginal.promises.rename(destination, previous);
            movedPrevious = true;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try {
            await fsOriginal.promises.rename(staged, destination);
            installed = true;
        } catch (error) {
            if (movedPrevious) {
                try { await fsOriginal.promises.rename(previous, destination); movedPrevious = false; }
                catch (rollbackError) { throw restoreError('REPLACE_ROLLBACK_FAILED', `Folder replacement failed; previous contents remain at ${previous}: ${rollbackError.message}`); }
            }
            throw error;
        }
    } finally {
        await fsOriginal.promises.rm(staged, { recursive: true, force: true }).catch(() => {});
        if (installed && movedPrevious) {
            await fsOriginal.promises.rm(previous, { recursive: true, force: true }).catch(error => console.error(`Could not remove replaced save directory: ${error.message}`));
        }
    }
}

async function preflightRestore(snapshot, options = {}) {
    const mappings = options.mappings || {};
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw restoreError('INVALID_MAPPING', 'Invalid restore path mappings');
    const currentAccounts = getAllAccountIds();
    const knownAccounts = new Set(Object.values(currentAccounts).filter(Boolean).map(String));
    const mappingsRequired = [];
    const plan = [];
    let localGameKnown;
    for (const entry of snapshot.metadata.backup_paths) {
        const sourcePath = path.join(snapshot.path, entry.folder_name);
        await snapshotStore.assertNoLinks(sourcePath, snapshot.path);
        const sourceStat = await fsOriginal.promises.stat(sourcePath);
        if (!sourceStat.isDirectory()) throw restoreError('INVALID_SNAPSHOT', 'A snapshot save path is missing');
        const explicitlyMapped = Object.prototype.hasOwnProperty.call(mappings, entry.folder_name);
        const sourceTemplate = entry.template;
        // Cloud templates are untrusted even when they look like this game's paths.
        // Every imported filesystem target is chosen in a main-process dialog.
        if (snapshot.metadata.cloudImported && !explicitlyMapped && entry.type !== 'reg') {
            mappingsRequired.push({ folder: entry.folder_name, template: sourceTemplate, type: entry.type, reason: 'custom', originalMissing: Boolean(entry.originalMissing) });
            continue;
        }
        const accountIds = Object.values(snapshot.metadata.accountScope || {}).filter(Boolean).map(String);
        const accountSensitive = /\{\{p\|uid\}\}|[\\/]userdata[\\/]|[\\/]savegames[\\/]/i.test(entry.originalTemplate || sourceTemplate) ||
            accountIds.some(account => sourceTemplate.includes(account) && !knownAccounts.has(account));
        let destinationPath;
        if (explicitlyMapped) destinationPath = mappings[entry.folder_name];
        else {
            if (snapshot.metadata.cloudImported && entry.type !== 'reg' && (snapshot.gameKey.startsWith('custom:') || path.isAbsolute(sourceTemplate) || accountSensitive)) {
                mappingsRequired.push({ folder: entry.folder_name, template: sourceTemplate, type: entry.type, reason: accountSensitive ? 'account' : 'custom' });
                continue;
            }
            if (snapshot.metadata.cloudImported && entry.type !== 'reg') {
                if (localGameKnown === undefined) {
                    try {
                        const local = await require('./backup').getGameDataFromDB(false, snapshot.gameId);
                        localGameKnown = Array.isArray(local.games) && local.games.some(game => String(game.wiki_page_id) === snapshot.gameId);
                    } catch { localGameKnown = false; }
                }
                if (!localGameKnown || (entry.install_folder && !findGameInstallPath(entry.install_folder))) {
                    mappingsRequired.push({ folder: entry.folder_name, template: sourceTemplate, type: entry.type, reason: 'game_not_installed' });
                    continue;
                }
            }
            destinationPath = entry.type === 'reg' ? resolveRegistryTemplate(sourceTemplate) : resolveTemplatedRestorePath(sourceTemplate, entry.install_folder);
        }
        if (typeof destinationPath !== 'string' || /\{\{|\}\}/.test(destinationPath) || (entry.type !== 'reg' && !path.isAbsolute(destinationPath))) {
            mappingsRequired.push({ folder: entry.folder_name, template: sourceTemplate, type: entry.type, reason: 'unresolved' });
            continue;
        }
        const item = { sourcePath, destinationPath, backupType: entry.type, entry };
        if (entry.type === 'reg') {
            item.destinationPath = validateRegistryDestination(resolveRegistryTemplate(destinationPath));
            if (snapshot.metadata.cloudImported && !options.confirmRegistry) throw restoreError('REGISTRY_CONFIRMATION_REQUIRED', 'Confirm the registry game keys before restoring', {
                registryTargets: snapshot.metadata.backup_paths.filter(value => value.type === 'reg').map(value => ({ folder: value.folder_name, key: validateRegistryDestination(resolveRegistryTemplate(mappings[value.folder_name] || value.template)), originalMissing: Boolean(value.originalMissing) })),
            });
            if (!entry.originalMissing) {
                const registryFile = path.join(sourcePath, 'registry_backup.reg');
                await snapshotStore.assertNoLinks(registryFile, sourcePath);
                item.registryContent = checkRegistryContent(await fsOriginal.promises.readFile(registryFile), validateRegistryDestination(resolveRegistryTemplate(sourceTemplate)), item.destinationPath);
            }
            item.originalMissing = !registryKeyExists(item.destinationPath);
        } else {
            item.destinationPath = validateDestination(destinationPath, snapshot.root);
            await snapshotStore.assertNoLinks(item.destinationPath);
            if (entry.type === 'folder') await snapshotStore.scanTree(sourcePath);
            else if (!entry.originalMissing) {
                const files = await fsOriginal.promises.readdir(sourcePath, { withFileTypes: true });
                const filename = entry.file_name || (files.length === 1 && files[0].isFile() ? files[0].name : null);
                if (!filename) throw restoreError('INVALID_SNAPSHOT', 'File backup must contain exactly one declared file');
                snapshotStore.validateSegment(filename);
                item.sourceFile = path.join(sourcePath, filename);
                await snapshotStore.assertNoLinks(item.sourceFile, sourcePath);
                if (!(await fsOriginal.promises.stat(item.sourceFile)).isFile()) throw restoreError('INVALID_SNAPSHOT', 'Declared save file is missing');
            }
            try {
                const destinationStat = await fsOriginal.promises.stat(item.destinationPath);
                if ((entry.type === 'folder') !== destinationStat.isDirectory()) throw restoreError('DESTINATION_TYPE_MISMATCH', 'Restore destination has an incompatible file type');
                item.originalMissing = false;
            } catch (error) { if (error.code === 'ENOENT') item.originalMissing = true; else throw error; }
            let writable = item.destinationPath;
            while (!fsOriginal.existsSync(writable)) writable = path.dirname(writable);
            await fsOriginal.promises.access(writable, fsOriginal.constants.W_OK);
        }
        plan.push(item);
    }
    if (mappingsRequired.length) throw restoreError('PATH_MAPPING_REQUIRED', 'Confirm destination mappings before restoring this snapshot', { mappingsRequired });
    for (let index = 0; index < plan.length; index++) {
        for (const other of plan.slice(index + 1)) {
            const current = plan[index];
            if (current.backupType === 'reg' || other.backupType === 'reg') continue;
            const currentContains = snapshotStore.inside(current.destinationPath, other.destinationPath, true);
            const otherContains = snapshotStore.inside(other.destinationPath, current.destinationPath, true);
            if (currentContains && otherContains || currentContains && current.backupType !== 'folder' || otherContains && other.backupType !== 'folder') {
                throw restoreError('OVERLAPPING_DESTINATIONS', 'Restore save paths conflict; choose separate destinations');
            }
        }
    }
    // Install enclosing folders first so their swap cannot erase a separately
    // backed up child. The protection snapshot follows the same order on rollback.
    plan.sort((a, b) => {
        if (a.backupType === 'reg' || b.backupType === 'reg') return a.backupType === b.backupType ? 0 : a.backupType === 'reg' ? 1 : -1;
        return a.destinationPath.split(/[\\/]/).length - b.destinationPath.split(/[\\/]/).length;
    });
    return plan;
}

async function restoreSnapshot({ gameId, folder, mappings, confirmRegistry = false, userActionForAll = null }) {
    let action = userActionForAll;
    let protectionSnapshot = null;
    const pathResults = [];
    try {
        return await coordinator.withGameLock(gameId, async () => {
            const snapshot = await snapshotStore.readSnapshot(getSettings().backupPath, gameId, folder);
            const release = coordinator.protectSnapshot(snapshot.path);
            let resume;
            try {
                const plan = await preflightRestore(snapshot, { mappings, confirmRegistry });
                const decision = await shouldSkip(plan.filter(item => item.backupType !== 'reg'), getGameDisplayName(snapshot.metadata), action);
                if (decision.actionForAll) action = decision.actionForAll;
                if (decision.skip) return { action, error: i18next.t('alert.manually_skipped'), code: 'SKIPPED', pathResults };
                resume = await require('./autoBackup').pauseAutoBackupForRestore(String(gameId));
                protectionSnapshot = await require('./backup').createBackupSnapshot({
                    wiki_page_id: String(gameId), title: snapshot.metadata.title, zh_CN: snapshot.metadata.zh_CN,
                    platform: snapshot.metadata.platform,
                    resolved_paths: plan.map(item => ({
                        resolved: item.destinationPath, template: item.destinationPath, finalTemplate: item.destinationPath,
                        type: item.backupType, originalMissing: item.originalMissing,
                    })),
                }, { skipUpload: true, restoreProtection: true, protectsSnapshotId: snapshot.snapshotId });
                for (const item of plan) {
                    try {
                        await snapshotStore.assertNoLinks(item.sourcePath, snapshot.path);
                        if (item.backupType !== 'reg') await snapshotStore.assertNoLinks(item.destinationPath);
                        if (item.entry.originalMissing) {
                            if (!snapshot.metadata.restoreProtection) throw restoreError('INVALID_SNAPSHOT', 'Missing-target records are only valid in protection backups');
                            if (item.backupType === 'reg') {
                                if (registryKeyExists(item.destinationPath)) await execFilePromise('reg.exe', ['delete', item.destinationPath, '/f'], { windowsHide: true });
                            } else await fsOriginal.promises.rm(item.destinationPath, { recursive: true, force: true });
                        } else if (item.backupType === 'folder') {
                            await replaceDirectory(item.sourcePath, item.destinationPath);
                        } else if (item.backupType === 'file') {
                            await fsOriginal.promises.mkdir(path.dirname(item.destinationPath), { recursive: true });
                            await fsOriginal.promises.copyFile(item.sourceFile, item.destinationPath);
                        } else {
                            const registryFile = path.join(os.tmpdir(), `gsm-restore-${randomUUID()}.reg`);
                            try {
                                await fsOriginal.promises.writeFile(registryFile, item.registryContent, { flag: 'wx' });
                                await execFilePromise('reg.exe', ['import', registryFile], { windowsHide: true });
                            } finally { await fsOriginal.promises.rm(registryFile, { force: true }).catch(() => {}); }
                        }
                        pathResults.push({ folder: item.entry.folder_name, success: true });
                    } catch (error) {
                        pathResults.push({ folder: item.entry.folder_name, success: false, error: error.message, code: error.code });
                        throw restoreError('PARTIAL_RESTORE', error.message);
                    }
                }
                const customGameRegistration = await require('./customGameStore').registerRestoredCustomGame(snapshot.root, snapshot, plan);
                return { action, error: null, snapshotId: snapshot.snapshotId, protectionSnapshotId: protectionSnapshot.snapshotId, protectionFolder: protectionSnapshot.folder, pathResults,
                    ...(customGameRegistration ? { customGameRegistration } : {}) };
            } finally {
                try { if (resume) await resume(); }
                finally { release(); }
            }
        });
    } catch (error) {
        return {
            action, error: error.message, code: error.code || (protectionSnapshot ? 'RESTORE_FAILED' : 'PREFLIGHT_OR_PROTECTION_FAILED'),
            mappingsRequired: error.mappingsRequired,
            registryTargets: error.registryTargets,
            protectionSnapshotId: protectionSnapshot?.snapshotId, protectionFolder: protectionSnapshot?.folder, pathResults,
        };
    }
}

async function restoreGame(gameObj, userActionForAll) {
    try {
        const gameId = snapshotStore.validateGameId(gameObj.wiki_page_id);
        // The renderer selects a folder only. Its backup metadata is never used.
        const folder = gameObj.folder || gameObj.backups?.[0]?.date || (await snapshotStore.listSnapshots(getSettings().backupPath, gameId))[0]?.folder;
        if (!folder) throw new Error('No restorable snapshot was found');
        return await restoreSnapshot({ gameId, folder, userActionForAll });
    } catch (error) {
        return { action: userActionForAll, error: error.message };
    }
}
async function shouldSkip(pathsToCheck, gameDisplayName, userActionForAll) {
    let latestSourceModTime = new Date(0);
    let latestDestModTime = new Date(0);

    // Loop through each source-destination pair to find the latest modification times
    for (const { sourcePath, destinationPath } of pathsToCheck) {
        const srcModTime = await getLatestModificationTime(sourcePath);
        const destModTime = await getLatestModificationTime(destinationPath);

        if (srcModTime > latestSourceModTime) {
            latestSourceModTime = srcModTime;
        }
        if (destModTime > latestDestModTime) {
            latestDestModTime = destModTime;
        }
    }

    // If the destination files are newer than the source (backup), prompt the user
    if (latestSourceModTime < latestDestModTime) {
        if (userActionForAll) {
            return { skip: userActionForAll === 'skip', actionForAll: userActionForAll };
        }

        // Show the dialog to ask the user whether to replace or skip
        const response = await dialog.showMessageBox(BrowserWindow.getFocusedWindow(), {
            type: 'question',
            buttons: [i18next.t('alert.yes'), i18next.t('alert.no')],
            title: i18next.t('alert.save_conflict'),
            message: `${i18next.t('alert.save_conflict_detected', { game: gameDisplayName })}\n\n` +
                `${i18next.t('alert.machine_save_date', { machineTime: moment(latestDestModTime).format('YYYY-MM-DD HH:mm') })}\n` +
                `${i18next.t('alert.backup_save_date', { backupTime: moment(latestSourceModTime).format('YYYY-MM-DD HH:mm') })}\n\n` +
                `${i18next.t('alert.overwrite_prompt')}`,
            checkboxLabel: i18next.t('alert.do_this_for_all'),
            defaultId: 1, // Default to 'Skip'
            cancelId: 1,
            noLink: true,
            modal: true
        });

        const userChoice = response.response === 0 ? 'replace' : 'skip';
        const doForAll = response.checkboxChecked;

        return {
            skip: userChoice === 'skip',
            actionForAll: doForAll ? userChoice : null
        };
    }

    return { skip: false, actionForAll: null };
}

// ======================================================================
// Path resolution
// ======================================================================
// An unresolved {{p|game}} leaves a relative path, which reads as "not installed"
function resolveTemplatedRestorePath(templatedPath, installFolder) {
    const gameInstallPath = installFolder ? findGameInstallPath(installFolder) : null;

    return templatedPath.replace(/\{\{p\|[^\}]+\}\}/gi, match =>
        resolvePlaceholder(match.toLowerCase().replace(/\\/g, '/'), gameInstallPath) || match);
}

function resolveRegistryTemplate(template) {
    return resolveTemplatedRestorePath(template).replace(/\//g, '\\').replace(/\\+$/, '');
}

module.exports = {
    getGameDataForRestore,
    restoreGame,
    restoreSnapshot,
    preflightRestore,
    validateDestination,
    checkRegistryContent,
    replaceDirectory,
};
