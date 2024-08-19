const {
    screen,
    app,
    Menu,
    BrowserWindow,
    ipcMain,
    dialog,
} = require("electron");

const fs = require("fs");
const path = require("path");
const i18next = require("i18next");
const Backend = require("i18next-fs-backend");
const GameData = require('./GameData');

app.commandLine.appendSwitch("lang", "en");
// to change language for specific browser window: append '?lang=zh' to url

// {{p|userprofile\\documents}} {{p|userprofile\\Documents}}
// {{p|userprofile\\appdata\\locallow}}
// %userprofile%

let win;
let settingsWin;

let settings;
let gameData = new GameData();
let writeQueue = Promise.resolve();

// Main window
const createWindow = async () => {
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
    win.loadURL(path.join(__dirname, "index.html"));

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

app.whenReady().then(async () => {
    settings = loadSettings();
    await initializeI18next(settings['language']);
    await gameData.initialize();

    if (settings['gameInstalls'] === 'uninitialized') {
        await gameData.detectGamePaths();
        saveSettings('gameInstalls', gameData.detectedGamePaths);
    }

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Language settings
const initializeI18next = (language) => {
    return i18next
        .use(Backend)
        .init({
            lng: language,
            fallbackLng: "en_US",
            backend: {
                loadPath: path.join(__dirname, "../locale/{{lng}}.json"),
            },
        });
};

ipcMain.handle("translate", async (event, key) => {
    return i18next.t(key);
});

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
                        settingsWin.loadFile(path.join(__dirname, "components/settings.html"));

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

// ======================================================================
// Settings module
// ======================================================================
const loadSettings = () => {
    const userDataPath = app.getPath("userData");
    const appDataPath = app.getPath("appData");
    const settingsPath = path.join(userDataPath, "GSM Settings", "settings.json");

    const locale_mapping = {
        'en-US': 'en_US',
        'zh-Hans-CN': 'zh_CN',
        'zh-Hant-HK': 'zh_CN',
        'zh-Hant-MO': 'zh_CN',
        'zh-Hant-TW': 'zh_CN',
    };

    const systemLocale = app.getLocale();
    // console.log(app.getPreferredSystemLanguages());
    const detectedLanguage = locale_mapping[systemLocale] || 'en_US';

    // Default settings
    const defaultSettings = {
        theme: 'dark',
        language: detectedLanguage,
        backupPath: path.join(appDataPath, "GSM Backups"),
        maxBackups: 5,
        gameInstalls: 'uninitialized'
    };

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    try {
        const data = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(data);

        // Merge with default settings to fill any missing keys
        return { ...defaultSettings, ...settings };
    } catch (err) {
        console.error("Error loading settings, using defaults:", err);
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings), 'utf8');
        return defaultSettings;
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

                    if (key === 'language') {
                        i18next.changeLanguage(value).then(() => {
                            BrowserWindow.getAllWindows().forEach((window) => {
                                window.webContents.send('apply-language');
                            });
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

ipcMain.on('save-settings', async (event, key, value) => {
    saveSettings(key, value);
});

ipcMain.on("load-theme", (event) => {
    event.reply("apply-theme", settings['theme']);
});

ipcMain.handle("get-settings", (event) => {
    return settings;
});

ipcMain.handle("get-detected-game-paths", async (event) => {
    await gameData.detectGamePaths();
    return gameData.detectedGamePaths;
});

ipcMain.handle('open-dialog', async (event) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();

    const result = await dialog.showOpenDialog(focusedWindow, {
        title: 'Select Backup Save Path',
        properties: ['openDirectory'],
        modal: true
    });
    return result;
});

// ======================================================================
// Core functions
// ======================================================================
