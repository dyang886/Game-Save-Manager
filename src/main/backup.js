const { app, dialog } = require('electron');

const { exec } = require('child_process');
const fs = require('fs');
const fsOriginal = require('original-fs');
const https = require('https');
const os = require('os');
const path = require('path');
const util = require('util');

const fse = require('fs-extra');
const glob = require('glob');
const i18next = require('i18next');
const moment = require('moment');
const sqlite3 = require('sqlite3');
const WinReg = require('winreg');

const { getMainWin, getStatus, updateStatus, getSignedDownloadUrl, getGameDisplayName, calculateDirectorySize, ensureWritable, getNewestBackup, fsOriginalCopyFolder, placeholder_mapping, osKeyMap, getSettings, saveSettings } = require('./global');
const { getGameData } = require('./gameData');

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
                const { customGames, customGameErrors } = await processCustomEntries(customJsonPath);
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
                const { customGames, customGameErrors } = await processCustomEntries(customJsonPath);
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

async function processCustomEntries(customJsonPath) {
    const customGames = [];
    const customGameErrors = [];

    const customEntries = JSON.parse(fs.readFileSync(customJsonPath, 'utf-8'));
    for (let customEntry of customEntries) {
        try {
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
            const resolvedPath = await resolveTemplatedBackupPath(templatedPath, db_game_row.install_path);

            // Check whether the resolved path actually exists then calculate size
            if (resolvedPath.path.includes('*')) {
                const files = glob.sync(resolvedPath.path.replace(/\\/g, '/'));
                for (const filePath of files) {
                    if (fsOriginal.existsSync(filePath)) {
                        const backupSize = calculateDirectorySize(filePath);
                        if (backupSize > 0) {
                            totalBackupSize += backupSize;
                            resolved_paths.push({
                                template: templatedPath,
                                resolved: path.normalize(filePath),
                                uid: resolvedPath.uid
                            });
                        }
                    }
                }
            } else {
                if (fsOriginal.existsSync(resolvedPath.path)) {
                    const backupSize = calculateDirectorySize(resolvedPath.path);
                    if (backupSize > 0) {
                        totalBackupSize += backupSize;
                        resolved_paths.push({
                            template: templatedPath,
                            resolved: path.normalize(resolvedPath.path),
                            uid: resolvedPath.uid
                        });
                    }
                }
            }
        }
    }

    // Process registry paths
    if (osKey === 'win' && db_game_row.save_location['reg'] && db_game_row.save_location['reg'].length > 0) {
        for (const templatedPath of db_game_row.save_location['reg']) {
            const resolvedPath = await resolveTemplatedBackupPath(templatedPath, null);

            const normalizedRegPath = path.normalize(resolvedPath.path);
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
                            template: templatedPath,
                            resolved: normalizedRegPath,
                            uid: resolvedPath.uid,
                            type: 'reg'
                        });
                    }
                    resolve();
                });
            });
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

// Resolves the templated path to the actual path based on the save_path_mapping
async function resolveTemplatedBackupPath(templatedPath, gameInstallPath) {
    let basePath = templatedPath.replace(/\{\{p\|[^\}]+\}\}/gi, match => {
        const normalizedMatch = match.toLowerCase().replace(/\\/g, '/');

        if (normalizedMatch === '{{p|game}}') {
            return gameInstallPath;
        } else if (normalizedMatch === '{{p|steam}}') {
            return getGameData().steamPath;
        } else if (normalizedMatch === '{{p|uplay}}' || normalizedMatch === '{{p|ubisoftconnect}}') {
            return getGameData().ubisoftPath;
        } else if (normalizedMatch === '{{p|uid}}') {
            // Defer handling of {{p|uid}} to the next step
            return '{{p|uid}}';
        }

        return placeholder_mapping[normalizedMatch] || match;
    });

    // Final check for unresolved placeholders, but ignore {{p|uid}}
    if (/\{\{p\|[^\}]+\}\}/i.test(basePath.toLowerCase().replace(/\{\{p\|uid\}\}/gi, ''))) {
        console.warn(`Unresolved placeholder found in path: ${basePath}`);
        return { path: '' };
    }

    // Handle {{p|uid}}
    if (basePath.includes('{{p|uid}}')) {
        return await fillPathUid(basePath);
    } else {
        return { path: basePath };
    }
}

async function fillPathUid(basePath) {
    const userIds = [getGameData().currentSteamUserId64, getGameData().currentSteamUserId3, getGameData().currentUbisoftUserId];

    // Check with pre-determined user ids
    for (const uid of userIds) {
        const resolvedPath = basePath.replace(/\{\{p\|uid\}\}/gi, uid);
        const matchedPaths = glob.sync(resolvedPath.replace(/\\/g, '/'));

        if (matchedPaths.length > 0) {
            return {
                path: resolvedPath,
                uid: uid,
            };
        }
    }

    // Exclude steam and ubisoft userdata save paths (to process current user only)
    const steamSavePathPattern = `${getGameData().steamPath}/userdata/{{p|uid}}`.replace(/\\/g, '/');
    const ubisoftSavePathPattern = `${getGameData().ubisoftPath}/savegames/{{p|uid}}`.replace(/\\/g, '/');
    const normalizedBasePath = basePath.replace(/\\/g, '/');

    if (normalizedBasePath.toLowerCase().includes(steamSavePathPattern.toLowerCase()) ||
        normalizedBasePath.toLowerCase().includes(ubisoftSavePathPattern.toLowerCase())) {
        return { path: '' };
    }

    // If no valid paths found with userIds, attempt wildcard for uid
    const wildcardPath = basePath.replace(/\{\{p\|uid\}\}/gi, '*');
    const wildcardResolvedPaths = glob.sync(wildcardPath.replace(/\\/g, '/'));

    if (wildcardResolvedPaths.length === 0) {
        return { path: '' };
    }

    const latestPath = await findLatestModifiedPath(wildcardResolvedPaths);
    const extractedUid = extractUidFromPath(basePath, latestPath);
    return {
        path: basePath.replace(/\{\{p\|uid\}\}/gi, extractedUid),
        uid: extractedUid,
    };
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

// Extract the uid from the resolved path based on the template path
function extractUidFromPath(templatePath, resolvedPath) {
    const templateParts = templatePath.split(path.sep);
    const resolvedParts = resolvedPath.split(path.sep);

    // Find where {{p|uid}} appears in the template and extract the corresponding part from the resolved path
    const uidIndex = templateParts.findIndex(part => part.includes('{{p|uid}}'));

    if (uidIndex !== -1 && resolvedParts[uidIndex]) {
        return resolvedParts[uidIndex];
    }

    return null;
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
                    template: resolvedPathObj.template,
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
                    template: finalizeTemplate(resolvedPathObj.template, resolvedPathObj.resolved, resolvedPathObj.uid, gameObj.install_path),
                    type: dataType,
                    install_folder: gameObj.install_folder || null
                });
            }
        }

        const configFilePath = path.join(backupInstancePath, 'backup_info.json');
        await fse.writeJson(configFilePath, backupConfig, { spaces: 4 });

        const existingBackups = (fsOriginal.readdirSync(gameBackupPath)).sort((a, b) => {
            return a.localeCompare(b);
        });

        // If there are more backups than allowed, delete the oldest ones
        const maxBackups = getSettings().maxBackups;
        if (existingBackups.length > maxBackups) {
            const backupsToDelete = existingBackups.slice(0, existingBackups.length - maxBackups);
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

// Replace wildcards and uid by finding the corresponding components in resolved path
function finalizeTemplate(template, resolvedPath, uid, gameInstallPath) {
    function splitTemplatePath(templatePath) {
        const tokens = [];
        let currentToken = '';
        let i = 0;
        let inPlaceholder = false;

        while (i < templatePath.length) {
            // If we're not already in a placeholder and we see the start marker, enter placeholder mode.
            if (!inPlaceholder && templatePath.substr(i, 2) === '{{') {
                inPlaceholder = true;
                currentToken += '{{';
                i += 2;
                continue;
            }

            // If we're in a placeholder and we see the end marker, exit placeholder mode.
            if (inPlaceholder && templatePath.substr(i, 2) === '}}') {
                inPlaceholder = false;
                currentToken += '}}';
                i += 2;
                continue;
            }

            // If we're not inside a placeholder and we encounter a path separator, flush the current token and skip any consecutive separators.
            if (!inPlaceholder && (templatePath[i] === '\\' || templatePath[i] === '/')) {
                if (currentToken) {
                    tokens.push(currentToken);
                    currentToken = '';
                }
                while (i < templatePath.length && (templatePath[i] === '\\' || templatePath[i] === '/')) {
                    i++;
                }
                continue;
            }

            // Append the current character to the token.
            currentToken += templatePath[i];
            i++;
        }

        if (currentToken) {
            tokens.push(currentToken);
        }
        return tokens;
    }

    const templateParts = splitTemplatePath(template);
    let resolvedParts = resolvedPath.split(path.sep);

    let resultParts = [];
    let resolvedIndex = 0;

    for (let i = 0; i < templateParts.length; i++) {
        const currentPart = templateParts[i]

        // Process placeholders
        if (/\{\{p\|[^\}]+\}\}/gi.test(currentPart)) {
            let pathMapping = '';
            const placeholder = currentPart.replace(/\\/g, '/').toLowerCase();

            if (placeholder.includes('{{p|game}}')) {
                pathMapping = placeholder.replace('{{p|game}}', gameInstallPath);
            } else if (placeholder.includes('{{p|steam}}')) {
                pathMapping = placeholder.replace('{{p|steam}}', getGameData().steamPath);
            } else if (/\{\{p\|(uplay|ubisoftconnect)\}\}/.test(placeholder)) {
                pathMapping = placeholder.replace(/\{\{p\|(uplay|ubisoftconnect)\}\}/, getGameData().ubisoftPath);
            } else if (placeholder.includes('{{p|uid}}')) {
                resultParts.push(placeholder.replace('{{p|uid}}', uid));
                resolvedIndex++;
                continue;
            } else {
                pathMapping = placeholder_mapping[placeholder];
            }

            resultParts.push(placeholder);
            const splittedPathMapping = pathMapping.split(path.sep);
            resolvedIndex += splittedPathMapping.length;

            // Process wildcards
        } else if (currentPart.includes('*')) {
            resultParts.push(resolvedParts[resolvedIndex]);
            resolvedIndex++;

            // Process normal path elements
        } else {
            resultParts.push(currentPart);
            resolvedIndex++;
        }
    }

    return path.join(...resultParts);
}

async function updateDatabase() {
    const progressId = 'update-db';
    const progressTitle = i18next.t('alert.updating_database');
    const dbPath = path.join(app.getPath("userData"), "GSM Database", "database.db");
    const backupPath = `${dbPath}.backup`;

    getMainWin().webContents.send('update-progress', progressId, progressTitle, 'start');

    try {
        if (!fs.existsSync(path.dirname(dbPath))) {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
        }

        await new Promise(async (resolve, reject) => {
            const databaseLink = await getSignedDownloadUrl('GSM/database.db');
            const request = https.get(databaseLink, (response) => {
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;

                const fileStream = fs.createWriteStream(dbPath);

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    const progressPercentage = Math.round((downloadedSize / totalSize) * 100);
                    getMainWin().webContents.send('update-progress', progressId, progressTitle, progressPercentage);
                });

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        resolve();
                    });
                });

                response.on('error', (error) => {
                    reject(error);
                });
            });

            request.on('error', (error) => {
                reject(error);
            });
        });

        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
        }
        getMainWin().webContents.send('update-progress', progressId, progressTitle, 'end');
        getMainWin().webContents.send('show-alert', 'success', i18next.t('alert.update_db_success'));

    } catch (error) {
        console.error(`An error occurred while updating the database: ${error.message}`);
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.error_during_db_update'), error.message);
        getMainWin().webContents.send('update-progress', progressId, progressTitle, 'end');

        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, dbPath);
            fs.unlinkSync(backupPath);
        }
    }
}

module.exports = {
    getGameDataFromDB,
    getAllGameDataFromDB,
    backupGame,
    updateDatabase
};
