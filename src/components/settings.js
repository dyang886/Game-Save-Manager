const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const themeSelect = document.getElementById('theme');
    const languageSelect = document.getElementById('language');
    const backupPathInput = document.getElementById('backup-path');
    const maxBackupsInput = document.getElementById('max-backups');

    // Load existing settings
    ipcRenderer.on('settings-value', (event, value) => {
        if (value) {
            themeSelect.value = value.theme || 'light';
            languageSelect.value = value.language || 'en';
            backupPathInput.value = value.backupPath || '';
            maxBackupsInput.value = value.maxBackups || 1;
        }
    });

    ipcRenderer.on('apply-theme', (event, theme) => {
        document.body.classList.toggle('dark', theme === 'dark');
    });

    ipcRenderer.send('load-settings', 'all');

    // Event listeners for changes
    themeSelect.addEventListener('change', (event) => {
        ipcRenderer.send('save-settings', 'theme', event.target.value);
        document.body.classList.toggle('dark', event.target.value === 'dark');
    });

    languageSelect.addEventListener('change', (event) => {
        ipcRenderer.invoke('change-language', event.target.value).then(() => {
            ipcRenderer.send('save-settings', 'language', event.target.value);
        });
    });

    backupPathInput.addEventListener('input', (event) => {
        ipcRenderer.send('save-settings', 'backupPath', event.target.value);
    });

    maxBackupsInput.addEventListener('input', (event) => {
        ipcRenderer.send('save-settings', 'maxBackups', event.target.value);
    });    
});
