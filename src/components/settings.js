document.addEventListener('DOMContentLoaded', () => {
    const themeSelect = document.getElementById('theme');
    const languageSelect = document.getElementById('language');
    const backupPathInput = document.getElementById('backup-path');
    const backupPathButton = document.getElementById('select-path');
    const maxBackupsInput = document.getElementById('max-backups');

    window.api.receive('settings-value', (value) => {
        if (value) {
            themeSelect.value = value.theme;
            languageSelect.value = value.language;
            backupPathInput.value = value.backupPath;
            maxBackupsInput.value = value.maxBackups;
        }
        updateTranslations();
    });

    window.api.send('load-settings');

    // Event listeners for changes
    themeSelect.addEventListener('change', (event) => {
        window.api.send('save-settings', 'theme', event.target.value);
    });

    languageSelect.addEventListener('change', (event) => {
        window.api.send('save-settings', 'language', event.target.value);
    });

    backupPathButton.addEventListener('click', async () => {
        const result = await window.api.invoke('open-dialog');
        if (result.filePaths && result.filePaths.length > 0) {
            backupPathInput.value = result.filePaths[0];
            window.api.send('save-settings', 'backupPath', backupPathInput.value);
        }
    });

    maxBackupsInput.addEventListener('input', (event) => {
        window.api.send('save-settings', 'maxBackups', event.target.value);
    });
});
