const fs = require('fs');
const os = require('os');
const path = require('path');

const glob = require('glob');
const vdf = require('vdf-parser');
const yaml = require('js-yaml');

const { getRegistryValue } = require('./registry');
const { getLatestModificationTime, placeholder_mapping } = require('./global');

const STEAM_ACCOUNT_ID_MASK = 0xFFFFFFFFn;

// ======================================================================
// Game data
// ======================================================================
class GameData {
    constructor() {
        this.steamPath = null;
        this.ubisoftPath = null;
        this.eaPath = null;
        this.battleNetPath = null;

        this.currentSteamId64 = null;
        this.currentSteamAccountId = null;
        this.currentSteamAccountName = null;
        this.currentSteamUserName = null;
        this.currentUbisoftAccountId = null;
        this.currentEpicAccountId = null;
        this.currentXboxAccountId = null;
        this.currentRockstarAccountId = null;
        this.currentGogAccountId = null;
        this.currentEAAccountId = null;

        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];
    }

    async initialize() {
        if (process.platform === 'win32') {
            // Query Steam install path
            this.steamPath = getRegistryValue('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');

            // Query Ubisoft install path
            this.ubisoftPath = getRegistryValue('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher', 'InstallDir');

            // Query EA install path
            this.eaPath = getRegistryValue('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Desktop', 'InstallLocation');

            // Query Battle.net install path
            this.battleNetPath = getRegistryValue('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Battle.net', 'InstallLocation');

            // Get current logged-in account IDs
            await this.getCurrentAccountIds();
        }

        console.log(
            'Steam account name: ' + this.currentSteamAccountName + '\n' +
            'Steam user name: ' + this.currentSteamUserName + '\n' +
            'Steam 64-bit ID: ' + this.currentSteamId64 + '\n' +
            'Steam account ID: ' + this.currentSteamAccountId + '\n' +
            'Ubisoft account ID: ' + this.currentUbisoftAccountId + '\n' +
            'Xbox account ID: ' + this.currentXboxAccountId + '\n' +
            'Epic account ID: ' + this.currentEpicAccountId + '\n' +
            'Rockstar account ID: ' + this.currentRockstarAccountId + '\n' +
            'GOG account ID: ' + this.currentGogAccountId + '\n' +
            'EA account ID: ' + this.currentEAAccountId
        );
    }

    async getCurrentAccountIds() {
        if (this.steamPath) {
            // Get the current Steam account's IDs and names
            const loginUsersPath = path.join(this.steamPath, 'config', 'loginusers.vdf');
            if (fs.existsSync(loginUsersPath)) {
                try {
                    const vdfContent = fs.readFileSync(loginUsersPath, 'utf-8');
                    const parsedData = vdf.parse(vdfContent);

                    if (parsedData.users) {
                        for (const steamId64 in parsedData.users) {
                            const accountData = parsedData.users[steamId64];
                            if (Number(accountData.AutoLogin) === 1) {
                                this.currentSteamId64 = steamId64;
                                this.currentSteamAccountId = (BigInt(steamId64) & STEAM_ACCOUNT_ID_MASK).toString();
                                this.currentSteamAccountName = accountData.AccountName;
                                this.currentSteamUserName = accountData.PersonaName;
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

        // Get current Ubisoft account ID
        const saveGamesPath = path.join(this.ubisoftPath, 'savegames');
        if (fs.existsSync(saveGamesPath)) {
            try {
                const accountFolders = fs.readdirSync(saveGamesPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                let latestAccountId = null;
                let latestTime = 0;

                for (const accountId of accountFolders) {
                    const accountFolderPath = path.join(saveGamesPath, accountId);
                    const accountFolderTime = await getLatestModificationTime(accountFolderPath);

                    if (accountFolderTime > latestTime) {
                        latestTime = accountFolderTime;
                        latestAccountId = accountId;
                    }
                }
                this.currentUbisoftAccountId = latestAccountId;
            } catch (e) {
                console.log('Error reading or parsing Ubisoft savegames directory:', e);
            }
        } else {
            console.log(`No Ubisoft accounts found at: ${saveGamesPath}`);
        }

        // Get current Epic account ID
        const epicDataPath = path.join(
            process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
            'EpicGamesLauncher', 'Saved', 'Data'
        );
        if (fs.existsSync(epicDataPath)) {
            try {
                const files = fs.readdirSync(epicDataPath, { withFileTypes: true })
                    .filter(dirent => dirent.isFile())
                    .map(dirent => dirent.name);

                let latestAccountId = null;
                let latestTime = 0;

                for (const fileName of files) {
                    const filePath = path.join(epicDataPath, fileName);
                    const fileModTime = await getLatestModificationTime(filePath);

                    if (fileModTime > latestTime) {
                        latestTime = fileModTime;
                        // remove 'OC_' prefix if present and remove .dat extension
                        const idMatch = fileName.match(/^(?:OC_)?([a-f0-9]+)\.dat$/i);
                        if (idMatch) {
                            latestAccountId = idMatch[1];
                        }
                    }
                }
                this.currentEpicAccountId = latestAccountId;
            } catch (e) {
                console.log('Error reading or parsing Epic user data directory:', e);
            }
        } else {
            console.log(`No Epic user data found at: ${epicDataPath}`);
        }

        // Get current Xbox account ID
        this.currentXboxAccountId = getRegistryValue('HKEY_CURRENT_USER\\Software\\Microsoft\\XboxLive', 'Xuid');

        // Get current Rockstar account ID
        const rStarProfilePath = path.join(process.env.USERPROFILE || os.homedir(), "Documents\\Rockstar Games\\Social Club\\Profiles");
        if (fs.existsSync(rStarProfilePath)) {
            try {
                const accountFolders = fs.readdirSync(rStarProfilePath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                let latestAccountId = null;
                let latestTime = 0;

                for (const accountId of accountFolders) {
                    const accountFolderPath = path.join(rStarProfilePath, accountId);
                    const accountFolderTime = await getLatestModificationTime(accountFolderPath);

                    if (accountFolderTime > latestTime) {
                        latestTime = accountFolderTime;
                        latestAccountId = accountId;
                    }
                }
                this.currentRockstarAccountId = latestAccountId;
            } catch (e) {
                console.log('Error reading or parsing Rockstar savegames directory:', e);
            }
        } else {
            console.log(`No Rockstar accounts found at: ${rStarProfilePath}`);
        }

        // --- Normally unused IDs ---
        this.currentGogAccountId = getRegistryValue('HKEY_CURRENT_USER\\Software\\GOG.com\\Galaxy\\settings', 'userId');

        // EA account ID
        const eaSettingsPattern = path.join(
            process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
            'Electronic Arts', 'EA Desktop', 'user_*.ini'
        );
        const eaFiles = glob.sync(eaSettingsPattern.replace(/\\/g, '/'));
        if (eaFiles.length > 0) {
            const fileName = path.basename(eaFiles[0]);
            const accountIdMatch = fileName.match(/user_(.+)\.ini/);
            if (accountIdMatch) {
                this.currentEAAccountId = accountIdMatch[1];
            }
        }
    }

    getAllAccountIds() {
        return {
            steamId64: this.currentSteamId64,
            steamAccountId: this.currentSteamAccountId,
            ubisoftAccountId: this.currentUbisoftAccountId,
            epicAccountId: this.currentEpicAccountId,
            xboxAccountId: this.currentXboxAccountId,
            rockstarAccountId: this.currentRockstarAccountId,
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

                            // The first Steam IDs under "apps"
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

let gameData = new GameData();

// The placeholder table both resolvers share; {{p|uid}} is left to the caller
function resolvePlaceholder(normalizedMatch, gameInstallPath) {
    // Always a resolved string or null, so an uninstalled launcher cannot leak into a path
    switch (normalizedMatch) {
        case '{{p|game}}': return gameInstallPath || null;
        case '{{p|steam}}': return gameData.steamPath || null;
        case '{{p|uplay}}':
        case '{{p|ubisoftconnect}}': return gameData.ubisoftPath || null;
        default: return placeholder_mapping[normalizedMatch] || null;
    }
}

module.exports = {
    getGameData: () => gameData,
    initializeGameData: async () => await gameData.initialize(),
    detectGamePaths: async () => await gameData.detectGamePaths(),
    getAllAccountIds: () => gameData.getAllAccountIds(),
    resolvePlaceholder
};
