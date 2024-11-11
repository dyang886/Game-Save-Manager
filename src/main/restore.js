const { BrowserWindow, dialog } = require('electron');

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const fse = require('fs-extra');
const i18next = require('i18next');
const moment = require('moment');

const { getGameData } = require('./gameData');
const { getMainWin, getGameDisplayName, calculateDirectorySize, ensureWritable, placeholder_mapping, getSettings } = require('./global');

const execPromise = util.promisify(exec);


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

async function getGameDataForRestore() {
    const backupPath = getSettings().backupPath;
    fse.ensureDir(backupPath);
    const gameFolders = await fse.readdir(backupPath);

    const games = [];
    const errors = [];

    for (const gameFolder of gameFolders) {
        const wikiIdFolderPath = path.join(backupPath, gameFolder);
        const stats = await fse.stat(wikiIdFolderPath);

        try {
            if (stats.isDirectory()) {
                const backups = [];

                // Read all backup instance folders inside this game folder
                const backupFolders = await fse.readdir(wikiIdFolderPath);
                for (const backupFolder of backupFolders) {
                    const backupFolderPath = path.join(wikiIdFolderPath, backupFolder);
                    const configFilePath = path.join(backupFolderPath, 'backup_info.json');
                    const backupSize = calculateDirectorySize(backupFolderPath);

                    // Check if the backup instance contains a config file
                    if (fs.existsSync(configFilePath)) {
                        try {
                            const backupConfig = await fse.readJson(configFilePath);
                            backups.push({
                                date: backupFolder,  // Backup folder name is the date (YYYY-MM-DD_HH-mm)
                                title: backupConfig.title,
                                zh_CN: backupConfig.zh_CN,
                                backup_size: backupSize,
                                backup_paths: backupConfig.backup_paths
                            });
                        } catch (err) {
                            console.error(`Error reading backup config file at ${configFilePath}: ${err.stack}`);
                            errors.push(`${i18next.t('alert.restore_process_error_config', { config_path: configFilePath })}: ${err.message}`);
                        }
                    }
                }

                if (backups.length > 0) {
                    const latestBackup = backups.sort((a, b) => {
                        return b.date.localeCompare(a.date);
                    })[0];
                    const latestBackupFormatted = moment(latestBackup.date, 'YYYY-MM-DD_HH-mm').format('YYYY/MM/DD HH:mm');

                    games.push({
                        wiki_page_id: gameFolder,
                        latest_backup: latestBackupFormatted,
                        title: latestBackup.title,
                        zh_CN: latestBackup.zh_CN,
                        backup_size: latestBackup.backup_size,
                        backups: backups
                    });
                }
            }

        } catch (error) {
            console.error(`Error processing ${wikiIdFolderPath} for restore table display: ${error.stack}`);
            errors.push(`${i18next.t('alert.restore_process_error_path', { backup_path: wikiIdFolderPath })}: ${error.message}`);
        }
    }

    return { games, errors };
}

async function restoreGame(gameObj, userActionForAll) {
    let localActionForAll = userActionForAll;
    const pathsToCheck = [];
    let gameNotInstalled = false;
    let steamNotInstalled = false;
    let ubisoftNotInstalled = false;

    try {
        const gameBackupPath = path.join(getSettings().backupPath, gameObj.wiki_page_id.toString());

        // Find the latest backup folder based on the backup date
        const latestBackupFolder = gameObj.backups.sort((a, b) => b.date.localeCompare(a.date))[0];
        const latestBackupPath = path.join(gameBackupPath, latestBackupFolder.date);

        for (const backupPath of latestBackupFolder.backup_paths) {
            const sourcePath = path.join(latestBackupPath, backupPath.folder_name);
            const destinationPath = resolveTemplatedRestorePath(backupPath.template, backupPath.install_folder);

            if (!await fse.pathExists(sourcePath)) {
                console.warn(`Source path does not exist: ${sourcePath}`);
                continue;
            }

            if (backupPath.type !== 'reg' && !path.isAbsolute(destinationPath.replace(/^[/\\]+/, ''))) {
                const normalizedTemplate = backupPath.template.toLowerCase();

                if (normalizedTemplate.includes('{{p|game}}')) {
                    gameNotInstalled = true;
                } else if (normalizedTemplate.includes('{{p|steam}}')) {
                    steamNotInstalled = true;
                } else if (normalizedTemplate.includes('{{p|ubisoftconnect}}') || normalizedTemplate.includes('{{p|uplay}}')) {
                    ubisoftNotInstalled = true;
                }

                console.warn(`Destination path is not absolute: ${destinationPath}`);
                continue;
            }

            pathsToCheck.push({ sourcePath, destinationPath, backupType: backupPath.type });
        }

        // Check for any conflicts before proceeding with the restore
        const shouldProceed = await shouldSkip(pathsToCheck, getGameDisplayName(gameObj), localActionForAll);

        if (shouldProceed.skip) {
            return { action: null, error: null };
        } else if (shouldProceed.actionForAll) {
            localActionForAll = shouldProceed.actionForAll;
        }

        // Proceed with restoring all paths based on user's decision
        for (const { sourcePath, destinationPath, backupType } of pathsToCheck) {
            await ensureWritable(destinationPath);

            if (backupType === 'folder') {
                await fse.ensureDir(destinationPath);
                await fse.copy(sourcePath, destinationPath, { overwrite: true });

            } else if (backupType === 'file') {
                await fse.ensureDir(path.dirname(destinationPath));
                await fse.copy(path.join(sourcePath, path.basename(destinationPath)), destinationPath, { overwrite: true });

            } else if (backupType === 'reg') {
                const registryFilePath = path.join(sourcePath, 'registry_backup.reg');
                const regImportCommand = `reg import "${registryFilePath}"`;
                await execPromise(regImportCommand);

            } else {
                console.warn(`Unknown backup type: ${backupType}`);
            }
        }

        if (gameNotInstalled) {
            throw Error(i18next.t('alert.game_not_installed'));
        } else if (steamNotInstalled) {
            throw Error(i18next.t('alert.steam_not_installed'));
        } else if (ubisoftNotInstalled) {
            throw Error(i18next.t('alert.ubisoft_not_installed'));
        }

        return { action: localActionForAll, error: null };

    } catch (error) {
        console.error(`Error during restore for game: ${getGameDisplayName(gameObj)}`, error.stack);
        return { action: localActionForAll, error: `${i18next.t('alert.restore_game_error', { game_name: getGameDisplayName(gameObj) })}: ${error.message}` };
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

async function getLatestModificationTime(directory) {
    if (!fs.existsSync(path)) {
        return new Date(0);
    }

    const stats = await fse.lstat(directory);

    if (stats.isDirectory()) {
        const files = await fse.readdir(directory);
        let latestModTime = new Date(0);

        for (const file of files) {
            const fullPath = path.join(directory, file);
            const fileStats = await fse.lstat(fullPath);

            if (fileStats.isDirectory()) {
                // Recursively check subdirectories
                const subDirModTime = await getLatestModificationTime(fullPath);
                if (subDirModTime > latestModTime) {
                    latestModTime = subDirModTime;
                }
            } else {
                // Consider file modification time
                const fileModTime = moment(fileStats.mtime).seconds(0).milliseconds(0).toDate();
                if (fileModTime > latestModTime) {
                    latestModTime = fileModTime;
                }
            }
        }
        return latestModTime;

    } else {
        return moment(stats.mtime).seconds(0).milliseconds(0).toDate();
    }
}

function resolveTemplatedRestorePath(templatedPath, installFolder) {
    let basePath = templatedPath.replace(/\{\{p\|[^\}]+\}\}/gi, match => {
        const normalizedMatch = match.toLowerCase().replace(/\\/g, '/');

        if (normalizedMatch === '{{p|game}}') {
            return getGameInstallPath(installFolder);
        } else if (normalizedMatch === '{{p|steam}}') {
            return getGameData().steamPath;
        } else if (normalizedMatch === '{{p|uplay}}' || normalizedMatch === '{{p|ubisoftconnect}}') {
            return getGameData().ubisoftPath;
        }

        return placeholder_mapping[normalizedMatch] || match;
    });

    return basePath;
}

function getGameInstallPath(installFolder) {
    const gameInstallPaths = getSettings().gameInstalls;

    for (const installPath of gameInstallPaths) {
        const directories = fs.readdirSync(installPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const dir of directories) {
            if (dir === installFolder) {
                return path.join(installPath, dir);
            }
        }
    }

    return 'gameNotInstalled';
}

module.exports = {
    getGameDataForRestore,
    restoreGame,
};