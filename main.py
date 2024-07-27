import datetime
import os
import shutil
import subprocess
import sys
import tempfile
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import zipfile

from PyQt6.QtCore import Qt, QSize, QByteArray
from PyQt6.QtGui import QAction, QColor, QFont, QFontDatabase, QIcon, QPixmap
from PyQt6.QtWidgets import QApplication, QTableWidget, QTableWidgetItem, QHeaderView, QHBoxLayout, QTabWidget, QLabel, QListWidgetItem, QMainWindow, QMessageBox, QStatusBar, QVBoxLayout, QWidget, QListWidget, QInputDialog
from tendo import singleton

from database import *
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
        self.appVersion = "2.0.0"
        self.githubLink = "https://github.com/dyang886/Game-Save-Manager"
        self.updateLink = "https://api.github.com/repos/dyang886/Game-Save-Manager/releases/latest"
        self.bilibiliLink = "https://space.bilibili.com/256673766"

        # Variable management
        self.gsmPathTextPrompt = tr("Select a .gsm file for restore")

        self.database = DataBase()
        self.currentlyMigrating = False
        self.currentlyBackuping = False
        self.currentlyRestoring = False
        self.currentlyExporting = False

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
        menu = self.menuBar()
        optionMenu = menu.addMenu(tr("Options"))

        settingsAction = QAction(tr("Settings"), self)
        settingsAction.triggered.connect(self.open_settings)
        optionMenu.addAction(settingsAction)

        openDirectoryAction = QAction(tr("Open Backup Path"), self)
        openDirectoryAction.triggered.connect(self.open_backup_directory)
        optionMenu.addAction(openDirectoryAction)

        aboutAction = QAction(tr("About"), self)
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
        self.tabWidget.addTab(backup_tab, self.setCustomIcon(backupIcon_path), tr("Backup"))

        backup_button_layout = QHBoxLayout()
        backup_button_layout.setSpacing(6)
        backup_tab_layout.addLayout(backup_button_layout)

        self.backup_button = CustomButton(tr("Backup Selected"))
        self.backup_button.clicked.connect(self.backup)
        backup_button_layout.addWidget(self.backup_button)

        self.add_custom_button = CustomButton(tr("Add Custom Games"))
        self.add_custom_button.clicked.connect(self.add_custom_games)
        backup_button_layout.addWidget(self.add_custom_button)

        self.refresh_backup_button = CustomButton(tr("Refresh Backup Table"))
        self.refresh_backup_button.clicked.connect(self.update_backup_table)
        backup_button_layout.addWidget(self.refresh_backup_button)

        # Backup table
        self.backup_table = QTableWidget(0, 4)  # Starts with zero rows and four columns
        self.backup_table.setHorizontalHeaderLabels(['', tr("Backupable?"), tr("Game Name"), tr("Latest Backup")])
        self.backup_table_header = CheckableHeader(Qt.Orientation.Horizontal, self.backup_table)
        self.backup_table.setHorizontalHeader(self.backup_table_header)
        self.backup_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.backup_table.horizontalHeader().setStretchLastSection(True)
        self.backup_table.verticalHeader().setMinimumSectionSize(35)
        self.backup_table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        self.backup_table.verticalHeader().setSectionsClickable(False)
        backup_tab_layout.addWidget(self.backup_table)
        
        # ===========================================================================
        # Tab 2: Restore
        # ===========================================================================
        restore_tab = QWidget()
        restore_tab_layout = QVBoxLayout()
        restore_tab_layout.setSpacing(10)
        restore_tab.setLayout(restore_tab_layout)
        self.tabWidget.addTab(restore_tab, self.setCustomIcon(restoreIcon_path), tr("Restore"))

        restore_button_layout = QHBoxLayout()
        restore_button_layout.setSpacing(6)
        restore_tab_layout.addLayout(restore_button_layout)

        self.restore_button = CustomButton(tr("Restore Selected"))
        self.restore_button.clicked.connect(self.restore)
        restore_button_layout.addWidget(self.restore_button)

        self.export_button = CustomButton(tr("Export Selected"))
        self.export_button.clicked.connect(self.export)
        restore_button_layout.addWidget(self.export_button)

        self.refresh_restore_button = CustomButton(tr("Refresh Restore Table"))
        self.refresh_restore_button.clicked.connect(self.update_restore_table)
        restore_button_layout.addWidget(self.refresh_restore_button)

        # Restore table
        self.restore_table = QTableWidget(0, 4)
        self.restore_table.setHorizontalHeaderLabels(['', tr("Restorable?"), tr("Game Name"), tr("Latest Backup")])
        self.restore_table_header = CheckableHeader(Qt.Orientation.Horizontal, self.restore_table)
        self.restore_table.setHorizontalHeader(self.restore_table_header)
        self.restore_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.restore_table.horizontalHeader().setStretchLastSection(True)
        self.restore_table.verticalHeader().setMinimumSectionSize(35)
        self.restore_table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Fixed)
        self.restore_table.verticalHeader().setSectionsClickable(False)
        restore_tab_layout.addWidget(self.restore_table)
        
        self.update_all_tables()

        # ===========================================================================
        # Tab 3: Progress prompt
        # ===========================================================================
        prompt_tab = QWidget()
        prompt_tab_layout = QVBoxLayout()
        prompt_tab.setLayout(prompt_tab_layout)
        self.prompt = QListWidget()
        prompt_tab_layout.addWidget(self.prompt)
        self.tabWidget.addTab(prompt_tab, self.setCustomIcon(promptIcon_path), tr("Progress Prompt"))

    # ===========================================================================
    # Core functions
    # ===========================================================================
    def closeEvent(self, event):
        super().closeEvent(event)
        os._exit(0)

    def init_settings(self):
        if settings["theme"] == "black":
            style = style_sheet.black
        elif settings["theme"] == "white":
            style = style_sheet.white

        style = style.format(
            drop_down_arrow=dropDownArrow_path,
            spin_box_up=spinboxUpArrow_path,
            spin_box_down=spinboxDownArrow_path,
            scroll_bar_top=upArrow_path,
            scroll_bar_bottom=downArrow_path,
            scroll_bar_left=leftArrow_path,
            scroll_bar_right=rightArrow_path,
        )
        self.setStyleSheet(style)
    
    def findWidgetInStatusBar(self, widgetName):
        for widget in self.statusbar.children():
            if widget.objectName() == widgetName:
                return widget
        return None
    
    def on_status_load(self, widgetName, message):
        statusWidget = StatusMessageWidget(widgetName, message)
        self.statusbar.addWidget(statusWidget)

    def on_status_update(self, widgetName, newMessage, state):
        target = self.findWidgetInStatusBar(widgetName)
        target.update_message(newMessage, state)

    def update_backup_table(self):
        self.database.updateDatabase()
        self.populate_backup_table()
    
    def update_restore_table(self):
        self.database.updateDatabase()
        self.populate_restore_table()
    
    def update_all_tables(self):
        self.database.updateDatabase()
        self.populate_backup_table()
        self.populate_restore_table()
    
    def disable_all_widgets(self):
        self.backup_button.setDisabled(True)
        self.refresh_backup_button.setDisabled(True)
        self.add_custom_button.setDisabled(True)
        self.restore_button.setDisabled(True)
        self.refresh_restore_button.setDisabled(True)
        self.export_button.setDisabled(True)
    
    def enable_all_widgets(self):
        self.backup_button.setEnabled(True)
        self.refresh_backup_button.setEnabled(True)
        self.add_custom_button.setEnabled(True)
        self.restore_button.setEnabled(True)
        self.refresh_restore_button.setEnabled(True)
        self.export_button.setEnabled(True)
    
    def on_message(self, message, type=None):
        item = QListWidgetItem(message)

        if type == "clear":
            self.prompt.clear()
        elif type == "success":
            # item.setForeground(QColor('green'))
            item.setBackground(QColor(0, 255, 0, 20))
            self.prompt.addItem(item)
        elif type == "failure":
            # item.setForeground(QColor('red'))
            item.setBackground(QColor(255, 0, 0, 20))
            self.prompt.addItem(item)
        else:
            self.prompt.addItem(item)
        
        self.prompt.scrollToBottom()
    
    def on_message_box(self, type, title, text):
        if type == "info":
            QMessageBox.information(self, title, text)
        elif type == "error":
            QMessageBox.critical(self, title, text)
        elif type == "question":
            msg_box = QMessageBox(
                QMessageBox.Icon.Question,
                title,
                text,
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                self
            )
            
            yes_button = msg_box.button(QMessageBox.StandardButton.Yes)
            yes_button.setText(tr("Yes"))
            no_button = msg_box.button(QMessageBox.StandardButton.No)
            no_button.setText(tr("No"))
            reply = msg_box.exec()

            if reply == QMessageBox.StandardButton.Yes:
                self.restore_thread.handle_message_box_response(True)
            else:
                self.restore_thread.handle_message_box_response(False)
    
    def setCustomIcon(self, iconPath):
        with open(iconPath, 'r') as file:
            svg_content = file.read()

        if settings["theme"] == "black":
            svg_content = svg_content.replace('<path ', '<path fill="#FFFFFF" ', 1)
        elif settings["theme"] == "white":
            svg_content = svg_content.replace('<path ', '<path fill="#000000" ', 1)

        byte_array = QByteArray(svg_content.encode('utf-8'))
        pixmap = QPixmap()
        pixmap.loadFromData(byte_array, format='SVG')
        return QIcon(pixmap)
    
    def update_selection(self, table):
        # Handle updating the "Select All" checkbox based on individual checkbox states
        allChecked = all(table.cellWidget(row, 0).layout().itemAt(0).widget().isChecked() for row in range(table.rowCount()))
        anyChecked = any(table.cellWidget(row, 0).layout().itemAt(0).widget().isChecked() for row in range(table.rowCount()))

        if allChecked:
            table.horizontalHeader().checkbox.setCheckState(Qt.CheckState.Checked)
        elif not anyChecked:
            table.horizontalHeader().checkbox.setCheckState(Qt.CheckState.Unchecked)
        else:
            table.horizontalHeader().checkbox.setCheckState(Qt.CheckState.PartiallyChecked)

    def populate_backup_table(self):
        game_list = sorted(self.database.game_list, key=lambda game: sort_game_name(game, "backup"))
        self.database.backup_dict = {i: game for i, game in enumerate(game_list)}
        self.backup_table_header.checkbox.setCheckState(Qt.CheckState.Unchecked)
        self.backup_table.setRowCount(len(game_list))
        icon_size = QSize(20, 20)

        for row_index, game in enumerate(game_list):
            # Checkbox for selection
            chk_box_widget = QWidget()
            chk_box_layout = QHBoxLayout(chk_box_widget)
            chk_box_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            chk_box = QCheckBox()
            chk_box.setChecked(False)
            if not game.backupable:
                chk_box.setDisabled(True)
            chk_box.stateChanged.connect(lambda state: self.update_selection(self.backup_table))
            chk_box_layout.addWidget(chk_box)
            self.backup_table.setCellWidget(row_index, 0, chk_box_widget)
            
            # Backupable status
            backup_icon = QLabel()
            icon_path = resource_path("assets/true.png") if game.backupable else resource_path("assets/false.png")
            pixmap = QPixmap(icon_path)
            pixmap = pixmap.scaled(icon_size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            backup_icon.setPixmap(pixmap)
            backup_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.backup_table.setCellWidget(row_index, 1, backup_icon)
            
            # Game name
            game_name_item = QTableWidgetItem(get_game_name(game))
            game_name_item.setFlags(game_name_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.backup_table.setItem(row_index, 2, game_name_item)
            
            # Last backup date
            root_backup_path = os.path.join(settings["gsmBackupPath"], sanitize_game_name(game.name_en))
            if os.path.exists(root_backup_path):
                stored_backups = sorted([d for d in os.listdir(root_backup_path) if os.path.isdir(os.path.join(root_backup_path, d))])
                latest_backup = stored_backups[-1]
                timestamp = datetime.strptime(latest_backup, '%Y-%m-%d_%H-%M')
                last_backup_item = QTableWidgetItem(timestamp.strftime('%Y/%m/%d %H:%M'))
            else:
                last_backup_item = QTableWidgetItem(tr("No backups"))
            last_backup_item.setFlags(last_backup_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.backup_table.setItem(row_index, 3, last_backup_item)
    
    def populate_restore_table(self):
        game_list = sorted(self.database.game_list, key=lambda game: sort_game_name(game, "restore"))
        self.database.restore_dict = {i: game for i, game in enumerate(game_list)}
        self.restore_table_header.checkbox.setCheckState(Qt.CheckState.Unchecked)
        self.restore_table.setRowCount(len(game_list))
        icon_size = QSize(20, 20)

        for row_index, game in enumerate(game_list):
            # Checkbox for selection
            chk_box_widget = QWidget()
            chk_box_layout = QHBoxLayout(chk_box_widget)
            chk_box_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            chk_box = QCheckBox()
            chk_box.setChecked(False)
            if not game.restorable:
                chk_box.setDisabled(True)
            chk_box.stateChanged.connect(lambda state: self.update_selection(self.restore_table))
            chk_box_layout.addWidget(chk_box)
            self.restore_table.setCellWidget(row_index, 0, chk_box_widget)
            
            # Restorable status
            backup_icon = QLabel()
            icon_path = resource_path("assets/true.png") if game.restorable else resource_path("assets/false.png")
            pixmap = QPixmap(icon_path)
            pixmap = pixmap.scaled(icon_size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            backup_icon.setPixmap(pixmap)
            backup_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.restore_table.setCellWidget(row_index, 1, backup_icon)
            
            # Game name
            game_name_item = QTableWidgetItem(get_game_name(game))
            game_name_item.setFlags(game_name_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.restore_table.setItem(row_index, 2, game_name_item)
            
            # Last backup date
            root_backup_path = os.path.join(settings["gsmBackupPath"], sanitize_game_name(game.name_en))
            if os.path.exists(root_backup_path):
                stored_backups = sorted([d for d in os.listdir(root_backup_path) if os.path.isdir(os.path.join(root_backup_path, d))])
                latest_backup = stored_backups[-1]
                timestamp = datetime.strptime(latest_backup, '%Y-%m-%d_%H-%M')
                last_backup_item = QTableWidgetItem(timestamp.strftime('%Y/%m/%d %H:%M'))
            else:
                last_backup_item = QTableWidgetItem(tr("No backups"))
            last_backup_item.setFlags(last_backup_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.restore_table.setItem(row_index, 3, last_backup_item)

    def backup(self):
        if self.currentlyMigrating:
            self.on_message_box("error", tr("Error"), tr("Please wait for backup path change to complete."))
            return

        if not self.currentlyBackuping:
            self.currentlyBackuping = True
            self.disable_all_widgets()
            backup_thread = BackupThread(self.backup_table, self.database, self)
            backup_thread.message.connect(self.on_message)
            backup_thread.status_load.connect(self.on_status_load)
            backup_thread.finished.connect(self.on_backup_finished)
            backup_thread.start()
    
    def on_backup_finished(self, widgetName):
        self.currentlyBackuping = False
        self.enable_all_widgets()
        self.update_all_tables()

        target = self.findWidgetInStatusBar(widgetName)
        if target:
            target.deleteLater()
    
    def restore(self):
        if self.currentlyMigrating:
            self.on_message_box("error", tr("Error"), tr("Please wait for backup path change to complete."))
            return

        if not self.currentlyRestoring:
            self.currentlyRestoring = True
            self.disable_all_widgets()
            self.restore_thread = RestoreThread(self.restore_table, self.database, self)
            self.restore_thread.message.connect(self.on_message)
            self.restore_thread.message_box.connect(self.on_message_box)
            self.restore_thread.status_load.connect(self.on_status_load)
            self.restore_thread.finished.connect(self.on_restore_finished)
            self.restore_thread.start()
    
    def on_restore_finished(self, widgetName):
        self.currentlyRestoring = False
        self.enable_all_widgets()
        self.update_all_tables()

        target = self.findWidgetInStatusBar(widgetName)
        if target:
            target.deleteLater()
    
    def export(self):
        if self.currentlyMigrating:
            self.on_message_box("error", tr("Error"), tr("Please wait for backup path change to complete."))
            return

        if not is_path_valid(settings["gsmBackupPath"]):
            self.on_message_box("error", tr("Error"), tr("No backups found."))
            return
        
        export_directory = QFileDialog.getExistingDirectory(self, tr("Select export path"))
        if not export_directory:
            return

        num_backups, ok = QInputDialog.getInt(self, tr("Export Configuration"), tr("Enter the maximum number of backups to export per game:"), value=settings["maxBackups"], min=1, max=settings["maxBackups"])
        if not ok or num_backups <= 0:
            return

        if not self.currentlyExporting:
            self.currentlyExporting = True
            self.disable_all_widgets()
            export_thread = ExportThread(self.restore_table, self.database, export_directory, num_backups, self)
            export_thread.message.connect(self.on_message)
            export_thread.status_load.connect(self.on_status_load)
            export_thread.finished.connect(self.on_export_finished)
            export_thread.start()
    
    def on_export_finished(self, widgetName):
        self.currentlyExporting = False
        self.enable_all_widgets()

        target = self.findWidgetInStatusBar(widgetName)
        if target:
            target.deleteLater()

    def add_custom_games(self):
        pass
    
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
    
    def open_backup_directory(self):
        os.startfile(settings["gsmBackupPath"])


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
