const { BrowserWindow, Menu, Notification, app } = require('electron');

const fs = require('fs');
const os = require('os');
const path = require('path');

const fse = require('fs-extra');
const i18next = require('i18next');
const moment = require('moment');

let win;
let settingsWin;
let aboutWin;
let settings;
let writeQueue = Promise.resolve();

const appVersion = "2.0.1";
const updateLink = "https://api.github.com/repos/dyang886/Game-Save-Manager/releases/latest";
let status = {
    backuping: false,
    restoring: false,
    migrating: false,
    updating_db: false
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
                                    preload: path.join(__dirname, "preload.js"),
                                },
                            });

                            settingsWin.setMenuBarVisibility(false);
                            settingsWin.loadFile(path.join(__dirname, "../renderer/html/settings.html"));

                            settingsWin.on("closed", () => {
                                settingsWin = null;
                            });
                        } else {
                            settingsWin.focus();
                        }
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
                                    preload: path.join(__dirname, "preload.js"),
                                },
                            });

                            aboutWin.setMenuBarVisibility(false);
                            aboutWin.loadFile(path.join(__dirname, "../renderer/html/about.html"));

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
            preload: path.join(__dirname, "preload.js"),
        },
    });

    // win.webContents.openDevTools();
    win.loadFile(path.join(__dirname, "../renderer/html/index.html"));
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

async function getLatestVersion() {
    try {
        const response = await fetch(updateLink);
        const data = await response.json();
        const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, "") : null;

        return latestVersion;

    } catch (error) {
        console.error("Error checking for update:", error.stack);
        return null;
    }
}

async function checkAppUpdate() {
    try {
        const response = await fetch(updateLink);
        const data = await response.json();
        const latestVersion = data.tag_name ? data.tag_name.replace(/^v/, "") : appVersion;

        if (latestVersion > appVersion) {
            showNotification(
                "info",
                i18next.t('alert.update_available'),
                `${i18next.t('alert.new_version_found', { old_version: appVersion, new_version: latestVersion })}\n` +
                `${i18next.t('alert.new_version_found_text')}`
            );
        }

    } catch (error) {
        console.error("Error checking for update:", error.stack);
        showNotification(
            "warning",
            i18next.t('alert.update_check_failed'),
            i18next.t('alert.update_check_failed_text')
        );
    }
}

function showNotification(type, title, body) {
    icon_map = {
        'info': path.join(__dirname, "../assets/information.png"),
        'warning': path.join(__dirname, "../assets/warning.png"),
        'critical': path.join(__dirname, "../assets/critical.png")
    }

    new Notification({
        title: title,
        body: body,
        icon: icon_map[type],
    }).show()
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
        if (fs.lstatSync(directoryPath).isDirectory()) {
            const files = fs.readdirSync(directoryPath);
            files.forEach(file => {
                if (ignoreConfig && file === 'backup_info.json') {
                    return;
                }
                const filePath = path.join(directoryPath, file);
                if (fs.lstatSync(filePath).isDirectory()) {
                    totalSize += calculateDirectorySize(filePath);
                } else {
                    totalSize += fs.lstatSync(filePath).size;
                }
            });

        } else {
            totalSize += fs.lstatSync(directoryPath).size;
        }

    } catch (error) {
        console.error(`Error calculating directory size for ${directoryPath}:`, error);
    }

    return totalSize;
}

// Ensure all files under a path have writable permission
async function ensureWritable(pathToCheck) {
    if (!fs.existsSync(pathToCheck)) {
        return;
    }

    const stats = await fse.stat(pathToCheck);

    if (stats.isDirectory()) {
        const items = await fse.readdir(pathToCheck);

        for (const item of items) {
            const fullPath = path.join(pathToCheck, item);
            await ensureWritable(fullPath);
        }

    } else {
        if (!(stats.mode & 0o200)) {
            await fse.chmod(pathToCheck, 0o666);
            console.log(`Changed permissions for file: ${pathToCheck}`);
        }
    }
}

function getNewestBackup(wiki_page_id) {
    const backupDir = path.join(settings.backupPath, wiki_page_id.toString());

    if (!fs.existsSync(backupDir)) {
        return i18next.t('main.no_backups');
    }

    const backups = fs.readdirSync(backupDir).filter(file => {
        const fullPath = path.join(backupDir, file);
        return fs.statSync(fullPath).isDirectory();
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

const placeholder_identifier = {
    '{{p|username}}': '{{p1}}',
    '{{p|userprofile}}': '{{p2}}',
    '{{p|userprofile/documents}}': '{{p3}}',
    '{{p|userprofile/appdata/locallow}}': '{{p4}}',
    '{{p|appdata}}': '{{p5}}',
    '{{p|localappdata}}': '{{p6}}',
    '{{p|programfiles}}': '{{p7}}',
    '{{p|programdata}}': '{{p8}}',
    '{{p|public}}': '{{p9}}',
    '{{p|windir}}': '{{p10}}',
    '{{p|game}}': '{{p11}}',
    '{{p|uid}}': '{{p12}}',
    '{{p|steam}}': '{{p13}}',
    '{{p|uplay}}': '{{p14}}',
    '{{p|ubisoftconnect}}': '{{p14}}',
    '{{p|hkcu}}': '{{p15}}',
    '{{p|hklm}}': '{{p16}}',
    '{{p|wow64}}': '{{p17}}',
    '{{p|osxhome}}': '{{p18}}',
    '{{p|linuxhome}}': '{{p19}}',
    '{{p|xdgdatahome}}': '{{p20}}',
    '{{p|xdgconfighome}}': '{{p21}}',
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
        maxBackups: 5,
        autoAppUpdate: true,
        autoDbUpdate: false,
        gameInstalls: 'uninitialized',
        pinnedGames: []
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

                    if (key === 'gameInstalls') {
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
            const items = fs.readdirSync(srcDir, { withFileTypes: true });

            for (const item of items) {
                const srcPath = path.join(srcDir, item.name);
                const destPath = path.join(destDir, item.name);

                if (item.isDirectory()) {
                    fse.ensureDirSync(destPath);
                    await moveAndTrackProgress(srcPath, destPath);
                } else {
                    const fileStats = fs.statSync(srcPath);
                    const readStream = fs.createReadStream(srcPath);
                    const writeStream = fs.createWriteStream(destPath);

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
                            fs.promises.utimes(destPath, fileStats.atime, fileStats.mtime)
                                .then(() => fs.promises.rm(srcPath))
                                .then(resolve)
                                .catch(reject);
                        });
                    });
                }
            }
            await fs.promises.rm(srcDir, { recursive: true });

        } catch (err) {
            errors.push(`Error moving file or directory: ${err.message}`);
        }
    };

    if (fs.existsSync(sourceDir)) {
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
    getCurrentVersion: () => appVersion,
    getLatestVersion,
    checkAppUpdate,
    getGameDisplayName,
    calculateDirectorySize,
    ensureWritable,
    getNewestBackup,
    placeholder_mapping,
    placeholder_identifier,
    osKeyMap,
    loadSettings,
    saveSettings,
    getSettings: () => settings,
    moveFilesWithProgress,
};
