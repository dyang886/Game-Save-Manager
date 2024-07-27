import errno
import gettext
import json
import locale
import os
import re
import shutil
import stat
import sys
import winreg

import pinyin
import polib


def resource_path(relative_path):
    if hasattr(sys, "_MEIPASS"):
        full_path = os.path.join(sys._MEIPASS, relative_path)
    else:
        full_path = os.path.join(os.path.abspath("."), relative_path)

    if not os.path.exists(full_path):
        resource_name = os.path.basename(relative_path)
        formatted_message = tr("Couldn't find {missing_resource}. Please try reinstalling the application.").format(missing_resource=resource_name)
        raise FileNotFoundError(formatted_message)

    return full_path


def apply_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)


def load_settings():
    locale.setlocale(locale.LC_ALL, '')
    system_locale = locale.getlocale()[0]
    locale_mapping = {
        "English_United States": "en_US",
        "Chinese (Simplified)_China": "zh_CN",
        "Chinese (Simplified)_Hong Kong SAR": "zh_CN",
        "Chinese (Simplified)_Macao SAR": "zh_CN",
        "Chinese (Simplified)_Singapore": "zh_CN",
        "Chinese (Traditional)_Hong Kong SAR": "zh_TW",
        "Chinese (Traditional)_Macao SAR": "zh_TW",
        "Chinese (Traditional)_Taiwan": "zh_TW",
        "Japanese_Japan": "ja_JP",
    }
    app_locale = locale_mapping.get(system_locale, 'en_US')

    default_settings = {
        "gsmBackupPath": os.path.join(os.environ["APPDATA"], "GSM Backups"),
        "language": app_locale,
        "theme": "black",
        "maxBackups": 3,
        "backupGDMusic": False
    }

    try:
        with open(SETTINGS_FILE, "r") as f:
            settings = json.load(f)
    except Exception as e:
        print("Error loading settings json" + str(e))
        settings = default_settings

    for key, value in default_settings.items():
        settings.setdefault(key, value)

    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)

    return settings


def get_translator():
    if not hasattr(sys, 'frozen'):
        for root, dirs, files in os.walk(resource_path("locale/")):
            for file in files:
                if file.endswith(".po"):
                    po = polib.pofile(os.path.join(root, file))
                    po.save_as_mofile(os.path.join(root, os.path.splitext(file)[0] + ".mo"))

    lang = settings["language"]
    gettext.bindtextdomain("Game Save Manager",resource_path("locale/"))
    gettext.textdomain("Game Save Manager")
    lang = gettext.translation("Game Save Manager", resource_path("locale/"), languages=[lang])
    lang.install()
    return lang.gettext


def ensure_backup_path_is_valid():
    try:
        os.makedirs(settings["gsmBackupPath"], exist_ok=True)
    except Exception:
        settings["gsmBackupPath"] = os.path.join(os.environ["APPDATA"], "GSM Backups")
        apply_settings(settings)
        os.makedirs(settings["gsmBackupPath"], exist_ok=True)


def sort_game_name(game: object, operation):
    if settings["language"] == "en_US":
        game_name = game.name_en
    elif settings["language"] == "zh_CN" or settings["language"] == "zh_TW":
        game_name = pinyin.get(game.name_zh, format="strip", delimiter=" ")

    if operation == "backup":
        return (not game.backupable, game_name)
    elif operation == "restore":
        return (not game.restorable, game_name)


def sanitize_game_name(name):
    return re.sub(r'[/\\:*?"<>|]', '_', name)


def get_game_name(game: object):
    if settings["language"] == "en_US":
        return game.name_en
    elif settings["language"] == "zh_CN" or settings["language"] == "zh_TW":
        return game.name_zh


def registry_path_exists(full_path):
        parts = full_path.split("\\", 1)

        hive_name = parts[0]
        hive_map = {
            "HKEY_CLASSES_ROOT": winreg.HKEY_CLASSES_ROOT,
            "HKEY_CURRENT_USER": winreg.HKEY_CURRENT_USER,
            "HKEY_LOCAL_MACHINE": winreg.HKEY_LOCAL_MACHINE,
            "HKEY_USERS": winreg.HKEY_USERS,
            "HKEY_CURRENT_CONFIG": winreg.HKEY_CURRENT_CONFIG
        }

        if hive_name not in hive_map:
            return False

        try:
            registry_key = winreg.OpenKey(hive_map[hive_name], parts[1], 0, winreg.KEY_READ)
            winreg.CloseKey(registry_key)
            return True
        except Exception:
            return False


def is_path_valid(path):
    """Check if a path exists and has at least one file inside."""

    if not os.path.exists(path):
        return False

    for root, dirs, files in os.walk(path):
        if files:
            return True

    return False


def handle_remove_readonly(func, path, e):
    """Handle the case where a file is read-only."""

    if isinstance(e, PermissionError) and e.errno == errno.EACCES:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    else:
        raise


def copyfile_with_permissions(src, dst):
    if os.path.exists(dst):
        os.chmod(dst, stat.S_IWRITE)

    shutil.copy(src, dst)
    shutil.copystat(src, dst)


def copytree_with_permissions(src, dst):
    src_entries = os.listdir(src)

    for entry in src_entries:
        src_path = os.path.join(src, entry)
        dst_path = os.path.join(dst, entry)

        if os.path.isdir(src_path) and os.path.exists(dst_path):
            if os.path.isdir(dst_path):
                for root, dirs, files in os.walk(dst_path):
                    for file in files:
                        os.chmod(os.path.join(root, file), stat.S_IWRITE)
        elif os.path.isfile(src_path) and os.path.exists(dst_path):
            os.chmod(dst_path, stat.S_IWRITE)

    shutil.copytree(src, dst, dirs_exist_ok=True)


setting_path = os.path.join(os.environ["APPDATA"], "GSM Settings")
os.makedirs(setting_path, exist_ok=True)

SETTINGS_FILE = os.path.join(setting_path, "settings.json")

settings = load_settings()
tr = get_translator()

ensure_backup_path_is_valid()

if settings["theme"] == "black":
    dropDownArrow_path = resource_path("assets/dropdown-white.png").replace("\\", "/")
    spinboxUpArrow_path = resource_path("assets/spinbox-up-white.png").replace("\\", "/")
    spinboxDownArrow_path = resource_path("assets/spinbox-down-white.png").replace("\\", "/")
elif settings["theme"] == "white":
    dropDownArrow_path = resource_path("assets/dropdown-black.png").replace("\\", "/")
    spinboxUpArrow_path = resource_path("assets/spinbox-up-black.png").replace("\\", "/")
    spinboxDownArrow_path = resource_path("assets/spinbox-down-black.png").replace("\\", "/")
upArrow_path = resource_path("assets/up.png").replace("\\", "/")
downArrow_path = resource_path("assets/down.png").replace("\\", "/")
leftArrow_path = resource_path("assets/left.png").replace("\\", "/")
rightArrow_path = resource_path("assets/right.png").replace("\\", "/")
backupIcon_path = resource_path("assets/backup.svg")
restoreIcon_path = resource_path("assets/restore.svg")
promptIcon_path = resource_path("assets/prompt.svg")
unzip_path = resource_path("dependency/7z/7z.exe")

language_options = {
    "English (US)": "en_US",
    "简体中文": "zh_CN",
    "繁體中文": "zh_TW",
    "日本語": "ja_JP",
}

theme_options = {
    tr("Black"): "black",
    tr("white"): "white"
}
