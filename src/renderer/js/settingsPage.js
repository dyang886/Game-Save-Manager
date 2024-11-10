document.addEventListener('DOMContentLoaded', () => {
    const themeSelect = document.getElementById('theme');
    const languageSelect = document.getElementById('language');
    const backupPathInput = document.getElementById('backup-path');
    const backupPathButton = document.getElementById('select-path');
    const maxBackupsInput = document.getElementById('max-backups');
    const autoAppUpdateCheckbox = document.getElementById('auto-app-update');
    const autoDbUpdateCheckbox = document.getElementById('auto-db-update');
    const autoDetectButton = document.getElementById('auto-detect-paths');
    const gamePathsContainer = document.getElementById('game-paths-container');
    const addNewPathButton = document.getElementById('add-new-path');
    const saveSettingsButton = document.getElementById('save-settings');

    window.api.invoke('get-settings').then((settings) => {
        if (settings) {
            themeSelect.value = settings.theme;
            languageSelect.value = settings.language;
            backupPathInput.value = settings.backupPath;
            maxBackupsInput.value = settings.maxBackups;
            autoAppUpdateCheckbox.checked = settings.autoAppUpdate;
            autoDbUpdateCheckbox.checked = settings.autoDbUpdate;

            if (settings.gameInstalls && settings.gameInstalls.length > 0) {
                settings.gameInstalls.forEach((installPath) => {
                    addGameInstallPath(installPath);
                });
            }
        }
        updateTranslations(document);
    });

    // Event listeners for changes
    themeSelect.addEventListener('change', (event) => {
        window.api.send('save-settings', 'theme', event.target.value);
    });

    languageSelect.addEventListener('change', (event) => {
        window.api.send('save-settings', 'language', event.target.value);
    });

    backupPathButton.addEventListener('click', async () => {
        const result = await window.api.invoke('open-backup-dialog');
        if (result) {
            backupPathInput.value = result;
        }
    });

    maxBackupsInput.addEventListener('input', function () {
        const value = parseInt(this.value, 10);
        if (isNaN(value) || value < 1) {
            this.value = 1;
        } else if (value > 1000) {
            this.value = 1000;
        }
    });

    saveSettingsButton.addEventListener('click', async () => {
        const start = await operationStartCheck('change-settings');
        if (start) {
            previousSettings = await window.api.invoke('get-settings');

            // Check if game install paths changed
            const newGameInstallPaths = [];
            document.querySelectorAll('.game-path-item .display-path').forEach((input) => {
                const path = input.value.trim();
                if (path) {
                    newGameInstallPaths.push(path);
                }
            });

            const areArraysEqual = (arr1, arr2) => {
                if (arr1.length !== arr2.length) {
                    return false;
                }
                const sortedArr1 = [...arr1].sort();
                const sortedArr2 = [...arr2].sort();

                return sortedArr1.every((value, index) => value === sortedArr2[index]);
            };

            if (!areArraysEqual(previousSettings.gameInstalls, newGameInstallPaths)) {
                window.api.send('save-settings', 'gameInstalls', newGameInstallPaths);
            }

            // Check if backup path changed
            const newBackupPath = backupPathInput.value.trim();
            if (previousSettings.backupPath.trim() !== newBackupPath) {
                window.api.send('migrate-backups', newBackupPath);
            }

            window.api.send('save-settings', 'maxBackups', maxBackupsInput.value);
            window.api.send('save-settings', 'autoAppUpdate', autoAppUpdateCheckbox.checked);
            window.api.send('save-settings', 'autoDbUpdate', autoDbUpdateCheckbox.checked);
            showAlert('success', await window.i18n.translate('settings.save-settings-success'));
        }
    });

    autoDetectButton.addEventListener('click', () => {
        window.api.invoke('get-detected-game-paths').then(async (value) => {
            if (value && value.length > 0) {
                value.forEach(path => {
                    if (!duplicatePathCheck(path)) {
                        addGameInstallPath(path);
                    }
                });
            } else {
                showAlert('warning', await window.i18n.translate('settings.noPathsDetected'));
            }
        });
    });

    addNewPathButton.addEventListener('click', () => {
        addGameInstallPath('');
    });

    function addGameInstallPath(installPath = '') {
        const newPath = document.createElement('div');
        newPath.className = 'flex mb-2 game-path-item';
        newPath.innerHTML = `
            <input type="text" readonly value="${installPath}"
                class="display-path flex-grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-l-lg p-2.5 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white" />
            <button type="button" class="select-path text-white bg-blue-700 hover:bg-blue-800 focus:outline-none font-medium rounded-r-lg text-sm px-4 py-2 dark:bg-blue-600 dark:hover:bg-blue-700">
                <i class="fa-solid fa-ellipsis"></i>
            </button>
            <button type="button" class="remove-path rounded-lg text-white bg-red-600 hover:bg-red-700 focus:outline-none font-medium text-sm px-4 py-2 ms-2 dark:bg-red-500 dark:hover:bg-red-600">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        gamePathsContainer.appendChild(newPath);

        const selectPathButton = newPath.querySelector('.select-path');
        const pathInput = newPath.querySelector('.display-path');
        const removePathButton = newPath.querySelector('.remove-path');

        selectPathButton.addEventListener('click', async () => {
            const result = await window.api.invoke('open-dialog');
            if (result.filePaths && result.filePaths.length > 0) {
                if (!duplicatePathCheck(result.filePaths[0], pathInput)) {
                    pathInput.value = result.filePaths[0];
                } else {
                    showAlert('warning', await window.i18n.translate('settings.gameInstallExists'));
                }
            }
        });

        removePathButton.addEventListener('click', () => {
            newPath.remove();
        });
    }

    // Attach event listeners to any existing path selection buttons
    document.querySelectorAll('.game-path-item .select-path').forEach((button) => {
        button.addEventListener('click', async (event) => {
            const pathInput = event.currentTarget.parentElement.querySelector('.display-path');
            const result = await window.api.invoke('open-dialog');
            if (result.filePaths && result.filePaths.length > 0) {
                if (!duplicatePathCheck(result.filePaths[0], pathInput)) {
                    pathInput.value = result.filePaths[0];
                } else {
                    showAlert('warning', await window.i18n.translate('settings.gameInstallExists'));
                }
            }
        });
    });

    function duplicatePathCheck(newPath, currentInput) {
        let isDuplicate = false;
        document.querySelectorAll('.game-path-item .display-path').forEach((input) => {
            if (input !== currentInput && input.value.trim() === newPath.trim()) {
                isDuplicate = true;
            }
        });
        return isDuplicate;
    }
});

window.api.receive('apply-language', () => {
    updateTranslations(document);
    updateSelectedCountAndSize('backup');
    updateSelectedCountAndSize('restore');
});
