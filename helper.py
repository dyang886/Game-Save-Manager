from PyQt6.QtCore import Qt, QRect
from PyQt6.QtGui import QIcon, QPixmap, QFontMetrics
from PyQt6.QtWidgets import QDialog, QCheckBox, QVBoxLayout, QHBoxLayout, QPushButton, QComboBox, QLabel, QMessageBox, QHeaderView

from config import *


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

        # Backup minecraft
        self.backMCCheckbox = QCheckBox(tr("Backup Minecraft"))
        self.backMCCheckbox.setChecked(settings["backupMC"])
        settingsWidgetsLayout.addWidget(self.backMCCheckbox)

        # Backup geometry dash music
        self.backupGDCheckbox = QCheckBox(tr("Backup Geometry Dash Music"))
        self.backupGDCheckbox.setChecked(settings["backupGDMusic"])
        settingsWidgetsLayout.addWidget(self.backupGDCheckbox)

        # Apply button
        applyButtonLayout = QHBoxLayout()
        applyButtonLayout.setContentsMargins(0, 0, 10, 10)
        applyButtonLayout.addStretch(1)
        settingsLayout.addLayout(applyButtonLayout)
        self.applyButton = QPushButton(tr("Apply"))
        self.applyButton.setFixedWidth(100)
        self.applyButton.clicked.connect(self.apply_settings_page)
        applyButtonLayout.addWidget(self.applyButton)
    
    def find_settings_key(self, value, dict):
        return next(key for key, val in dict.items() if val == value)
    
    def apply_settings_page(self):
        settings["theme"] = theme_options[self.themeCombo.currentText()]
        settings["language"] = language_options[self.languageCombo.currentText()]
        settings["backupMC"] = self.backMCCheckbox.isChecked()
        settings["backupGDMusic"] = self.backupGDCheckbox.isChecked()
        apply_settings(settings)

        QMessageBox.information(self, tr("Attention"), tr(
            "Please restart the application to apply theme and language settings."))


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
        githubText = f'GitHub: <a href="{githubUrl}" style="text-decoration: none; color: #284fff;">{githubUrl}</a>'
        githubLabel = QLabel(githubText)
        githubLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        githubLabel.setTextFormat(Qt.TextFormat.RichText)
        githubLabel.setOpenExternalLinks(True)
        linksLayout.addWidget(githubLabel)

        bilibiliUrl = self.parent().bilibiliLink
        text = tr("Bilibili author homepage:")
        bilibiliText = f'{text} <a href="{bilibiliUrl}" style="text-decoration: none; color: #284fff;">{bilibiliUrl}</a>'
        bilibiliLabel = QLabel(bilibiliText)
        bilibiliLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        bilibiliLabel.setTextFormat(Qt.TextFormat.RichText)
        bilibiliLabel.setOpenExternalLinks(True)
        linksLayout.addWidget(bilibiliLabel)

        self.setFixedSize(self.sizeHint())


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


# def manage_custom_games(self):
#     if self.addCustom_window is None or not self.addCustom_window.winfo_exists():
#         self.addCustom_window = tk.Toplevel(self)
#         self.addCustom_window.title(tr("Manage Custom Games"))
#         self.addCustom_window.iconbitmap(resource_path("assets/logo.ico"))
#         self.addCustom_window.transient(self)
#         self.addCustom_window.resizable(False, False)

#         self.content_frame = CTkScrollableFrame(
#             self.addCustom_window,
#             fg_color="transparent",
#             width=550, height=350
#         )
#         self.content_frame.grid(
#             row=0, column=0, sticky='nsew', padx=(20, 15), pady=(20, 0))
#         self.content_frame.columnconfigure(0, weight=1)
#         self.content_frame.columnconfigure(2, weight=1)

#         # Set up the table headers
#         ttk.Label(self.content_frame, text=tr("Game Name"), font=self.default_font).grid(row=0, column=0)
#         ttk.Label(self.content_frame, text=tr("Save type"), font=self.default_font).grid(row=0, column=1)
#         ttk.Label(self.content_frame, text=tr("Save Path"), font=self.default_font).grid(row=0, column=2)

#         # Apply button
#         apply_button = ttk.Button(
#             self.addCustom_window, text=tr("Save"),
#             command=self.save_custom_games,
#             style="TButton", width=10
#         )
#         apply_button.grid(row=1, column=0, padx=(
#             0, 20), pady=(20, 20), sticky='e')

#         # load saved custom games
#         self.custom_game_rows = []
#         if os.path.exists(self.customGameJson):
#             with open(self.customGameJson, "r") as file:
#                 custom_games = json.load(file)
#                 for game in custom_games.get("customGames", []):
#                     self.add_game_row(
#                         game["name"], game["type"], game["path"])
#         self.add_game_row()

#         self.center_window(self.addCustom_window)
#     else:
#         self.addCustom_window.lift()
#         self.addCustom_window.focus_force()

# def view_supported_games(self):
#     if self.supportedGames_window is None or not self.supportedGames_window.winfo_exists():
#         self.supportedGames_window = tk.Toplevel(self)
#         self.supportedGames_window.title(tr("View Supported Games"))
#         self.supportedGames_window.iconbitmap(
#             resource_path("assets/logo.ico"))
#         self.supportedGames_window.transient(self)
#         self.supportedGames_window.resizable(False, False)
#         self.supportedGames_window.minsize(width=650, height=700)

#         tree_frame = ttk.Frame(self.supportedGames_window)
#         tree_frame.pack(expand=True, fill=tk.BOTH)

#         scrollBar = ttk.Scrollbar(tree_frame, orient="vertical")

#         columns = ("game_name", "save_location")
#         game_treeview = ttk.Treeview(
#             tree_frame,
#             columns=columns, show="headings",
#             yscrollcommand=scrollBar.set,
#             style="Treeview"
#         )
#         game_treeview.heading("game_name", text=tr("Game Name"))
#         game_treeview.heading("save_location", text=tr("Save Location"))
#         game_treeview.column("save_location", width=100)
#         game_treeview.pack(side=tk.LEFT, expand=True, fill=tk.BOTH)

#         scrollBar.config(command=game_treeview.yview)
#         scrollBar.pack(side=tk.LEFT, fill=tk.Y)

#         for game, (location, fileType, path) in self.gameSaveDirectory.items():
#             if self.duplicate_symbol in game:
#                 continue
#             game_treeview.insert(
#                 '', tk.END, values=(self.transGame(game), location))

#         self.center_window(self.supportedGames_window)
#     else:
#         self.supportedGames_window.lift()
#         self.supportedGames_window.focus_force()

# def select_path(self, entry_widget, file_type_combobox):
#     file_type = self.file_types[file_type_combobox.get()]
#     path = ""
#     if file_type == "folder":
#         path = filedialog.askdirectory()
#     elif file_type == "file":
#         path = filedialog.askopenfilename()

#     if path:
#         path = os.path.normpath(path)
#         username_prefix = f"C:\\Users\\{self.user_name}"
#         if path.startswith(username_prefix):
#             path = path.replace(username_prefix, "C:\\Users\\{usr}")
#         entry_widget.delete(0, tk.END)
#         entry_widget.insert(0, path)

# def save_custom_games(self):
#     custom_games_dict = {"customGames": []}
#     game_names = set()
#     duplicate_game_names = set()
#     duplicate_found = False

#     for game_row in self.custom_game_rows:
#         game_row[0].config(foreground="white")
#         game_name_entry, file_type_combobox, game_save_entry = game_row[
#             0], game_row[1], game_row[2]
#         game_name = game_name_entry.get()
#         file_type = self.file_types[file_type_combobox.get()]
#         game_path = game_save_entry.get()

#         if game_name and game_path:
#             if game_name in game_names:
#                 duplicate_game_names.add(game_name)
#             else:
#                 game_names.add(game_name)
#                 custom_games_dict["customGames"].append(
#                     {"name": game_name, "type": file_type, "path": game_path})

#     # Highlight all duplicates
#     if duplicate_game_names:
#         for row in self.custom_game_rows:
#             game_name_entry = row[0]
#             game_name = game_name_entry.get()
#             if game_name in duplicate_game_names:
#                 game_name_entry.config(foreground="red")
#                 duplicate_found = True

#     if duplicate_found:
#         messagebox.showwarning(tr("Warning"), tr("Please make sure to have no duplicate game names."))
#         return

#     jsonPath = os.path.dirname(self.customGameJson)
#     if not os.path.exists(jsonPath):
#         os.makedirs(jsonPath)

#     try:
#         with open(self.customGameJson, "w") as file:
#             json.dump(custom_games_dict, file, indent=4)
#         messagebox.showinfo(tr("Success"), re("Custom games saved successfully."))
#     except Exception as e:
#         messagebox.showerror(tr("Error"), tr("Failed to save custom games: ") + str(e))

# def add_game_row(self, game_name="", file_type=tr("Folder"), save_path=""):
#     # Start rows after the header
#     row_number = len(self.custom_game_rows) + 1

#     # Create entry widgets for game name and save path
#     game_name_entry = ttk.Entry(
#         self.content_frame,
#         style="TEntry",
#         font=self.default_font
#     )
#     game_name_entry.insert(0, game_name)
#     game_name_entry.grid(row=row_number, column=0,
#                             padx=(0, 10), pady=(5, 5), sticky="we")
#     game_name_entry.bind("<KeyRelease>", lambda event,
#                             entry=game_name_entry: self.on_entry_change(entry))

#     file_type_combobox = ttk.Combobox(
#         self.content_frame,
#         style="TCombobox",
#         state="readonly",
#         font=self.default_font,
#         values=list(self.file_types.keys()),
#         width=6
#     )
#     if file_type in self.file_types.values():
#         for key, value in self.file_types.items():
#             if value == file_type:
#                 file_type = key
#                 break
#     file_type_combobox.set(file_type)
#     file_type_combobox.grid(row=row_number, column=1,
#                             padx=(0, 10), pady=(5, 5), sticky="we")

#     game_save_entry = ttk.Entry(
#         self.content_frame,
#         style="TEntry",
#         font=self.default_font
#     )
#     game_save_entry.insert(0, save_path)
#     game_save_entry.grid(row=row_number, column=2,
#                             pady=(5, 5), sticky="we")

#     # Create path selection button
#     path_button = ttk.Button(
#         self.content_frame, text="...", width=2,
#         command=lambda: self.select_path(
#             game_save_entry, file_type_combobox),
#         style="TButton"
#     )
#     path_button.grid(row=row_number, column=3, padx=(5, 0), pady=(5, 5))

#     # Create remove row button
#     remove_button = ttk.Button(
#         self.content_frame, text="-", width=2,
#         command=lambda: self.remove_game_row(row_number),
#         style="Red.TButton"
#     )
#     remove_button.grid(row=row_number, column=4, padx=(5, 0), pady=(5, 5))

#     # Create add row button
#     add_button = ttk.Button(
#         self.content_frame, text="+", width=2,
#         command=self.add_game_row,
#         style="Green.TButton"
#     )
#     add_button.grid(row=row_number, column=5, padx=(5, 10), pady=(5, 5))

#     self.custom_game_rows.append(
#         (game_name_entry, file_type_combobox, game_save_entry, path_button, remove_button, add_button))

#     if len(self.custom_game_rows) > 1:
#         # Hide the + button of the second-to-last row
#         self.custom_game_rows[-2][-1].grid_remove()

#     # Show last + button and disable first - button if only one row exists
#     self.custom_game_rows[-1][-1].grid()
#     if len(self.custom_game_rows) == 1:
#         self.custom_game_rows[0][4].config(state=tk.DISABLED)
#     else:
#         self.custom_game_rows[0][4].config(state=tk.NORMAL)

#     self.content_frame.after(
#         10, self.content_frame._parent_canvas.yview_moveto, 1.0)

# def remove_game_row(self, row_number):
#     for widget in self.custom_game_rows[row_number - 1]:
#         widget.destroy()
#     del self.custom_game_rows[row_number - 1]

#     # Update row indices for remove buttons in all remaining rows
#     for i, row in enumerate(self.custom_game_rows):
#         row[4].config(command=lambda idx=i: self.remove_game_row(idx + 1))

#         # Re-grid all widgets except the last + button
#         for j, widget in enumerate(row[:-1]):
#             widget.grid(row=i + 1, column=j)

#     # Hide all + buttons and show only on the last row
#     for row in self.custom_game_rows:
#         row[-1].grid_remove()
#     if self.custom_game_rows:
#         self.custom_game_rows[-1][-1].grid(
#             row=len(self.custom_game_rows), column=5)

#     # Disable first - button if only one row exists
#     if len(self.custom_game_rows) == 1:
#         self.custom_game_rows[0][4].config(state=tk.DISABLED)
#     else:
#         self.custom_game_rows[0][4].config(state=tk.NORMAL)
