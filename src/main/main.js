const { BrowserWindow, app, dialog, ipcMain, shell } = require('electron');

const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fse = require('fs-extra');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const { pinyin } = require('pinyin');

const { createMainWindow, getMainWin, getNewestBackup, getStatus, updateStatus, checkAppUpdate, osKeyMap, loadSettings, saveSettings, getSettings, moveFilesWithProgress, getCurrentVersion, getLatestVersion } = require('./global');
const { getGameData, initializeGameData, detectGamePaths } = require('./gameData');
const { getGameDataFromDB, getAllGameDataFromDB, backupGame, updateDatabase } = require('./backup');
const { getGameDataForRestore, restoreGame } = require("./restore");


app.commandLine.appendSwitch("lang", "en");

app.whenReady().then(async () => {
    loadSettings();
    await initializeI18next(getSettings().language);
    await initializeGameData();

    await createMainWindow();
    app.setAppUserModelId(i18next.t('main.title'));

    if (getSettings().gameInstalls === 'uninitialized') {
        await detectGamePaths();
        saveSettings('gameInstalls', getGameData().detectedGamePaths);
    }

    if (getSettings().autoAppUpdate) {
        checkAppUpdate();
    }

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

ipcMain.handle("get-settings", () => {
    return getSettings();
});

ipcMain.handle("get-detected-game-paths", async () => {
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

ipcMain.handle('open-backup-dialog', async () => {
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

ipcMain.handle('open-dialog', async () => {
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

ipcMain.handle('get-newest-backup-time', (event, wiki_page_id) => {
    return getNewestBackup(wiki_page_id);
});

// Sort objects using object.titleToSort
ipcMain.handle('sort-games', (event, games) => {
    const gamesWithSortedTitles = games.map((game) => {
        try {
            const isChinese = /[\u4e00-\u9fff]/.test(game.titleToSort);
            const titleToSort = isChinese
                ? pinyin(game.titleToSort, { style: pinyin.STYLE_NORMAL }).join(' ')
                : game.titleToSort.toLowerCase();
            return { ...game, titleToSort };

        } catch (error) {
            console.error(`Error sorting game ${game.titleToSort}: ${error.stack}`);
            getMainWin().webContents.send('show-alert', 'modal', `${i18next.t('alert.sort_failed', { game_name: game.titleToSort })}`, error.message);
            return { ...game, titleToSort: '' };
        }
    });

    return gamesWithSortedTitles.sort((a, b) => {
        return a.titleToSort.localeCompare(b.titleToSort);
    });
});

ipcMain.handle('save-custom-entries', async (event, jsonObj) => {
    try {
        const filePath = path.join(getSettings().backupPath, "custom_entries.json");
        let currentData = {};

        if (fs.existsSync(filePath)) {
            currentData = await fse.readJson(filePath);
        }

        if (JSON.stringify(currentData) !== JSON.stringify(jsonObj)) {
            await fse.writeJson(filePath, jsonObj, { spaces: 4 });
            getMainWin().webContents.send('show-alert', 'success', i18next.t('alert.save_custom_success'));
            getMainWin().webContents.send('update-backup-table');
        }

    } catch (error) {
        console.error(`Error saving custom games: ${error.stack}`);
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.save_custom_error'), error.message);
    }
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
        console.error(`Error loading custom games: ${error.stack}`);
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.load_custom_error'), error.message);
        return [];
    }
});

ipcMain.handle('get-platform', () => {
    return osKeyMap[os.platform()];
});

ipcMain.handle('get-uuid', () => {
    return randomUUID();
});

ipcMain.handle('get-icon-map', async () => {
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

ipcMain.handle('fetch-backup-table-data', async () => {
    const { games, errors } = await getGameDataFromDB();

    if (errors.length > 0) {
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.backup_process_error_display'), errors);
    }

    return games;
});

ipcMain.handle('backup-game', async (event, gameObj) => {
    return await backupGame(gameObj);
});

ipcMain.handle('fetch-restore-table-data', async () => {
    const { games, errors } = await getGameDataForRestore();

    if (errors.length > 0) {
        getMainWin().webContents.send('show-alert', 'modal', i18next.t('alert.restore_process_error_display'), errors);
    }

    return games;
});

ipcMain.handle('restore-game', async (event, gameObj, userActionForAll) => {
    return await restoreGame(gameObj, userActionForAll);
});

ipcMain.on('migrate-backups', (event, newBackupPath) => {
    const currentBackupPath = getSettings().backupPath;
    moveFilesWithProgress(currentBackupPath, newBackupPath);
});

ipcMain.handle('get-status', () => {
    return getStatus();
});

ipcMain.on('update-status', (event, statusKey, statusValue) => {
    updateStatus(statusKey, statusValue);
});

ipcMain.handle('get-current-version', () => {
    return getCurrentVersion();
});

ipcMain.handle('get-latest-version', () => {
    return getLatestVersion();
});

ipcMain.handle('update-database', async () => {
    await updateDatabase();
    return;
});