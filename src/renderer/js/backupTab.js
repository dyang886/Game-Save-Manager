import { showAlert, showInfoModal, updateProgress, operationStartCheck } from './utility.js';
import { spinner, showLoadingIndicator, hideLoadingIndicator, updateNewestBackupTime, addPinIcon, getPlatformIcon, formatSize, updateSelectedCountAndSize, setupSelectAllCheckbox, getSelectedWikiIds } from './commonTabs.js';

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
        }
    }
});

async function updateBackupTable(loader) {
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
                addPinIcon(row);
            }

            tableBody.appendChild(row);
        });
    };

    appendRowsToTable(pinnedGames, true);
    appendRowsToTable(otherGames, false);

    setupSelectAllCheckbox('backup', selectAllCheckbox);
}

// Function to create a backup table row
function createBackupTableRow(gameTitle, platformIcons, backupSize, newestBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-wiki-id', wikiPageId);
    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
    row.innerHTML = `
        <td class="w-4 py-4 pl-4">
            <div class="flex items-center">
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:outline-hidden dark:bg-gray-700 dark:border-gray-600">
                <label class="sr-only">checkbox</label>
            </div>
        </td>
        <th scope="row" class="pr-6 py-4 truncate font-medium text-gray-900 whitespace-nowrap dark:text-white">
            ${gameTitle}
        </th>
        <td class="px-6 py-4 truncate">
            ${platformIcons}
        </td>
        <td class="px-6 py-4 truncate">
            ${backupSize}
        </td>
        <td class="px-6 py-4 truncate newest-backup-time">
            ${newestBackupTime}
        </td>
        <td class="px-6 py-4 truncate text-center">
            <button class="dropdown-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-hidden dark:text-white"
                type="button">
                <svg class="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox="0 0 16 3">
                    <path
                        d="M2 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6.041 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM14 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
                </svg>
            </button>
        </td>
    `;
    return row;
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
        selectedGames.forEach(async wikiId => {
            await updateNewestBackupTime('backup', wikiId);
        });
        document.querySelector('#backup-summary-done').classList.remove('hidden');

        // Re-enable the button and revert to the original state
        backupButton.disabled = false;
        backupButton.classList.remove('cursor-not-allowed');
        backupIcon.innerHTML = '';
        backupIcon.classList.add('fa-arrow-right-long');
        backupButton.setAttribute('data-i18n', 'main.backup_selected');
        backupText.textContent = await window.i18n.translate('main.backup_selected');
        window.api.send('update-status', 'backuping', false);
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
        await updateRestoreTable(true);
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
