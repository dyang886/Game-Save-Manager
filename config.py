import gettext
import json
import locale
import os
import sys

import polib
from PyQt6.QtWidgets import QMessageBox


def resource_path(relative_path):
    if hasattr(sys, "_MEIPASS"):
        full_path = os.path.join(sys._MEIPASS, relative_path)
    else:
        full_path = os.path.join(os.path.abspath("."), relative_path)

    if not os.path.exists(full_path):
        resource_name = os.path.basename(relative_path)
        formatted_message = tr("Couldn't find {missing_resource}. Please try reinstalling the application.").format(
            missing_resource=resource_name)
        QMessageBox.critical(
            None, tr("Missing resource file"), formatted_message)
        sys.exit(1)

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
        "backupMC": False,
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
                    po.save_as_mofile(os.path.join(
                        root, os.path.splitext(file)[0] + ".mo"))

    lang = settings["language"]
    gettext.bindtextdomain("Game Save Manager",
                           resource_path("locale/"))
    gettext.textdomain("Game Save Manager")
    lang = gettext.translation(
        "Game Save Manager", resource_path("locale/"), languages=[lang])
    lang.install()
    return lang.gettext


setting_path = os.path.join(
    os.environ["APPDATA"], "GSM Settings/")
os.makedirs(setting_path, exist_ok=True)

SETTINGS_FILE = os.path.join(setting_path, "settings.json")

settings = load_settings()
tr = get_translator()
