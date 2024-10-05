const backupTableDataMap = new Map();
let backup_total_size = 0;
let backup_total_selected = 0;

window.api.receive('update-backup-table', async () => {
    await updateBackupTable(true);
});

async function updateBackupTable(loader) {
    if (loader) {
        await showLoadingIndicator('backup');
    }

    const gameData = await window.api.invoke('fetch-game-saves');
    const iconMap = await window.api.invoke('get-icon-map');
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
    const pinnedGames = await sortGames(
        gamesWithTitleToSort.filter(game => pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    const otherGames = await sortGames(
        gamesWithTitleToSort.filter(game => !pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    // Append rows to the table body
    const appendRowsToTable = (games, isPinned) => {
        games.forEach((game) => {
            const wikiId = parseInt(game.wiki_page_id);
            backupTableDataMap.set(wikiId, game);

            let gameTitle = game.title;
            if (game.zh_CN && settings.language === 'zh_CN') {
                gameTitle = game.zh_CN;
            }
            if (!gameTitle) {
                return;
            }

            const sortedPlatforms = platformOrder.filter(platform => game.platform.includes(platform));
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
                row = addPinIcon(row);
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
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:outline-none dark:bg-gray-700 dark:border-gray-600">
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

function setupBackupButton() {
    const backupButton = document.getElementById('backup-button');
    const backupIcon = document.getElementById('backup-icon');
    const backupText = document.getElementById('backup-text');

    backupButton.addEventListener('click', async () => {
        if (backupButton.disabled) return;

        // Disable the button and change the appearance
        backupButton.disabled = true;
        backupButton.classList.add('cursor-not-allowed');
        backupIcon.classList.remove('fa-arrow-right-long');
        backupIcon.innerHTML = `
            <svg aria-hidden="true" role="status" class="inline w-4 h-4 text-white animate-spin"
                viewBox="0 0 100 101" fill="none">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                    fill="#E5E7EB" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentColor" />
            </svg>`;
        backupButton.setAttribute('data-i18n', 'main.backup_in_progress');
        backupText.textContent = await window.i18n.translate('main.backup_in_progress');

        const exitCode = await performBackup();
        if (!exitCode) {
            showBackupSummary();
            getSelectedWikiIds('backup').forEach(async wikiId => {
                await updateNewestBackupTime('backup', wikiId);
            });
            await updateRestoreTable(true);
            document.querySelector('#backup-summary-done').classList.remove('hidden');
        }

        // Re-enable the button and revert to the original state
        backupButton.disabled = false;
        backupButton.classList.remove('cursor-not-allowed');
        backupIcon.innerHTML = '';
        backupIcon.classList.add('fa-arrow-right-long');
        backupButton.setAttribute('data-i18n', 'main.backup_selected');
        backupText.textContent = await window.i18n.translate('main.backup_selected');
    });
}

async function performBackup() {
    const selectedWikiIds = getSelectedWikiIds('backup');

    if (selectedWikiIds.length === 0) {
        showAlert('warning', await window.i18n.translate('alert.no_games_selected'));
        return 1;
    }

    for (const wikiId of selectedWikiIds) {
        const gameData = backupTableDataMap.get(wikiId);
        await window.api.invoke('backup-game', gameData);
    }

    return 0;
}

function showBackupSummary() {
    const backupSummary = document.querySelector('#backup-summary');
    const backupContent = document.querySelector('#backup-content');
    backupSummary.classList.remove('hidden');
    backupContent.classList.add('hidden');

    const selectedWikiIds = getSelectedWikiIds('backup');
    let total_size = 0;
    let total_selected = 0;

    selectedWikiIds.forEach(wikiId => {
        const gameData = backupTableDataMap.get(wikiId);
        if (gameData) {
            total_size += gameData.backup_size;
            total_selected += 1;
        }
    });

    window.api.invoke('get-settings').then((settings) => {
        if (settings) {
            document.getElementById('backup-summary-total-games').textContent = total_selected;
            document.getElementById('backup-summary-total-size').textContent = formatSize(total_size);
            document.getElementById('backup-summary-save-path').textContent = settings.backupPath;
        }
    });

    document.querySelector('#backup-summary-done').addEventListener('click', (event) => {
        backupContent.classList.remove('animate-fadeInShift', 'animate-fadeOut');
        backupSummary.classList.add('hidden');
        backupContent.classList.remove('hidden');
        event.target.closest('button').classList.add('hidden');
    });
}
