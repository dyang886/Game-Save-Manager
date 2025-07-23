const { BrowserWindow, Menu, Notification, app, ipcMain } = require('electron');

const fs = require('fs');
const fsOriginal = require('original-fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const axios = require('axios');
const fse = require('fs-extra');
const i18next = require('i18next');
const moment = require('moment');
const Seven = require('node-7z');
const sevenBin = require('7zip-bin');

const { SIGNED_URL_API_GATEWAY_ENDPOINT, VERSION_CHECKER_API_GATEWAY_ENDPOINT, CLIENT_API_KEY } = require('./secret_config')

let win;
let settingsWin;
let aboutWin;
let settings;
let writeQueue = Promise.resolve();

const appVersion = "1.0.0";
let status = {
    backuping: false,
    scanning_full: false,
    restoring: false,
    migrating: false,
    updating_db: false,
    exporting: false,
    importing: false
}

// Menu settings
const initializeMenu = () => {
    return [
        {
            label: i18next.t("main.options"),
            submenu: [
                {
                    label: i18next.t("settings.title"),
                    click() {
                        let settings_window_size = [650, 700];
                        // Check if settingsWin is already open
                        if (!settingsWin || settingsWin.isDestroyed()) {
                            settingsWin = new BrowserWindow({
                                width: settings_window_size[0],
                                height: settings_window_size[1],
                                minWidth: settings_window_size[0],
                                minHeight: settings_window_size[1],
                                icon: path.join(__dirname, "../assets/setting.ico"),
                                parent: win,
                                modal: true,
                                webPreferences: {
                                    preload: path.join(__dirname, "../preload/preload.js"),
                                    sandbox: false,
                                },
                            });

                            // settingsWin.webContents.openDevTools();
                            settingsWin.setMenuBarVisibility(false);
                            settingsWin.loadFile(path.join(__dirname, "../renderer/settings.html"));

                            settingsWin.on("closed", () => {
                                settingsWin = null;
                            });
                        } else {
                            settingsWin.focus();
                        }
                    },
                },
                {
                    label: i18next.t("main.scan_full"),
                    click() {
                        win.webContents.send("scan-full");
                    },
                },
                {
                    label: i18next.t("about.title"),
                    click() {
                        let about_window_size = [480, 290];
                        if (!aboutWin || aboutWin.isDestroyed()) {
                            aboutWin = new BrowserWindow({
                                width: about_window_size[0],
                                height: about_window_size[1],
                                resizable: false,
                                icon: path.join(__dirname, "../assets/logo.ico"),
                                parent: win,
                                modal: true,
                                webPreferences: {
                                    preload: path.join(__dirname, "../preload/preload.js"),
                                    sandbox: false,
                                },
                            });

                            // aboutWin.webContents.openDevTools();
                            aboutWin.setMenuBarVisibility(false);
                            aboutWin.loadFile(path.join(__dirname, "../renderer/about.html"));

                            aboutWin.on("closed", () => {
                                aboutWin = null;
                            });
                        } else {
                            aboutWin.focus();
                        }
                    },
                },
            ],
        },
        {
            label: i18next.t("main.export"),
            click() {
                win.webContents.send("open-export-modal");
            },
        },
        {
            label: i18next.t("main.import"),
            click() {
                win.webContents.send("open-import-modal", "");
            },
        },
    ];
}

// Main window
const createMainWindow = async () => {
    let main_window_size = [1100, 750];
    win = new BrowserWindow({
        width: main_window_size[0],
        height: main_window_size[1],
        minWidth: main_window_size[0],
        minHeight: main_window_size[1],
        icon: path.join(__dirname, "../assets/logo.ico"),
        webPreferences: {
            preload: path.join(__dirname, "../preload/preload.js"),
            sandbox: false,
        },
    });

    win.webContents.openDevTools();
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
    const menu = Menu.buildFromTemplate(initializeMenu());
    Menu.setApplicationMenu(menu);

    win.on("closed", () => {
        BrowserWindow.getAllWindows().forEach((window) => {
            if (window !== win) {
                window.close();
            }
        });

        if (process.platform !== "darwin") {
            app.quit();
        }
    });
};

function resource_path(resource_name) {
    if (!app.isPackaged) {
        return path.join(__dirname, "../assets_export", resource_name);
    } else {
        return path.join(process.resourcesPath, "assets_export", resource_name);
    }
}

async function getSignedDownloadUrl(filePathOnS3) {
    if (!SIGNED_URL_API_GATEWAY_ENDPOINT || !CLIENT_API_KEY) {
        console.error("Error: API Gateway endpoint or Client API Key is not configured.");
        return null;
    }

    const headers = {
        'x-api-key': CLIENT_API_KEY
    };
    const params = {
        'filePath': filePathOnS3
    };

    try {
        const response = await axios.get(SIGNED_URL_API_GATEWAY_ENDPOINT, {
            headers: headers,
            params: params,
            timeout: 15000 // 15 seconds
        });

        const data = response.data;
        const signedUrl = data.signedUrl;
        if (signedUrl) {
            return signedUrl;
        } else {
            console.error(`Error: 'signedUrl' not found in response. Response: ${JSON.stringify(data)}`);
            return null;
        }
    } catch (error) {
        console.error(`Error retrieving signed URL: ${error.message}`);
        return null;
    }
}

async function getLatestVersion(appName) {
    if (!VERSION_CHECKER_API_GATEWAY_ENDPOINT || !CLIENT_API_KEY) {
        console.error("Error: API Gateway endpoint or Client API Key is not configured.");
        return null;
    }

    const headers = {
        'x-api-key': CLIENT_API_KEY
    };
    const params = {
        'appName': appName
    };

    try {
        const response = await axios.get(VERSION_CHECKER_API_GATEWAY_ENDPOINT, {
            headers: headers,
            params: params,
            timeout: 15000 // 15 seconds
        });

        const data = response.data;
        const latestVersion = data.latest_version;
        if (latestVersion) {
            return latestVersion;
        } else {
            console.error(`Error: 'latest_version' not found in response. Response: ${JSON.stringify(data)}`);
            return null;
        }
    } catch (error) {
        console.error(`Error retrieving latest version: ${error.message}`);
        return null;
    }
}

async function checkAppUpdate() {
    try {
        const latestVersion = await getLatestVersion('GSM');

        if (latestVersion > appVersion) {
            showNotification(
                "app",
                i18next.t('alert.update_available'),
                `${i18next.t('alert.new_version_found', { old_version: appVersion, new_version: latestVersion })}\n` +
                `${i18next.t('alert.new_version_found_text')}`,
                latestVersion
            );
        }

    } catch (error) {
        console.error("Error checking for update:", error.stack);
        showNotification(
            "app",
            i18next.t('alert.update_check_failed'),
            i18next.t('alert.update_check_failed_text')
        );
    }
}

function showNotification(type, title, body, latest_version = 0) {
    const icon_map = {
        'app': resource_path('logo.png'),
        'info': resource_path('information.png'),
        'warning': resource_path('warning.png'),
        'critical': resource_path('critical.png'),
    }

    if (process.platform === 'win32') {
        const toastXml = `
            <toast launch="gamesavemanager://default-click">
                <visual>
                    <binding template="ToastImageAndText04">
                        <image id="1" src="${icon_map[type]}" placement="appLogoOverride"/>
                        <text id="1">${title}</text>
                        <text id="2">${body}</text>
                    </binding>
                </visual>
                <actions>
                    <action content="${i18next.t("alert.yes")}" activationType="protocol" arguments="gamesavemanager://yes"/>
                    <action content="${i18next.t("alert.no")}" activationType="protocol" arguments="gamesavemanager://no"/>
                </actions>
            </toast>
        `;

        app.setAppUserModelId('com.yyc.game-save-manager');
        const notification = new Notification({
            toastXml: toastXml
        });
        notification.show();

        const handleAction = (event, action) => {
            if (action === 'yes') {
                updateApp(latest_version);
            }
            ipcMain.removeListener('notification-action', handleAction);
        };
        ipcMain.on('notification-action', handleAction);

    } else {
        const notification = new Notification({
            title: title,
            body: body,
            icon: icon_map[type]
        });
        notification.show();
    }
}

function updateApp(latest_version) {
    const updaterPath = './Updater.exe';
    const s3Path = `GSM/Game Save Manager Setup ${latest_version}.exe`;
    const args = ['--pid', process.pid, '--s3-path', s3Path, '--theme', settings['theme'], '--language', settings['language']];

    try {
        const updaterProcess = spawn(updaterPath, args, {
            detached: true,
            stdio: 'ignore',
        });
        updaterProcess.unref();

    } catch (error) {
        console.error('An error occurred while trying to spawn the updater process:', error);
    }
}

function getGameDisplayName(gameObj) {
    if (settings.language === "en_US") {
        return gameObj.title;
    } else if (settings.language === "zh_CN") {
        return gameObj.zh_CN || gameObj.title;
    }
}

// Calculates the total size of a directory or file
function calculateDirectorySize(directoryPath, ignoreConfig = true) {
    let totalSize = 0;

    try {
        if (fsOriginal.statSync(directoryPath).isDirectory()) {
            const files = fsOriginal.readdirSync(directoryPath);
            files.forEach(file => {
                if (ignoreConfig && file === 'backup_info.json') {
                    return;
                }
                const filePath = path.join(directoryPath, file);
                if (fsOriginal.statSync(filePath).isDirectory()) {
                    totalSize += calculateDirectorySize(filePath);
                } else {
                    totalSize += fsOriginal.statSync(filePath).size;
                }
            });

        } else {
            totalSize += fsOriginal.statSync(directoryPath).size;
        }

    } catch (error) {
        console.error(`Error calculating directory size for ${directoryPath}:`, error);
    }

    return totalSize;
}

// Ensure all files under a path have writable permission
function ensureWritable(pathToCheck) {
    if (!fsOriginal.existsSync(pathToCheck)) {
        return;
    }

    const stats = fsOriginal.statSync(pathToCheck);

    if (stats.isDirectory()) {
        const items = fsOriginal.readdirSync(pathToCheck);

        for (const item of items) {
            const fullPath = path.join(pathToCheck, item);
            ensureWritable(fullPath);
        }

    } else {
        if (!(stats.mode & 0o200)) {
            fsOriginal.chmod(pathToCheck, 0o666, (err) => {
                if (err) {
                    throw (`Error changing permissions for ${pathToCheck}:`, err);
                }
            });
        }
    }
}

function getNewestBackup(wiki_page_id) {
    const backupDir = path.join(settings.backupPath, wiki_page_id.toString());

    if (!fsOriginal.existsSync(backupDir)) {
        return i18next.t('main.no_backups');
    }

    const backups = fsOriginal.readdirSync(backupDir).filter(file => {
        const fullPath = path.join(backupDir, file);
        return fsOriginal.statSync(fullPath).isDirectory();
    });

    if (backups.length === 0) {
        return i18next.t('main.no_backups');
    }

    const latestBackup = backups.sort((a, b) => {
        return b.localeCompare(a);
    })[0];

    return moment(latestBackup, 'YYYY-MM-DD_HH-mm').format('YYYY/MM/DD HH:mm');
}

function updateStatus(statusKey, statusValue) {
    status[statusKey] = statusValue;
}

function fsOriginalCopyFolder(source, target) {
    fsOriginal.mkdirSync(target, { recursive: true });

    const items = fsOriginal.readdirSync(source);

    for (const item of items) {
        const sourcePath = path.join(source, item);
        const destinationPath = path.join(target, item);

        const stats = fsOriginal.statSync(sourcePath);

        if (stats.isDirectory()) {
            fsOriginalCopyFolder(sourcePath, destinationPath);
        } else {
            fsOriginal.copyFileSync(sourcePath, destinationPath);
        }
    }
}

async function exportBackups(count, exportPath) {
    const progressId = 'export';
    const progressTitle = i18next.t('alert.exporting');
    const sourcePath = settings.backupPath;

    try {
        if (!exportPath) {
            win.webContents.send('show-alert', 'warning', i18next.t('alert.empty_export_path'));
            return;
        }

        if (!status.exporting) {
            status.exporting = true;
            win.webContents.send('update-progress', progressId, progressTitle, 'start');

            // Build the list of relative paths to archive
            let itemsToArchive = [];

            const customEntriesPath = path.join(sourcePath, 'custom_entries.json');
            if (fsOriginal.existsSync(customEntriesPath)) {
                itemsToArchive.push('custom_entries.json');
            }

            const items = fsOriginal.readdirSync(sourcePath);
            const gameFolders = items.filter(item => {
                const fullPath = path.join(sourcePath, item);
                return fsOriginal.lstatSync(fullPath).isDirectory();
            });

            // For each game folder, select the most recent backup instances
            for (const gameId of gameFolders) {
                const gameFolderPath = path.join(sourcePath, gameId);
                let backups = fsOriginal.readdirSync(gameFolderPath).filter(item => {
                    const fullPath = path.join(gameFolderPath, item);
                    return fsOriginal.lstatSync(fullPath).isDirectory();
                });

                backups.sort((a, b) => { return b.localeCompare(a); });
                backups = backups.slice(0, count);

                backups.forEach(backupFolder => {
                    itemsToArchive.push(path.join(gameId, backupFolder));
                });
            }

            const timestamp = moment().format('YYYY-MM-DD_HH-mm');
            const finalFileName = `GSMBackup-${timestamp}.gsmr`;
            const finalDestPath = path.join(exportPath, finalFileName);

            const sevenOptions = {
                yes: true,
                recursive: true,
                $bin: sevenBin.path7za.replace('app.asar', 'app.asar.unpacked'),
                $progress: true,
                $raw: []
            };

            const originalCwd = process.cwd();
            process.chdir(sourcePath);
            const archiveStream = Seven.add(finalDestPath, itemsToArchive, sevenOptions);

            archiveStream.on('progress', (progress) => {
                if (progress.percent) {
                    win.webContents.send('update-progress', progressId, progressTitle, Math.floor(progress.percent));
                }
            });

            await new Promise((resolve, reject) => {
                archiveStream.on('end', resolve);
                archiveStream.on('error', reject);
            });

            process.chdir(originalCwd);
            win.webContents.send('update-progress', progressId, progressTitle, 'end');
            win.webContents.send('show-alert', 'success', i18next.t('alert.export_success'));
            status.exporting = false;
        }

    } catch (error) {
        console.error(`An error occurred while exporting backups: ${error.message}`);
        win.webContents.send('show-alert', 'modal', i18next.t('alert.error_during_export'), error.message);
        win.webContents.send('update-progress', progressId, progressTitle, 'end');
        status.exporting = false;
    }
}

async function importBackups(gsmPath) {
    const progressId = 'import';
    const progressTitle = i18next.t('alert.importing');
    const destinationPath = settings.backupPath;

    try {
        if (!status.importing) {
            status.importing = true;
            win.webContents.send('update-progress', progressId, progressTitle, 'start');

            // 1. Extract the GSMR file to a temporary directory
            const tempExtractPath = fsOriginal.mkdtempSync(path.join(os.tmpdir(), 'GSMImportTemp-'));
            const sevenOptions = {
                yes: true,
                recursive: true,
                $bin: sevenBin.path7za.replace('app.asar', 'app.asar.unpacked'),
                $progress: true,
                $raw: []
            };

            const extractStream = Seven.extractFull(gsmPath, tempExtractPath, sevenOptions);

            extractStream.on('progress', (progress) => {
                if (progress.percent) {
                    const overallProgress = Math.floor(progress.percent * 0.5);
                    win.webContents.send('update-progress', progressId, progressTitle, Math.floor(overallProgress));
                }
            });

            await new Promise((resolve, reject) => {
                extractStream.on('end', resolve);
                extractStream.on('error', reject);
            });

            const extractedItems = fsOriginal.readdirSync(tempExtractPath);

            // 2. Process the custom_entries.json file if present
            if (extractedItems.includes('custom_entries.json')) {
                const importedJsonPath = path.join(tempExtractPath, 'custom_entries.json');
                let importedEntries = [];
                try {
                    importedEntries = JSON.parse(fsOriginal.readFileSync(importedJsonPath, 'utf8'));
                } catch (e) {
                    console.error("Error parsing imported custom_entries.json:", e);
                }

                const destinationJsonPath = path.join(destinationPath, 'custom_entries.json');
                let destinationEntries = [];
                if (fsOriginal.existsSync(destinationJsonPath)) {
                    try {
                        destinationEntries = JSON.parse(fsOriginal.readFileSync(destinationJsonPath, 'utf8'));
                    } catch (e) {
                        console.error("Error parsing destination custom_entries.json:", e);
                    }
                }

                // Append only those entries that do not already exist (by wiki_page_id)
                importedEntries.forEach(imported => {
                    const exists = destinationEntries.some(dest => dest.wiki_page_id === imported.wiki_page_id);
                    if (!exists) {
                        destinationEntries.push(imported);
                    }
                });
                fsOriginal.writeFileSync(destinationJsonPath, JSON.stringify(destinationEntries, null, 2), 'utf8');
            }

            // 3. Process game backup folders
            let totalBackups = extractedItems.length;
            let processedBackups = 0;

            for (const item of extractedItems) {
                const itemPath = path.join(tempExtractPath, item);
                if (fsOriginal.lstatSync(itemPath).isDirectory()) {
                    const gameId = item;
                    const destGameFolder = path.join(destinationPath, gameId);

                    const backupFolders = fsOriginal.readdirSync(itemPath).filter(sub => {
                        const subPath = path.join(itemPath, sub);
                        return fsOriginal.lstatSync(subPath).isDirectory();
                    });

                    // For each backup instance folder, skip if the same folder exists in destination
                    backupFolders.forEach(backupFolder => {
                        const srcBackupPath = path.join(itemPath, backupFolder);
                        const destBackupPath = path.join(destGameFolder, backupFolder);
                        if (!fsOriginal.existsSync(destBackupPath)) {
                            fsOriginalCopyFolder(srcBackupPath, destBackupPath);
                        }
                    });
                }

                processedBackups++;
                const movingProgress = totalBackups ? Math.floor((processedBackups / totalBackups) * 50) : 50;
                const overallProgress = 50 + movingProgress;
                win.webContents.send('update-progress', progressId, progressTitle, overallProgress);
            }

            win.webContents.send('show-alert', 'success', i18next.t('alert.import_success'));
            status.importing = false;

            await fsOriginal.promises.rm(tempExtractPath, { recursive: true });
        }

    } catch (error) {
        console.error(`An error occurred while importing backups: ${error.message}`);
        win.webContents.send('show-alert', 'modal', i18next.t('alert.error_during_import'), error.message);
        status.importing = false;

    } finally {
        win.webContents.send('update-progress', progressId, progressTitle, 'end');
        win.webContents.send('update-backup-table');
        win.webContents.send('update-restore-table');
    }
}

const placeholder_mapping = {
    // Windows
    '{{p|username}}': os.userInfo().username,
    '{{p|userprofile}}': process.env.USERPROFILE || os.homedir(),
    '{{p|userprofile/documents}}': path.join(process.env.USERPROFILE || os.homedir(), 'Documents'),
    '{{p|userprofile/appdata/locallow}}': path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow'),
    '{{p|appdata}}': process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Roaming'),
    '{{p|localappdata}}': process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
    '{{p|programfiles}}': process.env.PROGRAMFILES || 'C:\\Program Files',
    '{{p|programdata}}': process.env.PROGRAMDATA || 'C:\\ProgramData',
    '{{p|public}}': path.join(process.env.PUBLIC || 'C:\\Users\\Public'),
    '{{p|windir}}': process.env.WINDIR || 'C:\\Windows',

    // Registry
    '{{p|hkcu}}': 'HKEY_CURRENT_USER',
    '{{p|hklm}}': 'HKEY_LOCAL_MACHINE',
    '{{p|wow64}}': 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node',

    // Mac
    '{{p|osxhome}}': os.homedir(),

    // Linux
    '{{p|linuxhome}}': os.homedir(),
    '{{p|xdgdatahome}}': process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    '{{p|xdgconfighome}}': process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
};

const osKeyMap = {
    win32: 'win',
    darwin: 'mac',
    linux: 'linux'
};

// ======================================================================
// Settings
// ======================================================================
const loadSettings = () => {
    const userDataPath = app.getPath("userData");
    const appDataPath = app.getPath("appData");
    const settingsPath = path.join(userDataPath, "GSM Settings", "settings.json");

    const locale_mapping = {
        'en-US': 'en_US',
        'zh-Hans-CN': 'zh_CN',
        'zh-Hans-SG': 'zh_CN',
        'zh-Hant-HK': 'zh_TW',
        'zh-Hant-MO': 'zh_TW',
        'zh-Hant-TW': 'zh_TW',
    };

    const systemLocale = app.getLocale();
    // console.log(`Current locale: ${systemLocale}; Preferred languages: ${app.getPreferredSystemLanguages()}`);
    const detectedLanguage = locale_mapping[systemLocale] || 'en_US';

    // Default settings
    const defaultSettings = {
        theme: 'dark',
        language: detectedLanguage,
        backupPath: path.join(appDataPath, "GSM Backups"),
        exportPath: "",
        maxBackups: 5,
        autoAppUpdate: true,
        autoDbUpdate: false,
        saveUninstalledGames: true,
        gameInstalls: 'uninitialized',
        pinnedGames: [],
        uninstalledGames: []
    };

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    try {
        const data = fs.readFileSync(settingsPath, 'utf8');
        settings = { ...defaultSettings, ...JSON.parse(data) };

    } catch (err) {
        console.error("Error loading settings, using defaults:", err);
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings), 'utf8');
        settings = defaultSettings;
    }
};

function saveSettings(key, value) {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'GSM Settings', 'settings.json');

    settings[key] = value;

    // Queue the write operation to prevent simultaneous writes
    writeQueue = writeQueue.then(() => {
        return new Promise((resolve, reject) => {
            fs.writeFile(settingsPath, JSON.stringify(settings), (writeErr) => {
                if (writeErr) {
                    console.error('Error saving settings:', writeErr);
                    reject(writeErr);
                } else {
                    console.log(`Settings updated successfully: ${key}: ${value}`);

                    if (key === 'theme') {
                        BrowserWindow.getAllWindows().forEach((window) => {
                            window.webContents.send('apply-theme', value);
                        });
                    }

                    if (key === 'gameInstalls' || key === 'saveUninstalledGames') {
                        win.webContents.send('update-backup-table');
                    }

                    if (key === 'language') {
                        i18next.changeLanguage(value).then(() => {
                            BrowserWindow.getAllWindows().forEach((window) => {
                                window.webContents.send('apply-language');
                            });
                            const menu = Menu.buildFromTemplate(initializeMenu());
                            Menu.setApplicationMenu(menu);
                            resolve();
                        }).catch(reject);
                    } else {
                        resolve();
                    }
                }
            });
        });
    }).catch((err) => {
        console.error('Error in write queue:', err);
    });
}

async function moveFilesWithProgress(sourceDir, destinationDir) {
    let totalSize = 0;
    let movedSize = 0;
    let errors = [];
    status.migrating = true;
    const progressId = 'migrate-backups';
    const progressTitle = i18next.t('alert.migrate_backups');

    const moveAndTrackProgress = async (srcDir, destDir) => {
        try {
            const items = fsOriginal.readdirSync(srcDir, { withFileTypes: true });

            for (const item of items) {
                const srcPath = path.join(srcDir, item.name);
                const destPath = path.join(destDir, item.name);

                if (item.isDirectory()) {
                    fse.ensureDirSync(destPath);
                    await moveAndTrackProgress(srcPath, destPath);
                } else {
                    const fileStats = fsOriginal.statSync(srcPath);
                    const readStream = fsOriginal.createReadStream(srcPath);
                    const writeStream = fsOriginal.createWriteStream(destPath);

                    readStream.on('data', (chunk) => {
                        movedSize += chunk.length;
                        const progressPercentage = Math.round((movedSize / totalSize) * 100);
                        win.webContents.send('update-progress', progressId, progressTitle, progressPercentage);
                    });

                    await new Promise((resolve, reject) => {
                        readStream.pipe(writeStream);
                        readStream.on('error', reject);
                        writeStream.on('error', reject);
                        writeStream.on('finish', () => {
                            fsOriginal.promises.utimes(destPath, fileStats.atime, fileStats.mtime)
                                .then(() => fsOriginal.promises.rm(srcPath))
                                .then(resolve)
                                .catch(reject);
                        });
                    });
                }
            }
            await fsOriginal.promises.rm(srcDir, { recursive: true });

        } catch (err) {
            errors.push(`Error moving file or directory: ${err.message}`);
        }
    };

    if (fsOriginal.existsSync(sourceDir)) {
        totalSize = calculateDirectorySize(sourceDir, false);

        win.webContents.send('update-progress', progressId, progressTitle, 'start');
        await moveAndTrackProgress(sourceDir, destinationDir);
        win.webContents.send('update-progress', progressId, progressTitle, 'end');

        if (errors.length > 0) {
            console.log(errors);
            win.webContents.send('show-alert', 'modal', i18next.t('alert.error_during_backup_migration'), errors);
        } else {
            win.webContents.send('show-alert', 'success', i18next.t('alert.backup_migration_success'));
        }
    }
    saveSettings('backupPath', destinationDir);
    win.webContents.send('update-restore-table');
    status.migrating = false;
}

module.exports = {
    createMainWindow,
    getMainWin: () => win,
    getSettingsWin: () => settingsWin,
    getStatus: () => status,
    updateStatus,
    getSignedDownloadUrl,
    getCurrentVersion: () => appVersion,
    getLatestVersion,
    checkAppUpdate,
    updateApp,
    getGameDisplayName,
    calculateDirectorySize,
    ensureWritable,
    getNewestBackup,
    fsOriginalCopyFolder,
    exportBackups,
    importBackups,
    placeholder_mapping,
    osKeyMap,
    loadSettings,
    saveSettings,
    getSettings: () => settings,
    moveFilesWithProgress,
};
