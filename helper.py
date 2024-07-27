from datetime import datetime, timedelta
import shutil
import subprocess
import tempfile
import time

from PyQt6.QtCore import QEventLoop, Qt, QThread, QTimer, pyqtSignal, QRect
from PyQt6.QtGui import QIcon, QPixmap
from PyQt6.QtWidgets import QDialog, QCheckBox, QVBoxLayout, QHBoxLayout, QPushButton, QComboBox, QLabel, QMessageBox, QHeaderView, QTableWidget, QApplication, QWidget, QSpinBox, QLineEdit, QFileDialog

from config import *
from database import DataBase


class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(tr("Settings"))
        self.setWindowIcon(QIcon(resource_path("assets/setting.ico")))
        settingsLayout = QVBoxLayout()
        settingsLayout.setSpacing(15)
        self.setLayout(settingsLayout)
        self.setMinimumWidth(400)

        settingsWidgetsLayout = QVBoxLayout()
        settingsWidgetsLayout.setContentsMargins(50, 30, 50, 20)
        settingsLayout.addLayout(settingsWidgetsLayout)

        # Theme selection
        themeLayout = QVBoxLayout()
        themeLayout.setSpacing(2)
        settingsWidgetsLayout.addLayout(themeLayout)
        themeLayout.addWidget(QLabel(tr("Theme:")))
        self.themeCombo = QComboBox()
        self.themeCombo.addItems(theme_options.keys())
        self.themeCombo.setCurrentText(
            self.find_settings_key(settings["theme"], theme_options))
        themeLayout.addWidget(self.themeCombo)

        # Language selection
        languageLayout = QVBoxLayout()
        languageLayout.setSpacing(2)
        settingsWidgetsLayout.addLayout(languageLayout)
        languageLayout.addWidget(QLabel(tr("Language:")))
        self.languageCombo = QComboBox()
        self.languageCombo.addItems(language_options.keys())
        self.languageCombo.setCurrentText(
            self.find_settings_key(settings["language"], language_options))
        languageLayout.addWidget(self.languageCombo)

        # Backup save path
        backupLayout = QVBoxLayout()
        backupLayout.setSpacing(2)
        settingsWidgetsLayout.addLayout(backupLayout)
        backupLayout.addWidget(QLabel(tr("Backup Path:")))
        backupPathLayout = QHBoxLayout()
        backupPathLayout.setSpacing(5)
        backupLayout.addLayout(backupPathLayout)
        self.backupLineEdit = QLineEdit()
        self.backupLineEdit.setReadOnly(True)
        self.backupLineEdit.setText(os.path.normpath(settings["gsmBackupPath"]))
        backupPathLayout.addWidget(self.backupLineEdit)
        self.backupPathButton = CustomButton("...")
        self.backupPathButton.clicked.connect(self.selectBackupPath)
        backupPathLayout.addWidget(self.backupPathButton)

        # Maximum backups
        maxBackupsLayout = QVBoxLayout()
        maxBackupsLayout.setSpacing(2)
        settingsWidgetsLayout.addLayout(maxBackupsLayout)
        maxBackupsLayout.addWidget(QLabel(tr("Maximum Backups per Game:")))
        self.maxBackupsSpinBox = QSpinBox()
        self.maxBackupsSpinBox.setValue(settings["maxBackups"])
        self.maxBackupsSpinBox.setMinimum(0)
        self.maxBackupsSpinBox.setMaximum(1000)
        maxBackupsLayout.addWidget(self.maxBackupsSpinBox)

        # Backup geometry dash music
        self.backupGDCheckbox = QCheckBox(tr("Backup Geometry Dash Music"))
        self.backupGDCheckbox.setChecked(settings["backupGDMusic"])
        settingsWidgetsLayout.addWidget(self.backupGDCheckbox)

        # Apply button
        applyButtonLayout = QHBoxLayout()
        applyButtonLayout.setContentsMargins(0, 0, 10, 10)
        applyButtonLayout.addStretch(1)
        settingsLayout.addLayout(applyButtonLayout)
        self.applyButton = CustomButton(tr("Apply"))
        self.applyButton.setFixedWidth(100)
        self.applyButton.clicked.connect(self.apply_settings_page)
        applyButtonLayout.addWidget(self.applyButton)

        if self.parent().currentlyMigrating:
            self.backupPathButton.setDisabled(True)
            self.applyButton.setDisabled(True)
    
    def find_settings_key(self, value, dict):
        return next(key for key, val in dict.items() if val == value)
    
    def apply_settings_page(self):
        original_theme = settings["theme"]
        original_language = settings["language"]

        settings["theme"] = theme_options[self.themeCombo.currentText()]
        settings["language"] = language_options[self.languageCombo.currentText()]
        settings["gsmBackupPath"] = self.backupLineEdit.text()
        settings["maxBackups"] = self.maxBackupsSpinBox.value()
        settings["backupGDMusic"] = self.backupGDCheckbox.isChecked()
        apply_settings(settings)
        self.parent().update_all_tables()

        if original_theme != settings["theme"] or original_language != settings["language"]:
            msg_box = QMessageBox(
                QMessageBox.Icon.Question,
                tr("Attention"),
                tr("Do you want to restart the application now to apply theme or language settings?"),
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                self
            )
            
            yes_button = msg_box.button(QMessageBox.StandardButton.Yes)
            yes_button.setText(tr("Yes"))
            no_button = msg_box.button(QMessageBox.StandardButton.No)
            no_button.setText(tr("No"))
            reply = msg_box.exec()

            if reply == QMessageBox.StandardButton.Yes:
                os.execl(sys.executable, sys.executable, *map(lambda arg: f'"{arg}"', sys.argv))
        
        else:
            QMessageBox.information(self, tr("Success"), tr("Settings saved."))
    
    def selectBackupPath(self):
        if self.parent().currentlyBackuping:
            QMessageBox.critical(self, tr("Error"), tr("Please wait for backup to complete."))
            return
        elif self.parent().currentlyRestoring:
            QMessageBox.critical(self, tr("Error"), tr("Please wait for restore to complete."))
            return
        elif self.parent().currentlyExporting:
            QMessageBox.critical(self, tr("Error"), tr("Please wait for export to complete."))
            return

        self.disable_settings_widgets()

        initialPath = self.backupLineEdit.text() or os.path.expanduser("~")
        directory = QFileDialog.getExistingDirectory(self, tr("Select backup save path"), initialPath)
        if directory:
            changedPath = os.path.normpath(os.path.join(directory, "GSM Backups"))
            if self.backupLineEdit.text() == changedPath:
                QMessageBox.critical(self, tr("Error"), tr("Please choose a new path."))
                self.enable_settings_widgets()
                return

            elif os.path.exists(changedPath):
                msg_box = QMessageBox(
                    QMessageBox.Icon.Question,
                    tr("Attention"),
                    tr("Destination path already exists, would you like to overwrite?"),
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    self
                )
                
                yes_button = msg_box.button(QMessageBox.StandardButton.Yes)
                yes_button.setText(tr("Yes"))
                no_button = msg_box.button(QMessageBox.StandardButton.No)
                no_button.setText(tr("No"))
                reply = msg_box.exec()

                if reply == QMessageBox.StandardButton.No:
                    self.enable_settings_widgets()
                    return

            self.parent().currentlyMigrating = True
            migration_thread = PathChangeThread(settings["gsmBackupPath"], changedPath, self)
            migration_thread.status_load.connect(self.on_migration_status_load)
            migration_thread.finished.connect(self.on_migration_finished)
            migration_thread.error.connect(self.on_migration_error)
            migration_thread.start()
        
        else:
            self.enable_settings_widgets()
            return
    
    def enable_settings_widgets(self):
        global_settings_window = self.parent().settings_window
        if global_settings_window is not None and global_settings_window:
            global_settings_window.applyButton.setEnabled(True)
            global_settings_window.backupPathButton.setEnabled(True)
    
    def disable_settings_widgets(self):
        global_settings_window = self.parent().settings_window
        if global_settings_window is not None and global_settings_window:
            global_settings_window.applyButton.setDisabled(True)
            global_settings_window.backupPathButton.setDisabled(True)

    def on_migration_status_load(self):
        self.parent().on_status_load("migration", tr("Changing backup path"))
    
    def on_migration_error(self, error_message):
        self.parent().on_status_update("migration", tr("Failed to change backup path"), "error")
        QMessageBox.critical(self, tr("Error"), tr("Error changing backup path: ") + error_message)
    
    def on_migration_finished(self, new_path):
        self.enable_settings_widgets()
        self.parent().currentlyMigrating = False
        global_settings_window = self.parent().settings_window
        if global_settings_window is not None and global_settings_window:
            global_settings_window.backupLineEdit.setText(os.path.normpath(new_path))
        settings["gsmBackupPath"] = new_path
        apply_settings(settings)
        target = self.parent().findWidgetInStatusBar("migration")
        if target:
            target.deleteLater()


class PathChangeThread(QThread):
    status_load = pyqtSignal()
    error = pyqtSignal(str)
    finished = pyqtSignal(str)

    def __init__(self, source_path, destination_path, parent=None):
        super().__init__(parent)
        self.source_path = source_path
        self.destination_path = destination_path

    def run(self):
        self.status_load.emit()

        try:
            if os.path.exists(self.destination_path):
                shutil.rmtree(self.destination_path, onexc=handle_remove_readonly)
            
            os.makedirs(self.destination_path, exist_ok=True)
            shutil.copytree(self.source_path, self.destination_path, dirs_exist_ok=True)
            shutil.rmtree(self.source_path, onexc=handle_remove_readonly)
            self.finished.emit(self.destination_path)

        except Exception as e:
            self.error.emit(str(e))
            time.sleep(2)
            self.finished.emit(self.source_path)


class AboutDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(tr("About"))
        self.setWindowIcon(QIcon(resource_path("assets/logo.ico")))
        aboutLayout = QVBoxLayout()
        aboutLayout.setSpacing(30)
        aboutLayout.setContentsMargins(40, 20, 40, 30)
        self.setLayout(aboutLayout)

        appLayout = QHBoxLayout()
        appLayout.setSpacing(20)
        aboutLayout.addLayout(appLayout)

        # App logo
        logoPixmap = QPixmap(resource_path("assets/logo.png"))
        scaledLogoPixmap = logoPixmap.scaled(120, 120, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        logoLabel = QLabel()
        logoLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logoLabel.setPixmap(scaledLogoPixmap)
        appLayout.addWidget(logoLabel)

        # App name and version
        appNameFont = self.font()
        appNameFont.setPointSize(18)
        appInfoLayout = QVBoxLayout()
        appInfoLayout.setAlignment(Qt.AlignmentFlag.AlignVCenter)
        appLayout.addLayout(appInfoLayout)

        appNameLabel = QLabel("Game Save Manager")
        appNameLabel.setFont(appNameFont)
        appNameLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        appInfoLayout.addWidget(appNameLabel)
        appVersionLabel = QLabel(tr("Version: ") + self.parent().appVersion)
        appVersionLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        appInfoLayout.addWidget(appVersionLabel)

        # Links
        linksLayout = QVBoxLayout()
        linksLayout.setSpacing(10)
        aboutLayout.addLayout(linksLayout)

        githubUrl = self.parent().githubLink
        githubText = f'GitHub: <a href="{githubUrl}" style="text-decoration: none;">{githubUrl}</a>'
        githubLabel = QLabel(githubText)
        githubLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        githubLabel.setTextFormat(Qt.TextFormat.RichText)
        githubLabel.setOpenExternalLinks(True)
        linksLayout.addWidget(githubLabel)

        bilibiliUrl = self.parent().bilibiliLink
        text = tr("Bilibili author homepage:")
        bilibiliText = f'{text} <a href="{bilibiliUrl}" style="text-decoration: none;">{bilibiliUrl}</a>'
        bilibiliLabel = QLabel(bilibiliText)
        bilibiliLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        bilibiliLabel.setTextFormat(Qt.TextFormat.RichText)
        bilibiliLabel.setOpenExternalLinks(True)
        linksLayout.addWidget(bilibiliLabel)

        self.setFixedSize(self.sizeHint())


class CustomButton(QPushButton):
    def __init__(self, text, parent=None):
        super(CustomButton, self).__init__(text, parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

    def setEnabled(self, enabled):
        super().setEnabled(enabled)
        if enabled:
            self.setCursor(Qt.CursorShape.PointingHandCursor)
        else:
            self.setCursor(Qt.CursorShape.ForbiddenCursor)

    def enterEvent(self, event):
        if not self.isEnabled():
            QApplication.setOverrideCursor(Qt.CursorShape.ForbiddenCursor)
        super().enterEvent(event)

    def leaveEvent(self, event):
        QApplication.restoreOverrideCursor()
        super().leaveEvent(event)


class StatusMessageWidget(QWidget):
    def __init__(self, widgetName, message):
        super().__init__()
        self.setObjectName(widgetName)

        self.layout = QHBoxLayout()
        self.layout.setSpacing(3)
        self.setLayout(self.layout)

        self.messageLabel = QLabel(message)
        self.layout.addWidget(self.messageLabel)

        self.loadingLabel = QLabel(".")
        self.loadingLabel.setFixedWidth(20)
        self.layout.addWidget(self.loadingLabel)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_loading_animation)
        self.timer.start(500)

    def update_loading_animation(self):
        current_text = self.loadingLabel.text()
        new_text = '.' * ((len(current_text) % 3) + 1)
        self.loadingLabel.setText(new_text)

    def update_message(self, newMessage, state="load"):
        self.messageLabel.setText(newMessage)
        if state == "load":
            if not self.loadingLabel.isVisible():
                self.loadingLabel.show()
            if not self.timer.isActive():
                self.timer.start(500)
            self.messageLabel.setStyleSheet("")
        elif state == "error":
            self.timer.stop()
            self.loadingLabel.hide()
            self.messageLabel.setStyleSheet("QLabel { color: red; }")


class CheckableHeader(QHeaderView):
    def __init__(self, orientation, parent=None):
        super().__init__(orientation, parent)
        self.setMinimumSectionSize(100)
        self.checkbox = QCheckBox("Select All", self)
        self.checkbox.setTristate(True)
        self.checkbox.stateChanged.connect(self.handle_header_checkbox)
        self.sectionResized.connect(self.handle_section_resized)

    def showEvent(self, event):
        super().showEvent(event)
        self.position_checkbox()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.position_checkbox()

    def handle_section_resized(self, logicalIndex, oldSize, newSize):
        if logicalIndex == 0:  # Only adjust if the first column is resized
            self.position_checkbox()

    def position_checkbox(self):
        index = 0  # We want the checkbox in the first section
        pos_x = self.sectionViewportPosition(index)
        width = self.sectionSize(index)
        header_rect = QRect(pos_x, 0, width, self.height())
        checkbox_size = self.checkbox.sizeHint()

        new_x = header_rect.x() + (header_rect.width() - checkbox_size.width()) // 2
        new_y = header_rect.y() + (header_rect.height() - checkbox_size.height()) // 2

        self.checkbox.move(new_x, new_y)

    def handle_header_checkbox(self, state):
        table = self.parentWidget()
        if not table:
            return
        isChecked = state == 2
        isPartiallyChecked = state == 1
        if not isPartiallyChecked:  # Ignore changes if state is partially checked
            for row in range(table.rowCount()):
                chk_box = table.cellWidget(row, 0).layout().itemAt(0).widget()
                chk_box.setChecked(isChecked)


class BackupThread(QThread):
    message = pyqtSignal(str, str)
    status_load = pyqtSignal(str, str)
    finished = pyqtSignal(str)
    
    def __init__(self, backup_table: QTableWidget, database: DataBase, parent=None):
        super().__init__(parent)
        self.backup_table = backup_table
        self.database = database

    def run(self):
        selected_games = []
        statusWidgetName = "backup"

        for row in range(self.backup_table.rowCount()):
            chk_box = self.backup_table.cellWidget(row, 0).layout().itemAt(0).widget()
            if chk_box.isChecked():
                selected_games.append(self.database.backup_dict[row])
        
        if selected_games:
            self.message.emit("", "clear")
            self.status_load.emit(statusWidgetName, tr("Backup in progress"))
            self.parent().tabWidget.setCurrentIndex(2)
        else:
            self.finished.emit(statusWidgetName)
            return
        
        for game in selected_games:
            if game.backupable:
                timestamp1 = datetime.now().strftime('%Y-%m-%d_%H-%M')
                timestamp2 = datetime.now().strftime('%Y/%m/%d %H:%M')

                try:
                    root_backup_path = os.path.join(settings["gsmBackupPath"], sanitize_game_name(game.name_en))

                    # Backup each save paths
                    for count, save_path in enumerate(game.save_paths, start=1):
                        backup_path = os.path.join(root_backup_path, timestamp1, f"save_path_{count}")
                        os.makedirs(backup_path, exist_ok=True)

                        if save_path.save_loc == "Windows" and is_path_valid(save_path.root_path):
                            src = save_path.root_path

                            if save_path.files == "all":
                                copytree_with_permissions(src, backup_path)
                            else:
                                for item in save_path.files:
                                    item_path = os.path.join(src, item)
                                    if os.path.isfile(item_path):
                                        copyfile_with_permissions(item_path, os.path.join(backup_path, item))
                                    elif os.path.isdir(item_path):
                                        copytree_with_permissions(item_path, os.path.join(backup_path, item))

                        elif save_path.save_loc == "Steam" or save_path.save_loc == "Ubisoft":
                            if save_path.save_loc == "Steam":
                                user_ids = self.database.steam_user_ids
                            elif save_path.save_loc == "Ubisoft":
                                user_ids = self.database.ubisoft_user_ids
                            
                            for user_id in user_ids:
                                src = save_path.root_path.replace("<user_id>", user_id)
                                dst = os.path.join(backup_path, user_id)

                                if is_path_valid(src):
                                    os.makedirs(dst, exist_ok=True)

                                    if save_path.files == "all":
                                        copytree_with_permissions(src, dst)
                                    else:
                                        for item in save_path.files:
                                            item_path = os.path.join(src, item)
                                            if os.path.isfile(item_path):
                                                copyfile_with_permissions(item_path, os.path.join(dst, item))
                                            elif os.path.isdir(item_path):
                                                copytree_with_permissions(item_path, os.path.join(dst, item))
                        
                        elif save_path.save_loc == "Registry":
                            if registry_path_exists(save_path.root_path):
                                registry_backup_path = os.path.join(backup_path, f"{sanitize_game_name(game.name_en)}.reg")
                                command = f'reg export "{save_path.root_path}" "{registry_backup_path}" /y'
                                subprocess.run(command, creationflags=subprocess.CREATE_NO_WINDOW, check=True)

                    # Check maximum backups count
                    backups = sorted([d for d in os.listdir(root_backup_path) if os.path.isdir(os.path.join(root_backup_path, d))])
                    while len(backups) > settings["maxBackups"]:
                        oldest_backup = backups.pop(0)
                        shutil.rmtree(os.path.join(root_backup_path, oldest_backup), onexc=handle_remove_readonly)
                
                    self.message.emit(f"[{timestamp2}]   " + tr("Backup success: ") + get_game_name(game), "success")

                except Exception as e:
                    self.message.emit(f"[{timestamp2}]   " + tr("Backup failed: ") + get_game_name(game) + '\n' + tr("Reason: ") + str(e), "failure")

        self.message.emit(tr("Backup completed."), "")
        self.finished.emit(statusWidgetName)


class RestoreThread(QThread):
    message = pyqtSignal(str, str)
    message_box = pyqtSignal(str, str, str)
    status_load = pyqtSignal(str, str)
    finished = pyqtSignal(str)
    
    def __init__(self, restore_table: QTableWidget, database: DataBase, parent=None):
        super().__init__(parent)
        self.restore_table = restore_table
        self.database = database
        self.event_loop = None
        self.can_restore = False  # Whether backup is newer than local files or not
        self.restore_success = False  # Whether restore is processed or cancelled

    def run(self):
        selected_games = []
        statusWidgetName = "restore"

        for row in range(self.restore_table.rowCount()):
            chk_box = self.restore_table.cellWidget(row, 0).layout().itemAt(0).widget()
            if chk_box.isChecked():
                selected_games.append(self.database.restore_dict[row])
        
        if selected_games:
            self.message.emit("", "clear")
            self.status_load.emit(statusWidgetName, tr("Restore in progress"))
            self.parent().tabWidget.setCurrentIndex(2)
        else:
            self.finished.emit(statusWidgetName)
            return
        
        for game in selected_games:
            if game.restorable:
                timestamp = datetime.now().strftime('%Y/%m/%d %H:%M')
                self.can_restore = False
                self.restore_success = False

                try:
                    root_backup_path = os.path.join(settings["gsmBackupPath"], sanitize_game_name(game.name_en))
                    backup_dirs = [d for d in os.listdir(root_backup_path) if os.path.isdir(os.path.join(root_backup_path, d))]

                    if backup_dirs:
                        sorted_backup_dirs = sorted(backup_dirs)
                        latest_backup_path = os.path.join(root_backup_path, sorted_backup_dirs[-1])

                        for count, save_path in enumerate(game.save_paths, start=1):
                            full_save_path = os.path.join(latest_backup_path, f"save_path_{count}")

                            if save_path.save_loc == "Windows" and is_path_valid(full_save_path):
                                if self.can_restore:
                                    copytree_with_permissions(full_save_path, save_path.root_path)
                                    self.restore_success = True
                                elif not self.can_restore and count > 1:
                                    pass
                                else:
                                    self.confirm_restore(game.name_en, full_save_path, save_path.root_path)
                            
                            elif save_path.save_loc == "Steam" or save_path.save_loc == "Ubisoft":
                                user_ids = [d for d in os.listdir(full_save_path) if os.path.isdir(os.path.join(full_save_path, d))]
                                
                                for user_id in user_ids:
                                    src = os.path.join(full_save_path, user_id)
                                    dst = save_path.root_path.replace("<user_id>", user_id)

                                    if is_path_valid(src):
                                        if self.can_restore:
                                            copytree_with_permissions(src, dst)
                                            self.restore_success = True
                                        elif not self.can_restore and count > 1:
                                            pass
                                        else:
                                            self.confirm_restore(game.name_en, src, dst)
                            
                            elif save_path.save_loc == "Registry":
                                registry_backup_path = os.path.join(full_save_path, f"{sanitize_game_name(game.name_en)}.reg")
                                if os.path.exists(registry_backup_path):
                                    command = f'reg import "{registry_backup_path}"'
                                    subprocess.run(command, creationflags=subprocess.CREATE_NO_WINDOW, check=True)
                                    self.restore_success = True

                        if self.restore_success:
                            self.message.emit(f"[{timestamp}]   " + tr("Restore success: ") + get_game_name(game), "success")
                        else:
                            self.message.emit(f"[{timestamp}]   " + tr("Restore cancelled: ") + get_game_name(game), "failure")

                except Exception as e:
                    self.message.emit(f"[{timestamp}]   " + tr("Restore failed: ") + get_game_name(game) + '\n' + tr("Reason: ") + str(e), "failure")

        self.message.emit(tr("Restore completed."), "")
        self.finished.emit(statusWidgetName)
    
    def handle_message_box_response(self, result):
        self.can_restore = result
        if self.event_loop is not None:
            self.event_loop.exit()
    
    def confirm_restore(self, game_name, src, dst):
        source_mtime = self.get_latest_modification_time(src)
        destination_mtime = datetime.fromtimestamp(0)  # Initialize with the oldest possible time
        src_entries = os.listdir(src)

        for entry in src_entries:
            src_path = os.path.join(src, entry)
            dst_path = os.path.join(dst, entry)

            if os.path.isdir(src_path) and os.path.exists(dst_path):
                if os.path.isdir(dst_path):
                    for root, dirs, files in os.walk(dst_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            mod_time = datetime.fromtimestamp(os.path.getmtime(file_path))
                            if mod_time > destination_mtime:
                                destination_mtime = mod_time

            elif os.path.isfile(src_path) and os.path.exists(dst_path):
                mod_time = datetime.fromtimestamp(os.path.getmtime(dst_path))
                if mod_time > destination_mtime:
                    destination_mtime = mod_time

        if source_mtime >= self.round_to_nearest_minute(destination_mtime):
            copytree_with_permissions(src, dst)
            self.restore_success = True
        else:
            title = tr("Confirmation")
            text = tr(
                "Save conflict detected for {game_display}:\n"
                "Save data on machine (last modified on {destination_mtime})\n"
                "is newer than backup (last modified on {source_mtime}).\n\n"
                "Do you want to overwrite local save data with backup?"
            ).format(
                game_display=game_name,
                destination_mtime=destination_mtime.strftime('%Y/%m/%d %H:%M'),
                source_mtime=source_mtime.strftime('%Y/%m/%d %H:%M')
            )

            self.message_box.emit("question", title, text)
            self.event_loop = QEventLoop()
            self.event_loop.exec()
            if self.can_restore:
                copytree_with_permissions(src, dst)
                self.restore_success = True
    
    def get_latest_modification_time(self, path):
        latest_mod_time = datetime.fromtimestamp(0)

        if not os.path.exists(path):
            return latest_mod_time

        for root, dirs, files in os.walk(path):
            for name in files:
                file_path = os.path.join(root, name)
                mod_time = datetime.fromtimestamp(os.path.getmtime(file_path))
                if mod_time > latest_mod_time:
                    latest_mod_time = mod_time

        return self.round_to_nearest_minute(latest_mod_time)

    def round_to_nearest_minute(self, dt):
        discard_seconds = timedelta(seconds=dt.second, microseconds=dt.microsecond)
        dt -= discard_seconds
        if discard_seconds >= timedelta(seconds=30):
            dt += timedelta(minutes=1)
        return dt


class ExportThread(QThread):
    message = pyqtSignal(str, str)
    status_load = pyqtSignal(str, str)
    finished = pyqtSignal(str)
    
    def __init__(self, restore_table: QTableWidget, database: DataBase, export_path, backups_per_game, parent=None):
        super().__init__(parent)
        self.restore_table = restore_table
        self.database = database
        self.export_path = export_path
        self.backups_per_game = backups_per_game
        self.backup_path = settings["gsmBackupPath"]

    def run(self):
        selected_games = []
        statusWidgetName = "export"

        for row in range(self.restore_table.rowCount()):
            chk_box = self.restore_table.cellWidget(row, 0).layout().itemAt(0).widget()
            if chk_box.isChecked():
                selected_games.append(self.database.restore_dict[row])

        if selected_games:
            self.message.emit("", "clear")
            self.message.emit(tr("Export in progress") + "...", "")
            self.status_load.emit(statusWidgetName, tr("Export in progress"))
            self.parent().tabWidget.setCurrentIndex(2)
        else:
            self.finished.emit(statusWidgetName)
            return

        zip_filename = os.path.join(self.export_path, f"GSMbackup_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.gsm")
        try:
            with tempfile.NamedTemporaryFile(delete=False, mode='w', encoding='utf-8', suffix='.txt') as list_file:
                list_file_name = list_file.name
                for game in selected_games:
                    game_path = os.path.join(self.backup_path, sanitize_game_name(game.name_en))
                    if os.path.isdir(game_path):
                        backup_instances = sorted([d for d in os.listdir(game_path) if os.path.isdir(os.path.join(game_path, d))])
                        backups_to_export = backup_instances[-self.backups_per_game:]

                        for backup in backups_to_export:
                            backup_folder = os.path.join(game_path, backup)
                            relative_backup_folder = os.path.relpath(backup_folder, self.backup_path)
                            list_file.write(f'"{relative_backup_folder}"\n')

                list_file.flush()

            command = [unzip_path, "a", "-tzip", "-y", zip_filename, f"@{list_file.name}", "-scsUTF-8"]
            result = subprocess.run(command, cwd=self.backup_path, creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.message.emit(tr("Export completed.") + '\n' + tr("File exported to: ") + os.path.normpath(zip_filename), "success")
            print(result.stdout if result else "")
        except Exception as e:
            self.message.emit(tr("Export failed.") + '\n' + tr("Reason: ") + str(e), "failure")
        finally:
            os.remove(list_file_name)

        self.finished.emit(statusWidgetName)
