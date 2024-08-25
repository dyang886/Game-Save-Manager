const WinReg = require('winreg');
const path = require('path');
const vdf = require('vdf-parser');
const fs = require('fs');

class GameData {
    constructor() {
        this.steamPath = null;
        this.ubisoftPath = null;
        this.battleNetPath = null;

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

    async initialize() {
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

        // Query Battle.net install path
        this.battleNetPath = await this.getRegistryValue(
            WinReg.HKLM,
            '\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Battle.net',
            'InstallLocation'
        );
    }

    async detectGamePaths() {
        await this.initialize();
        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];

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
                        this.detectedGamePaths.push(normalizedPath);
                    }

                    // Add the first Steam IDs under "apps" to detectedSteamGameIds
                    if (folder.apps) {
                        const appIds = Object.keys(folder.apps);
                        this.detectedSteamGameIds.push(...appIds);
                    }
                }
            }
        } else {
            console.log(`VDF file not found at: ${steamVdfPath}`);
        }

        // Detect Ubisoft game installation folders
        const ubisoftGames = path.join(this.ubisoftPath, 'games');
        if (fs.existsSync(ubisoftGames)) {
            this.detectedGamePaths.push(path.normalize(ubisoftGames));
        }

        // Detect Battle.net game installation folders
        const battleNetGames = path.join(this.battleNetPath, 'games');
        if (fs.existsSync(battleNetGames)) {
            this.detectedGamePaths.push(path.normalize(battleNetGames));
        }
    }
}

module.exports = GameData;
