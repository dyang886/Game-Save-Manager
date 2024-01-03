import datetime
import gettext
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import zipfile

import polib
import sv_ttk
from tendo import singleton
import winreg


def resource_path(relative_path):
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath("."), relative_path)


def apply_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f)


def load_settings():
    try:
        with open(SETTINGS_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        # If the settings file doesn't exist, create it with default settings
        default_path = os.path.join(os.environ["APPDATA"], "GSM Backups")
        default_settings = {
            "gsmBackupPath": default_path,
            "language": "en_US"
        }
        os.makedirs(default_path, exist_ok=True)
        with open(SETTINGS_FILE, "w") as f:
            json.dump(default_settings, f)
        return default_settings


def get_translator():
    # compile .po files to .mo files
    for root, dirs, files in os.walk(resource_path("locale/")):
        for file in files:
            if file.endswith(".po"):
                po = polib.pofile(os.path.join(root, file))
                po.save_as_mofile(os.path.join(
                    root, os.path.splitext(file)[0] + ".mo"))

    # read settings and apply languages
    lang = settings["language"]
    gettext.bindtextdomain("Game Save Manager",
                           resource_path("locale/"))
    gettext.textdomain("Game Save Manager")
    lang = gettext.translation(
        "Game Save Manager", resource_path("locale/"), languages=[lang])
    lang.install()
    return lang.gettext


SETTINGS_FILE = os.path.join(
    os.environ["APPDATA"], "GSM Settings/", "settings.json")

setting_path = os.path.join(
    os.environ["APPDATA"], "GSM Settings/")
if not os.path.exists(setting_path):
    os.makedirs(setting_path)

settings = load_settings()
_ = get_translator()

language_options = {
    "English (US)": "en_US",
    "简体中文": "zh_CN"
}


class GameSaveManager(tk.Tk):

    def __init__(self):
        super().__init__()

        try:
            self.single_instance_checker = singleton.SingleInstance()
        except singleton.SingleInstanceException:
            sys.exit(1)
        if getattr(sys, 'frozen', False):
            dir_path = os.path.dirname(sys.executable)
        else:
            dir_path = os.path.dirname(os.path.abspath(__file__))
        os.chdir(dir_path)

        self.title("Game Save Manager")
        self.iconbitmap(resource_path("assets/logo.ico"))
        sv_ttk.set_theme("dark")
        self.gsmPathTextPrompt = _("Select a .gsm file for restore")
        self.gsmPath = sys.argv[1] if len(sys.argv) > 1 else ""
        self.gsmBackupPath = settings["gsmBackupPath"]
        self.entryLength = 40
        self.settings_window = None

        # Menu bar
        self.menuBar = tk.Frame(self, background="#2e2e2e")
        self.settingMenuBtn = tk.Menubutton(
            self.menuBar, text=_("Options"), background="#2e2e2e")
        self.settingsMenu = tk.Menu(self.settingMenuBtn, tearoff=0)
        self.settingsMenu.add_command(
            label=_("Settings"), command=self.open_settings)
        self.settingMenuBtn.config(menu=self.settingsMenu)
        self.settingMenuBtn.pack(side="left")
        self.menuBar.grid(row=0, column=0, sticky="ew")

        # Main frame
        self.frame = ttk.Frame(self, padding="20")
        self.frame.grid(row=1, column=0)

        # top buttons
        self.backUpButton = ttk.Button(
            self.frame, text=_("Backup"), width=20, command=self.create_backup_thread)
        self.backUpButton.grid(row=0, column=0, padx=(10, 10))

        self.exportButton = ttk.Button(
            self.frame, text=_("Export"), width=20, command=self.create_export_thread)
        self.exportButton.grid(row=0, column=1, padx=(10, 10))

        # backup path
        self.changeBackupPath = ttk.Frame(self.frame)
        self.changeBackupPath.grid(row=1, column=0, columnspan=2, pady=(20, 0))

        self.backupPathText = tk.StringVar()
        self.backupPathText.set(os.path.normpath(self.gsmBackupPath))
        self.backupPathEntry = ttk.Entry(
            self.changeBackupPath, font=("TkDefaultFont", 10), width=self.entryLength, state="readonly", textvariable=self.backupPathText)
        self.backupPathEntry.pack(side=tk.LEFT, padx=(0, 15))

        self.backupDialogButton = ttk.Button(
            self.changeBackupPath, text="...", width=2, command=self.create_migration_thread)
        self.backupDialogButton.pack(side=tk.LEFT)

        # prompt entry
        self.scroll = ttk.Scrollbar(self.frame)
        self.scroll.grid(row=2, column=2, sticky='ns')

        self.backupProgressText = tk.Text(
            self.frame, height=12, width=50, yscrollcommand=self.scroll.set)
        self.backupProgressText.grid(row=2, column=0, padx=(
            10, 0), pady=(20, 20), columnspan=2)
        self.backupProgressText.config(state="disabled")
        self.scroll.config(command=self.backupProgressText.yview)

        self.filePathFrame = ttk.Frame(self.frame)
        self.filePathFrame.grid(row=3, column=0, columnspan=2, pady=(0, 20))

        self.gsmPathText = ttk.Entry(
            self.filePathFrame, font=("TkDefaultFont", 10), width=self.entryLength)
        self.gsmPathText.pack(side=tk.LEFT, padx=(0, 15))
        self.gsmPathText.insert(0, self.gsmPathTextPrompt)
        self.gsmPathText.config(foreground="grey")
        if self.gsmPath != "":
            self.gsmPathText.delete(0, "end")
            self.gsmPathText.insert(0, self.gsmPath)
            self.gsmPathText.config(foreground="white")

        self.fileDialogButton = ttk.Button(
            self.filePathFrame, text="...", width=2, command=self.open_file)
        self.fileDialogButton.pack(side=tk.LEFT)

        # restore buttons
        self.restoreButton1 = ttk.Button(
            self.frame, text=_("Restore from machine"), width=20, command=self.create_restore_thread_1)
        self.restoreButton1.grid(row=4, column=0, padx=(10, 10))

        self.restoreButton2 = ttk.Button(
            self.frame, text=_("Restore from .gsm file"), width=20, command=self.create_restore_thread_2)
        self.restoreButton2.grid(row=4, column=1, padx=(10, 10))

        self.gsmPathText.bind('<FocusIn>', self.on_entry_click)
        self.gsmPathText.bind('<FocusOut>', self.on_focusout)

        self.duplicate_symbol = "#"  # additional symbols: "_" -> ": ", "^" -> "?"
        self.user_name = os.getlogin()
        self.steamUserID = []
        self.ubisoftUserID = []
        self.systemPath = {
            "Windows": -1,
            "Registry": -1,
            "Steam": None,
            "Ubisoft": None
        }

        # games where saves are under their install location; or special patterns
        # key names should match with game names in self.gameSaveDirectory
        # if value is [], it has a format of [root_path, path, path, ...]
        # for games saved under install location, value should set to "" if game not found
        # for game saves with special patterns and NOT under install location, value should set to the actual path
        self.gamePath = {
            "A Dance of Fire and Ice": "",
            "AI＊Shoujo": "",
            "Besiege": "",
            "Broforce": "",
            "Celeste": "",
            "Firework (2021)": "",
            "Geometry Dash": [],
            "Half-Life 2": "",
            "Inscryption": "",
            "Kaiju Princess": [],
            "Lies of P": "",
            "Little Nightmares": "",
            "Melatonin": "",
            "Minecraft Legends": [],
            "Portal": "",
            "Portal 2": "",
            "Portal with RTX": "",
            "Rhythm Doctor": "",
            "Saints Row": "",
            "Sanfu": "",
            "The Binding of Isaac": "",
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival": "",
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol: [],
            "Vampire Survivors": "",
            "Vampire Survivors" + self.duplicate_symbol: [],
            "Yomawari_Midnight Shadows": "",
        }

        self.find_steam_directory()
        self.find_ubisoft_directory()

        # self.instal_loc_save_path parameters: (game name, steam app id, subfolder after "steamapps/common/")
        self.gamePath["A Dance of Fire and Ice"] = self.instal_loc_save_path(
            "A Dance of Fire and Ice", 977950, "A Dance of Fire and Ice")
        self.gamePath["AI＊Shoujo"] = self.instal_loc_save_path(
            "AI＊Shoujo", 1250650, "AI-Shoujo")
        self.gamePath["Besiege"] = self.instal_loc_save_path(
            "Besiege", 346010, "Besiege")
        self.gamePath["Broforce"] = self.instal_loc_save_path(
            "Broforce", 274190, "Broforce")
        self.gamePath["Celeste"] = self.instal_loc_save_path(
            "Celeste", 504230, "Celeste")
        self.gamePath["Firework (2021)"] = self.instal_loc_save_path(
            "Firework (2021)", 1288310, "Firework")
        self.gamePath["Geometry Dash"] = self.geometrydash()
        self.gamePath["Half-Life 2"] = self.instal_loc_save_path(
            "Half-Life 2", 220, "Half-Life 2")
        self.gamePath["Inscryption"] = self.instal_loc_save_path(
            "Inscryption", 1092790, "Inscryption")
        self.gamePath["Kaiju Princess"] = self.kaiju_princess(
            self.instal_loc_save_path("Kaiju Princess", 1732180, "KaijuPrincess"))
        self.gamePath["Lies of P"] = self.instal_loc_save_path(
            "Lies of P", 1627720, "Lies of P")
        self.gamePath["Little Nightmares"] = self.instal_loc_save_path(
            "Little Nightmares", 424840, "Little Nightmares")
        self.gamePath["Melatonin"] = self.instal_loc_save_path(
            "Melatonin", 1585220, "Melatonin")
        self.gamePath["Minecraft Legends"] = self.minecraft_legends()
        self.gamePath["Portal"] = self.instal_loc_save_path(
            "Portal", 400, "Portal")
        self.gamePath["Portal 2"] = self.instal_loc_save_path(
            "Portal 2", 620, "Portal 2")
        self.gamePath["Portal with RTX"] = self.instal_loc_save_path(
            "Portal with RTX", 2012840, "PortalRTX")
        self.gamePath["Rhythm Doctor"] = self.instal_loc_save_path(
            "Rhythm Doctor", 774181, "Rhythm Doctor")
        self.gamePath["Saints Row"] = self.instal_loc_save_path(
            "Saints Row", 742420, "Saints Row")
        self.gamePath["Sanfu"] = self.sanfu()
        self.gamePath["The Binding of Isaac"] = self.instal_loc_save_path(
            "The Binding of Isaac", 113200, "The Binding Of Isaac")
        self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival"] = self.instal_loc_save_path(
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival", 882710, "TouHou Makuka Sai ~ Fantastic Danmaku Festival")
        self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival" +
                      self.duplicate_symbol] = self.tmsfdf()
        self.gamePath["Vampire Survivors"] = self.instal_loc_save_path(
            "Vampire Survivors", 1794680, "Vampire Survivors")
        self.gamePath["Vampire Survivors" +
                      self.duplicate_symbol] = self.vampire_survivors()
        self.gamePath["Yomawari_Midnight Shadows"] = self.instal_loc_save_path(
            "Yomawari_Midnight Shadows", 625980, "Yomawari Midnight Shadows")

        # Format: "Game Name": ("Save Location", "Save Data Type", "Save Path")
        # Template "": ("", "", f""),
        # If game has multiple save paths, create another entry appending "self.duplicate_symbol" at the end
        self.gameSaveDirectory = {
            "64.0": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/rebelrabbit/64_0"),
            "Abzû": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/AbzuGame/Saved/SaveGames"),
            "A Dance of Fire and Ice": ("Windows", "Folder", f"{self.gamePath['A Dance of Fire and Ice']}/User"),
            "AI＊Shoujo": ("Windows", "Folder", f"{self.gamePath['AI＊Shoujo']}/UserData/save"),
            "Alba_A Wildlife Adventure": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Alba/SaveFiles"),
            "Angry Birds Space": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/210550/remote"),
            "Anno 1800": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Anno 1800/accounts"),
            "Assassin's Creed Odyssey": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/5092"),
            "Assassin's Creed Origins": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/4923"),
            "Assassin's Creed Valhalla": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/7013"),
            "Asterigos_Curse of the Stars": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/AcmeGS/Asterigos/Saved/SaveGames"),
            "Astroneer": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Astro/Saved/SaveGames"),
            "Atomic Heart": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/AtomicHeart/Saved/SaveGames"),
            "Avicii Invector": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Hello There Games/AVICII Invector"),
            "A Way Out": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/A Way Out/Saves"),
            "Badland_Game of the Year Edition": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/BADLAND/data"),
            "Bad North": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/688420/remote"),
            "Baldur's Gate 3": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1086940/remote"),
            "Baldur's Gate 3" + self.duplicate_symbol: ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story"),
            "BattleBlock Theater": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/238460/remote"),
            "Beat Hazard": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/49600/remote"),
            "Besiege": ("Windows", "File", f"{self.gamePath['Besiege']}/Besiege_Data/CompletedLevels.txt"),
            "Besiege" + self.duplicate_symbol: ("Windows", "Folder", f"{self.gamePath['Besiege']}/Besiege_Data/SavedMachines"),
            "Biomutant": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Biomutant/Saved/SaveGames"),
            "Biped": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/NExTStudios/Biped"),
            "Blasphemous": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/TheGameKitchen/Blasphemous/Savegames"),
            "Blazing Beaks": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/BlazingBeaks"),
            "Bloons TD 6": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/960090"),
            "Borderlands 3": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/Borderlands 3/Saved/SaveGames"),
            "Bright Memory_Infinite": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/BrightMemoryInfinite/Saved/SaveGames"),
            "Broforce": ("Windows", "Folder", f"{self.gamePath['Broforce']}/Saves"),
            "Brotato": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Brotato"),
            "Candleman_The Complete Journey": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/591630/remote"),
            "Celeste": ("Windows", "Folder", f"{self.gamePath['Celeste']}/Saves"),
            "Child of Light": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/611"),
            "Cocoon": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/GeometricInteractive/Cocoon"),
            "Command & Conquer Remastered Collection": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1213210/remote"),
            "Command & Conquer Remastered Collection" + self.duplicate_symbol: ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/CnCRemastered/Save"),
            "Control": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/870780/remote"),
            "Core Keeper": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Pugstorm/Core Keeper/Steam"),
            "Creaks": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Amanita Design/Creaks/save"),
            "Creepy Tale": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/LocalLow/DeqafStudio/CreepyTale/playerData.deq"),
            "Crypt of the NecroDancer": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/247080/remote"),
            "Cube Escape Collection": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/CubeEscapeCollection"),
            "Cube Escape_Paradox": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/Paradox"),
            "Cuphead": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Cuphead"),
            "Cyberpunk 2077": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/CD Projekt Red/Cyberpunk 2077"),
            "Dark Deception": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/DDeception/Saved/SaveGames"),
            "Dark Souls III": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/DarkSoulsIII"),
            "Darkwood": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Acid Wizard Studio/Darkwood"),
            "Dave the Diver": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/nexon/DAVE THE DIVER/SteamSData"),
            "Days Gone": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/BendGame/Saved"),
            "Dead Cells": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/588650/remote"),
            "Dead Space (2023)": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Dead Space (2023)/settings/steam"),
            "Death Stranding": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/KojimaProductions/DeathStranding"),
            "Death Stranding_Director's Cut": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/KojimaProductions/DeathStrandingDC"),
            "Deathloop": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Arkane Studios/Deathloop/base/savegame"),
            "Death's Door": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Acid Nerve/DeathsDoor/SAVEDATA"),
            "Deiland": ("Registry", "None", f"HKEY_CURRENT_USER\\Software\\Chibig\\Deiland"),
            "Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/APK/Saved/SaveGames"),
            "Detroit_Become Human": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Quantic Dream/Detroit Become Human"),
            "Deus Ex_Mankind Divided": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/337000/remote"),
            "Devil May Cry 5": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/601150/remote/win64_save"),
            "Don't Starve Together": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Klei/DoNotStarveTogether"),
            "Doom Eternal": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/782330/remote"),
            "Dragon Age_Inquisition": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/BioWare/Dragon Age Inquisition/Save"),
            "DREDGE": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Black Salt Games/DREDGE/saves"),
            "Dying Light": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/239140/remote/out"),
            "Dying Light 2 Stay Human": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/534380/remote/out"),
            "Elden Ring": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/EldenRing"),
            "Element TD 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Element Studios/Element TD 2"),
            "Emily Wants to Play": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/EmilyWantsToPlay/Saved/SaveGames"),
            "Emily Wants to Play Too": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/EWTP_Too/Saved/SaveGames"),
            "Enter the Gungeon": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Dodge Roll/Enter the Gungeon"),
            "F1 22": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1692250/remote"),
            "Far Cry 4": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/856"),
            "Far Cry 5": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/4311"),
            "Far Cry 6": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/920"),
            "Far Cry New Dawn": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/5211"),
            "Feeding Frenzy 2": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\GameHouse\\Feeding Frenzy 2"),
            "Feist": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/327060/remote"),
            "FIFA 23": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/FIFA 23"),
            "Final Fantasy VII Remake Intergrade": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/FINAL FANTASY VII REMAKE/Steam"),
            "Fireboy & Watergirl_Elements": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/com.osloalbet.fb"),
            "Fireboy & Watergirl_Fairy Tales": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/com.osloalbet.fairies"),
            "Firework (2021)": ("Windows", "Folder", f'{self.gamePath["Firework (2021)"]}/www/save'),
            "Five Nights at Freddy's": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy"),
            "Five Nights at Freddy's 2": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy2"),
            "Five Nights at Freddy's 3": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy3"),
            "Five Nights at Freddy's 4": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/fn4"),
            "Five Nights at Freddy's_Sister Location": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/sl"),
            "Freddy Fazbear's Pizzeria Simulator": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/FNAF6"),
            "Genital Jousting": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/LocalLow/Free Lives/Genital Jousting/Profile.penis"),
            "Geometry Dash": ("Windows", "File", self.gamePath["Geometry Dash"]),
            "Getting Over It with Bennett Foddy": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\Bennett Foddy\\Getting Over It"),
            "Ghostrunner": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Ghostrunner/Saved/SaveGames"),
            "Goat Simulator": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/265930/remote"),
            "God of War": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/God of War"),
            "Gorogoa": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Annapurna/Gorogoa"),
            "Grand Theft Auto V": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rockstar Games/GTA V/Profiles"),
            "Gris": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/nomada studio/GRIS"),
            "Grounded": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Grounded"),
            "Hades": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Saved Games/Hades"),
            "Half-Life 2": ("Windows", "Folder", f"{self.gamePath['Half-Life 2']}/hl2/save"),
            "Half-Life 2_Episode One": ("Windows", "Folder", f"{self.gamePath['Half-Life 2']}/episodic/save"),
            "Half-Life 2_Episode Two": ("Windows", "Folder", f"{self.gamePath['Half-Life 2']}/ep2/save"),
            "Halo Infinite": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1240440/remote"),
            "Hamster Playground": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1442670/remote"),
            "Handy Dandy": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/LocalLow/YellowBootsProduction/HandyDandyHandy2020/saveData.hds"),
            "Headbangers_Rhythm Royale": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Glee-Cheese Studio/Headbangers"),
            "Hellblade_Senua's Sacrifice": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/HellbladeGame/Saved/SaveGames"),
            "Hidden Folks": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Adriaan de Jongh/Hidden Folks"),
            "Hi-Fi RUSH": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/TangoGameworks/Hi-Fi RUSH (STEAM)/Saved/SaveGames"),
            "High on Life": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Oregon/Saved/SaveGames"),
            "Hitman World of Assassination": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1659040/remote"),
            "Hogwarts Legacy": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Hogwarts Legacy/Saved/SaveGames"),
            "Hollow Knight": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Team Cherry/Hollow Knight"),
            "Horizon Zero Dawn": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Horizon Zero Dawn/Saved Game"),
            "Hot Wheels Unleashed": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/hotwheels/Saved/SaveGames"),
            "Human_Fall Flat": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/477160/remote"),
            "Immortals Fenyx Rising": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/62326"),
            "Influent": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\ThreeFlipStudios\\Influent"),
            "Insaniquarium": ("Windows", "Folder", f"C:/ProgramData/Steam/Insaniquarium/userdata"),
            "Inscryption": ("Windows", "File", f"{self.gamePath['Inscryption']}/SaveFile.gwsave"),
            "Inside": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/304430/remote"),
            "Invisigun Reloaded": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Sombr Studio/Invisigun Reloaded"),
            "Isoland": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland_Steam/savedatas"),
            "Isoland 2_Ashes of Time": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland2_Steam"),
            "Isoland 3_Dust of the Universe": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland3_Steam"),
            "Isoland_The Amusement Park": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/isoland0_Steam"),
            "It Takes Two": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/ItTakesTwo"),
            "Journey": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/638230/remote"),
            "Journey to the Savage Planet": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Towers/Saved/SaveGames"),
            "Jump Off The Bridge": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Jump_Off_The_Bridge"),
            "Jusant": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/ASC/Saved/SaveGames/FullGame"),
            "Just Cause 4": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/517630/remote"),
            "Just Go": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Studio Amateur/JustGo"),
            "Just Shapes & Beats": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/531510/remote"),
            "Kaiju Princess": ("Windows", "File", self.gamePath['Kaiju Princess']),
            "Kena_Bridge of Spirits": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Kena/Saved/SaveGames"),
            "Kingdom Rush_Vengeance": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Kingdom Rush Vengeance"),
            "KunKunNight": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/KunKunNight/Saved/SaveGames"),
            "Layers of Fear (2016)": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Bloober Team/Layers of Fear"),
            "Lego Star Wars_The Skywalker Saga": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Warner Bros. Interactive Entertainment/LEGO Star Wars - The Skywalker Saga/SAVEDGAMES/STEAM"),
            "Leo's Fortune": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/355630/local"),
            "Lies of P": ("Windows", "Folder", f"{self.gamePath['Lies of P']}/LiesofP/Saved/SaveGames"),
            "Life Is Strange": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/Life Is Strange/Saves"),
            "Life Is Strange" + self.duplicate_symbol: ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/319630/remote"),
            "Limbo": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/48000/remote"),
            "Little Nightmares": ("Windows", "Folder", f"{self.gamePath['Little Nightmares']}/Atlas/Saved/SaveGames"),
            "Little Nightmares II": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Helios/Saved/SaveGames"),
            "Lost in Random": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Zoink Games/Lost In Random"),
            "Love Is All Around": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/yoogames-hd1-steam/LoveIsAllAround/SavesDir"),
            "Machinarium": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/40700/remote"),
            "Mad Max": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/234140/remote"),
            "Marvel's Avengers": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Marvel's Avengers"),
            "Marvel's Guardians of the Galaxy": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1088850/remote"),
            "Marvel's Spider-Man Remastered": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Marvel's Spider-Man Remastered"),
            "Melatonin": ("Windows", "File", f"{self.gamePath['Melatonin']}/backup.json"),
            "Melatonin" + self.duplicate_symbol: ("Windows", "File", f"{self.gamePath['Melatonin']}/LvlEditor_food.json"),
            "Melatonin" + self.duplicate_symbol*2: ("Windows", "File", f"{self.gamePath['Melatonin']}/LvlEditor_stress.json"),
            "Melatonin" + self.duplicate_symbol*3: ("Windows", "File", f"{self.gamePath['Melatonin']}/save.json"),
            "Metro Exodus": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1449560/remote"),
            "Microsoft Flight Simulator (2020)": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1250410/remote"),
            "Minecraft Dungeons": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Mojang Studios/Dungeons"),
            "Minecraft Legends": ("Windows", "Folder", self.gamePath["Minecraft Legends"]),
            "Minecraft_Story Mode - A Telltale Games Series": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Telltale Games/Minecraft Story Mode"),
            "Mini Metro": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/287980/remote"),
            "Moncage": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Optillusion/Moncage"),
            "Monster Hunter Rise": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1446780/remote"),
            "Monster Hunter Stories 2_Wings of Ruin": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1277400/remote"),
            "Monster Hunter_World": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/582010/remote"),
            "Monument Valley_Panoramic Edition": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Monument Valley"),
            "Monument Valley 2_Panoramic Edition": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Monument Valley 2"),
            "Muse Dash": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Steam/MuseDash"),
            "Mushroom 11": ("Registry", "None", f"HKEY_CURRENT_USER\\Software\\Untame\\Mushroom 11"),
            "Mushroom 11" + self.duplicate_symbol: ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/243160/remote"),
            "My Time at Portia": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Pathea Games/My Time at Portia"),
            "My Time at Sandrock": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1084600/remote"),
            "Need for Speed Heat": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Need for Speed Heat/SaveGame/savegame"),
            "NieR Replicant": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/NieR Replicant ver.1.22474487139/Steam"),
            "NieR_Automata": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/NieR_Automata"),
            "No Man's Sky": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/HelloGames/NMS"),
            "Noita": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Nolla_Games_Noita"),
            "Octopath Traveler": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/Octopath_Traveler"),
            "Operation_Tango": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Clever-Plays/Operation Tango"),
            "Ori and the Blind Forest": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Ori and the Blind Forest"),
            "Ori and the Blind Forest_Definitive Edition": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Ori and the Blind Forest DE"),
            "Ori and the Will of the Wisps": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Ori and the Will of The Wisps"),
            "Outlast": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/238320/remote"),
            "Outlast 2": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/414700/remote"),
            "Overcooked": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Ghost Town Games/Overcooked"),
            "Overcooked! 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Team17/Overcooked2"),
            "Overcooked! All You Can Eat": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Team17/Overcooked All You Can Eat"),
            "Pacify": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Pacify/Saved/SaveGames"),
            "Patrick's Parabox": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Patrick Traynor/Patrick's Parabox"),
            "Payday 2": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/218620/remote"),
            "Persona 5 Royal": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/SEGA/P5R/Steam"),
            "PGA Tour 2K21": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/2K/PGA TOUR 2K21"),
            "PGA Tour 2K23": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/PGA TOUR 2K23"),
            "PHOGS!": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/850320/remote"),
            "Pikuniku": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/572890/remote"),
            "Placid Plastic Duck Simulator": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Turbolento Games/Placid Plastic Duck Simulator"),
            "Plague Inc": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/246620/remote"),
            "Plants vs. Zombies": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/3590/remote"),
            "Poly Bridge": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/367450/remote"),
            "Poly Bridge 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Dry Cactus/Poly Bridge 2"),
            "Polyball": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/368180/remote"),
            "Portal": ("Windows", "Folder", f"{self.gamePath['Portal']}/portal/save"),
            "Portal 2": ("Windows", "Folder", f"{self.gamePath['Portal 2']}/portal2/SAVE"),
            "Portal with RTX": ("Windows", "Folder", f"{self.gamePath['Portal with RTX']}/portal_rtx/save"),
            "Raft": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Redbeet Interactive/Raft/User"),
            "RAGE 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/id Software/Rage 2/Saves"),
            "Ratchet & Clank_Rift Apart": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Ratchet & Clank - Rift Apart"),
            "Rayman Legends": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rayman Legends"),
            "Red Dead Redemption 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rockstar Games/Red Dead Redemption 2/Profiles"),
            "Resident Evil 4 (2023)": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/2050650/remote/win64_save"),
            "Resident Evil 7_Biohazard": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/418370/remote/win64_save"),
            "Resident Evil Village": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1196590/remote/win64_save"),
            "Returnal": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Returnal/Steam/Saved/SaveGames"),
            "Rhythm Doctor": ("Windows", "Folder", f"{self.gamePath['Rhythm Doctor']}/User"),
            "Ride 4": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Ride4/Saved/SaveGames"),
            "Riders Republic": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/5780"),
            "Rise of the Tomb Raider": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/391220/remote"),
            "Risk of Rain 2": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/632360/remote/UserProfiles"),
            "Rusty Lake Hotel": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/Hotel"),
            "Rusty Lake Paradise": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/Paradise"),
            "Rusty Lake_Roots": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/com.RustyLake.RustyLakeRoots/Local Store/#SharedObjects/RustyLakeRoots.swf"),
            "Sackboy_A Big Adventure": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Sackboy/Steam/SaveGames"),
            "Saints Row": ("Windows", "Folder", f"{self.gamePath['Saints Row']}/sr5/_cloudfolder/saves/SR"),
            "Samorost 3": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Amanita-Design.Samorost3/Local Store"),
            "Samsara Room": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/SamsaraRoom"),
            "Sanfu": ("Windows", "Folder", f"{self.gamePath['Sanfu']}/www/save"),
            "Scorn": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Scorn/Saved/SaveGames"),
            "Sea of Stars": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Sabotage Studio/Sea of Stars"),
            "Sekiro_Shadows Die Twice": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Sekiro"),
            "Shadow of the Tomb Raider": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Shadow of the Tomb Raider"),
            "Shadows_Awakening": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Games Farm/Shadows_ Awakening/saves"),
            "Shift Happens": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/359840/remote"),
            "Sid Meier's Civilization VI": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/Sid Meier's Civilization VI/Saves"),
            "Sifu": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Sifu/Saved/SaveGames"),
            "Skul_The Hero Slayer": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Southpaw Games/Skul"),
            "Slime Rancher": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Monomi Park/Slime Rancher"),
            "Slime Rancher 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/MonomiPark/SlimeRancher2"),
            "Song of Nunu_A League of Legends Story": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/SongOfNunu/Saved/SaveGames"),
            "Sonic Frontiers": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/SEGA/SonicFrontiers/steam"),
            "South Park_The Stick of Truth": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/South Park - The Stick of Truth/save"),
            "SpeedRunners": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/207140/remote"),
            "SpongeBob SquarePants_Battle for Bikini Bottom - Rehydrated": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Pineapple/Saved/SaveGames"),
            "Stardew Valley": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/StardewValley/Saves"),
            # "Starlink_Battle for Atlas": ("Ubisoft", "Folder", f""), # incomplete
            "Steep": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/3280"),
            "Stray": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Hk_project/Saved/SaveGames"),
            "Super Bunny Man": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Catobyte/Super Bunny Man"),
            "Super Seducer": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/LaRuina/SuperSeducer"),
            "Super Seducer 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/LaRuina/SuperSeducer2"),
            "Superhot": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/SUPERHOT_Team/SUPERHOT"),
            "Superhot_Mind Control Delete": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/SUPERHOT_Team/SHMCD"),
            "Superliminal": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/PillowCastle/SuperliminalSteam/Clouds"),
            "Tales of Arise": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/BANDAI NAMCO Entertainment/Tales of Arise/Saved/SaveGames"),
            "Teardown": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Teardown"),
            "Terraria": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/My Games/Terraria"),
            "Terraria" + self.duplicate_symbol: ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/105600/remote"),
            "tERRORbane": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/BitNine Studio/tERRORbane"),
            "The Almost Gone": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Happy Volcano/The Almost Gone"),
            "The Amazing Spider-Man 2": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/267550/remote"),
            "The Beast Inside": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/TheBeastInside/Saved/SaveGames"),
            "The Binding of Isaac": ("Windows", "File", f"{self.gamePath['The Binding of Isaac']}/serial.txt"),
            "The Binding of Isaac_Rebirth": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/250900/remote"),
            "The Forest": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/242760/remote"),
            "The Game of Life 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Marmalade Game Studio/Game Of Life 2"),
            "The Hunter_Call of the Wild": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Avalanche Studios/COTW/Saves"),
            "The Last Campfire": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Hello Games/The Last Campfire"),
            "The Last of Us Part I": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/The Last of Us Part I/users"),
            "The Medium": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Medium/Saved/SaveGames"),
            "The Outlast Trials": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/OPP/Saved/SaveGames"),
            "The Past Within": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/RustyLake/The Past Within/Serialization/SaveFiles"),
            "There Is No Game_Wrong Dimension": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/DrawMeAPixel/Ting"),
            "The Sims 4": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Electronic Arts/The Sims 4/saves"),
            "The Stanley Parable_Ultra Deluxe": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Crows Crows Crows/The Stanley Parable_ Ultra Deluxe"),
            "The White Door": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Rusty Lake/TheWhiteDoor"),
            "The Witcher 3_Wild Hunt": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/The Witcher 3"),
            "Titanfall 2": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/Respawn/Titanfall2/profile/savegames"),
            "Tomb Raider (2013)": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/203160/remote"),
            "Tom Clancy's Ghost Recon Wildlands": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/3559"),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival": ("Windows", "File", f"{self.gamePath['Touhou Makuka Sai ~ Fantasy Danmaku Festival']}/Content/Music/00.xna"),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol: ("Windows", "File", self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol]),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol*2: ("Windows", "Folder", f"{self.gamePath['Touhou Makuka Sai ~ Fantasy Danmaku Festival']}/Replay"),
            "Townscaper": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Oskar Stalberg/Townscaper/Saves"),
            "Trail Out": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/TrailOut/Saved/SaveGames"),
            # "Trials Rising": ("", "", f""), # incomplete
            "Trine 4_The Nightmare Prince": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/690640/remote"),
            "Trine 5_A Clockwork Conspiracy": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1436700/remote"),
            "Trombone Champ": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Holy Wow/TromboneChamp"),
            "Tunic": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Andrew Shouldice/Secret Legend/SAVES"),
            "Ultimate Chicken Horse": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Clever Endeavour Games/Ultimate Chicken Horse"),
            "Ultimate Custom Night": ("Windows", "File", f"C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/CN"),
            "Unbound_Worlds Apart": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Unbound/Saved/SaveGames"),
            "Uncharted_Legacy of Thieves Collection": ("Windows", "Folder", f"C:/Users/{self.user_name}/Saved Games/Uncharted Legacy of Thieves Collection/users"),
            "Undertale": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/UNDERTALE"),
            "Unpacking": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1135690/remote"),
            "Unravel": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/Unravel"),
            "Unravel Two": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Local/UnravelTwo"),
            "Untitled Goose Game": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/House House/Untitled Goose Game"),
            "Vampire Survivors": ("Windows", "Folder", f"{self.gamePath['Vampire Survivors']}/resources/app/.webpack/renderer"),
            "Vampire Survivors" + self.duplicate_symbol: ("Windows", "Folder", self.gamePath["Vampire Survivors" + self.duplicate_symbol]),
            "Vampire Survivors" + self.duplicate_symbol*2: ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1794680/remote"),
            "Watch Dogs": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/541"),
            "Watch Dogs 2": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/3619"),
            "Watch Dogs_Legion": ("Ubisoft", "Folder", f"{self.systemPath['Ubisoft']}/savegames/<user-id>/7017"),
            "What the Golf^": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Triband/WHAT THE GOLF_"),
            "while True_learn()": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/619150/remote"),
            "Wild Hearts": ("Windows", "Folder", f"C:/Users/{self.user_name}/Documents/KoeiTecmo/WILD HEARTS"),
            "Wizard of Legend": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/LocalLow/Contingent99/Wizard of Legend"),
            "Word Game": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/文字遊戲"),
            "World War Z": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/699130/remote"),
            "Worms W.M.D": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/327030/remote"),
            "WWE 2K22": ("Steam", "Folder", f"{self.systemPath['Steam']}/userdata/<user-id>/1255630/remote"),
            "Yomawari_Lost in the Dark": ("Windows", "Folder", f"C:/Users/{self.user_name}/AppData/Roaming/Nippon Ichi Software, Inc/Yomawari Lost In the Dark"),
            "Yomawari_Midnight Shadows": ("Windows", "Folder", f"{self.gamePath['Yomawari_Midnight Shadows']}/savedata"),
        }

        self.eval('tk::PlaceWindow . center')
        self.mainloop()

    def open_settings(self):
        if self.settings_window is None or not self.settings_window.winfo_exists():
            self.settings_window = tk.Toplevel(self)
            self.settings_window.title(_("Settings"))
            self.settings_window.iconbitmap(
                resource_path("assets/setting.ico"))
            self.settings_window.columnconfigure(0, weight=1)
            self.settings_window.rowconfigure(0, weight=1)

            window_width, window_height = 300, 200
            self.settings_window.geometry(f"{window_width}x{window_height}")
            self.settings_window.resizable(False, False)

            # Center the settings window to be inside of main app window
            main_x = self.winfo_x()
            main_y = self.winfo_y()
            main_width = self.winfo_width()
            main_height = self.winfo_height()
            center_x = int(main_x + (main_width - window_width) / 2)
            center_y = int(main_y + (main_height - window_height) / 2)
            self.settings_window.geometry(f"+{center_x}+{center_y}")

            # languages frame
            self.languages_frame = ttk.Frame(self.settings_window)

            # languages label
            self.languages_label = ttk.Label(
                self.languages_frame, text=_("Language:"))
            self.languages_label.pack(anchor="w")

            # languages combobox
            self.languages_var = tk.StringVar()
            for key, value in language_options.items():
                if value == settings["language"]:
                    self.languages_var.set(key)

            self.languages_combobox = ttk.Combobox(
                self.languages_frame, textvariable=self.languages_var, values=list(language_options.keys()), state="readonly", width=20)
            self.languages_combobox.pack(side=tk.LEFT)

            # apply button
            apply_button = ttk.Button(
                self.settings_window, text=_("Apply"), command=self.apply_settings_page)

            self.languages_frame.grid(row=0, column=0, pady=(20, 0))
            apply_button.grid(row=2, column=0, padx=(
                0, 20), pady=(20, 20), sticky=tk.E)

    def apply_settings_page(self):
        settings["language"] = language_options[self.languages_var.get()]
        apply_settings(settings)
        messagebox.showinfo(_("Attention"), _(
            "Please restart the application to apply settings"))

    def change_path(self, event=None):
        self.disable_widgets()
        self.delete_all_text()
        folder = filedialog.askdirectory(title=_("Change backup path"))
        if folder:
            self.insert_text(_("Migrating existing backups...\n"))
            try:
                dst = os.path.join(folder, "GSM Backups")
                if os.path.exists(dst):
                    command = messagebox.askyesno(
                        _("Confirmation"), _("Backup already exists, would you like to override?"))
                    if command:
                        shutil.rmtree(dst)
                        shutil.copytree(self.gsmBackupPath, dst)
                    else:
                        self.insert_text(_("Backup migration aborted!\n"))
                        return
                else:
                    shutil.copytree(self.gsmBackupPath, dst)
            except Exception as e:
                messagebox.showerror(_("Error"), _(
                    "An error occurred, backup migration failed: ") + str(e))
                return

            shutil.rmtree(self.gsmBackupPath)
            self.gsmBackupPath = dst
            settings["gsmBackupPath"] = self.gsmBackupPath
            apply_settings(settings)
            self.insert_text(_("Migration complete!\n"))
            self.backupPathText.set(os.path.normpath(dst))
        else:
            self.insert_text(_("New backup path not specified!\n"))

        self.enable_widgets()

    def on_entry_click(self, event):
        if self.gsmPathText.get() == self.gsmPathTextPrompt:
            self.gsmPathText.delete(0, tk.END)
            self.gsmPathText.insert(0, "")
            self.gsmPathText.config(foreground="white")

    def on_focusout(self, event):
        if self.gsmPathText.get() == "":
            self.gsmPathText.insert(0, self.gsmPathTextPrompt)
            self.gsmPathText.config(foreground="grey")

    def open_file(self):
        gsm_file = filedialog.askopenfilename(
            title=self.gsmPathTextPrompt,
            filetypes=(("gsm files", "*.gsm"),))
        if gsm_file:
            self.gsmPathText.delete(0, "end")
            self.gsmPathText.insert(0, gsm_file)
            self.gsmPathText.config(foreground="white")

    def create_migration_thread(self):
        migration_thread = threading.Thread(target=self.change_path)
        migration_thread.start()

    def create_backup_thread(self):
        backup_thread = threading.Thread(target=self.backup)
        backup_thread.start()

    def create_export_thread(self):
        export_thread = threading.Thread(target=self.export)
        export_thread.start()

    def create_restore_thread_1(self):
        restore_thread = threading.Thread(target=self.restore1)
        restore_thread.start()

    def create_restore_thread_2(self):
        restore_thread = threading.Thread(target=self.restore2)
        restore_thread.start()

    def insert_text(self, text):
        if self.duplicate_symbol in text:
            return
        self.backupProgressText.config(state="normal")
        text = text.replace("_", ": ").replace("^", "?")

        if settings["language"] == "zh_CN":
            with open(resource_path("game_names.json"), "r", encoding="utf-8") as file:
                translations = json.load(file)

            for game in translations["games"]:
                textGameName = text.strip().replace(_("Backed up "), "").replace(_("Restored "), "")
                if game["en_US"] == textGameName:
                    text = text.replace(game["en_US"], game["zh_CN"])
                    break

        self.backupProgressText.insert(tk.END, text)
        self.backupProgressText.see("end")
        self.backupProgressText.config(state="disabled")

    def delete_all_text(self):
        self.backupProgressText.config(state="normal")
        self.backupProgressText.delete(1.0, tk.END)
        self.backupProgressText.config(state="disabled")

    def disable_widgets(self):
        self.backUpButton["state"] = "disabled"
        self.exportButton["state"] = "disabled"
        self.backupDialogButton["state"] = "disabled"
        self.restoreButton1["state"] = "disabled"
        self.restoreButton2["state"] = "disabled"
        self.gsmPathText["state"] = "disabled"
        self.fileDialogButton["state"] = "disabled"

    def enable_widgets(self):
        self.backUpButton["state"] = "enabled"
        self.exportButton["state"] = "enabled"
        self.backupDialogButton["state"] = "enabled"
        self.restoreButton1["state"] = "enabled"
        self.restoreButton2["state"] = "enabled"
        self.gsmPathText["state"] = "enabled"
        self.fileDialogButton["state"] = "enabled"

    # ==================================================================
    # Start of game specific save logic functions
    def geometrydash(self):
        root = f"C:/Users/{self.user_name}/AppData/Local/GeometryDash"
        result = [root]
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if dirname.endswith(".dat"):
                    result.append(dirname)
        return result

    def kaiju_princess(self, path):
        root = os.path.join(path, "KaijuPrincess_Data")
        result = [root]
        pattern = re.compile(r"savefile\d+\.sf")
        for dirname in os.listdir(root):
            if pattern.match(dirname):
                result.append(dirname)
        return result

    def minecraft_legends(self):
        root = f"C:/Users/{self.user_name}/AppData/Roaming/Minecraft Legends"
        result = [root]
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if dirname not in ["internalStorage", "logs"]:
                    result.append(dirname)
        return result

    def sanfu(self):
        install_path = os.path.join(
            self.find_game_root_path(1880330), "steamapps/common/三伏")
        if os.path.exists(install_path):
            return install_path

        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1880330")
            value, regtype = winreg.QueryValueEx(
                registry_key, "InstallLocation")
            winreg.CloseKey(registry_key)
            base_path = value[:value.rfind('\\') + 1]
            corrected_path = os.path.join(base_path, "三伏")
            return corrected_path
        except WindowsError:
            return ""

    def tmsfdf(self):
        root = os.path.join(
            self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival"], "Content/Data")
        result = [root]
        if os.path.exists(f"{root}/4.xna"):
            result.append("4.xna")
        if os.path.exists(f"{root}/5.xna"):
            result.append("5.xna")
        if os.path.exists(f"{root}/8.xna"):
            result.append("8.xna")
        return result

    def vampire_survivors(self):
        root = f"C:/Users/{self.user_name}/AppData/Roaming"
        result = [root]
        for dirname in os.listdir(root):
            if dirname.startswith("Vampire_Survivors"):
                result.append(dirname)
        return result
    # End of game specific save logic functions
    # ==================================================================

    # ==================================================================
    # Start of helper functions
    def find_steam_directory(self):
        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallPath")
            winreg.CloseKey(registry_key)
            self.systemPath["Steam"] = value
        except WindowsError:
            self.systemPath["Steam"] = None

        if self.systemPath["Steam"] is None:
            messagebox.showerror(
                _("Error"), _("Could not find Steam installation path\nGames saved under Steam directory will not be processed"))
            return False

        steamUserIDFolder = os.path.join(self.systemPath["Steam"], "userdata/")
        all_items = os.listdir(steamUserIDFolder)
        self.steamUserID = [item for item in all_items if os.path.isdir(
            os.path.join(steamUserIDFolder, item))]

        return True

    def find_ubisoft_directory(self):
        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallDir")
            winreg.CloseKey(registry_key)
            self.systemPath["Ubisoft"] = value
        except WindowsError:
            self.systemPath["Ubisoft"] = None

        if self.systemPath["Ubisoft"] is None:
            messagebox.showerror(
                _("Error"), _("Could not find Ubisoft installation path\nGames saved under Ubisoft directory will not be processed"))
            return False

        ubisoftUserIDFolder = os.path.join(
            self.systemPath["Ubisoft"], "savegames/")
        all_items = os.listdir(ubisoftUserIDFolder)
        self.ubisoftUserID = [item for item in all_items if os.path.isdir(
            os.path.join(ubisoftUserIDFolder, item))]

        return True

    def instal_loc_save_path(self, game_name, steam_app_id, subfolder):
        install_path = os.path.join(self.find_game_root_path(
            steam_app_id), f"steamapps/common/{subfolder}")
        if os.path.exists(install_path):
            return install_path

        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, f"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App {steam_app_id}")
            value, regtype = winreg.QueryValueEx(
                registry_key, "InstallLocation")
            winreg.CloseKey(registry_key)
            return value
        except WindowsError:
            return ""

    def find_game_root_path(self, id):
        if self.systemPath["Steam"]:
            steamVDF = os.path.join(
                self.systemPath["Steam"], "config/libraryfolders.vdf")
        else:
            return ""

        with open(steamVDF, 'r') as file:
            file_content = file.read()
        lines = file_content.splitlines()
        current_path = None
        game_dict = {}
        for line in lines:
            stripped_line = line.strip()
            if '"path"' in stripped_line:
                current_path = stripped_line.split()[-1].replace('"', '')
            if current_path and len(stripped_line.split()) == 2 and stripped_line.split()[0].replace('"', '').isnumeric():
                game_id = stripped_line.split()[0].replace('"', '')
                game_dict[game_id] = current_path

        return game_dict.get(str(id), "")

    def get_latest_modification_time(self, path):
        if os.path.isfile(path):
            return datetime.datetime.fromtimestamp(os.path.getmtime(path)).replace(second=0, microsecond=0)
        else:
            return max(
                datetime.datetime.fromtimestamp(os.path.getmtime(
                    os.path.join(root, file))).replace(second=0, microsecond=0)
                for root, _, files in os.walk(path) for file in files
            )

    def remove_destination(self, source, destination):
        if isinstance(destination, list) and destination[0]:
            for path in os.listdir(source):
                full_path = os.path.join(destination[0], path)
                if os.path.exists(full_path):
                    if os.path.isfile(full_path):
                        os.remove(full_path)
                    else:
                        shutil.rmtree(full_path)
        else:
            if os.path.isfile(destination):
                os.remove(destination)
            elif os.path.isdir(destination):
                shutil.rmtree(destination)

    # check if there are any files under all subdirectories of a path
    def is_directory_empty(self, path):
        return not any(files for _, _, files in os.walk(path))

    # add a folder deletion command to Windows RunOnce registry to run on startup
    def delete_temp_on_startup(self, path):
        key = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"
        value_name = "FolderDeletionOnStartup"
        command = f"cmd.exe /c rmdir /s /q \"{path}\""

        try:
            subprocess.run(["reg", "add", key, "/v", value_name, "/d", command, "/f"], check=True,
                           creationflags=subprocess.CREATE_NO_WINDOW, capture_output=True)
        except Exception as e:
            messagebox.showerror(
                _("Error"), _("Filed to delete temporary files: ") + e.stderr)
    # End of helper functions
    # ==================================================================

    # ==================================================================
    # Start of main operation functions
    def check_newer_save(self, game, source, destination):
        # check if games saved under their install location don't exist anymore
        if "Half-Life 2" in game:
            gameDstCheck = game.replace(
                "_Episode One", "").replace("_Episode Two", "")
        else:
            gameDstCheck = game
        if gameDstCheck in self.gamePath:
            dst = self.gamePath[gameDstCheck]
            if dst == "" or (isinstance(dst, list) and len(dst) > 0 and dst[0] == ""):
                return False

        # Get the modification time of destination
        if isinstance(destination, list) and destination[0]:
            destination_mtime = max(
                (self.get_latest_modification_time(os.path.join(destination[0], path))
                 for path in os.listdir(source) if os.path.exists(os.path.join(destination[0], path))),
                default=datetime.datetime.min
            )
        elif (os.path.isdir(destination) and self.is_directory_empty(destination)) or not os.path.exists(destination):
            return True
        else:
            destination_mtime = self.get_latest_modification_time(destination)

        # Get the modification time of source
        source_mtime = self.get_latest_modification_time(source)

        # Compare times and prompt the user if necessary
        if destination_mtime > source_mtime:
            game_display = game.replace('_', ': ').replace(
                '^', '?').rstrip(self.duplicate_symbol)

            message_template = _("Save conflict detected for {game_display}:\n"
                                 "Save data on machine (last modified on {destination_mtime})\n"
                                 "is newer than backup (last modified on {source_mtime}).\n\n"
                                 "Do you want to overwrite local save data with backup?")
            formatted_message = message_template.format(
                game_display=game_display,
                destination_mtime=destination_mtime.strftime('%Y-%m-%d %H:%M'),
                source_mtime=source_mtime.strftime('%Y-%m-%d %H:%M')
            )

            command = messagebox.askyesno(_("Confirmation"), formatted_message)
            if not command:
                return False

        # Default case: overwrite the destination
        self.remove_destination(source, destination)
        return True

    def export(self):
        self.disable_widgets()
        self.delete_all_text()

        if not os.path.exists(self.gsmBackupPath) or self.is_directory_empty(self.gsmBackupPath):
            messagebox.showerror(_("Error"), _("No backup found!"))
        else:
            export_path = filedialog.askdirectory(
                title=_("Please select a directory to export your file."))
            if export_path == "":
                self.insert_text(_("Export path not specified!"))
                self.enable_widgets()
                return
            now = datetime.datetime.now()
            date_str = now.strftime("%Y-%m-%d")
            gsmExported = os.path.join(export_path, f"GSMbackup_{date_str}")
            if os.path.exists(f"{gsmExported}.gsm"):
                confirmation_message_template = _(
                    "A file named {file_name} already exists. Do you want to overwrite it?")
                formatted_confirmation_message = confirmation_message_template.format(
                    file_name=os.path.basename(gsmExported) + ".gsm"
                )
                confirmation = messagebox.askyesno(
                    _("Confirmation"), formatted_confirmation_message)
                if confirmation:
                    pass
                else:
                    self.insert_text(_("Export aborted!"))
                    self.enable_widgets()
                    return
            self.insert_text(_("Export in progress...\n"))
            shutil.make_archive(gsmExported, "zip", self.gsmBackupPath)
            os.replace(f"{gsmExported}.zip", f"{gsmExported}.gsm")

            self.insert_text(_("Export successful!"))
            self.enable_widgets()

    def backup(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True
        command = None
        if os.path.exists(self.gsmBackupPath):
            command = messagebox.askyesno(
                _("Confirmation"), _("Backup already exists, would you like to override?"))
            if command:
                shutil.rmtree(self.gsmBackupPath)
            else:
                self.insert_text(_("Backup aborted!\n"))
                START = False

        if START:
            for game, (saveLocation, DataType, directory) in self.gameSaveDirectory.items():
                source = directory
                source_folders = []
                folderID = None
                destination = os.path.join(self.gsmBackupPath, game)

                if saveLocation == "Steam" or saveLocation == "Ubisoft":
                    if saveLocation == "Steam":
                        folderID = self.steamUserID
                    elif saveLocation == "Ubisoft":
                        folderID = self.ubisoftUserID

                    for id in folderID:
                        temp = directory
                        temp = temp.replace("<user-id>", id)
                        if os.path.exists(temp) and any(files for _, _, files in os.walk(temp)):
                            source_folders.append((id, temp))

                    if source_folders:
                        for (id, location) in source_folders:
                            destination = os.path.join(destination, id)
                            shutil.copytree(location, destination)
                            self.insert_text(_("Backed up ") + game + "\n")

                elif saveLocation == "Windows":
                    if isinstance(source, list):
                        if not source[0] or len(source) <= 1:
                            continue
                        for path in source[1:]:
                            src = os.path.join(source[0], path)
                            dst = os.path.join(destination, path)
                            if os.path.isdir(src):
                                if self.is_directory_empty(src):
                                    continue
                                shutil.copytree(src, dst)
                            elif os.path.isfile(src):
                                os.makedirs(destination, exist_ok=True)
                                shutil.copy(src, dst)
                                shutil.copystat(src, dst)
                    elif os.path.isfile(source):
                        os.makedirs(destination, exist_ok=True)
                        shutil.copy(source, os.path.join(
                            destination, os.path.basename(source)))
                        shutil.copystat(source, os.path.join(
                            destination, os.path.basename(source)))
                    elif os.path.exists(source):
                        if self.is_directory_empty(source):
                            continue
                        shutil.copytree(source, destination)
                    else:
                        continue

                    self.insert_text(_("Backed up ") + game + "\n")

                elif saveLocation == "Registry":
                    command = ["reg", "query", directory]
                    status = False
                    try:
                        subprocess.run(
                            command, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
                        status = True
                    except Exception:
                        status = False

                    if status:
                        if not os.path.exists(destination):
                            os.makedirs(destination)
                        backup_file = os.path.join(destination, f"{game}.reg")
                        command = ["reg", "export",
                                   directory, backup_file, "/y"]
                        try:
                            process = subprocess.run(
                                command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                            process.check_returncode()
                        except Exception:
                            self.insert_text("An error occurred.")
                            messagebox.showerror("Error", process.stderr)
                            return
                        self.insert_text(_("Backed up ") + game + "\n")

            self.insert_text(_("Back up completed!"))

        self.enable_widgets()

    # restore backup from machine
    def restore1(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True

        if not os.path.exists(self.gsmBackupPath) or self.is_directory_empty(self.gsmBackupPath):
            messagebox.showerror(_("Error"), _("No backup found!"))
            START = False

        if START:
            all_games = os.listdir(self.gsmBackupPath)
            for game in all_games:
                path = self.systemPath[self.gameSaveDirectory[game][0]]
                if path == None:
                    continue

                source = os.path.join(self.gsmBackupPath, game)
                destination = self.gameSaveDirectory[game][2]
                if not destination:
                    continue
                saveLocation = self.gameSaveDirectory[game][0]

                if saveLocation == "Steam" or saveLocation == "Ubisoft":
                    folderID = os.listdir(source)

                    for id in folderID:
                        temp = destination
                        temp = temp.replace("<user-id>", id)
                        idSource_folder = os.path.join(source, id)
                        if self.check_newer_save(game, idSource_folder, temp):
                            shutil.copytree(idSource_folder,
                                            temp, dirs_exist_ok=True)
                            self.insert_text(_("Restored ") + game + "\n")

                elif saveLocation == "Windows":
                    if isinstance(destination, list):
                        if destination[0] and self.check_newer_save(game, source, destination):
                            for path in os.listdir(source):
                                src = os.path.join(source, path)
                                dst = os.path.join(destination[0], path)
                                if os.path.isfile(src):
                                    os.makedirs(destination[0], exist_ok=True)
                                    shutil.copy(src, dst)
                                    shutil.copystat(src, dst)
                                else:
                                    shutil.copytree(
                                        src, dst, dirs_exist_ok=True)

                            self.insert_text(_("Restored ") + game + "\n")

                    elif self.check_newer_save(game, source, destination):
                        if self.gameSaveDirectory[game][1] == "File":
                            source_file = next(os.path.join(source, f)
                                               for f in os.listdir(source))
                            shutil.copy(source_file, destination)
                            shutil.copystat(source_file, destination)
                        else:
                            shutil.copytree(
                                source, destination, dirs_exist_ok=True)

                        self.insert_text(_("Restored ") + game + "\n")

                elif saveLocation == "Registry":
                    command = ["reg", "query", destination]
                    status = False
                    try:
                        subprocess.run(
                            command, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
                        status = True
                    except Exception:
                        status = False

                    if status:
                        delete_command = ["reg", "delete", destination, "/f"]
                        try:
                            process = subprocess.run(
                                delete_command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                            process.check_returncode()
                        except Exception:
                            self.insert_text(_("An error occurred."))
                            messagebox.showerror(_("Error"), process.stderr)
                            return

                    backup_file = os.path.join(source, f"{game}.reg")
                    if os.path.exists(backup_file):
                        command = ["reg", "import", backup_file]
                        try:
                            process = subprocess.run(
                                command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                            process.check_returncode()
                        except Exception:
                            self.insert_text(_("An error occurred."))
                            messagebox.showerror(_("Error"), process.stderr)
                            return

                        self.insert_text(_("Restored ") + game + "\n")

            self.insert_text(_("Restore completed!"))

        self.enable_widgets()

    # restore backup from .gsm file
    def restore2(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True

        gsmPath = self.gsmPathText.get()
        if not os.path.exists(gsmPath):
            messagebox.showerror(_("Error"), _("Invalid file path!"))
            START = False

        if START:
            temp_dir = os.path.join(
                tempfile.gettempdir(), "GameSaveManagerTemp")
            if os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except Exception:
                    self.delete_temp_on_startup(temp_dir)
                    self.insert_text(_("An error occurred."))
                    messagebox.showerror(
                        _("Error"), _("Unable to clear temporary files from last session, please restart your computer."))
                    self.enable_widgets()
                    return
            os.mkdir(temp_dir)
            zipGSM = f"{temp_dir}/{os.path.splitext(os.path.basename(gsmPath))[0]}.zip"
            self.insert_text(_("Decompressing file...\n"))

            try:
                shutil.copy(gsmPath, zipGSM)
                with zipfile.ZipFile(zipGSM, 'r') as zip_ref:
                    for member in zip_ref.infolist():
                        zip_ref.extract(member, temp_dir)
                        extracted_path = os.path.join(
                            temp_dir, member.filename)
                        # The + (0, 0, -1) is to add extra 0s for DST, etc.
                        mtime = time.mktime(member.date_time + (0, 0, -1))
                        os.utime(extracted_path, (mtime, mtime))
            except Exception as e:
                messagebox.showerror(_("Error"), _(
                    "An error occurred while extracting file: ") + str(e))
                return
            os.remove(zipGSM)

            all_games = os.listdir(temp_dir)
            for game in all_games:
                path = self.systemPath[self.gameSaveDirectory[game][0]]
                if path == None:
                    continue

                source = f"{temp_dir}/{game}"
                destination = self.gameSaveDirectory[game][2]
                if not destination:
                    continue
                saveLocation = self.gameSaveDirectory[game][0]

                if saveLocation == "Steam" or saveLocation == "Ubisoft":
                    folderID = os.listdir(source)

                    for id in folderID:
                        temp = destination
                        temp = temp.replace("<user-id>", id)
                        idSource_folder = os.path.join(source, id)
                        if self.check_newer_save(game, idSource_folder, temp) and os.path.exists:
                            shutil.copytree(idSource_folder,
                                            temp, dirs_exist_ok=True)
                            self.insert_text(_("Restored ") + game + "\n")

                elif saveLocation == "Windows":
                    if isinstance(destination, list):
                        if destination[0] and self.check_newer_save(game, source, destination):
                            for path in os.listdir(source):
                                src = os.path.join(source, path)
                                dst = os.path.join(destination[0], path)
                                if os.path.isfile(src):
                                    os.makedirs(destination[0], exist_ok=True)
                                    shutil.copy(src, dst)
                                    shutil.copystat(src, dst)
                                else:
                                    shutil.copytree(
                                        src, dst, dirs_exist_ok=True)

                            self.insert_text(_("Restored ") + game + "\n")

                    elif self.check_newer_save(game, source, destination):
                        if self.gameSaveDirectory[game][1] == "File":
                            source_file = next(os.path.join(source, f)
                                               for f in os.listdir(source))
                            shutil.copy(source_file, destination)
                            shutil.copystat(source_file, destination)
                        else:
                            shutil.copytree(
                                source, destination, dirs_exist_ok=True)

                        self.insert_text(_("Restored ") + game + "\n")

                elif saveLocation == "Registry":
                    command = ["reg", "query", destination]
                    status = False
                    try:
                        subprocess.run(
                            command, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
                        status = True
                    except Exception:
                        status = False

                    if status:
                        delete_command = ["reg", "delete", destination, "/f"]
                        try:
                            process = subprocess.run(
                                delete_command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                            process.check_returncode()
                        except Exception:
                            self.insert_text(_("An error occurred."))
                            messagebox.showerror(_("Error"), process.stderr)
                            return

                    backup_file = os.path.join(source, f"{game}.reg")
                    if os.path.exists(backup_file):
                        command = ["reg", "import", backup_file]
                        try:
                            process = subprocess.run(
                                command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                            process.check_returncode()
                        except Exception:
                            self.insert_text(_("An error occurred."))
                            messagebox.showerror(_("Error"), process.stderr)
                            return

                        self.insert_text(_("Restored ") + game + "\n")

            try:
                shutil.rmtree(temp_dir)
            except Exception:
                self.delete_temp_on_startup(temp_dir)
            self.insert_text(_("Restore completed!"))

        self.enable_widgets()
    # End of main operation functions
    # ==================================================================


if __name__ == "__main__":
    GameSaveManager()
