const fs = require('fs');
const fsOriginal = require('original-fs');
const os = require('os');
const path = require('path');

const glob = require('glob');
const moment = require('moment');
const vdf = require('vdf-parser');
const WinReg = require('winreg');
const yaml = require('js-yaml');

const STEAM_ID64_BASE = 76561197960265728n;

class GameData {
    constructor() {
        this.steamPath = null;
        this.ubisoftPath = null;
        this.eaPath = null;
        this.battleNetPath = null;

        this.currentSteamUserId64 = null;
        this.currentSteamUserId3 = null;
        this.currentSteamAccountName = null;
        this.currentSteamUserName = null;
        this.currentUbisoftUserId = null;
        this.currentEpicUserId = null;
        this.currentXboxUserId = null;
        this.currentRockStarUserId = null;
        this.currentGogUserId = null;
        this.currentEAUserId = null;

        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];
    }

    getRegistryValue(hive, key, valueName) {
        return new Promise((resolve, reject) => {
            const regKey = new WinReg({
                hive: hive,
                key: key
            });

            regKey.get(valueName, (err, item) => {
                if (err) {
                    console.log(`Error reading registry key: ${key}`, err.message);
                    resolve('');
                } else {
                    resolve(item.value);
                }
            });
        });
    }

    async initialize() {
        if (process.platform === 'win32') {
            // Query Steam install path
            this.steamPath = await this.getRegistryValue(
                WinReg.HKLM,
                '\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
                'InstallPath'
            );

            // Query Ubisoft install path
            this.ubisoftPath = await this.getRegistryValue(
                WinReg.HKLM,
                '\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher',
                'InstallDir'
            );

            // Query EA install path
            this.eaPath = await this.getRegistryValue(
                WinReg.HKLM,
                '\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Desktop',
                'InstallLocation'
            );

            // Query Battle.net install path
            this.battleNetPath = await this.getRegistryValue(
                WinReg.HKLM,
                '\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Battle.net',
                'InstallLocation'
            );

            // Get current logged in user ids
            await this.getCurrentUserIds();
        }

        console.log(
            'Steam account name: ' + this.currentSteamAccountName + '\n' +
            'Steam user name: ' + this.currentSteamUserName + '\n' +
            'Steam id64: ' + this.currentSteamUserId64 + '\n' +
            'Steam id3: ' + this.currentSteamUserId3 + '\n' +
            'Ubisoft user id: ' + this.currentUbisoftUserId + '\n' +
            'Xbox user id: ' + this.currentXboxUserId + '\n' +
            'Epic user id: ' + this.currentEpicUserId + '\n' +
            'Rockstar user id: ' + this.currentRockStarUserId + '\n' +
            'GOG user id: ' + this.currentGogUserId + '\n' +
            'EA user id: ' + this.currentEAUserId
        );
    }

    async getCurrentUserIds() {
        if (this.steamPath) {
            // Get the current Steam user's IDs and names
            const loginUsersPath = path.join(this.steamPath, 'config', 'loginusers.vdf');
            if (fs.existsSync(loginUsersPath)) {
                try {
                    const vdfContent = fs.readFileSync(loginUsersPath, 'utf-8');
                    const parsedData = vdf.parse(vdfContent);

                    if (parsedData.users) {
                        for (const userId64 in parsedData.users) {
                            const userData = parsedData.users[userId64];
                            if (Number(userData.AutoLogin) === 1) {
                                this.currentSteamUserId64 = userId64;
                                this.currentSteamUserId3 = (BigInt(userId64) - STEAM_ID64_BASE).toString();
                                this.currentSteamAccountName = userData.AccountName;
                                this.currentSteamUserName = userData.PersonaName;
                                break;
                            }
                        }
                    } else {
                        console.log(`No users found in ${loginUsersPath}`);
                    }
                } catch (e) {
                    console.log('Error reading or parsing Steam loginusers.vdf file:', e);
                }
            } else {
                console.log(`Steam loginusers.vdf file not found at: ${loginUsersPath}`);
            }
        } else {
            console.log('Steam not installed');
        }

        // Get current Ubisoft user id
        const saveGamesPath = path.join(this.ubisoftPath, 'savegames');
        if (fs.existsSync(saveGamesPath)) {
            try {
                const userFolders = fs.readdirSync(saveGamesPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                let latestUserId = null;
                let latestTime = 0;

                for (const userId of userFolders) {
                    const userFolderPath = path.join(saveGamesPath, userId);
                    const userFolderTime = getLatestModificationTime(userFolderPath);

                    if (userFolderTime > latestTime) {
                        latestTime = userFolderTime;
                        latestUserId = userId;
                    }
                }
                this.currentUbisoftUserId = latestUserId;
            } catch (e) {
                console.log('Error reading or parsing Ubisoft savegames directory:', e);
            }
        } else {
            console.log(`No Ubisoft users found at: ${saveGamesPath}`);
        }

        // Get current Epic user id
        const epicDataPath = path.join(
            process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
            'EpicGamesLauncher', 'Saved', 'Data'
        );
        if (fs.existsSync(epicDataPath)) {
            try {
                const files = fs.readdirSync(epicDataPath, { withFileTypes: true })
                    .filter(dirent => dirent.isFile())
                    .map(dirent => dirent.name);

                let latestUserId = null;
                let latestTime = 0;

                for (const fileName of files) {
                    const filePath = path.join(epicDataPath, fileName);
                    const fileModTime = getLatestModificationTime(filePath);

                    if (fileModTime > latestTime) {
                        latestTime = fileModTime;
                        // remove 'OC_' prefix if present and remove .dat extension
                        const idMatch = fileName.match(/^(?:OC_)?([a-f0-9]+)\.dat$/i);
                        if (idMatch) {
                            latestUserId = idMatch[1];
                        }
                    }
                }
                this.currentEpicUserId = latestUserId;
            } catch (e) {
                console.log('Error reading or parsing Epic user data directory:', e);
            }
        } else {
            console.log(`No Epic user data found at: ${epicDataPath}`);
        }

        // Get current Xbox user id
        this.currentXboxUserId = await this.getRegistryValue(
            WinReg.HKCU,
            '\\Software\\Microsoft\\XboxLive',
            'Xuid'
        );

        // Get current RockStar user id
        const rStarProfilePath = path.join(process.env.USERPROFILE || os.homedir(), "Documents\\Rockstar Games\\Social Club\\Profiles");
        if (fs.existsSync(rStarProfilePath)) {
            try {
                const userFolders = fs.readdirSync(rStarProfilePath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                let latestUserId = null;
                let latestTime = 0;

                for (const userId of userFolders) {
                    const userFolderPath = path.join(rStarProfilePath, userId);
                    const userFolderTime = getLatestModificationTime(userFolderPath);

                    if (userFolderTime > latestTime) {
                        latestTime = userFolderTime;
                        latestUserId = userId;
                    }
                }
                this.currentRockStarUserId = latestUserId;
            } catch (e) {
                console.log('Error reading or parsing Rockstar savegames directory:', e);
            }
        } else {
            console.log(`No Rockstar users found at: ${rStarProfilePath}`);
        }

        // --- Normally unused ids ---
        // Gog user id
        this.currentGogUserId = await this.getRegistryValue(
            WinReg.HKCU,
            '\\Software\\GOG.com\\Galaxy\\settings',
            'userId'
        );

        // EA user id
        const eaSettingsPattern = path.join(
            process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
            'Electronic Arts', 'EA Desktop', 'user_*.ini'
        );
        const eaFiles = glob.sync(eaSettingsPattern.replace(/\\/g, '/'));
        if (eaFiles.length > 0) {
            const fileName = path.basename(eaFiles[0]);
            const userIdMatch = fileName.match(/user_(.+)\.ini/);
            if (userIdMatch) {
                this.currentEAUserId = userIdMatch[1];
            }
        }
    }

    getAllUserIds() {
        return {
            steamId64: this.currentSteamUserId64,
            steamId3: this.currentSteamUserId3,
            ubisoftId: this.currentUbisoftUserId,
            epicId: this.currentEpicUserId,
            xboxId: this.currentXboxUserId,
            rockStarId: this.currentRockStarUserId,
        };
    }

    async detectGamePaths() {
        await this.initialize();
        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];

        if (process.platform === 'win32') {
            // Detect Steam game installation folders
            const steamVdfPath = path.join(this.steamPath, 'config', 'libraryfolders.vdf');
            if (fs.existsSync(steamVdfPath)) {
                try {
                    const vdfContent = fs.readFileSync(steamVdfPath, 'utf-8');
                    const parsedData = vdf.parse(vdfContent);

                    for (const key in parsedData.libraryfolders) {
                        if (parsedData.libraryfolders.hasOwnProperty(key)) {
                            const folder = parsedData.libraryfolders[key];

                            // Add the "path" to detectedGamePaths
                            if (folder.path) {
                                const normalizedPath = path.normalize(path.join(folder.path, 'steamapps', 'common'));
                                if (fs.existsSync(normalizedPath)) {
                                    this.detectedGamePaths.push(normalizedPath);
                                }
                            }

                            // Add the first Steam IDs under "apps" to detectedSteamGameIds
                            if (folder.apps) {
                                const appIds = Object.keys(folder.apps);
                                this.detectedSteamGameIds.push(...appIds);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error reading or parsing Steam libraryfolders.vdf file:', e);
                }
            } else {
                console.log(`Steam libraryfolders.vdf file not found at: ${steamVdfPath}`);
            }

            // Detect Ubisoft game installation folders
            const ubisoftSettingsPath = path.join(
                process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
                'Ubisoft Game Launcher', 'settings.yaml'
            );
            if (fs.existsSync(ubisoftSettingsPath)) {
                try {
                    const fileContents = fs.readFileSync(ubisoftSettingsPath, 'utf8');
                    const settings = yaml.load(fileContents);
                    const gameInstallationPath = settings.misc.game_installation_path;

                    if (gameInstallationPath && fs.existsSync(gameInstallationPath)) {
                        this.detectedGamePaths.push(path.normalize(gameInstallationPath));
                    }
                } catch (e) {
                    console.log('Error reading or parsing Ubisoft YAML file:', e);
                }
            } else {
                console.log(`Ubisoft settings.yaml file not found at ${ubisoftSettingsPath}`);
            }

            // Detect Epic game installation folders
            const epicManifestsPath = path.join(
                process.env.PROGRAMDATA || 'C:\\ProgramData',
                'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat'
            );
            if (fs.existsSync(epicManifestsPath)) {
                try {
                    const manifestFile = fs.readFileSync(epicManifestsPath, 'utf-8');
                    const manifest = JSON.parse(manifestFile);

                    if (manifest.InstallationList && Array.isArray(manifest.InstallationList)) {
                        const epicBasePaths = new Set();

                        for (const installation of manifest.InstallationList) {
                            if (installation.InstallLocation) {
                                // Get parent directory
                                const basePath = path.dirname(installation.InstallLocation);
                                if (basePath) {
                                    epicBasePaths.add(path.normalize(basePath));
                                }
                            }
                        }

                        // Add all unique base paths
                        for (const basePath of epicBasePaths) {
                            if (fs.existsSync(basePath)) {
                                this.detectedGamePaths.push(basePath);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error reading or parsing Epic LauncherInstalled.dat file:', e);
                }
            } else {
                console.log(`Epic LauncherInstalled.dat file not found at ${epicManifestsPath}`);
            }

            // Detect EA game installation folders
            const eaSettingsPattern = path.join(
                process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
                'Electronic Arts', 'EA Desktop', 'user_*.ini'
            );
            const files = glob.sync(eaSettingsPattern.replace(/\\/g, '/'));
            if (files.length > 0) {
                try {
                    const eaSettingsPath = files[0];
                    const fileContents = fs.readFileSync(eaSettingsPath, 'utf8');
                    const lines = fileContents.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('user.downloadinplacedir=')) {
                            const downloadPath = line.split('=')[1].trim();
                            if (downloadPath && fs.existsSync(downloadPath)) {
                                this.detectedGamePaths.push(path.normalize(downloadPath));
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error reading or parsing EA user_*.ini file:', e);
                }
            } else {
                console.log(`EA user_*.ini file not found at ${eaSettingsPattern}`);
            }

            // Detect GOG game installation folders
            const gogConfigPath = path.join(
                process.env.PROGRAMDATA || 'C:\\ProgramData',
                'GOG.com', 'Galaxy', 'config.json'
            );
            if (fs.existsSync(gogConfigPath)) {
                try {
                    const configFile = fs.readFileSync(gogConfigPath, 'utf-8');
                    const config = JSON.parse(configFile);
                    const libraryPath = config.libraryPath;
                    if (libraryPath && fs.existsSync(libraryPath)) {
                        this.detectedGamePaths.push(path.normalize(libraryPath));
                    }
                } catch (e) {
                    console.log('Error reading or parsing GOG config.json file:', e);
                }
            } else {
                console.log(`GOG config.json file not found at ${gogConfigPath}`);
            }

            // Detect Battle.net game installation folders
            const battleNetConfigPath = path.join(
                process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Roaming'),
                'Battle.net', 'Battle.net.config'
            );
            if (fs.existsSync(battleNetConfigPath)) {
                try {
                    const configFile = fs.readFileSync(battleNetConfigPath, 'utf-8');
                    const config = JSON.parse(configFile);

                    const defaultInstallPath = config.Client.Install.DefaultInstallPath;
                    if (defaultInstallPath && fs.existsSync(defaultInstallPath)) {
                        this.detectedGamePaths.push(path.normalize(defaultInstallPath));
                    }
                } catch (e) {
                    console.log('Error reading or parsing Battle.net configuration file:', e);
                }
            } else {
                console.log(`Battle.net config file not found at ${battleNetConfigPath}`);
            }
        }
    }
}

function getLatestModificationTime(directory) {
    if (!fsOriginal.existsSync(directory)) {
        return new Date(0);
    }

    const stats = fsOriginal.statSync(directory);

    if (stats.isDirectory()) {
        const files = fsOriginal.readdirSync(directory);
        let latestModTime = new Date(0);

        for (const file of files) {
            const fullPath = path.join(directory, file);
            const fileStats = fsOriginal.statSync(fullPath);

            if (fileStats.isDirectory()) {
                // Recursively check subdirectories
                const subDirModTime = getLatestModificationTime(fullPath);
                if (subDirModTime > latestModTime) {
                    latestModTime = subDirModTime;
                }
            } else {
                // Consider file modification time
                const fileModTime = moment(fileStats.mtime).seconds(0).milliseconds(0).toDate();
                if (fileModTime > latestModTime) {
                    latestModTime = fileModTime;
                }
            }
        }
        return latestModTime;

    } else {
        return moment(stats.mtime).seconds(0).milliseconds(0).toDate();
    }
}

let gameData = new GameData();

module.exports = {
    getGameData: () => gameData,
    initializeGameData: async () => await gameData.initialize(),
    detectGamePaths: async () => await gameData.detectGamePaths(),
    getAllUserIds: () => gameData.getAllUserIds(),
    getLatestModificationTime
};
