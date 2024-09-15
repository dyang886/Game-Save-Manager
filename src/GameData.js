const WinReg = require('winreg');
const path = require('path');
const vdf = require('vdf-parser');
const fs = require('fs');
const yaml = require('js-yaml');
const glob = require('glob');

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
                    console.error(`Error reading registry key: ${key}`, err);
                    resolve(null);
                } else {
                    resolve(item.value);
                }
            });
        });
    }

    getLatestModificationTime(dir) {
        let latestTime = 0;

        function checkDirectory(directoryPath) {
            const items = fs.readdirSync(directoryPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(directoryPath, item.name);
                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    checkDirectory(itemPath); // Recursively check subdirectories
                } else {
                    const modifiedTime = stats.mtimeMs;
                    if (modifiedTime > latestTime) {
                        latestTime = modifiedTime;
                    }
                }
            }
        }

        checkDirectory(dir);
        return latestTime;
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

        console.log(`Steam id64: ${this.currentSteamUserId64}\nSteam id3: ${this.currentSteamUserId3}\nUbisoft user id: ${this.currentUbisoftUserId}`);
    }

    async getCurrentUserIds() {
        // Get current Steam user id64 and user name
        const loginUsersPath = path.join(this.steamPath, 'config', 'loginusers.vdf');
        if (fs.existsSync(loginUsersPath)) {
            const vdfContent = fs.readFileSync(loginUsersPath, 'utf-8');
            const parsedData = vdf.parse(vdfContent);

            if (parsedData.users) {
                for (const userId64 in parsedData.users) {
                    const userData = parsedData.users[userId64];
                    if (userData.MostRecent == 1) {
                        this.currentSteamUserId64 = userId64;
                        this.currentSteamAccountName = userData.AccountName;
                        this.currentSteamUserName = userData.PersonaName;
                        break;
                    }
                }
            } else {
                console.log(`No users found in ${loginUsersPath}`);
            }
        } else {
            console.log(`Steam loginusers.vdf file not found at: ${loginUsersPath}`);
        }

        // Get current Steam user id3
        const userdataPath = path.join(this.steamPath, 'userdata');
        const userDirectories = fs.readdirSync(userdataPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const userId3 of userDirectories) {
            const configPath = path.join(userdataPath, userId3, 'config', 'localconfig.vdf');
            if (fs.existsSync(configPath)) {
                const localConfigContent = fs.readFileSync(configPath, 'utf-8');
                const localConfigData = vdf.parse(localConfigContent);

                if (localConfigData.UserLocalConfigStore && localConfigData.UserLocalConfigStore.friends) {
                    const personaName = localConfigData.UserLocalConfigStore.friends.PersonaName;
                    if (personaName === this.currentSteamUserName) {
                        this.currentSteamUserId3 = userId3;
                        break;
                    }
                } else {
                    console.log(`No persona name found in ${configPath}`);
                }
            } else {
                console.log(`Steam localconfig.vdf file not found at: ${configPath}`);
            }
        }

        // Get current Ubisoft user id
        const saveGamesPath = path.join(this.ubisoftPath, 'savegames');
        const userFolders = fs.readdirSync(saveGamesPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        let latestUserId = null;
        let latestTime = 0;

        for (const userId of userFolders) {
            const userFolderPath = path.join(saveGamesPath, userId);
            const userFolderTime = this.getLatestModificationTime(userFolderPath);

            if (userFolderTime > latestTime) {
                latestTime = userFolderTime;
                latestUserId = userId;
            }
        }
        this.currentUbisoftUserId = latestUserId;
    }

    async detectGamePaths() {
        await this.initialize();
        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];

        if (process.platform === 'win32') {
            // Detect Steam game installation folders
            const steamVdfPath = path.join(this.steamPath, 'config', 'libraryfolders.vdf');
            if (fs.existsSync(steamVdfPath)) {
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
            } else {
                console.log(`Steam libraryfolders.vdf file not found at: ${steamVdfPath}`);
            }

            // Detect Ubisoft game installation folders
            const ubisoftSettingsPath = path.join(
                process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
                'Ubisoft Game Launcher',
                'settings.yaml'
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

            // Detect EA game installation folders
            const eaSettingsPattern = path.join(
                process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
                'Electronic Arts',
                'EA Desktop',
                'user_*.ini'
            );
            const files = glob.sync(eaSettingsPattern.replace(/\\/g, '/'));
            if (files.length > 0) {
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
            } else {
                console.log(`EA user_*.ini file not found at ${eaSettingsPattern}`);
            }

            // Detect Battle.net game installation folders
            const battleNetConfigPath = path.join(
                process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Roaming'),
                'Battle.net',
                'Battle.net.config'
            );
            if (fs.existsSync(battleNetConfigPath)) {
                try {
                    const configFile = fs.readFileSync(battleNetConfigPath, 'utf-8');
                    const config = JSON.parse(configFile);

                    const defaultInstallPath = config.Client.Install.DefaultInstallPath;
                    if (defaultInstallPath && fs.existsSync(defaultInstallPath)) {
                        this.detectedGamePaths.push(path.normalize(defaultInstallPath));
                    }
                } catch (error) {
                    console.log('Error reading or parsing Battle.net configuration file:', error);
                }
            } else {
                console.log(`Battle.net config file not found at ${battleNetConfigPath}`);
            }
        }
    }
}

module.exports = GameData;
