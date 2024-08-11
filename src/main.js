const {
    screen,
    app,
    Menu,
    BrowserWindow,
    ipcMain,
    Notification,
} = require("electron");

const fs = require("fs");
const path = require("path");
const i18next = require("i18next");
const Backend = require("i18next-fs-backend");

// {{p|userprofile\\documents}} {{p|userprofile\\Documents}}
// {{p|userprofile\\appdata\\locallow}}
// %userprofile%

let win;
let settingsWin;
app.commandLine.appendSwitch("lang", "en");
// to change language for specific browser window: append '?lang=zh' to url

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
    const lang = loadSettings().language;
    await initializeI18next(lang);

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
                    // Check if settingsWin is already open
                    if (!settingsWin || settingsWin.isDestroyed()) {
                        settingsWin = new BrowserWindow({
                            width: 300,
                            height: 200,
                            icon: path.join(__dirname, "../assets/setting.ico"),
                            webPreferences: {
                                preload: path.join(__dirname, "preload.js"),
                            },
                        });

                        settingsWin.webContents.openDevTools();
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
    console.log(app.getPreferredSystemLanguages());
    const detectedLanguage = locale_mapping[systemLocale] || 'en_US';

    // Default settings
    const defaultSettings = {
        theme: "dark",
        language: detectedLanguage,
        backupPath: path.join(appDataPath, "GSM Backups"),
        maxBackups: 5
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

ipcMain.on("load-settings", (event) => {
    const settings = loadSettings();
    event.reply("settings-value", settings);
});

ipcMain.on('save-settings', async (event, key, value) => {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'GSM Settings', 'settings.json');

    const settings = loadSettings();
    settings[key] = value;

    fs.writeFile(settingsPath, JSON.stringify(settings), (writeErr) => {
        if (writeErr) {
            console.error('Error saving settings:', writeErr);
        } else {
            console.log('Settings updated successfully');

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
                });
            }
        }
    });
});
