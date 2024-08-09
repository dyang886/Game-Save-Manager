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
const LanguageDetector = require("i18next-browser-languagedetector");

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
        icon: path.join(__dirname, "assets/logo.ico"),
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

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Language settings
i18next
    .use(Backend)
    .use(LanguageDetector)
    .init({
        fallbackLng: "en",
        backend: {
            loadPath: path.join(__dirname, "locale/{{lng}}.json"),
        },
    });

ipcMain.handle("change-language", async (event, lng) => {
    await i18next.changeLanguage(lng);
    console.log(`Language changed to ${i18next.language}`);
    return;
});

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
                            icon: path.join(__dirname, "assets/setting.ico"),
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
ipcMain.on('save-settings', async (event, key, value) => {
    const userDataPath = app.getPath('userData');
    const settingsPath = path.join(userDataPath, 'GSM Settings', 'settings.json');

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    fs.readFile(settingsPath, (readErr, data) => {
        let settings = {};

        if (!readErr) {
            settings = JSON.parse(data);
        }
        settings[key] = value;

        fs.writeFile(settingsPath, JSON.stringify(settings), (writeErr) => {
            if (writeErr) {
                console.error('Error saving settings:', writeErr);
            } else {
                console.log('Settings updated successfully');

                if (key === 'theme') {
                    win.webContents.send('apply-theme', value);
                }

                if (key === 'language') {
                    i18next.changeLanguage(value);
                }
            }
        });
    });
});


ipcMain.on("load-settings", (event, key) => {
    const userDataPath = app.getPath("userData");
    const appDataPath = app.getPath("appData");
    const settingsPath = path.join(userDataPath, "GSM Settings", "settings.json");

    // Default settings
    const defaultSettings = {
        theme: "light",
        language: "en",
        backupPath: path.join(appDataPath, "GSM", "Backups"),
        maxBackups: 5
    };

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    fs.readFile(settingsPath, (err, data) => {
        let settings;

        if (err) {
            console.error("Error loading settings, using defaults:", err);
            settings = defaultSettings;
            fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');
        } else {
            try {
                settings = JSON.parse(data);
                // Merge with default settings to fill any missing keys
                settings = { ...defaultSettings, ...settings };
            } catch (parseErr) {
                console.error("Error parsing settings file, using defaults:", parseErr);
                settings = defaultSettings;

                // Save the default settings if the file is corrupt or another error occurs
                fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf8');
                console.log("Corrupted settings file replaced with default values.");
            }
        }

        const value = key === 'all' ? settings : settings[key];
        event.reply("settings-value", value);
    });
});
