import datetime
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import zipfile

from customtkinter import CTkScrollableFrame
from PIL import Image, ImageTk
from tendo import singleton

from PyQt6.QtCore import Qt, QTimer, QSize, QByteArray
from PyQt6.QtGui import QAction, QColor, QFont, QFontDatabase, QIcon, QPixmap
from PyQt6.QtWidgets import QApplication, QFileDialog, QGridLayout, QTableWidget, QTableWidgetItem, QHeaderView, QHBoxLayout, QTabWidget, QLabel, QLineEdit, QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QStatusBar, QVBoxLayout, QWidget, QListWidget

from helper import *
import style_sheet


class GameSaveManager(QMainWindow):

    def __init__(self):
        super().__init__()

        # Single instance check and basic UI setup
        try:
            self.single_instance_checker = singleton.SingleInstance()
        except singleton.SingleInstanceException:
            sys.exit(1)
        except Exception as e:
            print(str(e))

        self.setWindowTitle("Game Save Manager")
        self.setWindowIcon(QIcon(resource_path("assets/logo.ico")))
        self.setMinimumSize(850, 650)

        # Version, user prompts, and links
        self.appVersion = "1.1.6"
        self.githubLink = "https://github.com/dyang886/Game-Save-Manager"
        self.updateLink = "https://api.github.com/repos/dyang886/Game-Save-Manager/releases/latest"
        self.bilibiliLink = "https://space.bilibili.com/256673766"

        # Paths and variable management
        self.gsmPathTextPrompt = tr("Select a .gsm file for restore")

        self.dropDownArrow_path = resource_path("assets/dropdown.png").replace("\\", "/")
        self.upArrow_path = resource_path("assets/up.png").replace("\\", "/")
        self.downArrow_path = resource_path("assets/down.png").replace("\\", "/")
        self.leftArrow_path = resource_path("assets/left.png").replace("\\", "/")
        self.rightArrow_path = resource_path("assets/right.png").replace("\\", "/")

        self.backupIcon_path = resource_path("assets/backup.svg")
        self.restoreIcon_path = resource_path("assets/restore.svg")

        if getattr(sys, 'frozen', False):
            dir_path = os.path.dirname(sys.executable)
        else:
            dir_path = os.path.dirname(os.path.abspath(__file__))
        os.chdir(dir_path)
        self.gsmPath = sys.argv[1] if len(sys.argv) > 1 else ""
        self.gsmBackupPath = settings["gsmBackupPath"]
        self.customGameJson = os.path.join(
            self.gsmBackupPath, "0 Custom", "custom_games.json")

        self.file_types = {
            tr("Folder"): "folder",
            tr("File"): "file"
        }

        # Window references
        self.settings_window = None
        self.about_window = None

        # Main widget group
        centralWidget = QWidget(self)
        self.setCentralWidget(centralWidget)
        mainLayout = QVBoxLayout(centralWidget)
        mainLayout.setSpacing(15)
        mainLayout.setContentsMargins(30, 20, 30, 10)
        centralWidget.setLayout(mainLayout)
        self.init_settings()

        self.tabWidget = QTabWidget()
        self.tabWidget.setTabPosition(QTabWidget.TabPosition.North)
        self.tabWidget.setIconSize(QSize(20, 20))
        mainLayout.addWidget(self.tabWidget)

        # Menu setup
        menuFont = self.font()
        menuFont.setPointSize(9)
        menu = self.menuBar()
        menu.setFont(menuFont)

        optionMenu = menu.addMenu(tr("Options"))

        settingsAction = QAction(tr("Settings"), self)
        settingsAction.setFont(menuFont)
        settingsAction.triggered.connect(self.open_settings)
        optionMenu.addAction(settingsAction)

        aboutAction = QAction(tr("About"), self)
        aboutAction.setFont(menuFont)
        aboutAction.triggered.connect(self.open_about)
        optionMenu.addAction(aboutAction)

        # Status bar setup
        self.statusbar = QStatusBar()
        self.setStatusBar(self.statusbar)

        # ===========================================================================
        # Tab 1: Backup
        # ===========================================================================        
        backup_tab = QWidget()
        backup_tab_layout = QVBoxLayout()
        backup_tab_layout.setSpacing(10)
        backup_tab.setLayout(backup_tab_layout)
        self.tabWidget.addTab(backup_tab, self.setCustomIcon(self.backupIcon_path), tr("Backup"))

        button_layout = QHBoxLayout()
        button_layout.setSpacing(6)
        backup_tab_layout.addLayout(button_layout)

        backup_button = QPushButton(tr("Backup Selected"))
        # backup_button.clicked.connect(self.perform_backup)
        button_layout.addWidget(backup_button)

        refresh_button = QPushButton(tr("Add Custom Games"))
        # refresh_button.clicked.connect(self.refresh_backup_list)
        button_layout.addWidget(refresh_button)

        # Table for Game Saves
        self.backup_table = QTableWidget(0, 4)  # Starts with zero rows and four columns
        self.backup_table.setHorizontalHeaderLabels(['', tr("Backupable?"), tr("Game Name"), tr("Save Path")])
        self.backup_table_header = CheckableHeader(Qt.Orientation.Horizontal, self.backup_table)
        self.backup_table.setHorizontalHeader(self.backup_table_header)
        self.backup_table.horizontalHeader().setStretchLastSection(True)
        self.backup_table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        backup_tab_layout.addWidget(self.backup_table)

        # Test
        # Sample data for the backup table
        self.test_data = [
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves/asdkfjsdklfja;sdlkfjasl;dfjkal;/asdkjgla;ksfdjgskldjaflsd"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3 asdfjaskldjf asetg ", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
            {"selected": False, "backupable": True, "game_name": "The Witcher 3", "save_path": "C:/Users/Username/Documents/TheWitcher3/saves"},
            {"selected": False, "backupable": False, "game_name": "Cyberpunk 2077", "save_path": "C:/Users/Username/Documents/Cyberpunk2077/saves"},
            {"selected": False, "backupable": True, "game_name": "Skyrim", "save_path": "C:/Users/Username/Documents/Skyrim/saves"},
            {"selected": False, "backupable": False, "game_name": "Fallout 4", "save_path": "C:/Users/Username/Documents/Fallout4/saves"},
            {"selected": False, "backupable": True, "game_name": "Dark Souls III", "save_path": "D:/Games/DarkSoulsIII/saves"},
        ]
        
        self.populate_backup_table()
        
        # ===========================================================================
        # Tab 2: Restore
        # ===========================================================================
        restore_tab = QWidget()
        restore_tab_layout = QVBoxLayout()
        restore_tab.setLayout(restore_tab_layout)
        restore_tab_layout.addWidget(QLabel("Restore settings and configuration here."))
        self.tabWidget.addTab(restore_tab, self.setCustomIcon(self.restoreIcon_path), tr("Restore"))
    
    def populate_backup_table(self):
        self.backup_table.setRowCount(len(self.test_data))
        icon_size = QSize(20, 20)

        for row_index, game in enumerate(self.test_data):
            # Checkbox for selection
            chk_box_widget = QWidget()
            chk_box_layout = QHBoxLayout(chk_box_widget)
            chk_box_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            chk_box = QCheckBox()
            chk_box.setChecked(game["selected"])
            if not game["backupable"]:
                chk_box.setDisabled(True)
            chk_box.stateChanged.connect(lambda state, x=row_index: self.update_selection(x, state))
            chk_box_layout.addWidget(chk_box)
            self.backup_table.setCellWidget(row_index, 0, chk_box_widget)
            
            # Backupable status
            backup_icon = QLabel()
            icon_path = resource_path("assets/true.png") if game["backupable"] else resource_path("assets/false.png")
            pixmap = QPixmap(icon_path)
            pixmap = pixmap.scaled(icon_size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            backup_icon.setPixmap(pixmap)
            backup_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.backup_table.setCellWidget(row_index, 1, backup_icon)
            
            # Game name
            self.backup_table.setItem(row_index, 2, QTableWidgetItem(game["game_name"]))
            
            # Save path
            self.backup_table.setItem(row_index, 3, QTableWidgetItem(game["save_path"]))

    def update_selection(self, index, isChecked):
        # Handle updating the "Select All" checkbox based on individual checkbox states
        allChecked = all(self.backup_table.cellWidget(row, 0).layout().itemAt(0).widget().isChecked() for row in range(self.backup_table.rowCount()))
        anyChecked = any(self.backup_table.cellWidget(row, 0).layout().itemAt(0).widget().isChecked() for row in range(self.backup_table.rowCount()))

        if allChecked:
            self.backup_table_header.checkbox.setCheckState(Qt.CheckState.Checked)
        elif not anyChecked:
            self.backup_table_header.checkbox.setCheckState(Qt.CheckState.Unchecked)
        else:
            self.backup_table_header.checkbox.setCheckState(Qt.CheckState.PartiallyChecked)

    # ===========================================================================
    # Menu functions
    # ===========================================================================
    def open_settings(self):
        if self.settings_window is not None and self.settings_window.isVisible():
            self.settings_window.raise_()
            self.settings_window.activateWindow()
        else:
            self.settings_window = SettingsDialog(self)
            self.settings_window.show()
    
    def open_about(self):
        if self.about_window is not None and self.about_window.isVisible():
            self.about_window.raise_()
            self.about_window.activateWindow()
        else:
            self.about_window = AboutDialog(self)
            self.about_window.show()


    # ===========================================================================
    # event functions
    # ===========================================================================
    def on_entry_click(self, event):
        if self.gsmPathText.get() == self.gsmPathTextPrompt:
            self.gsmPathText.delete(0, tk.END)
            self.gsmPathText.insert(0, "")
            self.gsmPathText.config(foreground="white")

    def on_focusout(self, event):
        if self.gsmPathText.get() == "":
            self.gsmPathText.insert(0, self.gsmPathTextPrompt)
            self.gsmPathText.config(foreground="grey")

    def on_entry_change(self, entry_widget):
        entry_widget.config(foreground="white")

    def create_migration_thread(self):
        migration_thread = threading.Thread(target=self.change_path)
        migration_thread.start()

    def create_export_thread(self):
        export_thread = threading.Thread(target=self.export)
        export_thread.start()

    def create_backup_thread(self):
        backup_thread = threading.Thread(target=self.backup)
        backup_thread.start()

    def create_restore_thread_1(self):
        restore_thread = threading.Thread(target=self.restoreFromMachine)
        restore_thread.start()

    def create_restore_thread_2(self):
        restore_thread = threading.Thread(target=self.restoreFromGSM)
        restore_thread.start()

    # ===========================================================================
    # core helper functions
    # ===========================================================================
    def enable_widgets(self):
        self.backUpButton["state"] = "enabled"
        self.exportButton["state"] = "enabled"
        self.backupDialogButton["state"] = "enabled"
        self.restoreButton1["state"] = "enabled"
        self.restoreButton2["state"] = "enabled"
        self.gsmPathText["state"] = "enabled"
        self.fileDialogButton["state"] = "enabled"

    def disable_widgets(self):
        self.backUpButton["state"] = "disabled"
        self.exportButton["state"] = "disabled"
        self.backupDialogButton["state"] = "disabled"
        self.restoreButton1["state"] = "disabled"
        self.restoreButton2["state"] = "disabled"
        self.gsmPathText["state"] = "disabled"
        self.fileDialogButton["state"] = "disabled"

    def delete_all_text(self):
        self.backupProgressText.config(state="normal")
        self.backupProgressText.delete(1.0, tk.END)
        self.backupProgressText.config(state="disabled")
    
    def setCustomIcon(self, iconPath):
        with open(iconPath, 'r') as file:
            svg_content = file.read()

        if settings["theme"] == "black":
            svg_content = svg_content.replace(
                '<path ', '<path fill="#FFFFFF" ', 1)
        elif settings["theme"] == "white":
            pass

        byte_array = QByteArray(svg_content.encode('utf-8'))
        pixmap = QPixmap()
        pixmap.loadFromData(byte_array, format='SVG')
        return QIcon(pixmap)

    def special_options_check(self, source):
        gdBackupPath = os.path.join(source, "Geometry Dash")
        if os.path.exists(gdBackupPath):
            for item in os.listdir(gdBackupPath):
                item_path = os.path.join(gdBackupPath, item)
                if os.path.isfile(item_path) and not item_path.endswith(".dat"):
                    self.gameSaveDirectory["Geometry Dash"] = self.gdMusic
                    break

    def transGame(self, gameName):
        gameName = gameName.replace("_", ": ").replace(
            "^", "?").rstrip(self.duplicate_symbol)

        if settings["language"] == "zh_CN" or settings["language"] == "zh_TW":
            with open(resource_path("game_names.json"), "r", encoding="utf-8") as file:
                translations = json.load(file)

            for game in translations["games"]:
                if game["en_US"] == gameName:
                    return game["zh_CN"]

        return gameName

    def insert_text(self, text):
        if self.duplicate_symbol in text:
            return
        self.backupProgressText.config(state="normal")

        textGameName = text.strip().replace(
            tr("Backed up "), "").replace(tr("Restored "), "")
        text = text.replace(textGameName, self.transGame(textGameName))

        self.backupProgressText.insert(tk.END, text)
        self.backupProgressText.see("end")
        self.backupProgressText.config(state="disabled")

    def open_file(self):
        gsm_file = filedialog.askopenfilename(
            title=self.gsmPathTextPrompt,
            filetypes=(("gsm files", "*.gsm"),))
        if gsm_file:
            self.gsmPathText.delete(0, "end")
            self.gsmPathText.insert(0, gsm_file)
            self.gsmPathText.config(foreground="white")

    # check if there are any files under all subdirectories of a path
    def is_directory_empty(self, path):
        return not any(files for _, _, files in os.walk(path))

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
                        os.chmod(full_path, stat.S_IWRITE)
                        os.remove(full_path)
                    else:
                        shutil.rmtree(full_path, onerror=lambda func, path, exc_info: (
                            os.chmod(path, stat.S_IWRITE),
                            func(path)
                        ))
        else:
            if os.path.isfile(destination):
                os.chmod(destination, stat.S_IWRITE)
                os.remove(destination)
            elif os.path.isdir(destination):
                shutil.rmtree(destination, onerror=lambda func, path, exc_info: (
                    os.chmod(path, stat.S_IWRITE),
                    func(path)
                ))

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
                tr("Error"), tr("Filed to delete temporary files: ") + str(e))

    # ===========================================================================
    # core functions
    # ===========================================================================
    def closeEvent(self, event):
        super().closeEvent(event)
        os._exit(1)

    def init_settings(self):
        if settings["theme"] == "black":
            style = style_sheet.black
        elif settings["theme"] == "white":
            style = style_sheet.white

        style = style.format(
            drop_down_arrow=self.dropDownArrow_path,
            scroll_bar_top=self.upArrow_path,
            scroll_bar_bottom=self.downArrow_path,
            scroll_bar_left=self.leftArrow_path,
            scroll_bar_right=self.rightArrow_path,
        )
        self.setStyleSheet(style)

    def change_path(self, event=None):
        self.disable_widgets()
        self.delete_all_text()

        folder = filedialog.askdirectory(title=tr("Change backup path"))
        if folder:
            self.insert_text(tr("Migrating existing backups...\n"))
            try:
                dst = os.path.join(folder, "GSM Backups")

                # Can't change to the same path
                if self.backupPathText.get() == os.path.normpath(dst):
                    messagebox.showerror(
                        tr("Error"), tr("Please choose a new path."))
                    self.insert_text(tr("Backup migration aborted!\n"))
                    self.enable_widgets()
                    return

                if os.path.exists(dst):
                    command = messagebox.askyesno(
                        tr("Confirmation"), tr("Backup already exists, would you like to override?"))
                    if command:
                        shutil.rmtree(dst)
                        shutil.copytree(self.gsmBackupPath, dst)
                    else:
                        self.insert_text(tr("Backup migration aborted!\n"))
                        self.enable_widgets()
                        return
                else:
                    shutil.copytree(self.gsmBackupPath, dst)
            except Exception as e:
                messagebox.showerror(tr("Error"), tr("An error occurred, backup migration failed: ") + str(e))
                self.insert_text(tr("Backup migration aborted!\n"))
                self.enable_widgets()
                return

            try:
                shutil.rmtree(self.gsmBackupPath)
            except Exception as e:
                messagebox.showinfo(tr("Manual Cleanup"), tr("Couldn't remove backup from the original path, you can remove them manually.") + f"\n\n{str(e)}")
                if os.path.exists(self.gsmBackupPath):
                    os.startfile(self.gsmBackupPath)

            self.gsmBackupPath = dst
            settings["gsmBackupPath"] = self.gsmBackupPath
            apply_settings(settings)
            self.insert_text(tr("Migration complete!\n"))
            self.backupPathText.set(os.path.normpath(dst))
        else:
            self.insert_text(tr("New backup path not specified!\n"))

        self.enable_widgets()

    def check_newer_save(self, game, source, destination, isCustom=False):
        if not isCustom:
            # special check for games share the same installation path, make sure the shared installation path exists
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
            game_display = self.transGame(game.rstrip(self.duplicate_symbol))

            message_template = tr("Save conflict detected for {game_display}:\n"
                                 "Save data on machine (last modified on {destination_mtime})\n"
                                 "is newer than backup (last modified on {source_mtime}).\n\n"
                                 "Do you want to overwrite local save data with backup?")
            formatted_message = message_template.format(
                game_display=game_display,
                destination_mtime=destination_mtime.strftime('%Y-%m-%d %H:%M'),
                source_mtime=source_mtime.strftime('%Y-%m-%d %H:%M')
            )

            command = messagebox.askyesno(tr("Confirmation"), formatted_message)
            if not command:
                return False

        # Default case: overwrite the destination
        self.remove_destination(source, destination)
        return True

    def backup_custom(self):
        custom_path = os.path.join(self.gsmBackupPath, "0 Custom")

        if os.path.exists(self.customGameJson):
            with open(self.customGameJson, "r") as file:
                custom_games = json.load(file).get("customGames", [])

                if custom_games:
                    self.insert_text(tr("\nBelow are custom games:\n"))
                    for game in custom_games:
                        source = os.path.normpath(game["path"]).format(usr=self.user_name)
                        destination = os.path.join(custom_path, game["name"])
                        if os.path.exists(source):

                            try:
                                if game["type"] == "folder":
                                    if not self.is_directory_empty(source):
                                        shutil.copytree(source, destination)
                                        self.insert_text(
                                            tr("Backed up ") + game["name"] + "\n")
                                    else:
                                        self.insert_text(
                                            tr("Back up path is empty: ") + game["name"] + "\n")

                                elif game["type"] == "file":
                                    os.makedirs(destination, exist_ok=True)
                                    shutil.copy(source, os.path.join(
                                        destination, os.path.basename(source)))
                                    shutil.copystat(source, os.path.join(
                                        destination, os.path.basename(source)))
                                    self.insert_text(
                                        tr("Backed up ") + game["name"] + "\n")

                            except Exception as e:
                                self.insert_text(
                                    tr("Backup failed: ") + game["name"] + "\n")
                                error_text = tr("An error occurred while backing up {game_name}: ").format(
                                    game_name=game["name"])
                                messagebox.showerror(
                                    tr("Error"), error_text + str(e))
                        else:
                            self.insert_text(
                                tr("Back up path is invalid: ") + game["name"] + "\n")

    def restore_custom(self, source):
        custom_path = os.path.join(source, "0 Custom")
        custom_json = os.path.join(custom_path, "custom_games.json")

        if os.path.exists(custom_path):
            backups_present = any(os.path.isdir(os.path.join(
                custom_path, item)) for item in os.listdir(custom_path))
            if backups_present:
                self.insert_text(tr("\nBelow are custom games:\n"))

            if os.path.exists(custom_json):
                with open(custom_json, "r") as file:
                    custom_games = json.load(file).get("customGames", [])

            for game_name in os.listdir(custom_path):
                matching_game = next(
                    (game for game in custom_games if game["name"] == game_name), None)

                if matching_game:
                    source = os.path.join(custom_path, game_name)
                    destination = os.path.normpath(matching_game["path"]).format(usr=self.user_name)

                    try:
                        if not self.is_directory_empty(source) and self.check_newer_save(game_name, source, destination, True):

                            if matching_game["type"] == "folder":
                                shutil.copytree(source, destination,
                                                dirs_exist_ok=True)

                            elif matching_game["type"] == "file":
                                source_file = next(os.path.join(
                                    source, f) for f in os.listdir(source))
                                os.makedirs(os.path.dirname(
                                    destination), exist_ok=True)
                                shutil.copy(source_file, destination)
                                shutil.copystat(source_file, destination)

                            self.insert_text(tr("Restored ") + game_name + "\n")

                    except Exception as e:
                        self.insert_text(
                            tr("Restore failed: ") + game_name + "\n")
                        error_text = tr("An error occurred while restoring {game_name}: ").format(
                            game_name=game_name)
                        messagebox.showerror(
                            tr("Error"), error_text + str(e))
                else:
                    if game_name != "custom_games.json":
                        self.insert_text(
                            tr("No entry found in custom game list: ") + game_name + "\n")

    def export(self):
        self.disable_widgets()
        self.delete_all_text()

        if not os.path.exists(self.gsmBackupPath) or self.is_directory_empty(self.gsmBackupPath):
            messagebox.showerror(tr("Error"), tr("No backup found!"))
        else:
            export_path = filedialog.askdirectory(
                title=tr("Please select a directory to export your file."))
            if export_path == "":
                self.insert_text(tr("Export path not specified!"))
                self.enable_widgets()
                return
            now = datetime.datetime.now()
            date_str = now.strftime("%Y-%m-%d")
            gsmExported = os.path.join(export_path, f"GSMbackup_{date_str}")
            if os.path.exists(f"{gsmExported}.gsm"):
                confirmation_message_template = tr("A file named {file_name} already exists. Do you want to overwrite it?")
                formatted_confirmation_message = confirmation_message_template.format(
                    file_name=os.path.basename(gsmExported) + ".gsm"
                )
                confirmation = messagebox.askyesno(
                    tr("Confirmation"), formatted_confirmation_message)
                if confirmation:
                    pass
                else:
                    self.insert_text(tr("Export aborted!"))
                    self.enable_widgets()
                    return
            self.insert_text(tr("Export in progress...\n"))
            shutil.make_archive(gsmExported, "zip", self.gsmBackupPath)
            os.replace(f"{gsmExported}.zip", f"{gsmExported}.gsm")

            self.insert_text(tr("Export successful!"))

        self.enable_widgets()

    def backup(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True
        command = None
        if os.path.exists(self.gsmBackupPath):
            command = messagebox.askyesno(
                tr("Confirmation"), tr("Backup already exists, would you like to override?"))
            if command:
                try:
                    custom_json = os.path.join(
                        self.gsmBackupPath, "0 Custom", "custom_games.json")
                    moved_json = os.path.join(
                        setting_path, "custom_games.json")
                    isMoved = False

                    if os.path.exists(custom_json):
                        shutil.move(custom_json, moved_json)
                        isMoved = True

                    shutil.rmtree(self.gsmBackupPath, onerror=lambda func, path, exc_info: (
                        os.chmod(path, stat.S_IWRITE),
                        func(path)
                    ))
                except Exception as e:
                    messagebox.showerror(tr("Error"), tr("An error occurred while cleaning previous backup: ") + str(e))
                    self.insert_text(tr("Backup aborted!\n"))
                    START = False

                if isMoved:
                    os.makedirs(os.path.join(self.gsmBackupPath,
                                "0 Custom"), exist_ok=True)
                    shutil.move(moved_json, custom_json)
            else:
                self.insert_text(tr("Backup aborted!\n"))
                START = False

        if START:
            for game, (saveLocation, saveType, directory) in self.gameSaveDirectory.items():
                source = directory
                source_folders = []
                folderID = None
                destination = os.path.join(self.gsmBackupPath, game)

                if game in self.minecraft and not settings["backupMC"]:
                    continue

                try:
                    if saveLocation == "Steam" or saveLocation == "Ubisoft":
                        if saveLocation == "Steam":
                            folderID = self.steamUserID
                        elif saveLocation == "Ubisoft":
                            folderID = self.ubisoftUserID

                        if folderID:
                            for id in folderID:
                                idSource = directory.replace("<user-id>", id)
                                if os.path.exists(idSource) and not self.is_directory_empty(idSource):
                                    source_folders.append((id, idSource))
                        else:
                            continue

                        if source_folders:
                            for (id, source) in source_folders:
                                shutil.copytree(
                                    source, os.path.join(destination, id))
                            self.insert_text(tr("Backed up ") + game + "\n")

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

                        self.insert_text(tr("Backed up ") + game + "\n")

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
                            backup_file = os.path.join(
                                destination, f"{game}.reg")
                            command = ["reg", "export",
                                       directory, backup_file, "/y"]
                            try:
                                process = subprocess.run(
                                    command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                                process.check_returncode()
                            except Exception:
                                self.insert_text(
                                    tr("Backup failed: ") + self.transGame(game) + "\n")
                                error_text = tr("An error occurred while backing up {game_name}: ").format(
                                    game_name=self.transGame(game))
                                messagebox.showerror(
                                    tr("Error"), error_text + process.stderr)
                                return
                            self.insert_text(tr("Backed up ") + game + "\n")

                except Exception as e:
                    self.insert_text(tr("Backup failed: ") +
                                     self.transGame(game) + "\n")
                    error_text = tr("An error occurred while backing up {game_name}: ").format(
                        game_name=self.transGame(game))
                    messagebox.showerror(tr("Error"), error_text + str(e))

            self.backup_custom()
            self.insert_text(tr("Back up completed!"))

        self.enable_widgets()

    def restore(self, game, saveLocation, source, destination):
        try:
            if saveLocation == "Steam" or saveLocation == "Ubisoft":
                folderID = os.listdir(source)

                for id in folderID:
                    idDestination = destination.replace("<user-id>", id)
                    idSource = os.path.join(source, id)
                    if self.check_newer_save(game, idSource, idDestination):
                        shutil.copytree(idSource, idDestination,
                                        dirs_exist_ok=True)
                self.insert_text(tr("Restored ") + game + "\n")

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

                        self.insert_text(tr("Restored ") + game + "\n")
                    else:
                        self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")

                elif self.check_newer_save(game, source, destination):
                    if self.gameSaveDirectory[game][1] == "File":
                        source_file = next(os.path.join(source, f)
                                           for f in os.listdir(source))
                        os.makedirs(os.path.dirname(
                            destination), exist_ok=True)
                        shutil.copy(source_file, destination)
                        shutil.copystat(source_file, destination)
                    else:
                        shutil.copytree(
                            source, destination, dirs_exist_ok=True)

                    self.insert_text(tr("Restored ") + game + "\n")
                else:
                    self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")

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
                        return process.stderr

                backup_file = os.path.join(source, f"{game}.reg")
                if os.path.exists(backup_file):
                    command = ["reg", "import", backup_file]
                    try:
                        process = subprocess.run(
                            command, creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.PIPE, text=True)
                        process.check_returncode()
                    except Exception:
                        return process.stderr

                    self.insert_text(tr("Restored ") + game + "\n")

        except Exception as e:
            return str(e)

        return 0

    def restoreFromMachine(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True

        if not os.path.exists(self.gsmBackupPath) or self.is_directory_empty(self.gsmBackupPath):
            messagebox.showerror(tr("Error"), tr("No backup found!"))
            START = False

        if START:
            self.special_options_check(self.gsmBackupPath)
            all_games = os.listdir(self.gsmBackupPath)
            for game in all_games:
                if game in self.gameSaveDirectory:
                    path = self.systemPath[self.gameSaveDirectory[game][0]]
                    if path == None:
                        self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")
                        continue
                else:
                    continue
                
                saveLocation = self.gameSaveDirectory[game][0]
                source = os.path.join(self.gsmBackupPath, game)
                destination = self.gameSaveDirectory[game][2]

                if saveLocation != "Registry":
                    if not isinstance(destination, list) and (not destination or not os.path.isabs(destination)):
                        self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")
                        continue

                error = self.restore(game, saveLocation, source, destination)
                if error:
                    self.insert_text(tr("Restore failed: ") +
                                     self.transGame(game) + "\n")
                    error_text = tr("An error occurred while restoring {game_name}: ").format(
                        game_name=self.transGame(game))
                    messagebox.showerror(tr("Error"), error_text + error)

            self.restore_custom(self.gsmBackupPath)
            self.insert_text(tr("Restore completed!"))

        self.enable_widgets()

    def restoreFromGSM(self):
        self.disable_widgets()
        self.delete_all_text()

        START = True

        gsmPath = self.gsmPathText.get()
        if not os.path.exists(gsmPath):
            messagebox.showerror(tr("Error"), tr("Invalid file path!"))
            START = False

        if START:
            temp_dir = os.path.join(
                tempfile.gettempdir(), "GameSaveManagerTemp")
            self.special_options_check(temp_dir)

            if os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except Exception:
                    self.delete_temp_on_startup(temp_dir)
                    self.insert_text(tr("An error occurred."))
                    messagebox.showerror(
                        tr("Error"), tr("Unable to clear temporary files from last session, please restart your computer."))
                    self.enable_widgets()
                    return
            os.makedirs(temp_dir, exist_ok=True)
            zipGSM = os.path.join(
                temp_dir, f"{os.path.splitext(os.path.basename(gsmPath))[0]}.zip")
            self.insert_text(tr("Decompressing file...\n"))

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
                messagebox.showerror(tr("Error"), tr("An error occurred while extracting file: ") + str(e))
                self.enable_widgets()
                return
            os.remove(zipGSM)

            all_games = os.listdir(temp_dir)
            for game in all_games:
                if game in self.gameSaveDirectory:
                    path = self.systemPath[self.gameSaveDirectory[game][0]]
                    if path == None:
                        self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")
                        continue
                else:
                    continue
                
                saveLocation = self.gameSaveDirectory[game][0]
                source = os.path.join(temp_dir, game)
                destination = self.gameSaveDirectory[game][2]

                if saveLocation != "Registry":
                    if not isinstance(destination, list) and (not destination or not os.path.isabs(destination)):
                        self.insert_text(tr("Restore failed: ") + self.transGame(game) + "\n")
                        continue

                error = self.restore(game, saveLocation, source, destination)
                if error:
                    self.insert_text(tr("Restore failed: ") +
                                     self.transGame(game) + "\n")
                    error_text = tr("An error occurred while restoring {game_name}: ").format(
                        game_name=self.transGame(game))
                    messagebox.showerror(tr("Error"), error_text + error)

            self.restore_custom(temp_dir)

            try:
                shutil.rmtree(temp_dir)
            except Exception:
                self.delete_temp_on_startup(temp_dir)

            self.insert_text(tr("Restore completed!"))

        self.enable_widgets()


if __name__ == "__main__":
    app = QApplication(sys.argv)

    # Language setting
    font_config = {
        "en_US": resource_path("assets/NotoSans-Regular.ttf"),
        "zh_CN": resource_path("assets/NotoSansSC-Regular.ttf"),
        "zh_TW": resource_path("assets/NotoSansTC-Regular.ttf"),
        "ja_JP": resource_path("assets/NotoSansJP-Regular.ttf"),
    }
    fontId = QFontDatabase.addApplicationFont(
        font_config[settings["language"]])
    fontFamilies = QFontDatabase.applicationFontFamilies(fontId)
    customFont = QFont(fontFamilies[0], 10)
    app.setFont(customFont)

    mainWin = GameSaveManager()
    mainWin.show()

    # Center window
    qr = mainWin.frameGeometry()
    cp = mainWin.screen().availableGeometry().center()
    qr.moveCenter(cp)
    mainWin.move(qr.topLeft())

    sys.exit(app.exec())
