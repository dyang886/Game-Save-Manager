import os
import re
import winreg

from config import *
from game_saves import games


class DataBase():
    def __init__(self):
        self.game_list = []
        self.steam_user_ids = []
        self.ubisoft_user_ids = []

        self.backup_dict = {}  # {Index: Game}
        self.restore_dict = {}  # {Index: Game}
    
    def updateDatabase(self):
        self.user_name = os.getlogin()
        self.steam_path = self.steamPath()
        self.ubisoft_path = self.ubisoftPath()
        self.steamVDF_data = self.steamVDFData(self.steam_path)

        self.game_list = []
        for game in games:
            gameObject = Game(
                game['en_US'],
                game['zh_CN'],
                game.get('steam_id', ''),
                game['save_paths'],
                self.user_name,
                self.steam_path,
                self.ubisoft_path,
                self.steam_user_ids,
                self.ubisoft_user_ids,
                self.steamVDF_data
            )
            self.game_list.append(gameObject)

    def steamPath(self):
        steam_path = ""
        try:
            registry_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallPath")
            winreg.CloseKey(registry_key)
            steam_path = value
        except WindowsError:
            steam_path = ""

        if not steam_path:
            print(tr("Could not find Steam installation path\nGames saved under Steam directory will not be processed") + "\n\n")
            return "<steam_path>"

        steam_user_id_folder = os.path.join(steam_path, "userdata")
        if os.path.exists(steam_user_id_folder):
            all_items = os.listdir(steam_user_id_folder)
            self.steam_user_ids = [item for item in all_items if os.path.isdir(os.path.join(steam_user_id_folder, item))]
            print("Steam user ids: ", self.steam_user_ids)

        return steam_path

    def ubisoftPath(self):
        ubisoft_path = ""
        try:
            registry_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallDir")
            winreg.CloseKey(registry_key)
            ubisoft_path = value
        except WindowsError:
            ubisoft_path = ""

        if not ubisoft_path:
            print(tr("Could not find Ubisoft installation path\nGames saved under Ubisoft directory will not be processed") + "\n\n")
            return "<ubisoft_path>"

        ubisoft_user_id_folder = os.path.join(ubisoft_path, "savegames")
        if os.path.exists(ubisoft_user_id_folder):
            all_items = os.listdir(ubisoft_user_id_folder)
            self.ubisoft_user_ids = [item for item in all_items if os.path.isdir(os.path.join(ubisoft_user_id_folder, item))]
            print("Ubisoft user ids: ", self.ubisoft_user_ids)

        return ubisoft_path
    
    def steamVDFData(self, steam_path):
        steamVDF = os.path.join(steam_path, "config/libraryfolders.vdf")

        if os.path.exists(steamVDF):
            with open(steamVDF, 'r') as file:
                file_content = file.read()
        else:
            return ""
        
        lines = file_content.splitlines()
        current_path = None
        game_dict = {}
        for line in lines:
            stripped_line = line.strip()
            path_match = re.match(r'"path"\s+"(.+?)"', stripped_line)
            if path_match:
                current_path = path_match.group(1)
            game_id_match = re.match(r'"(\d+)"\s+"\d+"', stripped_line)
            if current_path and game_id_match:
                game_dict[game_id_match.group(1)] = current_path
        
        return game_dict


class Game():

    class SavePath():
        def __init__(self, save_loc, root_path, files):
            self.save_loc = save_loc
            self.root_path = root_path
            self.files = files

    def __init__(self, name_en, name_zh, steam_id, save_paths, user_name, steam_path, ubisoft_path, steam_user_ids, ubisoft_user_ids, steamVDF_data):
        self.name_en = name_en
        self.name_zh = name_zh
        self.steam_id = steam_id
        self.save_paths = []
        self.backupable = False
        self.restorable = False

        self.special_cases = {
            "Geometry Dash": self.geometryDash,
            "kaiju Princess": self.kaijuPrincess,
            "Vampire Survivors": self.vampireSurvivors,
        }

        self.constructPath(name_en, steam_id, save_paths, user_name, steam_path, ubisoft_path, steam_user_ids, ubisoft_user_ids, steamVDF_data)

    def constructPath(self, name_en, steam_id, save_paths, user_name, steam_path, ubisoft_path, steam_user_ids, ubisoft_user_ids, steamVDF_data):
        root_backup_path = os.path.join(settings["gsmBackupPath"], sanitize_game_name(name_en))

        for save_path in save_paths:
            formatted_root_path = save_path["root_path"].format(
                user_name=user_name,
                steam_path=steam_path,
                ubisoft_path=ubisoft_path,
                steam_library_path=self.steamLibraryPath(steamVDF_data, steam_id)
            )
            files = save_path["files"]

            # Check backupable
            if is_path_valid(formatted_root_path):
                self.backupable = True
            elif "<user_id>" in formatted_root_path:
                if save_path["save_loc"] == "Steam":
                    if any(is_path_valid(formatted_root_path.replace("<user_id>", id)) for id in steam_user_ids):
                        self.backupable = True
                elif save_path["save_loc"] == "Ubisoft":
                    if any(is_path_valid(formatted_root_path.replace("<user_id>", id)) for id in ubisoft_user_ids):
                        self.backupable = True
            elif save_path["save_loc"] == "Registry":
                if registry_path_exists(formatted_root_path):
                    self.backupable = True
            
            # Check restorable
            if is_path_valid(root_backup_path) and not ("<ubisoft_path>" in formatted_root_path or "<steam_path>" in formatted_root_path or "<steam_library_path>" in formatted_root_path):
                self.restorable = True

            if files == "special" and self.backupable:
                files = self.special_cases[name_en](formatted_root_path)

            self.save_paths.append(Game.SavePath(save_path["save_loc"], os.path.normpath(formatted_root_path), files))

    def steamLibraryPath(self, steamVDF_data, steam_id):
        if not steamVDF_data:
            return "<steam_library_path>"
        
        steam_library_path = steamVDF_data.get(str(steam_id), "")
        if steam_library_path:
            return os.path.join(steam_library_path, "steamapps/common")

        return "<steam_library_path>"
    
    # ===========================================================================
    # Game specific save logic functions
    # ===========================================================================
    def geometryDash(self, root_path):
        if settings["backupGDMusic"]:
            return "all"
        else:
            result = []
            for dirname in os.listdir(root_path):
                if dirname.endswith(".dat"):
                    result.append(dirname)
            return result

    def kaijuPrincess(self, root_path):
        result = []
        pattern = re.compile(r"savefile\d+\.s")
        for dirname in os.listdir(root_path):
            if pattern.match(dirname):
                result.append(dirname)
        return result

    def vampireSurvivors(self, root_path):
        result = []
        for dirname in os.listdir(root_path):
            if dirname.startswith("Vampire_Survivors"):
                result.append(dirname)
        return result
