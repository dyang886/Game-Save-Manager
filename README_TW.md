# Game Save Manager

[English](./README.md) | [简体中文](./README_CN.md) | 繁體中文

![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/dyang886/Game-Save-Manager/total) ![GitHub Repo stars](https://img.shields.io/github/stars/dyang886/Game-Save-Manager?style=flat&color=ffc000) ![GitHub Release](https://img.shields.io/github/v/release/dyang886/Game-Save-Manager?link=https%3A%2F%2Fgithub.com%2Fdyang886%2FGame-Save-Manager%2Freleases%2Flatest) ![GitHub License](https://img.shields.io/github/license/dyang886/Game-Save-Manager) <a href="https://discord.gg/d627qVyHEF" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_Discord-f0f0f0?logo=discord"></a> <a href="https://pd.qq.com/s/h06qbdey6" target="_blank"><img alt="Static Badge" src="https://img.shields.io/badge/Join_QQ-f0f0f0?logo=qq"></a>

<div align="center">
    <img src="src/assets/logo.png" alt="Game Save Manager logo" width="250" />
</div>
**獲取更多資訊，請造訪我們的官方網站 [https://gamezonelabs.com](https://gamezonelabs.com)。**

不要再盲目信任雲端同步了。**Game Save Manager (GSM)** 將你在 Steam、Epic 以及自訂位置的遊戲存檔安全地集中在一個地方。自動偵測已安裝的遊戲，維護帶有版本歷史的備份，並支援一鍵還原你的遊戲進度。

---

## 核心功能

### 集中管理 (由 PCGamingWiki 強力驅動)
別再在 AppData 資料夾裡辛苦翻找了。GSM 會自動尋找並整理你的存檔檔案，將其呈現在一個清晰、可互動的表格中。藉助全球最大的眾包遊戲資料庫，我們支援超過 14,000 個遊戲存檔位置。

### 智慧偵測引擎
GSM 的搜尋範圍不僅侷限於單一資料夾。它採用了雙重掃描系統：
* **安裝路徑掃描:** 透過掃描你的遊戲庫資料夾，自動偵測由 Steam、Epic、Battle.net 等平台安裝的遊戲。
* **深度資料庫掃描:** 即使是已經解除安裝的遊戲也會留下存檔痕跡。GSM 會檢查數千個已知存檔路徑（包括登錄檔、AppData、文件），找回你遺忘的遊戲歷史。

### 時光倒流與版本控制
選錯了劇情對話？存檔檔案損毀？GSM 會為每款遊戲保留滾動的備份歷史。你可以設定**自動輪換** 限制，自動清理舊檔案以節省磁碟空間；或者將特定備份（例如「最終 BOSS 前」）標記為**永久固定**，這樣它們就永遠不會被誤刪。

### 跨裝置轉移
換新電腦了？GSM 允許你將整個存檔歷史匯出為一個單獨的 `.gsmr` 壓縮檔。在新電腦上匯入該檔案，GSM 會智慧合併備份，輕鬆將現有的本機歷史記錄與匯入的檔案無縫結合。

### 帳號智慧識別
GSM 能智慧識別 Steam、Ubisoft、Epic、Xbox 和 Rockstar 等平台的使用者 ID。這讓你能夠為特定帳號進行單獨備份，或者為系統上的所有帳號建立全域備份。

### 自訂與擴充支援
正在玩小眾獨立遊戲或是打了大量模組 (Mod) 的遊戲？使用**自訂遊戲** 頁籤，手動將任何資料夾、檔案或登錄檔項目新增到備份系統中。利用**智慧變數**（如 `%AppData%` 或你的 `%UserProfile%`），確保你的自訂備份在任何電腦上都能完美運作。

---

## 安裝指南

1. 前往我們的 [最新發布 (Latest Release)](https://github.com/dyang886/Game-Save-Manager/releases) 頁面。
2. 下載最新的 Windows (64位元) 安裝檔。
3. 執行安裝程式並按照螢幕上的指示進行操作。
4. 啟動 GSM，開始保護你的遊戲進度！

---

## 進階使用與選項

雖然 GSM 的設計理念是開箱即用，但你完全可以透過應用程式介面掌控你的備份策略：

* **批次處理:** 在備份或還原頁籤中勾選多個已偵測到的遊戲，一鍵即可批次處理。
* **智慧還原:** 還原存檔時，GSM 會自動選擇最新的備份。如果它偵測到你目前的本機檔案比備份還要新，會在覆寫前安全地提示你進行確認。
* **備份限制:** 在設定中配置每款遊戲的最大滾動備份數量，以控制儲存空間的佔用。
* **匯出位置:** 輕鬆選擇匯出的 `.gsmr` 檔案儲存位置，方便快速轉移到外部硬碟。

---

## 支援與反饋

如遇問題、有新功能建議或希望參與貢獻，請造訪 [Issues](https://github.com/dyang886/Game-Save-Manager/issues) 頁面，或透過 Discord/QQ（連結見頁面頂部）加入我們的社群。