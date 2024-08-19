const WinReg = require('winreg');
const path = require('path');
const vdf = require('vdf-parser');
const fs = require('fs');

class GameData {
    constructor() {
        this.steamPath = null;
        this.ubisoftPath = null;
        this.steamVdfPath = null;
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

        // Parse steam vdf file
        if (this.steamPath) {
            this.steamVdfPath = path.join(this.steamPath, 'config', 'libraryfolders.vdf');
        }
    }

    async detectGamePaths() {
        await this.initialize();
        this.detectedGamePaths = [];
        this.detectedSteamGameIds = [];

        // Detect steam game installation folders
        if (fs.existsSync(this.steamVdfPath)) {
            const vdfContent = fs.readFileSync(this.steamVdfPath, 'utf-8');
            const parsedData = vdf.parse(vdfContent);

            for (const key in parsedData.libraryfolders) {
                if (parsedData.libraryfolders.hasOwnProperty(key)) {
                    const folder = parsedData.libraryfolders[key];
                    
                    // Add the "path" to detectedGamePaths
                    if (folder.path) {
                        const normalizedPath = path.normalize(folder.path);
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
            console.log(`VDF file not found at: ${this.steamVdfPath}`);
        }
    }
}

module.exports = GameData;
