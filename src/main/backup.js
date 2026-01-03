const { app, dialog } = require('electron');

const { exec } = require('child_process');
const fs = require('fs');
const fsOriginal = require('original-fs');
const os = require('os');
const path = require('path');
const util = require('util');

const axios = require('axios');
const fse = require('fs-extra');
const glob = require('glob');
const i18next = require('i18next');
const moment = require('moment');
const sqlite3 = require('sqlite3');
const WinReg = require('winreg');

const { getMainWin, getStatus, updateStatus, getSignedDownloadUrl, getGameDisplayName, calculateDirectorySize, ensureWritable, getNewestBackup, fsOriginalCopyFolder, placeholder_mapping, osKeyMap, getSettings, saveSettings } = require('./global');
const { getGameData, getAllUserIds } = require('./gameData');

const execPromise = util.promisify(exec);


// A sample backup game object: {
//     title: 'Worms W.M.D',
//     wiki_page_id: '35700',
//     install_folder: 'WormsWMD',
//     steam_id: 327030,
//     gog_id: 1448620034,
//     save_location: {
//         win: [
//             '{{p|localappdata}}\\Packages\\Team17DigitalLimited.WormsW.M.DWin10_j5x4vj4y67jhc\\LocalCache\\Local\\Microsoft\\WritablePackageRoot\\CommonData',
//             '{{P|steam}}\\userdata\\{{P|uid}}\\327030',
//             '{{P|game}}\\CommonData\\local.cfg',
//             '{{p|public}}\\Public Documents\\Team17\\WormsWMD'
//         ],
//         reg: [],
//         mac: [],
//         linux: []
//     },
//     platform: [ 'Steam', 'Xbox', 'EA', 'GOG' ],
//     zh_CN: null,
//     install_path: 'F:\\SteamLibrary\\steamapps\\common\\WormsWMD',
//     latest_backup: '2024/9/1 21:00',
//     resolved_paths: [
//         {
//             template: '{{P|steam}}\\userdata\\{{P|uid}}\\327030',
//             resolved: 'D:\\Program Files\\Steam\\userdata\\477235894\\327030',
//             uid: '477235894'
//         },
//         {
//             template: '{{P|game}}\\CommonData\\local.cfg',
//             resolved: 'F:\\SteamLibrary\\steamapps\\common\\WormsWMD\\CommonData\\local.cfg',
//             uid: undefined
//         }
//     ],
//     backup_size: 414799
// }

async function getGameDataFromDB(ignoreUninstalled = false) {
    const games = [];
    const errors = [];
    const dbPath = path.join(app.getPath("userData"), "GSM Database", "database.db");

    if (!fs.existsSync(dbPath)) {
        const installedDbPath = path.join('./database', 'database.db');
        if (!fs.existsSync(installedDbPath)) {
            dialog.showErrorBox(
                i18next.t('alert.missing_database_file'),
                i18next.t('alert.missing_database_file_message')
            );
            return { games, errors };
        } else {
            await fse.copy(installedDbPath, dbPath);
        }
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    let stmtInstallFolder;
    const processedInstallPaths = new Set();

    return new Promise(async (resolve, reject) => {
        try {
            // 1. Process installed games by folder name
            stmtInstallFolder = db.prepare("SELECT * FROM games WHERE install_folder = ?");
            const gameInstallPaths = getSettings().gameInstalls;

            // Process database entries
            if (gameInstallPaths.length > 0) {
                for (const installPath of gameInstallPaths) {
                    const directories = fsOriginal.readdirSync(installPath, { withFileTypes: true })
                        .filter(dirent => dirent.isDirectory())
                        .map(dirent => dirent.name);

                    for (const dir of directories) {
                        if (processedInstallPaths.has(dir)) continue;
                        processedInstallPaths.add(dir);

                        const rows = await new Promise((resolve, reject) => {
                            stmtInstallFolder.all(dir, (err, rows) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(rows);
                                }
                            });
                        });

                        if (rows && rows.length > 0) {
                            for (const row of rows) {
                                try {
                                    row.wiki_page_id = row.wiki_page_id.toString();
                                    row.platform = JSON.parse(row.platform);
                                    row.save_location = JSON.parse(row.save_location);
                                    row.install_path = path.join(installPath, dir);
                                    row.latest_backup = getNewestBackup(row.wiki_page_id);

                                    const processed_game = await process_game(row);
                                    if (processed_game.resolved_paths.length !== 0) {
                                        games.push(processed_game);
                                    }

                                } catch (err) {
                                    console.error(`Error processing installed game ${getGameDisplayName(row)}: ${err.stack}`);
                                    errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: getGameDisplayName(row) })}: ${err.message}`);
                                }
                            }
                        }
                    }
                }
            }
            stmtInstallFolder.finalize();

            // 2. Process uninstalled games by wiki id
            if (!ignoreUninstalled && getSettings().saveUninstalledGames) {
                const uninstalledWikiIds = getSettings().uninstalledGames || [];
                const processedWikiIds = new Set(games.map(game => game.wiki_page_id));
                const remainingUninstalledWikiIds = uninstalledWikiIds.filter(id => !processedWikiIds.has(id));
                if (JSON.stringify([...remainingUninstalledWikiIds].sort()) !== JSON.stringify([...uninstalledWikiIds].sort())) {
                    saveSettings('uninstalledGames', remainingUninstalledWikiIds);
                }

                for (const wikiId of remainingUninstalledWikiIds) {
                    const rows = await new Promise((res, rej) => {
                        db.all("SELECT * FROM games WHERE wiki_page_id = ?", [wikiId], (err, rows) => {
                            if (err) rej(err);
                            else res(rows);
                        });
                    });

                    if (rows && rows.length > 0) {
                        for (const row of rows) {
                            try {
                                row.wiki_page_id = row.wiki_page_id.toString();
                                row.platform = JSON.parse(row.platform);
                                row.save_location = JSON.parse(row.save_location);
                                row.latest_backup = getNewestBackup(row.wiki_page_id);

                                const processed_game = await process_game(row);
                                if (processed_game.resolved_paths.length !== 0) {
                                    games.push(processed_game);
                                }

                            } catch (err) {
                                console.error(`Error processing uninstalled game ${getGameDisplayName(row)}: ${err.stack}`);
                                errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: getGameDisplayName(row) })}: ${err.message}`);
                            }
                        }
                    }
                }
            }

            // 3. Process custom entries
            const customJsonPath = path.join(getSettings().backupPath, 'custom_entries.json');

            if (fs.existsSync(customJsonPath)) {
                const { customGames, customGameErrors } = await processCustomEntries(customJsonPath, gameInstallPaths);
                games.push(...customGames);
                errors.push(...customGameErrors);
            }

        } catch (error) {
            console.error(`Error displaying backup table: ${error.stack}`);
            errors.push(`${i18next.t('alert.backup_process_error_display')}: ${error.message}`);
            if (stmtInstallFolder) {
                stmtInstallFolder.finalize();
            }

        } finally {
            db.close();
            resolve({ games, errors });
        }
    });
}

async function getAllGameDataFromDB() {
    const games = [];
    const errors = [];
    const dbPath = path.join(app.getPath("userData"), "GSM Database", "database.db");
    const gameInstallPaths = getSettings().gameInstalls;

    if (!getStatus().scanning_full) {
        if (!fs.existsSync(dbPath)) {
            const installedDbPath = path.join('./database', 'database.db');
            if (!fs.existsSync(installedDbPath)) {
                dialog.showErrorBox(
                    i18next.t('alert.missing_database_file'),
                    i18next.t('alert.missing_database_file_message')
                );
                return { games, errors };
            } else {
                await fse.copy(installedDbPath, dbPath);
            }
        }

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        const progressId = 'scan-full';
        const progressTitle = i18next.t('alert.scanning_full');
        const mainWin = getMainWin();

        mainWin.webContents.send('update-progress', progressId, progressTitle, 'start');
        updateStatus('scanning_full', true);

        try {
            const rows = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM games", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            const totalRows = rows.length;
            let processedRows = 0;

            for (const row of rows) {
                try {
                    row.wiki_page_id = row.wiki_page_id.toString();
                    row.platform = JSON.parse(row.platform);
                    row.save_location = JSON.parse(row.save_location);
                    row.latest_backup = getNewestBackup(row.wiki_page_id);

                    const processed_game = await process_game(row);
                    if (processed_game.resolved_paths.length !== 0) {
                        games.push(processed_game);
                    }

                } catch (err) {
                    console.error(`Error processing database game ${getGameDisplayName(row)}: ${err.stack}`);
                    errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: getGameDisplayName(row) })}: ${err.message}`);
                }
                processedRows++;
                const dbProgress = Math.floor((processedRows / totalRows) * 95);
                mainWin.webContents.send('update-progress', progressId, progressTitle, dbProgress);
            }

            const customJsonPath = path.join(getSettings().backupPath, 'custom_entries.json');
            if (fs.existsSync(customJsonPath)) {
                const { customGames, customGameErrors } = await processCustomEntries(customJsonPath, gameInstallPaths);
                games.push(...customGames);
                errors.push(...customGameErrors);
            }

            mainWin.webContents.send('update-progress', progressId, progressTitle, 100);
            mainWin.webContents.send('show-alert', 'success', i18next.t('alert.scan_full_complete'));

        } catch (error) {
            console.error(`Error displaying backup table: ${error.stack}`);
            errors.push(`${i18next.t('alert.backup_process_error_display')}: ${error.message}`);

        } finally {
            updateStatus('scanning_full', false);
            mainWin.webContents.send('update-progress', progressId, progressTitle, 'end');
            db.close();
            return { games, errors };
        }
    }
}

async function processCustomEntries(customJsonPath, gameInstallPaths) {
    const customGames = [];
    const customGameErrors = [];

    const customEntries = JSON.parse(fs.readFileSync(customJsonPath, 'utf-8'));
    for (let customEntry of customEntries) {
        try {
            if (customEntry.install_folder) {
                for (const installPath of gameInstallPaths) {
                    const potentialPath = path.join(installPath, customEntry.install_folder);
                    if (fsOriginal.existsSync(potentialPath)) {
                        customEntry.install_path = potentialPath;
                        break;
                    }
                }
            }

            customEntry.platform = ['Custom'];
            customEntry.latest_backup = getNewestBackup(customEntry.wiki_page_id);
            for (const plat in customEntry.save_location) {
                customEntry.save_location[plat] = customEntry.save_location[plat].map(entry => entry.template);
            }

            const processed_game = await process_game(customEntry);
            if (processed_game.resolved_paths.length !== 0) {
                customGames.push(processed_game);
            }
        } catch (err) {
            console.error(`Error processing custom game ${customEntry.title}: ${err.stack}`);
            customGameErrors.push(`${i18next.t('alert.backup_process_error_custom', { game_name: customEntry.title })}: ${err.message}`);
        }
    }

    return { customGames, customGameErrors };
}

async function process_game(db_game_row) {
    const resolved_paths = [];
    let totalBackupSize = 0;

    const currentOS = os.platform();
    const osKey = osKeyMap[currentOS];

    if (osKey && db_game_row.save_location[osKey]) {
        for (const templatedPath of db_game_row.save_location[osKey]) {
            const resolvedPathObjs = await resolveTemplatedBackupPath(templatedPath, db_game_row.install_path, false);

            // Process each resolved path object
            for (const resolvedPathObj of resolvedPathObjs) {
                if (fsOriginal.existsSync(resolvedPathObj.resolved)) {
                    const backupSize = calculateDirectorySize(resolvedPathObj.resolved);
                    if (backupSize > 0) {
                        totalBackupSize += backupSize;
                        resolved_paths.push(resolvedPathObj);
                    }
                }
            }
        }
    }

    // Process registry paths
    if (osKey === 'win' && db_game_row.save_location['reg'] && db_game_row.save_location['reg'].length > 0) {
        for (const templatedPath of db_game_row.save_location['reg']) {
            const resolvedPathObjs = await resolveTemplatedBackupPath(templatedPath, null, true);

            // Process each resolved registry path object
            for (const resolvedPathObj of resolvedPathObjs) {
                const normalizedRegPath = path.normalize(resolvedPathObj.resolved);
                const { hive, key } = parseRegistryPath(normalizedRegPath);
                const winRegHive = getWinRegHive(hive);
                if (!winRegHive) {
                    continue;
                }

                const registryKey = new WinReg({
                    hive: winRegHive,
                    key: key
                });

                await new Promise((resolve, reject) => {
                    registryKey.keyExists((err, exists) => {
                        if (err) {
                            getMainWin().webContents.send('show-alert', 'error', `${i18next.t('alert.registry_existence_check_failed')}: ${db_game_row.title}`);
                            console.error(`Error checking registry existence for ${db_game_row.title}: ${err}`);
                            return reject(err);
                        }
                        if (exists) {
                            resolved_paths.push({
                                template: resolvedPathObj.template,
                                finalTemplate: resolvedPathObj.finalTemplate,
                                resolved: normalizedRegPath,
                                type: 'reg'
                            });
                        }
                        resolve();
                    });
                });
            }
        }
    }

    db_game_row.resolved_paths = resolved_paths;
    db_game_row.backup_size = totalBackupSize;

    return db_game_row;
}

function getWinRegHive(hive) {
    switch (hive) {
        case 'HKEY_CURRENT_USER': return WinReg.HKCU;
        case 'HKEY_LOCAL_MACHINE': return WinReg.HKLM;
        case 'HKEY_CLASSES_ROOT': return WinReg.HKCR;
        default: {
            console.warn(`Invalid registry hive: ${hive}`);
            return null;
        }
    }
}

function parseRegistryPath(registryPath) {
    const parts = registryPath.split('\\');
    const hive = parts.shift();
    const key = '\\' + parts.join('\\');

    return { hive, key };
}

async function resolveTemplatedBackupPath(templatedPath, gameInstallPath, isRegistry = false) {
    // Track placeholder→value mappings for later reconstruction of finalTemplate
    const placeholderMappings = {};

    // Replace all non-uid placeholders while tracking mappings
    let basePath = templatedPath.replace(/\{\{p\|[^\}]+\}\}/gi, match => {
        const normalizedMatch = match.toLowerCase().replace(/\\/g, '/');

        let replacement = normalizedMatch;
        if (normalizedMatch === '{{p|game}}') {
            replacement = gameInstallPath;
        } else if (normalizedMatch === '{{p|steam}}') {
            replacement = getGameData().steamPath;
        } else if (normalizedMatch === '{{p|uplay}}' || normalizedMatch === '{{p|ubisoftconnect}}') {
            replacement = getGameData().ubisoftPath;
        } else if (normalizedMatch === '{{p|uid}}') {
            // Defer handling of {{p|uid}} - leave it as is
            return '{{p|uid}}';
        } else if (placeholder_mapping[normalizedMatch]) {
            replacement = placeholder_mapping[normalizedMatch];
        }

        // Track this mapping if it was actually resolved
        if (replacement !== normalizedMatch) {
            placeholderMappings[normalizedMatch] = replacement;
        }

        return replacement;
    });

    // Final check for unresolved placeholders (except uid)
    if (/\{\{p\|[^\}]+\}\}/i.test(basePath.toLowerCase().replace(/\{\{p\|uid\}\}/gi, ''))) {
        console.warn(`Unresolved placeholder found in path: ${basePath}`);
        return [];
    }

    // If it's a registry path, return directly without uid/wildcard processing
    if (isRegistry) {
        return [{
            template: templatedPath,
            finalTemplate: basePath,
            resolved: basePath
        }];
    }

    // For file paths, pass to fillPathUid to handle uid and wildcards
    return await fillPathUid(templatedPath, basePath, placeholderMappings);
}

async function fillPathUid(templatedPath, basePath, placeholderMappings) {
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // Helper function to create finalTemplate by reversing placeholder mappings
    function createFinalTemplate(resolvedPath) {
        let finalTemplate = resolvedPath.replace(/\\/g, '/');
        const sortedMappings = Object.entries(placeholderMappings)
            .sort((a, b) => b[1].length - a[1].length);

        for (const [placeholder, resolvedValue] of sortedMappings) {
            const normalizedValue = resolvedValue.replace(/\\/g, '/');
            const escapedValue = escapeRegExp(normalizedValue);
            const regex = new RegExp(escapedValue, 'gi');
            finalTemplate = finalTemplate.replace(regex, placeholder);
        }

        return finalTemplate;
    }

    // Helper function to generate all combinations of UIDs for a given number of {{p|uid}}
    function generateUidCombinations(count, allUids) {
        if (count === 0) return [[]];
        if (count === 1) return allUids.map(uid => [uid]);

        const smaller = generateUidCombinations(count - 1, allUids);
        const result = [];
        for (const combo of smaller) {
            for (const uid of allUids) {
                result.push([...combo, uid]);
            }
        }
        return result;
    }

    // Helper function to try glob on a path and return valid paths
    function tryGlobAndReturnPaths(testPath) {
        const files = glob.sync(testPath.replace(/\\/g, '/'));
        if (files.length > 0) {
            return files
                .filter(filePath => fsOriginal.existsSync(filePath))
                .map(filePath => ({
                    template: templatedPath,
                    finalTemplate: createFinalTemplate(filePath),
                    resolved: filePath
                }));
        }
        return null;
    }

    // 1. If there's no uid placeholder, just handle wildcards
    if (!basePath.includes('{{p|uid}}')) {
        const result = tryGlobAndReturnPaths(basePath);
        return result || [];
    }

    const steamPath = getGameData().steamPath;
    const ubisoftPath = getGameData().ubisoftPath;
    const steamUid = getGameData().currentSteamUserId3;
    const ubisoftUid = getGameData().currentUbisoftUserId;

    // Helper to apply context-aware UID replacement using regex
    const applyContextReplacement = (pathStr, fullPattern, uidValue) => {
        if (!fullPattern || !uidValue) return pathStr;

        const normalizedPattern = fullPattern.replace(/\\/g, '/');
        const normalizedPath = pathStr.replace(/\\/g, '/');

        const escapedPattern = escapeRegExp(normalizedPattern);
        const regex = new RegExp(escapedPattern, 'gi');

        const replacement = normalizedPattern.replace(/\{\{p\|uid\}\}/gi, uidValue);
        return normalizedPath.replace(regex, replacement);
    };

    // 2. Apply context-aware replacements
    let contextAwarePath = basePath;
    if (!getSettings().backupAllAccounts) {
        contextAwarePath = applyContextReplacement(contextAwarePath, `${steamPath}/userdata/{{p|uid}}`, steamUid);
        contextAwarePath = applyContextReplacement(contextAwarePath, `${ubisoftPath}/savegames/{{p|uid}}`, ubisoftUid);
    }

    // If both placeholders are context-aware, try glob directly
    if (!contextAwarePath.includes('{{p|uid}}')) {
        const result = tryGlobAndReturnPaths(contextAwarePath);
        return result || [];
    }

    // 3. Count and guess remaining {{p|uid}} placeholders
    const uidMatches = contextAwarePath.match(/\{\{p\|uid\}\}/gi);
    const uidCount = uidMatches ? uidMatches.length : 0;

    if (uidCount === 0) {
        // All UIDs were context-aware, handled above
        return [];
    }

    const uidValues = Object.values(getAllUserIds()).filter(uid => uid && uid !== 'N/A' && uid !== null && uid !== undefined);
    const uidCombinations = generateUidCombinations(uidCount, uidValues);

    for (const uidCombo of uidCombinations) {
        let testPath = contextAwarePath;

        // Replace each {{p|uid}} with the corresponding uid from the combination
        let uidIndex = 0;
        testPath = testPath.replace(/\{\{p\|uid\}\}/gi, () => {
            const uid = uidCombo[uidIndex];
            uidIndex++;
            return uid;
        });

        const result = tryGlobAndReturnPaths(testPath);
        if (result) {
            return result;
        }
    }

    // 4. Final fallback: wildcard matching for uid
    const wildcardPath = basePath.replace(/\{\{p\|uid\}\}/gi, '*');
    const wildcardResolvedPaths = glob.sync(wildcardPath.replace(/\\/g, '/'));

    if (wildcardResolvedPaths.length === 0) {
        return [];
    }

    const latestPath = await findLatestModifiedPath(wildcardResolvedPaths);
    return [{
        template: templatedPath,
        finalTemplate: createFinalTemplate(latestPath),
        resolved: latestPath
    }];
}

// Find the latest modified path
async function findLatestModifiedPath(paths) {
    let latestPath = null;
    let latestTime = 0;

    for (const filePath of paths) {
        const stats = fsOriginal.statSync(filePath);
        if (stats.mtimeMs > latestTime) {
            latestTime = stats.mtimeMs;
            latestPath = filePath;
        }
    }

    return latestPath;
}

async function backupGame(gameObj) {
    const gameBackupPath = path.join(getSettings().backupPath, gameObj.wiki_page_id.toString());

    // Create a new backup instance folder based on the current date and time
    const backupInstanceFolder = moment().format('YYYY-MM-DD_HH-mm');
    const backupInstancePath = path.join(gameBackupPath, backupInstanceFolder);

    try {
        const backupConfig = {
            title: gameObj.title,
            zh_CN: gameObj.zh_CN || null,
            backup_paths: []
        };

        // Iterate over resolved paths and copy files to the backup instance
        for (const [index, resolvedPathObj] of gameObj.resolved_paths.entries()) {
            const resolvedPath = path.normalize(resolvedPathObj.resolved);
            const pathFolderName = `path${index + 1}`;
            const targetPath = path.join(backupInstancePath, pathFolderName);
            fsOriginal.mkdirSync(targetPath, { recursive: true });

            if (resolvedPathObj['type'] === 'reg') {
                // Registry backup logic using reg.exe
                const registryFilePath = path.join(targetPath, 'registry_backup.reg');

                const regExportCommand = `reg export "${resolvedPath}" "${registryFilePath}" /y`;
                await execPromise(regExportCommand);

                backupConfig.backup_paths.push({
                    folder_name: pathFolderName,
                    template: resolvedPathObj.finalTemplate,
                    type: 'reg',
                    install_folder: gameObj.install_folder || null
                });

            } else {
                // File/directory backup logic
                let dataType = null;
                ensureWritable(resolvedPath);
                const stats = fsOriginal.statSync(resolvedPath);

                if (stats.isDirectory()) {
                    dataType = 'folder';
                    fsOriginalCopyFolder(resolvedPath, targetPath);
                } else {
                    dataType = 'file';
                    const targetFilePath = path.join(targetPath, path.basename(resolvedPath));
                    fsOriginal.copyFileSync(resolvedPath, targetFilePath);
                }

                backupConfig.backup_paths.push({
                    folder_name: pathFolderName,
                    template: resolvedPathObj.finalTemplate,
                    type: dataType,
                    install_folder: gameObj.install_folder || null
                });
            }
        }

        const configFilePath = path.join(backupInstancePath, 'backup_info.json');
        await fse.writeJson(configFilePath, backupConfig, { spaces: 4 });

        // Separate permanent and non-permanent backups
        const nonPermanentBackups = [];
        for (const backup of (fsOriginal.readdirSync(gameBackupPath)).sort((a, b) => a.localeCompare(b))) {
            const backupConfigPath = path.join(gameBackupPath, backup, 'backup_info.json');
            if (fsOriginal.existsSync(backupConfigPath)) {
                const backupConfig = await fse.readJson(backupConfigPath);
                if (!backupConfig.is_permanent) {
                    nonPermanentBackups.push(backup);
                }
            } else {
                // If no config file exists, treat as non-permanent
                nonPermanentBackups.push(backup);
            }
        }

        // If there are more non-permanent backups than allowed, delete the oldest ones
        const maxBackups = getSettings().maxBackups;
        if (nonPermanentBackups.length > maxBackups) {
            const backupsToDelete = nonPermanentBackups.slice(0, nonPermanentBackups.length - maxBackups);
            for (const backup of backupsToDelete) {
                const backupToDeletePath = path.join(gameBackupPath, backup);
                fsOriginal.rmSync(backupToDeletePath, { recursive: true, force: true });
            }
        }

    } catch (error) {
        console.error(`Error during backup for game ${getGameDisplayName(gameObj)}: ${error.stack}`);
        return `${i18next.t('alert.backup_game_error', { game_name: getGameDisplayName(gameObj) })}: ${error.message}`;
    }

    return null;
}

async function updateDatabase() {
    const progressId = 'update-db';
    const progressTitle = i18next.t('alert.updating_database');
    const dbPath = path.join(app.getPath("userData"), "GSM Database", "database.db");
    const dbTempPath = `${dbPath}.temp`;

    getMainWin().webContents.send('update-progress', progressId, progressTitle, 'start');

    try {
        if (!fs.existsSync(path.dirname(dbPath))) {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, dbTempPath);
        }

        await new Promise(async (resolve, reject) => {
            try {
                const databaseLink = await getSignedDownloadUrl('GSM/database.db');
                if (!databaseLink) {
                    throw new Error("Request failed.");
                }
                const { data, headers } = await axios({
                    method: 'get',
                    url: databaseLink,
                    responseType: 'stream',
                });

                const totalSize = parseInt(headers['content-length'], 10);
                let downloadedSize = 0;

                const fileStream = fs.createWriteStream(dbTempPath);

                data.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    const progressPercentage = Math.round((downloadedSize / totalSize) * 100);
                    getMainWin().webContents.send('update-progress', progressId, progressTitle, progressPercentage);
                });

                data.on('error', (error) => {
                    reject(error);
                });

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        resolve();
                    });
                });

                fileStream.on('error', (error) => {
                    reject(error);
                });

                data.pipe(fileStream);

            } catch (error) {
                reject(error);
            }
        });

        if (fs.existsSync(dbTempPath)) {
            fs.copyFileSync(dbTempPath, dbPath);
            fs.unlinkSync(dbTempPath);
        }
        getMainWin().webContents.send('update-progress', progressId, progressTitle, 'end');
        getMainWin().webContents.send('show-alert', 'success', i18next.t('alert.update_db_success'));

    } catch (error) {
        console.error(`An error occurred while updating the database: ${error.message}`);
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.error_during_db_update'), error.message);
        getMainWin().webContents.send('update-progress', progressId, progressTitle, 'end');

        if (fs.existsSync(dbTempPath)) {
            fs.unlinkSync(dbTempPath);
        }
    }
}

module.exports = {
    getGameDataFromDB,
    getAllGameDataFromDB,
    backupGame,
    updateDatabase
};
