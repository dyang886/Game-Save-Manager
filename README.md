# Game Save Manager

English | [简体中文](./README_CN.md) | [繁體中文](./README_TW.md)

![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/dyang886/Game-Save-Manager/total) ![GitHub Repo stars](https://img.shields.io/github/stars/dyang886/Game-Save-Manager?style=flat&color=ffc000) ![GitHub Release](https://img.shields.io/github/v/release/dyang886/Game-Save-Manager?link=https%3A%2F%2Fgithub.com%2Fdyang886%2FGame-Save-Manager%2Freleases%2Flatest) ![GitHub License](https://img.shields.io/github/license/dyang886/Game-Save-Manager) <a href="https://discord.gg/d627qVyHEF" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_Discord-f0f0f0?logo=discord"></a> <a href="https://pd.qq.com/s/h06qbdey6" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_QQ-f0f0f0?logo=qq"></a>

<div align="center">
    <img src="src/assets/logo.png" alt="Game Save Manager logo" width="250" />
</div>

**Please visit our official website [https://gamezonelabs.com](https://gamezonelabs.com) for more info.**

Stop trusting the cloud blindly. **Game Save Manager (GSM)** secures your game saves from platforms like Steam, Epic, and custom locations all in one place. Auto-detect installed games, maintain a versioned history, and restore your progress with a single click.

---

## Core Features

### Centralized Management (Powered by PCGamingWiki)
Stop digging through AppData folders. GSM automatically finds and organizes your save files into one clean, interactive table. Leveraging the world's largest crowd-sourced game database, it supports over 14,000 game save locations.

### Smart Detection Engine
GSM doesn't just look at one folder. It uses a dual-scan system:
* **Install Path Scan:** Automatically detects games installed via Steam, Epic, Battle.net, and more by scanning your library folders.
* **Deep Database Scan:** Even uninstalled games leave saves behind. GSM checks thousands of known save paths (Registry, AppData, Documents) to recover forgotten history.

### Time Travel & Versioning
Messed up a dialogue choice? Corrupted a save file? GSM keeps a rolling history of backups for every game. Set an **Auto-Rotation** limit to automatically clean up old files and save disk space, or mark specific backups (like "Before Final Boss") as **Permanent Pinned Saves** so they are never deleted.

### Cross-Device Migration
Moving to a new PC? GSM lets you export your entire save history into a single `.gsmr` archive. Import it on your new machine, and GSM will smartly merge the backups, combining existing history with the imported files effortlessly.

### Account Awareness
GSM intelligently detects User IDs for platforms like Steam, Ubisoft, Epic, Xbox, and Rockstar. This allows you to back up specific accounts individually or create global backups encompassing all accounts on the system.

### Support the Unsupported
Playing a niche indie game or a heavily modded title? Use the **Custom Games** tab to manually add any folder, file, or registry key to the backup system. Utilize **Smart Placeholders** (like `%AppData%` or your `%UserProfile%`) to ensure your custom backups work seamlessly on any PC.

---

## Installation

1. Navigate to our [Latest Release](https://github.com/dyang886/Game-Save-Manager/releases) page.
2. Download the latest Windows (64-bit) installer.
3. Run the installer and follow the on-screen instructions.
4. Launch GSM and secure your progress!

---

## Advanced Usage & Options

While GSM is designed to be plug-and-play, you have full control over your backup strategy via the app's interface:

* **Batch Operations:** Select multiple detected games from the Backup or Restore tabs to process them all with a single click. 
* **Smart Restores:** When restoring, GSM automatically selects the most recent backup. If it detects that your current local files are newer than the backup, it will safely prompt you for confirmation before overwriting.
* **Backup Limits:** Configure the maximum number of rolling backups per game in your settings to keep your storage usage in check.
* **Export Destination:** Easily choose where your exported `.gsmr` files are saved for quick external drive transfers.

---

## Support

For issues, feature requests, or contributions, please visit the [Issues](https://github.com/dyang886/Game-Save-Manager/issues) page or join our community via Discord/QQ (links at the top of the page).