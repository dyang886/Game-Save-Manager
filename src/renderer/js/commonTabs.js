import { showAlert, updateTranslations, updateProgress, operationStartCheck, wrapNumberInput } from './utility.js';
import { checkAndWarnUnsavedChanges } from './customTab.js';

document.addEventListener('DOMContentLoaded', () => {
    updateTranslations(document);
    initializeTabs();
    setupSearchFilter('backup');
    setupSearchFilter('restore');
    setDropDownAction();
});

window.api.receive('apply-language', () => {
    updateTranslations(document);
    updateSelectedCountAndSize('backup');
    updateSelectedCountAndSize('restore');
});

// Auto backup IPC receivers
window.api.receive('auto-backup-started', (wikiId) => {
    const backupRow = document.querySelector(`#backup tbody tr[data-wiki-id="${wikiId}"]`);
    const restoreRow = document.querySelector(`#restore tbody tr[data-wiki-id="${wikiId}"]`);
    if (backupRow) setIcon(backupRow, 'timer', true);
    if (restoreRow) setIcon(restoreRow, 'timer', true);
});

window.api.receive('auto-backup-stopped', (wikiId) => {
    const backupRow = document.querySelector(`#backup tbody tr[data-wiki-id="${wikiId}"]`);
    const restoreRow = document.querySelector(`#restore tbody tr[data-wiki-id="${wikiId}"]`);
    if (backupRow) setIcon(backupRow, 'timer', false);
    if (restoreRow) setIcon(restoreRow, 'timer', false);
});

window.api.receive('auto-backup-performed', async (wikiId) => {
    await addOrUpdateTableRow('backup', wikiId);
    await addOrUpdateTableRow('restore', wikiId);
});

export const spinner = `
    <svg aria-hidden="true" role="status" class="inline w-4 h-4 text-white animate-spin"
        viewBox="0 0 100 101" fill="none">
        <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
            fill="#E5E7EB" />
        <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentColor" />
    </svg>
`;

// Function to initialize the tab switching functionality
function initializeTabs() {
    const tabsElement = document.getElementById('main-tab');
    const tabElements = [
        { id: 'backup', triggerEl: document.querySelector('#backup-tab'), targetEl: document.querySelector('#backup') },
        { id: 'restore', triggerEl: document.querySelector('#restore-tab'), targetEl: document.querySelector('#restore') },
        { id: 'custom', triggerEl: document.querySelector('#custom-tab'), targetEl: document.querySelector('#custom') },
    ];

    const options = {
        defaultTabId: 'backup',
        activeClasses: 'text-blue-600 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-400 border-blue-600 dark:border-blue-500',
        inactiveClasses: 'text-gray-500 hover:text-gray-600 dark:text-gray-400 border-gray-100 hover:border-gray-300 dark:border-gray-700 dark:hover:text-gray-300',
    };

    if (tabsElement) {
        const defaultTab = tabElements.find(tab => tab.id === options.defaultTabId);
        if (defaultTab) {
            showTab(defaultTab, tabElements, options);
        }

        tabElements.forEach(tab => {
            tab.triggerEl.addEventListener('click', async () => {
                // Check for unsaved changes in custom tab before leaving it
                const currentCustomTab = tabElements.find(t => t.id === 'custom' && !t.targetEl.classList.contains('hidden'));
                if (currentCustomTab && tab.id !== 'custom') {
                    const canLeave = await checkAndWarnUnsavedChanges();
                    if (!canLeave) {
                        return;
                    }
                }

                const contentEl = document.getElementById(`${tab.id}-content`);
                if (contentEl) {
                    contentEl.classList.remove('animate-fadeInShift', 'animate-fadeOut');
                }
                if (tab.id === 'custom') {
                    loadEntriesFromJson();
                }
                showTab(tab, tabElements, options);
            });
        });
    }
}

// Function to handle tab switching logic
function showTab(tab, tabElements, options) {
    tabElements.forEach(t => {
        if (t.id === tab.id) {
            t.triggerEl.classList.add(...options.activeClasses.split(' '));
            t.triggerEl.classList.remove(...options.inactiveClasses.split(' '));
            t.targetEl.classList.remove('hidden');
        } else {
            t.triggerEl.classList.remove(...options.activeClasses.split(' '));
            t.triggerEl.classList.add(...options.inactiveClasses.split(' '));
            t.targetEl.classList.add('hidden');
        }
    });

    if (typeof options.onShow === 'function') {
        options.onShow(tab);
    }
}

const loader = `
    <svg data-loader-active="true" aria-hidden="true" class="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none">
        <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
        <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
    </svg>
    <span class="text-content pl-3 text-gray-900 dark:text-white">Loading...</span>
`;

export async function showLoadingIndicator(tabName) {
    const loadingContainer = document.getElementById(`${tabName}-loading`);
    const actionSummary = document.querySelector(`#${tabName}-summary`);
    const contentContainer = document.getElementById(`${tabName}-content`);
    const actionButton = document.getElementById(`${tabName}-button`);

    actionSummary.classList.add('hidden');
    document.querySelector(`#${tabName}-summary-done`).classList.add('hidden');
    actionButton.disabled = true;
    actionButton.classList.add('cursor-not-allowed');

    if (contentContainer && window.getComputedStyle(contentContainer).display !== 'none') {
        contentContainer.classList.remove('animate-fadeInShift');
        contentContainer.classList.add('animate-fadeOut');

        await new Promise(resolve => setTimeout(resolve, 300));
        contentContainer.classList.add('hidden');

        if (loadingContainer) {
            loadingContainer.innerHTML = loader;
            const loadingTextKey = loadingContainer.getAttribute('data-i18n');
            loadingContainer.querySelector('.text-content').textContent = await window.i18n.translate(loadingTextKey);
            loadingContainer.classList.remove('hidden');
        }

        // First time showing loader without table content
    } else {
        if (loadingContainer) {
            loadingContainer.innerHTML = loader;
            const loadingTextKey = loadingContainer.getAttribute('data-i18n');
            loadingContainer.querySelector('.text-content').textContent = await window.i18n.translate(loadingTextKey);
            loadingContainer.classList.remove('hidden');
        }
    }
}

export function hideLoadingIndicator(tabName) {
    const loadingContainer = document.getElementById(`${tabName}-loading`);
    const contentContainer = document.getElementById(`${tabName}-content`);
    const actionButton = document.getElementById(`${tabName}-button`);

    actionButton.disabled = false;
    actionButton.classList.remove('cursor-not-allowed');

    if (loadingContainer) {
        loadingContainer.classList.add('hidden');
    }

    if (contentContainer) {
        contentContainer.classList.remove('hidden');
        contentContainer.classList.remove('animate-fadeOut');
        contentContainer.classList.add('animate-fadeInShift');
    }
}

// Function to set up the search filter for the table
function setupSearchFilter(tabName) {
    const searchInput = document.getElementById(`${tabName}-search`);
    const tableBody = document.querySelector(`#${tabName} tbody`);

    searchInput.addEventListener('input', function () {
        const filter = searchInput.value.toLowerCase();
        const rows = tableBody.querySelectorAll('tr');

        rows.forEach(row => {
            const gameNameCell = row.querySelector('th[scope="row"]');
            const gameName = gameNameCell ? gameNameCell.textContent.toLowerCase() : '';
            row.style.display = gameName.includes(filter) ? '' : 'none';
        });
    });
}



export function setIcon(row, iconName, show) {
    const titleCell = row.querySelector('th[scope="row"]');
    if (!titleCell) return;

    const iconSpan = titleCell.querySelector(`span[data-icon="${iconName}"]`);
    if (iconSpan) {
        iconSpan.classList.toggle('hidden', !show);
    }
}

export function getPlatformIcon(platform, iconMap) {
    return iconMap[platform] || '';
}

export function formatSize(sizeInBytes) {
    if (sizeInBytes === 0) return '0 B';
    const i = Math.floor(Math.log(sizeInBytes) / Math.log(1024));
    return (sizeInBytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}

const platformOrder = ['Custom', 'Steam', 'Ubisoft', 'EA', 'Epic', 'GOG', 'Xbox', 'Blizzard'];

export function createBackupTableRow(gameTitle, platformIcons, backupSize, newestBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-wiki-id', wikiPageId);
    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
    row.innerHTML = `
        <td class="py-4 pl-4">
            <div class="flex items-center">
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:outline-hidden dark:bg-gray-700 dark:border-gray-600">
                <label class="sr-only">checkbox</label>
            </div>
        </td>
        <th scope="row" class="pr-6 py-4 truncate font-medium text-gray-900 whitespace-nowrap dark:text-white">
            <span data-icon="pin" class="hidden"><i class="fa-solid fa-thumbtack text-red-500 mr-2"></i></span>
            <span data-icon="star" class="hidden"><i class="fa-solid fa-star text-yellow-500 mr-2"></i></span>
            <span data-icon="timer" class="hidden"><i class="fa-solid fa-hourglass text-blue-500 mr-2"></i></span>
            ${gameTitle}
        </th>
        <td class="px-6 py-4 truncate">
            ${platformIcons}
        </td>
        <td class="px-6 py-4 truncate backup-size">
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

export function createRestoreTableRow(gameTitle, backupCount, backupSize, newestBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-wiki-id', wikiPageId);
    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
    row.innerHTML = `
        <td class="py-4 pl-4">
            <div class="flex items-center">
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:outline-hidden dark:bg-gray-700 dark:border-gray-600">
                <label class="sr-only">checkbox</label>
            </div>
        </td>
        <th scope="row" class="pr-6 py-4 truncate font-medium text-gray-900 whitespace-nowrap dark:text-white">
            <span data-icon="pin" class="hidden"><i class="fa-solid fa-thumbtack text-red-500 mr-2"></i></span>
            <span data-icon="star" class="hidden"><i class="fa-solid fa-star text-yellow-500 mr-2"></i></span>
            <span data-icon="timer" class="hidden"><i class="fa-solid fa-hourglass text-blue-500 mr-2"></i></span>
            ${gameTitle}
        </th>
        <td class="px-6 py-4 truncate backup-count">
            ${backupCount}
        </td>
        <td class="px-6 py-4 truncate backup-size">
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

export async function addOrUpdateTableRow(tabName, wikiId) {
    let gameData;
    if (tabName === 'backup') {
        const games = await window.api.invoke('fetch-backup-table-data', null, wikiId);
        gameData = games && games.length > 0 ? games[0] : null;
    } else {
        const games = await window.api.invoke('fetch-restore-table-data', wikiId);
        gameData = games && games.length > 0 ? games[0] : null;
    }
    if (!gameData) return;

    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;
    dataMap.set(wikiId, gameData);

    const existingRow = document.querySelector(`#${tabName} tbody tr[data-wiki-id="${wikiId}"]`);

    if (existingRow) {
        // Update existing row cells
        const sizeCell = existingRow.querySelector('.backup-size');
        if (sizeCell) sizeCell.textContent = formatSize(gameData.backup_size);
        const timeCell = existingRow.querySelector('.newest-backup-time');
        if (timeCell) timeCell.textContent = gameData.latest_backup;
        if (tabName === 'restore') {
            const countCell = existingRow.querySelector('.backup-count');
            if (countCell) countCell.textContent = gameData.backups.length;
        }
    } else {
        // Create and append new row
        const settings = await window.api.invoke('get-settings');
        let gameTitle = gameData.title;
        if (gameData.zh_CN && settings.language === 'zh_CN') {
            gameTitle = gameData.zh_CN;
        }
        if (!gameTitle) return;

        let row;
        if (tabName === 'backup') {
            const iconMap = await window.api.invoke('get-icon-map');
            const sortedPlatforms = platformOrder.filter(platform => (gameData.platform || []).includes(platform));
            const platformIcons = sortedPlatforms.map(platform => getPlatformIcon(platform, iconMap)).join(' ');
            row = createBackupTableRow(gameTitle, platformIcons, formatSize(gameData.backup_size), gameData.latest_backup, wikiId);

            const restoreGameData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
            const hasPermanent = restoreGameData && restoreGameData.backups && restoreGameData.backups.some(b => b.is_permanent);
            if (hasPermanent) setIcon(row, 'star', true);
        } else {
            row = createRestoreTableRow(gameTitle, gameData.backups.length, formatSize(gameData.backup_size), gameData.latest_backup, wikiId);

            const hasPermanent = gameData.backups.some(b => b.is_permanent);
            if (hasPermanent) setIcon(row, 'star', true);
        }

        const pinnedGamesWikiIds = settings.pinnedGames || [];
        const isPinned = pinnedGamesWikiIds.includes(wikiId.toString());
        if (isPinned) {
            setIcon(row, 'pin', true);
        }

        // Check if auto backup is active
        const autoBackupState = await window.api.invoke('get-auto-backup-state');
        if (autoBackupState[wikiId.toString()]) {
            setIcon(row, 'timer', true);
        }

        // Insert row in sorted position
        const tableBody = document.querySelector(`#${tabName} tbody`);
        const siblingRows = Array.from(tableBody.querySelectorAll('tr'))
            .filter(r => {
                const pinned = !r.querySelector('span[data-icon="pin"].hidden');
                return isPinned ? pinned : !pinned;
            })
            .concat({ getAttribute: () => wikiId.toString(), querySelector: () => ({ textContent: gameTitle }) })
            .map(r => ({
                wikiId: r.getAttribute('data-wiki-id'),
                titleToSort: r.querySelector('th[scope="row"]').textContent.trim()
            }));

        const sorted = await window.api.invoke('sort-games', siblingRows);
        const targetIndex = sorted.findIndex(g => g.wikiId === wikiId.toString());

        if (isPinned) {
            // Insert among pinned rows
            if (targetIndex === 0) {
                tableBody.insertBefore(row, tableBody.firstChild);
            } else {
                const prevRow = tableBody.querySelector(`tr[data-wiki-id="${sorted[targetIndex - 1].wikiId}"]`);
                tableBody.insertBefore(row, prevRow.nextSibling);
            }
        } else {
            // Insert among unpinned rows
            if (targetIndex === 0) {
                const lastPinnedRow = Array.from(tableBody.querySelectorAll('tr'))
                    .reverse()
                    .find(r => !r.querySelector('span[data-icon="pin"].hidden'));
                if (lastPinnedRow) {
                    tableBody.insertBefore(row, lastPinnedRow.nextSibling);
                } else {
                    tableBody.insertBefore(row, tableBody.firstChild);
                }
            } else {
                const prevRow = tableBody.querySelector(`tr[data-wiki-id="${sorted[targetIndex - 1].wikiId}"]`);
                tableBody.insertBefore(row, prevRow.nextSibling);
            }
        }
    }
}

// Helper function to remove a game row from a tab's table and clean up its data map
function removeTableRow(tabName, wikiId) {
    const row = document.querySelector(`#${tabName} tbody tr[data-wiki-id="${wikiId}"]`);
    if (row) {
        row.remove();
    }
    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;
    dataMap.delete(wikiId);
    updateSelectedCountAndSize(tabName);
}

async function createDropdownMenu(wikiPageId, tabName) {
    let action = 'pin-on-top';
    let i18nKey = 'main.pin_on_top';

    const settings = await window.api.invoke('get-settings');
    if (settings && settings.pinnedGames.includes(wikiPageId.toString())) {
        action = 'unpin';
        i18nKey = 'main.unpin';
    }
    const wikiUrl = !wikiPageId.includes('-') ? `https://www.pcgamingwiki.com/wiki/index.php?curid=${wikiPageId}` : "none";

    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'bg-white rounded-lg shadow-sm w-48 dark:bg-gray-700 absolute hidden animate-fadeInShift';
    dropdownMenu.innerHTML = `
        <ul class="py-2 text-sm text-gray-700 dark:text-gray-200">
            <li>
                <a href="#" data-action="${action}" data-id="${wikiPageId}" data-i18n="${i18nKey}"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content"></span>
                </a>
            </li>
            <li>
                <a href="#" data-action="open-wiki" data-url="${wikiUrl}" data-i18n="main.view_wiki"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content">View on PCGamingWiki</span>
                </a>
            </li>
            <li>
                <a href="#" data-action="manage-backups" data-id="${wikiPageId}" data-i18n="main.manage_backups"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content">Manage Backups</span>
                </a>
            </li>
            ${tabName !== 'restore' ? `<li>
                <a href="#" data-action="auto-backup" data-id="${wikiPageId}" data-i18n="main.auto_backup"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content"></span>
                </a>
            </li>` : ''}
        </ul>
    `;
    dropdownMenu.querySelectorAll('.text-content').forEach(async (span) => {
        span.textContent = await window.i18n.translate(span.parentElement.getAttribute('data-i18n'));
    })
    document.body.appendChild(dropdownMenu);
    return dropdownMenu;
}

function positionDropdownMenu(button, dropdownMenu) {
    const buttonRect = button.getBoundingClientRect();
    const dropdownLeft = buttonRect.left + window.scrollX - buttonRect.width * 2;
    const dropdownTop = buttonRect.bottom + window.scrollY;

    dropdownMenu.style.top = `${dropdownTop}px`;
    dropdownMenu.style.left = `${dropdownLeft}px`;
    dropdownMenu.classList.remove('hidden');
}

function setDropDownAction() {
    let activeDropdownMenu = null;
    let lastButtonClicked = null;

    function removeDropDown() {
        activeDropdownMenu.remove();
        activeDropdownMenu = null;
        lastButtonClicked = null;
    }

    document.addEventListener('click', async (event) => {
        const button = event.target.closest('.dropdown-menu-button');

        // Handle actions in the dropdown menu
        let actionElement = event.target;
        if (actionElement.tagName === 'SPAN') {
            actionElement = actionElement.closest('a');
        }
        if (actionElement && actionElement.dataset.action === 'pin-on-top') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                window.api.invoke('get-settings').then((settings) => {
                    if (settings) {
                        let pinned_games_wiki_ids = new Set(settings['pinnedGames']);
                        pinned_games_wiki_ids.add(wikiId);
                        window.api.send('save-settings', 'pinnedGames', Array.from(pinned_games_wiki_ids));
                        pinGameOnTop('backup', wikiId);
                        pinGameOnTop('restore', wikiId);
                    }
                });
            }
            removeDropDown();
            return;
        }
        if (actionElement && actionElement.dataset.action === 'unpin') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                window.api.invoke('get-settings').then((settings) => {
                    if (settings) {
                        let pinned_games_wiki_ids = new Set(settings['pinnedGames']);
                        pinned_games_wiki_ids.delete(wikiId);
                        window.api.send('save-settings', 'pinnedGames', Array.from(pinned_games_wiki_ids));
                        unpinGameFromTop('backup', wikiId);
                        unpinGameFromTop('restore', wikiId);
                    }
                });
            }
            removeDropDown();
            return;
        }
        if (actionElement && actionElement.dataset.action === 'open-wiki') {
            const wikiUrl = actionElement.dataset.url;
            if (wikiUrl && wikiUrl !== 'none') {
                window.api.invoke('open-url', wikiUrl);
            } else {
                showAlert('warning', await window.i18n.translate('alert.no_wiki_url'));
            }
            removeDropDown();
            return;
        }
        if (actionElement && actionElement.dataset.action === 'manage-backups') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                showManageBackupsModal(wikiId);
            }
            removeDropDown();
            return;
        }
        if (actionElement && actionElement.dataset.action === 'auto-backup') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                showAutoBackupModal(wikiId);
            }
            removeDropDown();
            return;
        }

        // If clicking outside any dropdown, remove the active one
        if (!button && activeDropdownMenu) {
            removeDropDown();
            return;
        }

        // If clicking the same button, toggle the dropdown visibility
        if (button === lastButtonClicked && activeDropdownMenu) {
            removeDropDown();
            return;
        }

        // If clicking a different button or first time clicking
        if (button) {
            const wikiPageId = button.closest('tr').getAttribute('data-wiki-id');
            const tabName = button.closest('#backup, #restore, #custom')?.id || 'backup';

            if (activeDropdownMenu) {
                activeDropdownMenu.remove();
            }
            const dropdownMenu = await createDropdownMenu(wikiPageId, tabName);
            positionDropdownMenu(button, dropdownMenu);
            activeDropdownMenu = dropdownMenu;
            lastButtonClicked = button;
        }
    });

    // Close dropdown on scroll
    document.querySelector('#backup .table-container').addEventListener('scroll', () => {
        if (activeDropdownMenu) {
            removeDropDown();
        }
    });
    document.querySelector('#restore .table-container').addEventListener('scroll', () => {
        if (activeDropdownMenu) {
            removeDropDown();
        }
    });
}

async function pinGameOnTop(tabName, wikiId) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const rowToMove = tableBody.querySelector(`tr[data-wiki-id="${wikiId}"]`);

    if (rowToMove) {
        tableBody.removeChild(rowToMove);
        setIcon(rowToMove, 'pin', true);

        const pinnedGames = Array.from(tableBody.querySelectorAll('tr'))
            .filter(row => !row.querySelector('span[data-icon="pin"].hidden'))
            .concat(rowToMove)
            .map(row => ({
                wikiId: row.getAttribute('data-wiki-id'),
                titleToSort: row.querySelector('th[scope="row"]').textContent.trim()
            }));

        const sortedPinnedGames = await window.api.invoke('sort-games', pinnedGames);
        const targetIndex = sortedPinnedGames.findIndex(game => game.wikiId === wikiId);

        if (targetIndex === 0) {
            tableBody.insertBefore(rowToMove, tableBody.firstChild);
        } else {
            const previousRowId = sortedPinnedGames[targetIndex - 1].wikiId;
            const previousRow = tableBody.querySelector(`tr[data-wiki-id="${previousRowId}"]`);
            tableBody.insertBefore(rowToMove, previousRow.nextSibling);
        }
    }
}

async function unpinGameFromTop(tabName, wikiId) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const rowToMove = tableBody.querySelector(`tr[data-wiki-id="${wikiId}"]`);

    if (rowToMove) {
        setIcon(rowToMove, 'pin', false);
        tableBody.removeChild(rowToMove);

        const unpinnedGames = Array.from(tableBody.querySelectorAll('tr'))
            .filter(row => row.querySelector('span[data-icon="pin"].hidden'))
            .concat(rowToMove)
            .map(row => ({
                wikiId: row.getAttribute('data-wiki-id'),
                titleToSort: row.querySelector('th[scope="row"]').textContent.trim()
            }));

        const sortedUnpinnedGames = await window.api.invoke('sort-games', unpinnedGames);
        const targetIndex = sortedUnpinnedGames.findIndex(game => game.wikiId === wikiId);

        const lastPinnedRow = Array.from(tableBody.querySelectorAll('tr'))
            .reverse()
            .find(row => !row.querySelector('span[data-icon="pin"].hidden'));

        if (targetIndex === 0) {
            if (lastPinnedRow) {
                tableBody.insertBefore(rowToMove, lastPinnedRow.nextSibling);
            } else {
                tableBody.insertBefore(rowToMove, tableBody.firstChild);
            }
        } else {
            const previousRowId = sortedUnpinnedGames[targetIndex - 1].wikiId;
            const previousRow = tableBody.querySelector(`tr[data-wiki-id="${previousRowId}"]`);
            tableBody.insertBefore(rowToMove, previousRow.nextSibling);
        }
    }
}

// Function to update the count and size display
export async function updateSelectedCountAndSize(tabName) {
    const selectedCountWidget = document.querySelector(`#${tabName}-selected-count`);
    const totalSizeWidget = document.querySelector(`#${tabName}-selected-size`);
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const selectedWikiIds = getSelectedWikiIds(tabName);
    const total_games_count = tableBody.querySelectorAll('.row-checkbox').length;

    let total_size = 0;
    let total_selected = 0;

    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;

    selectedWikiIds.forEach(wikiId => {
        const gameData = dataMap.get(wikiId);
        if (gameData) {
            total_size += gameData.backup_size;
            total_selected += 1;
        }
    });

    selectedCountWidget.innerHTML = await window.i18n.translate('main.selected_games_count', {
        count: total_selected,
        total: total_games_count
    });
    totalSizeWidget.innerHTML = await window.i18n.translate(`main.total_${tabName}_size`, {
        size: formatSize(total_size)
    });
}

// Function to setup "Select All" checkbox functionality
export function setupSelectAllCheckbox(tabName, selectAllCheckbox) {
    const tableBody = document.querySelector(`#${tabName} tbody`);

    // Handle the "Select All" checkbox change
    selectAllCheckbox.addEventListener('change', function () {
        const isChecked = this.checked;
        const rowCheckboxes = tableBody.querySelectorAll('.row-checkbox');
        rowCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
        });

        updateSelectAllCheckbox(selectAllCheckbox, tableBody);
        updateSelectedCountAndSize(tabName);
    });

    // Handle individual row checkbox changes
    tableBody.addEventListener('change', function (event) {
        if (event.target.classList.contains('row-checkbox')) {
            updateSelectAllCheckbox(selectAllCheckbox, tableBody);
            updateSelectedCountAndSize(tabName);
        }
    });
}

// Function to update the "Select All" checkbox state
function updateSelectAllCheckbox(selectAllCheckbox, tableContainer) {
    const rowCheckboxes = tableContainer.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(rowCheckboxes).every(checkbox => checkbox.checked);
    const anyChecked = Array.from(rowCheckboxes).some(checkbox => checkbox.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = !allChecked && anyChecked;
}

export function getSelectedWikiIds(tabName) {
    const table = document.querySelector(`#${tabName}`);
    const selectedRows = table.querySelectorAll('.row-checkbox:checked');
    return Array.from(selectedRows).map(checkbox => {
        const row = checkbox.closest('tr');
        return row.getAttribute('data-wiki-id').trim();
    });
}

// Helper function for Backup Management Modal to update backup date display
function updateBackupDateDisplay(backupDateDisplay, backupDate, customName, isPermanent) {
    const formattedDate = backupDate.replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
        return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });

    if (isPermanent) {
        const permanentIcon = '<i class="fa-solid fa-star text-yellow-500 mr-2"></i>';
        const renameIcon = `<button type="button" class="rename-backup-btn text-gray-400 hover:text-blue-500 transition-colors duration-150 ml-2" data-backup-date="${backupDate}"><i class="fa-solid fa-pencil"></i></button>`;

        if (customName) {
            backupDateDisplay.innerHTML = `${permanentIcon}<div class="flex flex-col"><span class="backup-custom-name font-medium">${customName}</span><span class="text-xs text-gray-500 dark:text-gray-400">${formattedDate}</span></div>${renameIcon}`;
        } else {
            backupDateDisplay.innerHTML = `${permanentIcon}<span class="backup-date-text">${formattedDate}</span>${renameIcon}`;
        }
    } else {
        backupDateDisplay.innerHTML = `<span class="backup-date-text">${formattedDate}</span>`;
    }
}

// Helper function for Backup Management Modal to attach rename button listener
function attachRenameButtonListener(renameBtn) {
    const row = renameBtn.closest('tr');
    renameBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const renameMode = row.querySelector('.rename-mode');
        const backupDateDisplay = row.querySelector('.backup-date-display');
        const nameInput = row.querySelector('.backup-name-input');
        const currentCustomName = row.getAttribute('data-custom-name');

        renameMode.classList.remove('hidden');
        renameMode.classList.add('flex');
        backupDateDisplay.classList.add('hidden');
        nameInput.value = currentCustomName || '';
        nameInput.focus();
        nameInput.select();
    });
}

export async function showManageBackupsModal(wikiId) {
    const gamesList = await window.api.invoke('fetch-restore-table-data', wikiId);

    // Extract the single game from the returned array, fall back to backupTableDataMap if no backups exist
    const gameData = gamesList && gamesList.length > 0
        ? gamesList[0]
        : { backups: [], latest_backup: '-', title: '', zh_CN: '' };

    // If no restore data, use backupTableDataMap for game info
    if (!gamesList || gamesList.length === 0) {
        const backupData = window.backupTableDataMap.get(wikiId);
        if (backupData) {
            gameData.title = backupData.title;
            gameData.zh_CN = backupData.zh_CN;
        }
    }

    const modal = document.getElementById('modal-manage-backups');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-manage-backups-title');
    const headerInfo = document.getElementById('modal-manage-backups-header-info');
    const modalContent = document.getElementById('modal-manage-backups-content');

    // Set title
    let gameTitle = gameData.title;
    await window.api.invoke('get-settings').then((settings) => {
        if (gameData.zh_CN && settings.language === 'zh_CN') {
            gameTitle = gameData.zh_CN;
        }
    });
    const backupCount = gameData.backups.length;
    const latestBackup = gameData.latest_backup;
    modalTitle.textContent = gameTitle;

    // Create header info with translations
    const newestBackupLabel = await window.i18n.translate('main.newest_backup_time');
    const backupCountLabel = await window.i18n.translate('main.backup_count');
    headerInfo.innerHTML = `
        <p><span class="font-medium">${newestBackupLabel}:</span> <span class="newest-backup-value">${latestBackup}</span></p>
        <p><span class="font-medium">${backupCountLabel}:</span> <span class="backup-count-value">${backupCount}</span></p>
    `;

    const backupTimeLabel = await window.i18n.translate('main.backup_time');
    const backupSizeLabel = await window.i18n.translate('main.backup_size');
    const actionLabel = await window.i18n.translate('main.action');
    const restoreLabel = await window.i18n.translate('main.restore');
    const deleteLabel = await window.i18n.translate('main.delete');
    const makePermanentLabel = await window.i18n.translate('main.make_permanent');
    const removePermanentLabel = await window.i18n.translate('main.remove_permanent');
    const enterBackupNameLabel = await window.i18n.translate('main.enter_backup_name');
    const openBackupFolderLabel = await window.i18n.translate('main.open_backup_folder');
    const browseLocalSaveLabel = await window.i18n.translate('main.browse_local_save');
    const deleteLocalSaveLabel = await window.i18n.translate('main.delete_local_save');

    const rowsHtml = gameData.backups
        .sort((a, b) => {
            // Sort by is_permanent (true first), then by date
            if (a.is_permanent !== b.is_permanent) {
                return b.is_permanent - a.is_permanent;
            }
            return b.date.localeCompare(a.date);
        })
        .map(backup => {
            const formattedDate = backup.date.replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
                return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            });
            const backupSize = formatSize(backup.backup_size);
            const permanentIcon = backup.is_permanent ? '<i class="fa-solid fa-star text-yellow-500 mr-2"></i>' : '';
            const renameIcon = backup.is_permanent ? `<button type="button" class="rename-backup-btn text-gray-400 hover:text-blue-500 transition-colors duration-150 ml-2" data-backup-date="${backup.date}"><i class="fa-solid fa-pencil"></i></button>` : '';

            // Display logic: if permanent and has custom name, show custom name with date below; otherwise just show date
            let dateDisplay;
            if (backup.is_permanent && backup.custom_name) {
                dateDisplay = `${permanentIcon}<div class="flex flex-col"><span class="backup-custom-name font-medium">${backup.custom_name}</span><span class="text-xs text-gray-500 dark:text-gray-400">${formattedDate}</span></div>${renameIcon}`;
            } else {
                dateDisplay = `${permanentIcon}<span class="backup-date-text">${formattedDate}</span>${renameIcon}`;
            }

            return `<tr class="bg-white border-b dark:bg-[#2d3748] dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-600" data-custom-name="${backup.custom_name || ''}">
                <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    <div class="flex items-center">
                        <div class="rename-mode hidden items-center bg-white dark:bg-gray-700 rounded-md border border-gray-300 dark:border-gray-600">
                            <input type="text" class="backup-name-input pl-3 py-2 flex-1 min-w-0 bg-transparent border-0 text-gray-900 text-sm focus:outline-none dark:text-white placeholder-gray-500 dark:placeholder-gray-400" placeholder="${enterBackupNameLabel}" />
                            <button type="button" class="confirm-rename-btn px-3 py-2 text-green-500 hover:text-green-600 transition-colors duration-150">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        </div>
                        <div class="backup-date-display flex items-center">
                            ${dateDisplay}
                        </div>
                    </div>
                </td>
                <td class="px-6 py-3">${backupSize}</td>
                <td class="px-6 py-3 text-center">
                    <div class="flex justify-center gap-2">
                        <button type="button" class="restore-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors duration-150 dark:bg-blue-700 dark:hover:bg-blue-600" data-backup-date="${backup.date}">
                            <i class="fa-solid fa-arrow-left mr-1"></i>
                            ${restoreLabel}
                        </button>
                        <button type="button" class="permanent-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 rounded-md transition-colors duration-150 dark:bg-yellow-600 dark:hover:bg-yellow-500" data-backup-date="${backup.date}" data-is-permanent="${backup.is_permanent}">
                            <i class="fa-solid fa-star mr-1"></i>
                            ${backup.is_permanent ? removePermanentLabel : makePermanentLabel}
                        </button>
                        <button type="button" class="delete-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors duration-150 dark:bg-red-700 dark:hover:bg-red-600" data-backup-date="${backup.date}">
                            <i class="fa-solid fa-trash mr-1"></i>
                            ${deleteLabel}
                        </button>
                    </div>
                </td>
            </tr>`;
        })
        .join('');

    const tableHtml = `
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left rtl:text-right text-gray-500 dark:text-gray-400">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-200 rounded-t-lg">
                    <tr>
                        <th scope="col" class="px-4 py-3 rounded-tl-lg">${backupTimeLabel}</th>
                        <th scope="col" class="px-6 py-3">${backupSizeLabel}</th>
                        <th scope="col" class="px-6 py-3 text-center rounded-tr-lg">${actionLabel}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;

    const footerButtonsHtml = `
        <div class="mt-4 flex flex-wrap items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
            <button type="button" id="modal-open-backup-folder" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600">
                <i class="fa-solid fa-folder-open mr-2"></i>
                ${openBackupFolderLabel}
            </button>

            <div class="flex gap-3">
                <button type="button" id="modal-browse-local-save" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600">
                    <i class="fa-solid fa-folder-tree mr-2"></i>
                    ${browseLocalSaveLabel}
                </button>
                <button type="button" id="modal-delete-local-save" class="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-70 dark:bg-red-700 dark:hover:bg-red-600">
                    <i class="fa-solid fa-trash-can mr-2"></i>
                    ${deleteLocalSaveLabel}
                </button>
            </div>
        </div>
    `;

    modalContent.innerHTML = tableHtml + footerButtonsHtml;

    // Add event listeners to 'open backup folder' button
    document.getElementById('modal-open-backup-folder').addEventListener('click', () => {
        window.api.send('open-backup-folder', wikiId);
    });

    // Add event listeners to 'browse local save' button
    document.getElementById('modal-browse-local-save').addEventListener('click', async () => {
        // Check 1: make sure we have valid backupTableDataMap (backup tab finished loading)
        const backupLoaderContainer = document.getElementById('backup-loading');
        const isBackupLoading = backupLoaderContainer && !backupLoaderContainer.classList.contains('hidden') && backupLoaderContainer.querySelector('[data-loader-active="true"]');
        if (isBackupLoading) {
            showAlert('warning', await window.i18n.translate('alert.wait_for_backup_loading'));
            return;
        }

        // Check 2: make sure local save data exists
        const gameData = window.backupTableDataMap.get(wikiId);
        const resolvedPaths = gameData?.resolved_paths;

        if (!gameData || !resolvedPaths || resolvedPaths.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_local_save_found'));
            return;
        }

        window.api.send('browse-local-save', resolvedPaths);
    });

    // Add event listeners to 'delete local save' button
    document.getElementById('modal-delete-local-save').addEventListener('click', async () => {
        const backupLoaderContainer = document.getElementById('backup-loading');
        const isBackupLoading = backupLoaderContainer && !backupLoaderContainer.classList.contains('hidden') && backupLoaderContainer.querySelector('[data-loader-active="true"]');
        if (isBackupLoading) {
            showAlert('warning', await window.i18n.translate('alert.wait_for_backup_loading'));
            return;
        }

        const gameData = window.backupTableDataMap.get(wikiId);
        const resolvedPaths = gameData?.resolved_paths;

        if (!gameData || !resolvedPaths || resolvedPaths.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_local_save_found'));
            return;
        }

        const success = await window.api.invoke('confirm-delete-local-save', resolvedPaths);
        if (success) {
            removeTableRow('backup', wikiId);
            showAlert('success', await window.i18n.translate('alert.local_save_deleted'));
        }
    });

    // Add event listeners to restore buttons
    modalContent.querySelectorAll('.restore-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            closeManageBackupsModal();
            const backupDate = btn.dataset.backupDate;
            await restoreBackupInstance(backupDate, gameData);
        });
    });

    // Add event listeners to permanent buttons
    modalContent.querySelectorAll('.permanent-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const backupDate = btn.dataset.backupDate;
            const isPermanent = btn.dataset.isPermanent === 'true';
            const newIsPermanent = !isPermanent;

            const success = await window.api.invoke('update-backup-info', wikiId, backupDate, 'is_permanent', newIsPermanent);

            if (success) {
                const row = btn.closest('tr');
                const backupDateDisplay = row.querySelector('.backup-date-display');
                const customName = row.getAttribute('data-custom-name');

                // Update star icon/custom name on modal
                if (newIsPermanent) {
                    btn.dataset.isPermanent = 'true';
                    btn.innerHTML = `<i class="fa-solid fa-star mr-1"></i>${removePermanentLabel}`;

                    updateBackupDateDisplay(backupDateDisplay, backupDate, customName, true);

                    const renameBtn = backupDateDisplay.querySelector('.rename-backup-btn');
                    if (renameBtn) {
                        attachRenameButtonListener(renameBtn);
                    }
                } else {
                    btn.dataset.isPermanent = 'false';
                    btn.innerHTML = `<i class="fa-solid fa-star mr-1"></i>${makePermanentLabel}`;

                    updateBackupDateDisplay(backupDateDisplay, backupDate, customName, false);
                }

                // Show star icon on main tables if ANY permanent backups exist
                const hasAnyPermanentBackup = gameData.backups.some(backup => {
                    const btn = modalContent.querySelector(`.permanent-backup-btn[data-backup-date="${backup.date}"]`);
                    return btn && btn.dataset.isPermanent === 'true';
                });
                const backupTableRow = document.querySelector(`#backup tbody tr[data-wiki-id="${wikiId}"]`);
                const restoreTableRow = document.querySelector(`#restore tbody tr[data-wiki-id="${wikiId}"]`);
                if (backupTableRow) {
                    setIcon(backupTableRow, 'star', hasAnyPermanentBackup);
                }
                if (restoreTableRow) {
                    setIcon(restoreTableRow, 'star', hasAnyPermanentBackup);
                }
                // Update restoreTableDataMap with the new permanent status so backup tab has the latest data
                const restoreGameData = window.restoreTableDataMap.get(wikiId);
                if (restoreGameData) {
                    const backupToUpdate = restoreGameData.backups.find(b => b.date === backupDate);
                    if (backupToUpdate) {
                        backupToUpdate.is_permanent = newIsPermanent;
                    }
                }

                // Re-sort table with permanent backups on top
                const tbody = modalContent.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                rows.sort((a, b) => {
                    const aIsPermanent = a.querySelector('.permanent-backup-btn').dataset.isPermanent === 'true';
                    const bIsPermanent = b.querySelector('.permanent-backup-btn').dataset.isPermanent === 'true';
                    if (aIsPermanent !== bIsPermanent) {
                        return bIsPermanent - aIsPermanent;
                    }
                    // Then sort by date (newest first)
                    const aDate = a.querySelector('.permanent-backup-btn').dataset.backupDate;
                    const bDate = b.querySelector('.permanent-backup-btn').dataset.backupDate;
                    return bDate.localeCompare(aDate);
                });
                rows.forEach(row => tbody.appendChild(row));
            }
        });
    });

    // Add event listeners to delete backup buttons
    modalContent.querySelectorAll('.delete-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const backupDate = btn.dataset.backupDate;
            const row = btn.closest('tr');
            const success = await window.api.invoke('confirm-delete-backup', wikiId, backupDate);

            if (success) {
                row.remove();
                const countElement = headerInfo.querySelector('.backup-count-value');
                const currentCount = parseInt(countElement.textContent);
                const newCount = currentCount - 1;
                countElement.textContent = newCount;

                // Update newest backup date in modal header
                const newestBackupElement = headerInfo.querySelector('.newest-backup-value');
                const remainingDates = Array.from(modalContent.querySelectorAll('.permanent-backup-btn'))
                    .map(b => b.dataset.backupDate)
                    .sort((a, b) => b.localeCompare(a));
                if (remainingDates.length > 0) {
                    const formatted = remainingDates[0].replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
                        return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    });
                    newestBackupElement.textContent = formatted;
                }

                if (newCount === 0) {
                    // If all backups are deleted, remove the row from the restore table
                    removeTableRow('restore', wikiId);
                } else {
                    // Update restore tab row
                    await addOrUpdateTableRow('restore', wikiId);
                    updateSelectedCountAndSize('restore');
                }

                // Update backup tab row
                await addOrUpdateTableRow('backup', wikiId);
                updateSelectedCountAndSize('backup');
            }
        });
    });

    // Add event listeners to rename backup buttons
    modalContent.querySelectorAll('.rename-backup-btn').forEach(btn => {
        attachRenameButtonListener(btn);
    });

    // Add event listeners to confirm rename backup buttons
    modalContent.querySelectorAll('.confirm-rename-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const row = btn.closest('tr');
            const backupDate = row.querySelector('.permanent-backup-btn').dataset.backupDate;
            const nameInput = row.querySelector('.backup-name-input');
            const newName = nameInput.value.trim();

            const success = await window.api.invoke('update-backup-info', wikiId, backupDate, 'custom_name', newName);

            if (success) {
                row.setAttribute('data-custom-name', newName);
                const renameMode = row.querySelector('.rename-mode');
                const backupDateDisplay = row.querySelector('.backup-date-display');
                updateBackupDateDisplay(backupDateDisplay, backupDate, newName, true);

                renameMode.classList.add('hidden');
                renameMode.classList.remove('flex');
                backupDateDisplay.classList.remove('hidden');

                // Update restoreTableDataMap with custom name
                const restoreGameData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
                if (restoreGameData) {
                    const backupToUpdate = restoreGameData.backups.find(b => b.date === backupDate);
                    if (backupToUpdate) {
                        backupToUpdate.custom_name = newName;
                    }
                }

                // Re-attach rename button event listener
                const newRenameBtn = backupDateDisplay.querySelector('.rename-backup-btn');
                if (newRenameBtn) {
                    attachRenameButtonListener(newRenameBtn);
                }
            }
        });
    });

    // Add keydown listener to rename input fields to trigger confirm on Enter
    modalContent.querySelectorAll('.backup-name-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const confirmBtn = input.closest('.rename-mode').querySelector('.confirm-rename-btn');
                if (confirmBtn) {
                    confirmBtn.click();
                }
            }
        });
    });

    // Show modal
    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');

    // Close button handler
    document.getElementById('modal-manage-backups-close').onclick = closeManageBackupsModal;
}

function closeManageBackupsModal() {
    const modal = document.getElementById('modal-manage-backups');
    const modalOverlay = document.getElementById('modal-overlay');

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalOverlay.classList.add('hidden');
}

async function showAutoBackupModal(wikiId) {
    const modal = document.getElementById('modal-auto-backup');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-auto-backup-title');
    const modalContent = document.getElementById('modal-auto-backup-content');
    const confirmButton = document.getElementById('modal-auto-backup-confirm');
    const closeButton = document.getElementById('modal-auto-backup-close');

    if (!modalOverlay.classList.contains('hidden')) return;

    // Get game title
    const settings = await window.api.invoke('get-settings');
    const backupData = window.backupTableDataMap.get(wikiId);
    const restoreData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
    const gameData = backupData || restoreData;
    let gameTitle = '';
    if (gameData) {
        gameTitle = (gameData.zh_CN && settings.language === 'zh_CN') ? gameData.zh_CN : gameData.title;
    }

    const autoBackupState = await window.api.invoke('get-auto-backup-state');
    const isActive = !!autoBackupState[wikiId];
    const status = autoBackupState[wikiId] || null;

    // Set title
    const autoBackupLabel = await window.i18n.translate('main.auto_backup');
    modalTitle.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-2"></i><span class="text-content">${autoBackupLabel}</span>`;

    // Build content
    const enableLabel = await window.i18n.translate('main.auto_backup_enable');
    const disableLabel = await window.i18n.translate('main.auto_backup_disable');
    const modeIntervalLabel = await window.i18n.translate('main.auto_backup_mode_interval');
    const modeWatcherLabel = await window.i18n.translate('main.auto_backup_mode_watcher');
    const intervalLabel = await window.i18n.translate('main.auto_backup_interval_minutes');
    const modeLabel = await window.i18n.translate('main.auto_backup_mode');
    const statusActiveLabel = await window.i18n.translate('main.auto_backup_status_active');
    const statusInactiveLabel = await window.i18n.translate('main.auto_backup_status_inactive');

    const currentMode = status ? status.mode : 'interval';
    const currentInterval = status ? (status.intervalMinutes || 30) : 30;

    let statusHtml = '';
    if (isActive) {
        const modeDisplay = status.mode === 'interval'
            ? await window.i18n.translate('main.auto_backup_mode_interval_detail', { minutes: status.intervalMinutes })
            : modeWatcherLabel;
        const backupsPerformed = await window.i18n.translate('main.auto_backup_backups_performed', { count: status.logCount });
        const failedCount = status.failCount > 0
            ? await window.i18n.translate('main.auto_backup_failures', { count: status.failCount })
            : '';
        statusHtml = `
            <div class="mb-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
                <p class="text-sm text-green-800 dark:text-green-200">
                    <i class="fa-solid fa-circle-check mr-1"></i>
                    <strong>${statusActiveLabel}</strong> — ${modeDisplay}
                </p>
                <p class="text-sm text-green-700 dark:text-green-300 mt-1">${backupsPerformed}</p>
                ${failedCount ? `<p class="text-sm text-red-600 dark:text-red-400 mt-1">${failedCount}</p>` : ''}
            </div>
        `;
    } else {
        statusHtml = `
            <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg">
                <p class="text-sm text-gray-600 dark:text-gray-300">
                    <i class="fa-solid fa-circle-xmark mr-1"></i>
                    ${statusInactiveLabel}
                </p>
            </div>
        `;
    }

    modalContent.innerHTML = `
        <p class="text-base font-medium text-gray-900 dark:text-white mb-4">${gameTitle}</p>
        ${statusHtml}
        <div id="auto-backup-config" class="${isActive ? 'hidden' : ''}">
            <label class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">${modeLabel}</label>
            <div class="flex flex-col gap-2 mb-4">
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="auto-backup-mode" value="interval" ${currentMode === 'interval' ? 'checked' : ''}
                        class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                    <span class="ms-2 text-sm text-gray-900 dark:text-gray-300">${modeIntervalLabel}</span>
                </label>
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="auto-backup-mode" value="watcher" ${currentMode === 'watcher' ? 'checked' : ''}
                        class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                    <span class="ms-2 text-sm text-gray-900 dark:text-gray-300">${modeWatcherLabel}</span>
                </label>
            </div>

            <div id="auto-backup-interval-config" class="${currentMode === 'watcher' ? 'hidden' : ''}">
                <label class="block mb-1 text-sm font-medium text-gray-900 dark:text-white">${intervalLabel}</label>
                <input type="number" id="auto-backup-interval" value="${currentInterval}" min="1"
                    class="mb-4 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:outline-hidden block w-full p-2.5 dark:bg-gray-600 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white" />
            </div>
        </div>
    `;

    // Toggle interval config visibility based on mode selection
    modalContent.querySelectorAll('input[name="auto-backup-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const intervalConfig = document.getElementById('auto-backup-interval-config');
            if (radio.value === 'watcher') {
                intervalConfig.classList.add('hidden');
            } else {
                intervalConfig.classList.remove('hidden');
            }
        });
    });

    // Wrap interval input with custom controls
    const intervalInput = document.getElementById('auto-backup-interval');
    if (intervalInput) {
        wrapNumberInput(intervalInput);
    }

    // Update confirm button text
    if (isActive) {
        confirmButton.innerHTML = `<span class="text-content">${disableLabel}</span>`;
        confirmButton.className = confirmButton.className.replace(/bg-blue-700 hover:bg-blue-800/, 'bg-red-600 hover:bg-red-700').replace(/dark:bg-blue-600 dark:hover:bg-blue-700/, 'dark:bg-red-700 dark:hover:bg-red-600');
    } else {
        confirmButton.innerHTML = `<span class="text-content">${enableLabel}</span>`;
        confirmButton.className = confirmButton.className.replace(/bg-red-600 hover:bg-red-700/, 'bg-blue-700 hover:bg-blue-800').replace(/dark:bg-red-700 dark:hover:bg-red-600/, 'dark:bg-blue-600 dark:hover:bg-blue-700');
    }

    const handleClose = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modalOverlay.classList.add('hidden');
    };

    const handleConfirm = async () => {
        if (isActive) {
            // Disable auto backup and show summary
            const logs = await window.api.invoke('stop-auto-backup', wikiId);
            handleClose();

            if (logs && logs.length > 0) {
                const failCount = logs.filter(l => !l.success).length;
                const summaryMessage = await window.i18n.translate('main.auto_backup_summary', {
                    total: logs.length,
                    failed: failCount
                });

                if (failCount > 0) {
                    const failedDetails = logs
                        .filter(l => !l.success)
                        .map(l => `[${l.timestamp}] ${l.error}`);
                    showAlert('modal', summaryMessage, failedDetails.length === 1 ? failedDetails[0] : [failedDetails]);
                } else {
                    showAlert('success', summaryMessage);
                }
            } else {
                showAlert('info', await window.i18n.translate('main.auto_backup_disabled'));
            }
        } else {
            // Enable auto backup
            const mode = modalContent.querySelector('input[name="auto-backup-mode"]:checked').value;
            const intervalMinutes = parseInt(document.getElementById('auto-backup-interval').value, 10) || 30;
            await window.api.invoke('start-auto-backup', wikiId, mode, intervalMinutes);
            handleClose();
            showAlert('success', await window.i18n.translate('main.auto_backup_enabled'));
        }
    };

    // Clear previous listeners by cloning
    const newCloseButton = closeButton.cloneNode(true);
    closeButton.parentNode.replaceChild(newCloseButton, closeButton);
    newCloseButton.addEventListener('click', handleClose);

    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    newConfirmButton.addEventListener('click', handleConfirm);

    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');
}

async function restoreBackupInstance(backupDate, gameData) {
    const start = await operationStartCheck('restore');

    if (start) {
        window.api.send('update-status', 'restoring', true);
        const restoreButton = document.getElementById('restore-button');
        restoreButton.disabled = true;
        restoreButton.classList.add('cursor-not-allowed');
        const restoreProgressId = 'restore-progress';
        const restoreProgressTitle = await window.api.invoke('translate', 'main.restore_in_progress');
        updateProgress(restoreProgressId, restoreProgressTitle, 'start');

        // Find the specific backup instance
        const backupInstance = gameData.backups.find(b => b.date === backupDate);
        // Create a game object with just this backup instance
        const gameObjForRestore = { ...gameData, backups: [backupInstance] };
        const { action, error } = await window.api.invoke('restore-game', gameObjForRestore, null);

        const restoreFailed = error ? 1 : 0;
        updateProgress(restoreProgressId, restoreProgressTitle, 'end');
        document.querySelector('#restore-tab').click();
        showRestoreSummary(1, restoreFailed, error, backupInstance.backup_size);
        document.querySelector('#restore-summary-done').classList.remove('hidden');
        restoreButton.disabled = false;
        restoreButton.classList.remove('cursor-not-allowed');
        window.api.send('update-status', 'restoring', false);

        // Update backup tab entry in background
        const wikiId = gameData.wiki_page_id;
        (async () => {
            window.api.send('update-status', 'updating_backup', true);
            await addOrUpdateTableRow('backup', wikiId);
            window.api.send('update-status', 'updating_backup', false);
        })();
    }
}
