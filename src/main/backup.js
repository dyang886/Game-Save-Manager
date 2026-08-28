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

const {
    getMainWin, getStatus, updateStatus, getSignedDownloadUrl, getGameDisplayName,
    mapConcurrent, calculateDirectorySize, walkDirectory, readJsonFile, writeJsonFile,
    ensureWritable, getNewestBackup, fsOriginalCopyFolder,
    findGameInstallPath, osKeyMap, getSettings, saveSettings
} = require('./global');
const { getGameData, getAllAccountIds, resolvePlaceholder } = require('./gameData');
const { registryKeyExists, getRegistryChildNames, getRegistryExportSize } = require('./registry');

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
//             finalTemplate: '{{P|steam}}\\userdata\\477235894\\327030',
//             resolved: 'D:\\Program Files\\Steam\\userdata\\477235894\\327030',
//         },
//         {
//             template: '{{P|game}}\\CommonData\\local.cfg',
//             finalTemplate: '{{P|game}}\\CommonData\\local.cfg',
//             resolved: 'F:\\SteamLibrary\\steamapps\\common\\WormsWMD\\CommonData\\local.cfg',
//         }
//     ],
//     backup_size: 414799
// }


// ======================================================================
// Database
// ======================================================================
const databasePath = () => path.join(app.getPath('userData'), 'GSM Database', 'database.db');

// Seeds the user's copy from the one shipped alongside the app on first run.
async function ensureDatabase() {
    if (fs.existsSync(databasePath())) return true;

    const installedDbPath = app.isPackaged
        ? path.join(path.dirname(app.getPath('exe')), 'database', 'database.db')
        : path.join('./database', 'database.db');

    if (!fs.existsSync(installedDbPath)) {
        dialog.showErrorBox(
            i18next.t('alert.missing_database_file'),
            i18next.t('alert.missing_database_file_message')
        );
        return false;
    }

    await fse.copy(installedDbPath, databasePath());
    return true;
}

// Promise wrapper for sqlite3's callback API, which every query here goes through.
function queryAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

// One query per chunk rather than per value, kept under SQLite's 999 variable limit
const SQL_VARIABLE_LIMIT = 900;

async function queryGamesByColumn(db, column, values) {
    const rows = [];

    for (let start = 0; start < values.length; start += SQL_VARIABLE_LIMIT) {
        const chunk = values.slice(start, start + SQL_VARIABLE_LIMIT);
        const placeholders = chunk.map(() => '?').join(',');
        const chunkRows = await queryAll(db, `SELECT * FROM games WHERE ${column} IN (${placeholders})`, chunk.map(String));
        rows.push(...chunkRows);
    }

    return rows;
}

async function updateDatabase() {
    const progressId = 'update-db';
    const progressTitle = i18next.t('alert.updating_database');
    const dbPath = databasePath();
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


// ======================================================================
// Game data
// ======================================================================
// Helper: parse common fields on a DB row
function parseDbRow(row) {
    row.wiki_page_id = row.wiki_page_id.toString();
    row.platform = JSON.parse(row.platform);
    row.save_location = JSON.parse(row.save_location);
    row.latest_backup = getNewestBackup(row.wiki_page_id);
}

// Helper: set install_path from the game install directories, returns true if found
function findInstallPath(row) {
    row.install_path = findGameInstallPath(row.install_folder);
    return Boolean(row.install_path);
}

// Helper: process game and push to array if it has valid resolved paths
async function processAndPushGame(row, games) {
    const processed = await process_game(row);
    if (processed.resolved_paths.length !== 0) {
        games.push(processed);
    }
}

// Games resolve in parallel; one that throws is reported and skipped
async function processRowsConcurrently(rows, games, errors, kind) {
    const resolved = await mapConcurrent(rows, async (row) => {
        try {
            parseDbRow(row);
            return await process_game(row);
        } catch (err) {
            console.error(`Error processing ${kind} game ${getGameDisplayName(row)}: ${err.stack}`);
            errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: getGameDisplayName(row) })}: ${err.message}`);
            return null;
        }
    });

    games.push(...resolved.filter(game => game && game.resolved_paths.length !== 0));
}

async function getGameDataFromDB(ignoreUninstalled = false, wikiId = null) {
    const games = [];
    const errors = [];
    const dbPath = databasePath();

    if (!await ensureDatabase()) return { games, errors };

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    // If specific wikiId is provided, fetch only that game
    if (wikiId) {
        try {
            // 1. Check database
            const rows = await queryAll(db, "SELECT * FROM games WHERE wiki_page_id = ?", [wikiId]);

            if (rows && rows.length > 0) {
                const row = rows[0];
                parseDbRow(row);
                const isInstalled = findInstallPath(row);

                if (!isInstalled) {
                    if (ignoreUninstalled || !getSettings().saveUninstalledGames) {
                        return { games, errors };
                    }
                    const uninstalledWikiIds = (getSettings().uninstalledGames || []).map(String);
                    if (!uninstalledWikiIds.includes(row.wiki_page_id)) {
                        return { games, errors };
                    }
                }

                await processAndPushGame(row, games);
            } else {
                // 2. Fallback to checking custom games
                const customJsonPath = path.join(getSettings().backupPath, 'custom_entries.json');
                if (fsOriginal.existsSync(customJsonPath)) {
                    const { customGames, customGameErrors } = await processCustomEntries(customJsonPath, wikiId);
                    games.push(...customGames);
                    errors.push(...customGameErrors);
                }
            }
        } catch (error) {
            console.error(`Error fetching single game data for ${wikiId}: ${error.stack}`);
            errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: wikiId })}: ${error.message}`);
        } finally {
            db.close();
        }
        return { games, errors };
    }

    return new Promise(async (resolve, reject) => {
        try {
            // 1. Process installed games by folder name
            const gameInstallPaths = getSettings().gameInstalls;

            // First install root wins, matching the old per-folder de-duplication
            const installPathByFolder = new Map();
            for (const installPath of gameInstallPaths) {
                for (const dirent of fsOriginal.readdirSync(installPath, { withFileTypes: true })) {
                    if (dirent.isDirectory() && !installPathByFolder.has(dirent.name)) {
                        installPathByFolder.set(dirent.name, path.join(installPath, dirent.name));
                    }
                }
            }

            const installedRows = await queryGamesByColumn(db, 'install_folder', [...installPathByFolder.keys()]);
            for (const row of installedRows) {
                row.install_path = installPathByFolder.get(row.install_folder);
            }
            await processRowsConcurrently(installedRows, games, errors, 'installed');

            // 2. Process uninstalled games by wiki id
            if (!ignoreUninstalled && getSettings().saveUninstalledGames) {
                const uninstalledWikiIds = getSettings().uninstalledGames || [];
                const processedWikiIds = new Set(games.map(game => game.wiki_page_id));
                const remainingUninstalledWikiIds = uninstalledWikiIds.filter(id => !processedWikiIds.has(id));
                if (JSON.stringify([...remainingUninstalledWikiIds].sort()) !== JSON.stringify([...uninstalledWikiIds].sort())) {
                    await saveSettings('uninstalledGames', remainingUninstalledWikiIds);
                }

                const uninstalledRows = await queryGamesByColumn(db, 'wiki_page_id', remainingUninstalledWikiIds);
                await processRowsConcurrently(uninstalledRows, games, errors, 'uninstalled');
            }

            // 3. Process custom entries
            const customJsonPath = path.join(getSettings().backupPath, 'custom_entries.json');

            if (fsOriginal.existsSync(customJsonPath)) {
                const { customGames, customGameErrors } = await processCustomEntries(customJsonPath);
                games.push(...customGames);
                errors.push(...customGameErrors);
            }

        } catch (error) {
            console.error(`Error displaying backup table: ${error.stack}`);
            errors.push(`${i18next.t('alert.backup_process_error_display')}: ${error.message}`);

        } finally {
            db.close();
            resolve({ games, errors });
        }
    });
}

async function getAllGameDataFromDB() {
    const games = [];
    const errors = [];
    const dbPath = databasePath();

    if (!getStatus().scanning_full) {
        if (!await ensureDatabase()) return { games, errors };

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        const progressId = 'scan-full';
        const progressTitle = i18next.t('alert.scanning_full');
        const mainWin = getMainWin();

        mainWin.webContents.send('update-progress', progressId, progressTitle, 'start');
        updateStatus('scanning_full', true);

        try {
            const rows = await queryAll(db, "SELECT * FROM games");

            const totalRows = rows.length;
            let processedRows = 0;
            let reportedProgress = -1;

            const scanned = await mapConcurrent(rows, async (row) => {
                let processed = null;
                try {
                    parseDbRow(row);
                    processed = await process_game(row);

                } catch (err) {
                    console.error(`Error processing database game ${getGameDisplayName(row)}: ${err.stack}`);
                    errors.push(`${i18next.t('alert.backup_process_error_db', { game_name: getGameDisplayName(row) })}: ${err.message}`);
                }

                processedRows++;
                // Only on change, or concurrent rows resend the same percent
                const dbProgress = Math.floor((processedRows / totalRows) * 95);
                if (dbProgress !== reportedProgress) {
                    reportedProgress = dbProgress;
                    mainWin.webContents.send('update-progress', progressId, progressTitle, dbProgress);
                }
                return processed;
            });

            games.push(...scanned.filter(game => game && game.resolved_paths.length !== 0));

            const customJsonPath = path.join(getSettings().backupPath, 'custom_entries.json');
            if (fsOriginal.existsSync(customJsonPath)) {
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

// Names only, for the hidden-games modal, which has no use for save paths
async function getGameTitlesByIds(wikiIds) {
    const results = [];
    if (!wikiIds || wikiIds.length === 0) {
        return results;
    }

    const dbPath = databasePath();
    if (!fs.existsSync(dbPath)) {
        return results;
    }

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    try {
        const placeholders = wikiIds.map(() => '?').join(',');
        const rows = await queryAll(db,
            `SELECT wiki_page_id, title, zh_CN FROM games WHERE wiki_page_id IN (${placeholders})`,
            wikiIds.map(String));

        for (const row of rows) {
            results.push({
                wiki_page_id: row.wiki_page_id.toString(),
                title: row.title,
                zh_CN: row.zh_CN
            });
        }
    } catch (error) {
        console.error(`Error fetching game titles by ids: ${error.message}`);
    } finally {
        db.close();
    }

    return results;
}

async function processCustomEntries(customJsonPath, targetWikiId = null) {
    const customGames = [];
    const customGameErrors = [];

    const customEntries = await readJsonFile(customJsonPath);
    const entriesToProcess = targetWikiId
        ? customEntries.filter(e => e.wiki_page_id === targetWikiId)
        : customEntries;

    const processed = await mapConcurrent(entriesToProcess, async (customEntry) => {
        try {
            findInstallPath(customEntry);
            customEntry.platform = ['Custom'];
            customEntry.latest_backup = getNewestBackup(customEntry.wiki_page_id);
            for (const plat in customEntry.save_location) {
                customEntry.save_location[plat] = customEntry.save_location[plat].map(entry => entry.template);
            }

            return await process_game(customEntry);
        } catch (err) {
            console.error(`Error processing custom game ${customEntry.title}: ${err.stack}`);
            customGameErrors.push(`${i18next.t('alert.backup_process_error_custom', { game_name: customEntry.title })}: ${err.message}`);
            return null;
        }
    });

    customGames.push(...processed.filter(game => game && game.resolved_paths.length !== 0));

    return { customGames, customGameErrors };
}

async function process_game(db_game_row) {
    const resolved_paths = [];
    let totalBackupSize = 0;
    let latestModifiedMs = 0;

    const currentOS = os.platform();
    const osKey = osKeyMap[currentOS];

    if (osKey && db_game_row.save_location[osKey]) {
        for (const templatedPath of db_game_row.save_location[osKey]) {
            const resolvedPathObjs = await resolveTemplatedBackupPath(templatedPath, db_game_row.install_path, false);

            // Walked all at once; a missing path sizes to zero, which excludes it below
            const walked = await Promise.all(resolvedPathObjs.map(
                resolvedPathObj => walkDirectory(resolvedPathObj.resolved)
            ));

            resolvedPathObjs.forEach((resolvedPathObj, index) => {
                if (walked[index].size > 0) {
                    totalBackupSize += walked[index].size;
                    latestModifiedMs = Math.max(latestModifiedMs, walked[index].modifiedMs);
                    resolved_paths.push(resolvedPathObj);
                }
            });
        }
    }

    // Process registry paths
    if (osKey === 'win' && db_game_row.save_location['reg'] && db_game_row.save_location['reg'].length > 0) {
        for (const templatedPath of db_game_row.save_location['reg']) {
            const resolvedPathObjs = await resolveTemplatedBackupPath(templatedPath, null, true);

            // Sizing a key also answers whether it exists, so it doubles as the check
            for (const resolvedPathObj of resolvedPathObjs) {
                const normalizedRegPath = path.normalize(resolvedPathObj.resolved);
                const exportSize = getRegistryExportSize(normalizedRegPath);
                if (exportSize !== null) {
                    totalBackupSize += exportSize;
                    resolved_paths.push({
                        template: resolvedPathObj.template,
                        finalTemplate: resolvedPathObj.finalTemplate,
                        resolved: normalizedRegPath,
                        type: 'reg'
                    });
                }
            }
        }
    }

    db_game_row.resolved_paths = resolved_paths;
    db_game_row.backup_size = totalBackupSize;
    // A registry-only save has no file to date, so there is no time to show
    db_game_row.latest_modified = latestModifiedMs
        ? moment(latestModifiedMs).format('YYYY/MM/DD HH:mm')
        : '-';

    return db_game_row;
}


// ======================================================================
// Path resolution
// ======================================================================
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Only * and ? are allowed as wildcards
function toGlobPattern(resolvedPath) {
    return resolvedPath.replace(/\\/g, '/').replace(/[[\]{}()!+@|]/g, '\\$&');
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

// Helper function to reconstruct the final template from resolved placeholder mappings
function createFinalTemplate(resolvedPath, placeholderMappings) {
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

async function resolveTemplatedBackupPath(templatedPath, gameInstallPath, isRegistry = false) {
    // Track placeholder→value mappings for later reconstruction of finalTemplate
    const placeholderMappings = {};

    // Replace all non-uid placeholders while tracking mappings
    let basePath = templatedPath.replace(/\{\{p\|[^\}]+\}\}/gi, match => {
        const normalizedMatch = match.toLowerCase().replace(/\\/g, '/');
        if (normalizedMatch === '{{p|uid}}') {
            return '{{p|uid}}';   // resolved later, once per account
        }

        const replacement = resolvePlaceholder(normalizedMatch, gameInstallPath);
        if (replacement === null) {
            return normalizedMatch;
        }

        placeholderMappings[normalizedMatch] = replacement;
        return replacement;
    });

    // Final check for unresolved placeholders (except uid)
    if (/\{\{p\|[^\}]+\}\}/i.test(basePath.toLowerCase().replace(/\{\{p\|uid\}\}/gi, ''))) {
        console.warn(`Unresolved placeholder found in path: ${basePath}`);
        return [];
    }

    if (isRegistry) {
        // Registry paths require registry-key enumeration rather than filesystem globbing.
        return await fillRegistryPathUid(templatedPath, basePath, placeholderMappings);
    }

    // For file paths, pass to fillPathUid to handle uid and wildcards
    return await fillPathUid(templatedPath, basePath, placeholderMappings);
}

async function fillPathUid(templatedPath, basePath, placeholderMappings) {
    // Stays sync: the async walk orders differently, and order names path1/path2
    function tryGlobAndReturnPaths(testPath) {
        // glob walks with patched fs, so it descends into a .asar; original-fs sees
        // those matches for what they are, paths that do not exist on disk.
        const files = glob.sync(toGlobPattern(testPath));
        if (files.length > 0) {
            return files
                .filter(filePath => fsOriginal.existsSync(filePath))
                .map(filePath => ({
                    template: templatedPath,
                    finalTemplate: createFinalTemplate(filePath, placeholderMappings),
                    resolved: filePath
                }));
        }
        return null;
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

    // 1. If there's no uid placeholder, just handle wildcards
    if (!basePath.includes('{{p|uid}}')) {
        const result = tryGlobAndReturnPaths(basePath);
        return result || [];
    }

    // 2. For all accounts, skip context-aware and known UID matching and use wildcards
    if (getSettings().backupAllAccounts) {
        const wildcardPath = basePath.replace(/\{\{p\|uid\}\}/gi, '*');
        const result = tryGlobAndReturnPaths(wildcardPath);
        return result || [];
    }

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

    const steamPath = getGameData().steamPath;
    const ubisoftPath = getGameData().ubisoftPath;
    const steamAccountId = getGameData().currentSteamAccountId;
    const ubisoftAccountId = getGameData().currentUbisoftAccountId;

    // 3. Apply platform-specific current-account replacements
    let contextAwarePath = basePath;
    contextAwarePath = applyContextReplacement(contextAwarePath, `${steamPath}/userdata/{{p|uid}}`, steamAccountId);
    contextAwarePath = applyContextReplacement(contextAwarePath, `${ubisoftPath}/savegames/{{p|uid}}`, ubisoftAccountId);

    // If all placeholders are context-aware, try glob directly
    if (!contextAwarePath.includes('{{p|uid}}')) {
        const result = tryGlobAndReturnPaths(contextAwarePath);
        return result || [];
    }

    // 4. Count and try known current-account IDs for remaining {{p|uid}} placeholders
    const uidMatches = contextAwarePath.match(/\{\{p\|uid\}\}/gi);
    const uidCount = uidMatches ? uidMatches.length : 0;

    if (uidCount === 0) {
        return [];
    }

    const uidValues = Object.values(getAllAccountIds()).filter(uid => uid && uid !== 'N/A' && uid !== null && uid !== undefined);
    const uidCombinations = generateUidCombinations(uidCount, uidValues);

    for (const uidCombo of uidCombinations) {
        let testPath = contextAwarePath;

        // Replace each {{p|uid}} with the corresponding UID from the combination
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

    // 5. Final fallback: select the newest wildcard match for UID
    const wildcardPath = basePath.replace(/\{\{p\|uid\}\}/gi, '*');
    const wildcardResolvedPaths = glob.sync(toGlobPattern(wildcardPath))
        .filter(filePath => fsOriginal.existsSync(filePath));

    if (wildcardResolvedPaths.length === 0) {
        return [];
    }

    const latestPath = await findLatestModifiedPath(wildcardResolvedPaths);
    return [{
        template: templatedPath,
        finalTemplate: createFinalTemplate(latestPath, placeholderMappings),
        resolved: latestPath
    }];
}

async function fillRegistryPathUid(templatedPath, basePath, placeholderMappings) {
    // A trailing separator hides the key from reg.exe and escapes the quote on export
    basePath = basePath.replace(/\\+$/, '');

    function expandUidWildcards(registryPath) {
        const [hive, ...segments] = registryPath.split('\\').filter(Boolean);
        const uidSegmentIndex = segments.findIndex(segment => /\{\{p\|uid\}\}/i.test(segment));

        if (uidSegmentIndex === -1) {
            return [registryPath];
        }

        const parentSegments = segments.slice(0, uidSegmentIndex);
        const parentPath = parentSegments.length > 0
            ? `${hive}\\${parentSegments.join('\\')}`
            : hive;
        const childNames = getRegistryChildNames(parentPath);
        const uidSegmentPattern = new RegExp(
            `^${segments[uidSegmentIndex]
                .split(/\{\{p\|uid\}\}/i)
                .map(escapeRegExp)
                .join('(.+)')}$`,
            'i'
        );
        const expandedPaths = [];

        for (const childName of childNames) {
            if (!uidSegmentPattern.test(childName)) continue;

            const candidateSegments = [...segments];
            candidateSegments[uidSegmentIndex] = childName;
            const candidatePath = `${hive}\\${candidateSegments.join('\\')}`;
            expandedPaths.push(...expandUidWildcards(candidatePath));
        }

        return expandedPaths;
    }

    const toResolvedPathObj = resolvedPath => ({
        template: templatedPath,
        finalTemplate: createFinalTemplate(resolvedPath, placeholderMappings),
        resolved: resolvedPath
    });

    // 1. If there's no uid placeholder, return the concrete registry path
    if (!basePath.includes('{{p|uid}}')) {
        return [toResolvedPathObj(basePath)];
    }

    // 2. For all accounts, enumerate and return every matching registry key
    if (getSettings().backupAllAccounts) {
        const expandedPaths = expandUidWildcards(basePath);
        const existingPaths = [];
        for (const registryPath of expandedPaths) {
            if (registryKeyExists(registryPath)) {
                existingPaths.push(toResolvedPathObj(registryPath));
            }
        }
        return existingPaths;
    }

    // 3. Try known current-account IDs
    const uidMatches = basePath.match(/\{\{p\|uid\}\}/gi);
    const uidCount = uidMatches ? uidMatches.length : 0;
    const uidValues = Object.values(getAllAccountIds())
        .filter(uid => uid && uid !== 'N/A' && uid !== null && uid !== undefined);
    const uidCombinations = generateUidCombinations(uidCount, uidValues);

    for (const uidCombo of uidCombinations) {
        let uidIndex = 0;
        const candidatePath = basePath.replace(/\{\{p\|uid\}\}/gi, () => uidCombo[uidIndex++]);
        if (registryKeyExists(candidatePath)) {
            return [toResolvedPathObj(candidatePath)];
        }
    }

    // 4. Fall back to the first wildcard match
    const expandedPaths = expandUidWildcards(basePath);
    for (const registryPath of expandedPaths) {
        if (registryKeyExists(registryPath)) {
            return [toResolvedPathObj(registryPath)];
        }
    }

    return [];
}


// ======================================================================
// Backing up
// ======================================================================
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
                await ensureWritable(resolvedPath);
                const stats = fsOriginal.statSync(resolvedPath);

                if (stats.isDirectory()) {
                    dataType = 'folder';
                    await fsOriginalCopyFolder(resolvedPath, targetPath);
                } else {
                    dataType = 'file';
                    const targetFilePath = path.join(targetPath, path.basename(resolvedPath));
                    await fsOriginal.promises.copyFile(resolvedPath, targetFilePath);
                }

                backupConfig.backup_paths.push({
                    folder_name: pathFolderName,
                    template: resolvedPathObj.finalTemplate,
                    type: dataType,
                    install_folder: gameObj.install_folder || null
                });
            }
        }

        // Sized before the config exists, so it matches a later walk of this folder
        backupConfig.backup_size = await calculateDirectorySize(backupInstancePath);

        const configFilePath = path.join(backupInstancePath, 'backup_info.json');
        await writeJsonFile(configFilePath, backupConfig);

        // Separate permanent and non-permanent backups
        const nonPermanentBackups = [];
        for (const backup of (fsOriginal.readdirSync(gameBackupPath)).sort((a, b) => a.localeCompare(b))) {
            const backupConfigPath = path.join(gameBackupPath, backup, 'backup_info.json');
            if (fsOriginal.existsSync(backupConfigPath)) {
                const backupConfig = await readJsonFile(backupConfigPath);
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
                await fsOriginal.promises.rm(backupToDeletePath, { recursive: true, force: true });
            }
        }

    } catch (error) {
        console.error(`Error during backup for game ${getGameDisplayName(gameObj)}: ${error.stack}`);
        return `${i18next.t('alert.backup_game_error', { game_name: getGameDisplayName(gameObj) })}: ${error.message}`;
    }

    return null;
}


module.exports = {
    getGameDataFromDB,
    getAllGameDataFromDB,
    getGameTitlesByIds,
    backupGame,
    updateDatabase
};

