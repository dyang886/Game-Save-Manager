import { showAlert, showInfoModal, updateProgress, operationStartCheck } from './utility.js';
import { spinner, showLoadingIndicator, hideLoadingIndicator, createBackupTableRow, addOrUpdateTableRow, getPlatformIcon, formatSize, updateSelectedCountAndSize, setupSelectAllCheckbox, getSelectedWikiIds, setIcon } from './commonTabs.js';

const backupTableDataMap = new Map();
window.backupTableDataMap = backupTableDataMap;

document.addEventListener('DOMContentLoaded', async () => {
    setupBackupTabButtons();

    const settings = await window.api.invoke('get-settings');
    if (settings.autoDbUpdate) {
        await updateDatabase();
    }
    await updateBackupTable(true);
});

window.api.receive('update-backup-table', () => {
    updateBackupTable(true);
});

window.api.receive('scan-full', async () => {
    const start = await operationStartCheck('scan-full');
    if (start) {
        const iconMap = await window.api.invoke('get-icon-map');
        const fullScanGameData = await window.api.invoke('start-scan-full');

        if (fullScanGameData) {
            window.api.send('update-status', 'updating_backup', true);
            await showLoadingIndicator('backup');
            let normalScanGameData = await window.api.invoke('fetch-backup-table-data', true);

            const allIds = new Set(fullScanGameData.map(game => game.wiki_page_id));
            const installedGameIds = new Set(normalScanGameData.map(game => game.wiki_page_id));
            const uninstalledGameIds = [...allIds].filter(id => !installedGameIds.has(id));
            if (uninstalledGameIds.length > 0) {
                window.api.send('save-settings', 'uninstalledGames', uninstalledGameIds);
            }

            normalScanGameData = await window.api.invoke('fetch-backup-table-data');
            await populateBackupTable(normalScanGameData, iconMap);
            updateSelectedCountAndSize('backup');
            hideLoadingIndicator('backup');
            window.api.send('update-status', 'updating_backup', false);
        }
    }
});

export async function updateBackupTable(loader) {
    window.api.send('update-status', 'updating_backup', true);
    if (loader) {
        await showLoadingIndicator('backup');
    }

    const iconMap = await window.api.invoke('get-icon-map');
    const gameData = await window.api.invoke('fetch-backup-table-data');
    await populateBackupTable(gameData, iconMap);
    updateSelectedCountAndSize('backup');

    if (loader) {
        hideLoadingIndicator('backup');
    }
    window.api.send('update-status', 'updating_backup', false);
}

// Function to populate backup table
async function populateBackupTable(data, iconMap) {
    const backupTable = document.querySelector('#backup');
    const tableBody = document.querySelector('#backup tbody');
    const selectAllCheckbox = backupTable.querySelector('#backup-checkbox-all-search');

    const settings = await window.api.invoke('get-settings');
    const pinnedGamesWikiIds = settings.pinnedGames || [];
    const selectedWikiIds = getSelectedWikiIds('backup');

    const platformOrder = ['Custom', 'Steam', 'Ubisoft', 'EA', 'Epic', 'GOG', 'Xbox', 'Blizzard'];

    tableBody.innerHTML = '';
    backupTableDataMap.clear();

    const gamesWithTitleToSort = await Promise.all(
        data.map(async (game) => {
            const titleToSort = settings.language === 'zh_CN'
                ? game.zh_CN || game.title
                : game.title;
            return { ...game, titleToSort };
        })
    );

    // Split and sort pinned and unpinned games
    const pinnedGames = await window.api.invoke(
        'sort-games',
        gamesWithTitleToSort.filter(game => pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    const otherGames = await window.api.invoke(
        'sort-games',
        gamesWithTitleToSort.filter(game => !pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    // Append rows to the table body
    const autoBackupState = await window.api.invoke('get-auto-backup-state');
    const autoBackupSet = new Set(Object.keys(autoBackupState));

    const appendRowsToTable = (games, isPinned) => {
        games.forEach((game) => {
            const wikiId = game.wiki_page_id;
            backupTableDataMap.set(wikiId, game);

            let gameTitle = game.title;
            if (game.zh_CN && settings.language === 'zh_CN') {
                gameTitle = game.zh_CN;
            }
            if (!gameTitle) {
                return;
            }

            const sortedPlatforms = platformOrder.filter(platform => (game.platform || []).includes(platform));
            const platformIcons = sortedPlatforms.map(platform => getPlatformIcon(platform, iconMap)).join(' ');
            const backupSize = formatSize(game.backup_size);

            let row = createBackupTableRow(gameTitle, platformIcons, backupSize, game.latest_backup, game.wiki_page_id);

            // Check if selected
            if (selectedWikiIds.includes(wikiId)) {
                const checkbox = row.querySelector('.row-checkbox');
                if (checkbox) {
                    checkbox.checked = true;
                }
            }

            // Check if pinned
            if (isPinned) {
                setIcon(row, 'pin', true);
            }

            // Check if any backup is permanent by looking at restore table data which has is_permanent
            const restoreGameData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
            const hasPermamentBackup = restoreGameData && restoreGameData.backups && restoreGameData.backups.some(backup => backup.is_permanent);
            if (hasPermamentBackup) {
                setIcon(row, 'star', true);
            }

            // Check if auto backup is active
            if (autoBackupSet.has(wikiId.toString())) {
                setIcon(row, 'timer', true);
            }

            tableBody.appendChild(row);
        });
    };

    appendRowsToTable(pinnedGames, true);
    appendRowsToTable(otherGames, false);

    setupSelectAllCheckbox('backup', selectAllCheckbox);
}

function setupBackupTabButtons() {
    const backupButton = document.getElementById('backup-button');
    const backupIcon = document.getElementById('backup-icon');
    const backupText = document.getElementById('backup-text');

    backupButton.addEventListener('click', async () => {
        const selectedGames = getSelectedWikiIds('backup');

        if (backupButton.disabled) return;
        if (selectedGames.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_games_selected'));
            return;
        }
        window.api.send('update-status', 'backuping', true);

        // Disable the button and change the appearance
        backupButton.disabled = true;
        backupButton.classList.add('cursor-not-allowed');
        backupIcon.classList.remove('fa-arrow-right-long');
        backupIcon.innerHTML = spinner;
        backupButton.setAttribute('data-i18n', 'main.backup_in_progress');
        backupText.textContent = await window.i18n.translate('main.backup_in_progress');

        await performBackup();
        document.querySelector('#backup-summary-done').classList.remove('hidden');

        // Re-enable the button and revert to the original state
        backupButton.disabled = false;
        backupButton.classList.remove('cursor-not-allowed');
        backupIcon.innerHTML = '';
        backupIcon.classList.add('fa-arrow-right-long');
        backupButton.setAttribute('data-i18n', 'main.backup_selected');
        backupText.textContent = await window.i18n.translate('main.backup_selected');
        window.api.send('update-status', 'backuping', false);

        // Update table rows in background
        (async () => {
            window.api.send('update-status', 'updating_backup', true);
            window.api.send('update-status', 'updating_restore', true);
            backupButton.disabled = true;
            backupButton.classList.add('cursor-not-allowed');
            backupIcon.classList.remove('fa-arrow-right-long');
            backupIcon.innerHTML = spinner;
            backupButton.setAttribute('data-i18n', 'main.updating_backup');
            backupText.textContent = await window.i18n.translate('main.updating_backup');

            for (const wikiId of selectedGames) {
                await addOrUpdateTableRow('backup', wikiId);
                await addOrUpdateTableRow('restore', wikiId);
            }

            backupButton.disabled = false;
            backupButton.classList.remove('cursor-not-allowed');
            backupIcon.innerHTML = '';
            backupIcon.classList.add('fa-arrow-right-long');
            backupButton.setAttribute('data-i18n', 'main.backup_selected');
            backupText.textContent = await window.i18n.translate('main.backup_selected');
            window.api.send('update-status', 'updating_backup', false);
            window.api.send('update-status', 'updating_restore', false);
        })();
    });

    document.getElementById('update-database').addEventListener('click', async () => {
        await updateDatabase();
    });
}

async function performBackup() {
    const selectedWikiIds = getSelectedWikiIds('backup');
    const backupProgressId = 'backup-progress';
    const backupProgressTitle = await window.api.invoke('translate', 'main.backup_in_progress');
    const totalGames = selectedWikiIds.length;

    const start = await operationStartCheck('backup');
    if (start) {
        updateProgress(backupProgressId, backupProgressTitle, 'start');

        let backupCount = 0;
        let backupFailed = 0;
        let backupSize = 0;
        let errors = [];

        for (const wikiId of selectedWikiIds) {
            const gameData = backupTableDataMap.get(wikiId);
            const newError = await window.api.invoke('backup-game', gameData);

            if (newError) {
                backupFailed += 1;
                errors.push(newError);
            } else {
                backupSize += gameData.backup_size;
            }

            backupCount++;
            const progressPercentage = Math.round((backupCount / totalGames) * 100);
            updateProgress(backupProgressId, backupProgressTitle, progressPercentage);
        }

        updateProgress(backupProgressId, backupProgressTitle, 'end');
        showBackupSummary(backupCount, backupFailed, errors, backupSize);
    }
}

function showBackupSummary(backupCount, backupFailed, errors, backupSize) {
    const backupSummary = document.querySelector('#backup-summary');
    const backupContent = document.querySelector('#backup-content');
    const backupFailedContainer = document.querySelector('#backup-summary-total-failed-container');
    backupSummary.classList.remove('hidden');
    backupContent.classList.add('hidden');

    window.api.invoke('get-settings').then(async (settings) => {
        if (settings) {
            document.getElementById('backup-summary-total-games').textContent = backupCount;
            document.getElementById('backup-summary-total-size').textContent = formatSize(backupSize);
            document.getElementById('backup-summary-save-path').textContent = settings.backupPath;

            if (backupFailed > 0) {
                const failed_message = await window.i18n.translate('summary.total_backup_failed', {
                    failed_count: backupFailed
                });
                document.getElementById('backup-summary-total-failed').textContent = failed_message;
                document.getElementById('backup-failed-learn-more').addEventListener('click', () => {
                    showInfoModal(failed_message, [errors]);
                });
                backupFailedContainer.classList.remove('hidden');
            } else {
                backupFailedContainer.classList.add('hidden');
            }
        }
    });

    document.querySelector('#backup-summary-done').addEventListener('click', (event) => {
        backupContent.classList.remove('animate-fadeInShift', 'animate-fadeOut');
        backupSummary.classList.add('hidden');
        backupContent.classList.remove('hidden');
        event.target.closest('button').classList.add('hidden');
    });
}

async function updateDatabase() {
    const updateButton = document.getElementById('update-database');
    const updateButtonIcon = document.getElementById('update-database-icon');
    const updateButtonText = document.getElementById('update-database-text');

    if (updateButton.disabled) return;

    const start = await operationStartCheck('update-db');
    if (start) {
        window.api.send('update-status', 'updating_db', true);
        updateButton.disabled = true;
        updateButton.classList.add('cursor-not-allowed');
        updateButtonIcon.innerHTML = spinner;
        updateButtonIcon.classList.remove('fa-rotate');
        updateButton.setAttribute('data-i18n', 'alert.updating_database');
        updateButtonText.textContent = await window.i18n.translate('alert.updating_database');

        await window.api.invoke('update-database');

        window.api.send('update-status', 'updating_db', false);
        updateButton.disabled = false;
        updateButton.classList.remove('cursor-not-allowed');
        updateButtonIcon.innerHTML = '';
        updateButtonIcon.classList.add('fa-rotate');
        updateButton.setAttribute('data-i18n', 'main.update_database');
        updateButtonText.textContent = await window.i18n.translate('main.update_database');
        updateBackupTable(true);
    }
}
