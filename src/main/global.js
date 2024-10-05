const { BrowserWindow, Menu, app, screen } = require('electron');

const fs = require('fs');
const os = require('os');
const path = require('path');

const fse = require('fs-extra');
const i18next = require('i18next');
const moment = require('moment');

const { getSettings } = require('./settings');

let win;
let settingsWin;

// Main window
const createMainWindow = async () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    const dimensions = primaryDisplay.size;

    win = new BrowserWindow({
        width: dimensions.width * 0.4,
        height: dimensions.height * 0.5,
        icon: path.join(__dirname, "../assets/logo.ico"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });

    // win.webContents.openDevTools();
    win.loadFile(path.join(__dirname, "../renderer/html/index.html"));

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

// Menu settings
const menuTemplate = [
    {
        label: "Options",
        submenu: [
            {
                label: "Settings",
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

                        // settingsWin.webContents.openDevTools();
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
        ],
    },
];
const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);

function getGameDisplayName(gameObj) {
    if (getSettings().language === "en_US") {
        return gameObj.title;
    } else if (getSettings().language === "zh_CN") {
        return gameObj.zh_CN || gameObj.title;
    }
}

// Calculates the total size of a directory or file
function calculateDirectorySize(directoryPath) {
    let totalSize = 0;

    try {
        if (fs.lstatSync(directoryPath).isDirectory()) {
            const files = fs.readdirSync(directoryPath);
            files.forEach(file => {
                if (file === 'backup_info.json') {
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
    const backupDir = path.join(getSettings().backupPath, wiki_page_id.toString());

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

module.exports = {
    createMainWindow,
    getMainWin: () => win,
    getSettingsWin: () => settingsWin,
    getGameDisplayName,
    calculateDirectorySize,
    ensureWritable,
    getNewestBackup,
    placeholder_mapping,
    placeholder_identifier,
    osKeyMap,
};
