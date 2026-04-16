import { showAlert, showInfoModal, updateProgress, operationStartCheck } from './utility.js';
import { spinner, showLoadingIndicator, hideLoadingIndicator, createRestoreTableRow, addOrUpdateTableRow, formatSize, updateSelectedCountAndSize, setupSelectAllCheckbox, getSelectedWikiIds, setIcon } from './commonTabs.js';

const restoreTableDataMap = new Map();
window.restoreTableDataMap = restoreTableDataMap;

document.addEventListener('DOMContentLoaded', () => {
    setupRestoreButton();
    updateRestoreTable(true);
});

window.api.receive('update-restore-table', () => {
    updateRestoreTable(true);
});

async function updateRestoreTable(loader) {
    window.api.send('update-status', 'updating_restore', true);
    if (loader) {
        await showLoadingIndicator('restore');
    }

    const gameData = await window.api.invoke('fetch-restore-table-data');
    await populateRestoreTable(gameData);
    updateSelectedCountAndSize('restore');

    if (loader) {
        hideLoadingIndicator('restore');
    }
    window.api.send('update-status', 'updating_restore', false);
}
window.updateRestoreTable = updateRestoreTable;

// Function to populate restore table
async function populateRestoreTable(data) {
    const restoreTable = document.querySelector('#restore');
    const tableBody = document.querySelector('#restore tbody');
    const selectAllCheckbox = restoreTable.querySelector('#restore-checkbox-all-search');

    const settings = await window.api.invoke('get-settings');
    const pinnedGamesWikiIds = settings.pinnedGames || [];
    const selectedWikiIds = getSelectedWikiIds('restore');

    tableBody.innerHTML = '';
    restoreTableDataMap.clear();

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
            restoreTableDataMap.set(wikiId, game);

            let gameTitle = game.title;
            if (game.zh_CN && settings.language === 'zh_CN') {
                gameTitle = game.zh_CN;
            }
            if (!gameTitle) {
                return;
            }

            const backupCount = game.backups.length;
            const backupSize = formatSize(game.backup_size);

            let row = createRestoreTableRow(gameTitle, backupCount, backupSize, game.latest_backup, game.wiki_page_id);

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

            // Check if any backup is permanent
            const hasPermamentBackup = game.backups.some(backup => backup.is_permanent);
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

    setupSelectAllCheckbox('restore', selectAllCheckbox);
}

function setupRestoreButton() {
    const restoreButton = document.getElementById('restore-button');
    const restoreIcon = document.getElementById('restore-icon');
    const restoreText = document.getElementById('restore-text');

    restoreButton.addEventListener('click', async () => {
        const selectedGames = getSelectedWikiIds('restore');

        if (restoreButton.disabled) return;
        if (selectedGames.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_games_selected'));
            return;
        }

        // Disable the button and change the appearance
        restoreButton.disabled = true;
        restoreButton.classList.add('cursor-not-allowed');
        restoreIcon.classList.remove('fa-arrow-right-long');
        restoreIcon.innerHTML = spinner;
        restoreButton.setAttribute('data-i18n', 'main.restore_in_progress');
        restoreText.textContent = await window.i18n.translate('main.restore_in_progress');

        await performRestore();
        document.querySelector('#restore-summary-done').classList.remove('hidden');

        // Re-enable the button and revert to the original state
        restoreButton.disabled = false;
        restoreButton.classList.remove('cursor-not-allowed');
        restoreIcon.innerHTML = '';
        restoreIcon.classList.add('fa-arrow-right-long');
        restoreButton.setAttribute('data-i18n', 'main.restore_selected');
        restoreText.textContent = await window.i18n.translate('main.restore_selected');
        window.api.send('update-status', 'restoring', false);

        // Update table rows in background
        (async () => {
            window.api.send('update-status', 'updating_backup', true);
            restoreButton.disabled = true;
            restoreButton.classList.add('cursor-not-allowed');
            restoreIcon.classList.remove('fa-arrow-right-long');
            restoreIcon.innerHTML = spinner;
            restoreButton.setAttribute('data-i18n', 'main.updating_restore');
            restoreText.textContent = await window.i18n.translate('main.updating_restore');

            for (const wikiId of selectedGames) {
                await addOrUpdateTableRow('backup', wikiId);
            }

            restoreButton.disabled = false;
            restoreButton.classList.remove('cursor-not-allowed');
            restoreIcon.innerHTML = '';
            restoreIcon.classList.add('fa-arrow-right-long');
            restoreButton.setAttribute('data-i18n', 'main.restore_selected');
            restoreText.textContent = await window.i18n.translate('main.restore_selected');
            window.api.send('update-status', 'updating_backup', false);
        })();
    });
}

async function performRestore() {
    const selectedWikiIds = getSelectedWikiIds('restore');
    const restoreProgressId = 'restore-progress';
    const restoreProgressTitle = await window.api.invoke('translate', 'main.restore_in_progress');
    const totalGames = selectedWikiIds.length;

    const start = await operationStartCheck('restore');
    if (start) {
        window.api.send('update-status', 'restoring', true);
        updateProgress(restoreProgressId, restoreProgressTitle, 'start');

        let restoreCount = 0;
        let restoreFailed = 0;
        let restoreSize = 0;
        let errors = [];
        let globalAction = null;

        for (const wikiId of selectedWikiIds) {
            const gameData = restoreTableDataMap.get(wikiId);
            const { action: actionForAll, error: newError } = await window.api.invoke('restore-game', gameData, globalAction);

            // Not counting games that are skipped
            if (newError) {
                restoreFailed += 1;
                restoreCount++;
                errors.push(newError);
            } else if (actionForAll !== 'skip') {
                restoreSize += gameData.backup_size;
                restoreCount++;
            }

            const progressPercentage = Math.round((restoreCount / totalGames) * 100);
            updateProgress(restoreProgressId, restoreProgressTitle, progressPercentage);

            if (actionForAll) {
                globalAction = actionForAll;
            }
        }

        updateProgress(restoreProgressId, restoreProgressTitle, 'end');
        showRestoreSummary(restoreCount, restoreFailed, errors, restoreSize);
    }
}

export function showRestoreSummary(restoreCount, restoreFailed, errors, restoreSize) {
    const restoreSummary = document.querySelector('#restore-summary');
    const restoreContent = document.querySelector('#restore-content');
    const restoreFailedContainer = document.querySelector('#restore-summary-total-failed-container');
    restoreSummary.classList.remove('hidden');
    restoreContent.classList.add('hidden');

    window.api.invoke('get-settings').then(async (settings) => {
        if (settings) {
            document.getElementById('restore-summary-total-games').textContent = restoreCount;
            document.getElementById('restore-summary-total-size').textContent = formatSize(restoreSize);
            document.getElementById('restore-summary-save-path').textContent = settings.backupPath;

            if (restoreFailed > 0) {
                const failed_message = await window.i18n.translate('summary.total_restore_failed', {
                    failed_count: restoreFailed
                });
                document.getElementById('restore-summary-total-failed').textContent = failed_message;
                document.getElementById('restore-failed-learn-more').addEventListener('click', () => {
                    showInfoModal(failed_message, [errors]);
                });
                restoreFailedContainer.classList.remove('hidden');
            } else {
                restoreFailedContainer.classList.add('hidden');
            }
        }
    });

    document.querySelector('#restore-summary-done').addEventListener('click', (event) => {
        restoreContent.classList.remove('animate-fadeInShift', 'animate-fadeOut');
        restoreSummary.classList.add('hidden');
        restoreContent.classList.remove('hidden');
        event.target.closest('button').classList.add('hidden');
    });
}
window.showRestoreSummary = showRestoreSummary;