const restoreTableDataMap = new Map();
let restore_total_size = 0;
let restore_total_selected = 0;

window.api.receive('update-restore-table', () => {
    updateRestoreTable(true);
});

async function updateRestoreTable(loader) {
    if (loader) {
        await showLoadingIndicator('restore');
    }

    const gameData = await window.api.invoke('fetch-restore-table-data');
    await populateRestoreTable(gameData);
    updateSelectedCountAndSize('restore');

    if (loader) {
        hideLoadingIndicator('restore');
    }
}

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
                addPinIcon(row);
            }

            tableBody.appendChild(row);
        });
    };

    appendRowsToTable(pinnedGames, true);
    appendRowsToTable(otherGames, false);

    setupSelectAllCheckbox('restore', selectAllCheckbox);
}

function createRestoreTableRow(gameTitle, backupCount, backupSize, newestBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-wiki-id', wikiPageId);
    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
    row.innerHTML = `
        <td class="w-4 py-4 pl-4">
            <div class="flex items-center">
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:outline-none dark:bg-gray-700 dark:border-gray-600">
                <label class="sr-only">checkbox</label>
            </div>
        </td>
        <th scope="row" class="pr-6 py-4 truncate font-medium text-gray-900 whitespace-nowrap dark:text-white">
            ${gameTitle}
        </th>
        <td class="px-6 py-4 truncate">
            ${backupCount}
        </td>
        <td class="px-6 py-4 truncate">
            ${backupSize}
        </td>
        <td class="px-6 py-4 truncate newest-backup-time">
            ${newestBackupTime}
        </td>
        <td class="px-6 py-4 truncate text-center">
            <button class="dropdown-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-none dark:text-white"
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
        window.api.send('update-status', 'restoring', true);

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
    });
}

async function performRestore() {
    const selectedWikiIds = getSelectedWikiIds('restore');
    const restoreProgressId = 'restore-progress';
    const restoreProgressTitle = await window.api.invoke('translate', 'main.restore_in_progress');
    const totalGames = selectedWikiIds.length;

    const start = await operationStartCheck('restore');
    if (start) {
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

function showRestoreSummary(restoreCount, restoreFailed, errors, restoreSize) {
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
                    showModal(failed_message, errors);
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
