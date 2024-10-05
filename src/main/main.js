const { BrowserWindow, app, dialog, ipcMain, shell } = require('electron');

const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fse = require('fs-extra');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const { pinyin } = require('pinyin');

const { createMainWindow, getMainWin, getNewestBackup, osKeyMap, } = require('./global');
const { loadSettings, saveSettings, getSettings } = require('./settings');
const { getGameData, initializeGameData, detectGamePaths } = require('./gameData');
const { getGameDataFromDB, getAllGameDataFromDB, backupGame } = require('./backup');
const { getGameDataForRestore, restoreGame } = require("./restore");


app.commandLine.appendSwitch("lang", "en");

app.whenReady().then(async () => {
    loadSettings();
    await initializeI18next(getSettings().language);
    await initializeGameData();

    if (getSettings().gameInstalls === 'uninitialized') {
        await detectGamePaths();
        saveSettings('gameInstalls', getGameData().detectedGamePaths);
    }

    createMainWindow();

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

// ======================================================================
// Listeners
// ======================================================================
ipcMain.handle("translate", async (event, key, options) => {
    return i18next.t(key, options);
});

ipcMain.on('save-settings', async (event, key, value) => {
    saveSettings(key, value);
});

ipcMain.on("load-theme", (event) => {
    event.reply("apply-theme", getSettings().theme);
});

ipcMain.handle("get-settings", (event) => {
    return getSettings();
});

ipcMain.handle("get-detected-game-paths", async (event) => {
    await detectGamePaths();
    return getGameData().detectedGamePaths;
});

ipcMain.handle('open-url', async (event, url) => {
    await shell.openExternal(url);
});

ipcMain.handle('open-backup-folder', async (event, wikiId) => {
    const backupPath = path.join(getSettings().backupPath, wikiId.toString());
    if (fs.existsSync(backupPath) && fs.readdirSync(backupPath).length > 0) {
        await shell.openPath(backupPath);
    } else {
        getMainWin().webContents.send('show-alert', 'warning', i18next.t('alert.no_backups_found'));
    }
});

ipcMain.handle('open-backup-dialog', async (event) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();

    const result = await dialog.showOpenDialog(focusedWindow, {
        title: i18next.t('settings.select_backup_path'),
        properties: ['openDirectory'],
        modal: true
    });

    if (result.filePaths.length > 0) {
        return path.join(result.filePaths[0], 'GSM Backups');
    }

    return null;
});

ipcMain.handle('open-dialog', async (event) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();

    const result = await dialog.showOpenDialog(focusedWindow, {
        title: i18next.t('settings.select_path'),
        properties: ['openDirectory'],
        modal: true
    });

    return result;
});

ipcMain.handle('select-path', async (event, fileType) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();

    let dialogOptions = {
        title: i18next.t('settings.select_path'),
        properties: []
    };

    switch (fileType) {
        case 'file':
            dialogOptions.properties = ['openFile'];
            break;
        case 'folder':
            dialogOptions.properties = ['openDirectory'];
            break;
        case 'registry':
            return null;
    }

    const result = await dialog.showOpenDialog(focusedWindow, {
        ...dialogOptions,
        modal: true
    });

    if (result.filePaths.length > 0) {
        return result.filePaths[0];
    }

    return null;
});

ipcMain.on('update-components-after-applying-settings', (event) => {
    getMainWin().webContents.send('update-backup-table');
    getMainWin().webContents.send('update-restore-table');
});

ipcMain.handle('get-newest-backup-time', (event, wiki_page_id) => {
    return getNewestBackup(wiki_page_id);
});

ipcMain.handle('get-pinyin', (event, zhTitle) => {
    return pinyin(zhTitle, { style: pinyin.STYLE_NORMAL }).join(' ');
});

ipcMain.handle('save-custom-entries', async (event, jsonObj) => {
    console.log(jsonObj)
    await fse.writeJson(path.join(getSettings().backupPath, "custom_entries.json"), jsonObj, { spaces: 4 });
});

ipcMain.handle('load-custom-entries', async () => {
    try {
        const filePath = path.join(getSettings().backupPath, "custom_entries.json");

        const fileExists = await fse.pathExists(filePath);
        if (!fileExists) {
            return [];
        }

        const jsonData = await fse.readJson(filePath);
        return jsonData;

    } catch (error) {
        console.error('Error loading custom entries:', error);
        return [];
    }
});

ipcMain.handle('get-platform', () => {
    return osKeyMap[os.platform()];
});

ipcMain.handle('get-uuid', () => {
    return randomUUID();
});

ipcMain.handle('fetch-game-saves', async (event) => {
    try {
        const games = await getGameDataFromDB();
        // const games = await getAllGameDataFromDB();
        return games;
    } catch (err) {
        getMainWin().webContents.send('show-alert', 'error', i18next.t('alert.fetch_backup_failed'));
        console.error("Failed to fetch backup data:", err);
        return [];
    }
});

ipcMain.handle('backup-game', async (event, gameObj) => {
    await backupGame(gameObj);
});

ipcMain.handle('get-icon-map', async (event) => {
    return {
        'Custom': fs.readFileSync(path.join(__dirname, '../assets/custom.svg'), 'utf-8'),
        'Steam': fs.readFileSync(path.join(__dirname, '../assets/steam.svg'), 'utf-8'),
        'Ubisoft': fs.readFileSync(path.join(__dirname, '../assets/ubisoft.svg'), 'utf-8'),
        'EA': fs.readFileSync(path.join(__dirname, '../assets/ea.svg'), 'utf-8'),
        'Epic': fs.readFileSync(path.join(__dirname, '../assets/epic.svg'), 'utf-8'),
        'GOG': fs.readFileSync(path.join(__dirname, '../assets/gog.svg'), 'utf-8'),
        'Xbox': fs.readFileSync(path.join(__dirname, '../assets/xbox.svg'), 'utf-8'),
        'Blizzard': fs.readFileSync(path.join(__dirname, '../assets/battlenet.svg'), 'utf-8'),
    };
});

ipcMain.handle('fetch-restore-table-data', async (event) => {
    try {
        const games = await getGameDataForRestore();
        return games;
    } catch (err) {
        getMainWin().webContents.send('show-alert', 'error', i18next.t('alert.fetch_restore_failed'));
        console.error("Failed to fetch restore data:", err);
        return [];
    }
});

ipcMain.handle('restore-game', async (event, gameObj, userActionForAll) => {
    await restoreGame(gameObj, userActionForAll);
});
