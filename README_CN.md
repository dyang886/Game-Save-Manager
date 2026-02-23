# Game Save Manager

[English](./README.md) | 简体中文 | [繁體中文](./README_TW.md)

![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/dyang886/Game-Save-Manager/total) ![GitHub Repo stars](https://img.shields.io/github/stars/dyang886/Game-Save-Manager?style=flat&color=ffc000) ![GitHub Release](https://img.shields.io/github/v/release/dyang886/Game-Save-Manager?link=https%3A%2F%2Fgithub.com%2Fdyang886%2FGame-Save-Manager%2Freleases%2Flatest) ![GitHub License](https://img.shields.io/github/license/dyang886/Game-Save-Manager) <a href="https://discord.gg/d627qVyHEF" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_Discord-f0f0f0?logo=discord"></a> <a href="https://pd.qq.com/s/h06qbdey6" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_QQ-f0f0f0?logo=qq"></a>

<div align="center">
    <img src="src/assets/logo.png" alt="Game Save Manager logo" width="250" />
</div>

**获取更多信息，请访问我们的官方网站 https://gamezonelabs.com。**

不要再盲目信任云同步了。**Game Save Manager (GSM)** 将你在 Steam、Epic 以及自定义位置的游戏存档安全地集中在一个地方。自动检测已安装的游戏，维护带有版本历史的备份，并支持一键恢复你的游戏进度。

---

## 核心功能

### 集中管理 (由 PCGamingWiki 强力驱动)
别再在 AppData 文件夹里辛苦翻找了。GSM 会自动查找并整理你的存档文件，将其呈现在一个清晰、可交互的表格中。借助全球最大的众包游戏数据库，我们支持超过 14,000 个游戏存档位置。

### 智能检测引擎
GSM 的搜索范围不仅局限于单个文件夹。它采用了双重扫描系统：
* **安装路径扫描:** 通过扫描你的游戏库文件夹，自动检测由 Steam、Epic、战网（Battle.net）等平台安装的游戏。
* **深度数据库扫描:** 即使是已经卸载的游戏也会留下存档痕迹。GSM 会检查数千个已知存档路径（包括注册表、AppData、文档），找回你遗忘的游戏历史。

### 时光倒流与版本控制
选错了剧情对话？存档文件损坏？GSM 会为每款游戏保留滚动的备份历史。你可以设置**自动轮换** 限制，自动清理旧文件以节省磁盘空间；或者将特定备份（比如“最终 BOSS 前”）标记为**永久固定**，这样它们就永远不会被误删。

### 跨设备迁移
换新电脑了？GSM 允许你将整个存档历史导出为一个单独的 `.gsmr` 归档文件。在新电脑上导入该文件，GSM 会智能合并备份，轻松将现有的本地历史记录与导入的文件无缝结合。

### 账号智能识别
GSM 能智能识别 Steam、Ubisoft、Epic、Xbox 和 Rockstar 等平台的用户 ID。这让你能够为特定账号进行单独备份，或者为系统上的所有账号创建全局备份。

### 自定义与扩展支持
正在玩小众独立游戏或是打了大量 Mod 的游戏？使用**自定义游戏** 选项卡，手动将任何文件夹、文件或注册表项添加到备份系统中。利用**智能占位符**（如 `%AppData%` 或你的 `%UserProfile%`），确保你的自定义备份在任何电脑上都能完美运行。

---

## 安装指南

1. 前往我们的 [最新发布 (Latest Release)](https://github.com/dyang886/Game-Save-Manager/releases) 页面。
2. 下载最新的 Windows (64位) 安装包。
3. 运行安装程序并按照屏幕上的指示进行操作。
4. 启动 GSM，开始保护你的游戏进度！

---

## 进阶使用与选项

虽然 GSM 的设计理念是开箱即用，但你完全可以通过应用界面掌控你的备份策略：

* **批量操作:** 在备份或恢复选项卡中勾选多个已检测到的游戏，一键即可批量处理。
* **智能恢复:** 恢复存档时，GSM 会自动选择最新的备份。如果它检测到你当前的本地文件比备份还要新，会在覆盖前安全地提示你进行确认。
* **备份限制:** 在设置中配置每款游戏的最大滚动备份数量，以控制存储空间的占用。
* **导出位置:** 轻松选择导出的 `.gsmr` 文件的保存位置，方便快速转移到外部硬盘。

---

## 支持与反馈

如遇问题、有新功能建议或希望参与贡献，请访问 [Issues](https://github.com/dyang886/Game-Save-Manager/issues) 页面，或通过 Discord/QQ（链接见页面顶部）加入我们的社区。