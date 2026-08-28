import { showAlert, updateTranslations } from './utility.js';
import { checkAndWarnUnsavedChanges } from './customTab.js';
import { showManageBackupsModal, showAutoBackupModal, showHiddenGamesModal, showAutoBackupSummary, refreshAutoBackupModalStatus } from './modalDisplay.js';

document.addEventListener('DOMContentLoaded', () => {
    updateTranslations(document);
    initializeTabs();
    setupSearchFilter('backup');
    setupSearchFilter('restore');
    setupRowMenu();
    setupTableSorting('backup');
    setupTableSorting('restore');
});

window.api.receive('apply-language', () => {
    updateTranslations(document);
    updateSelectedCountAndSize('backup');
    updateSelectedCountAndSize('restore');
});

window.api.receive('open-hidden-games-modal', () => {
    showHiddenGamesModal();
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
    await refreshAutoBackupModalStatus(wikiId);
});

// ======================================================================
// Tabs
// ======================================================================
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

async function showLoadingIndicator(tabName) {
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

function hideLoadingIndicator(tabName) {
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

// ======================================================================
// Table updates
// ======================================================================
const tableUpdateStates = new Map();

function getTableUpdateState(tabName) {
    if (!tableUpdateStates.has(tabName)) {
        tableUpdateStates.set(tabName, {
            running: false,
            promise: null,
            fullUpdatePending: false,
            loaderRequested: false,
            loadTable: null,
            rowActions: new Map()
        });
    }
    return tableUpdateStates.get(tabName);
}

// Reloads coalesce into one trailing load, then the latest queued action per row
async function processTableUpdates(tabName, state) {
    let loaderVisible = false;
    window.api.send('update-status', `updating_${tabName}`, true);

    try {
        while (state.fullUpdatePending || state.rowActions.size > 0) {
            if (state.fullUpdatePending) {
                state.fullUpdatePending = false;

                if (state.loaderRequested) {
                    if (!loaderVisible) {
                        await showLoadingIndicator(tabName);
                        loaderVisible = true;
                    }
                    state.loaderRequested = false;
                }

                await state.loadTable();
                continue;
            }

            const rowActions = Array.from(state.rowActions.values());
            state.rowActions.clear();
            for (const action of rowActions) {
                if (action.type === 'remove') {
                    performRemoveTableRow(tabName, action.wikiId);
                } else {
                    await performAddOrUpdateTableRow(tabName, action.wikiId);
                }
            }
        }
    } finally {
        if (loaderVisible) {
            hideLoadingIndicator(tabName);
        }
        window.api.send('update-status', `updating_${tabName}`, false);
    }
}

export function queueFullTableUpdate(tabName, loader, loadTable) {
    const state = getTableUpdateState(tabName);
    state.fullUpdatePending = true;
    state.loaderRequested ||= Boolean(loader);
    state.loadTable = loadTable;

    if (!state.running) {
        state.running = true;
        state.promise = processTableUpdates(tabName, state)
            .catch(error => {
                console.error(`Error updating ${tabName} table:`, error);
            })
            .finally(() => {
                state.running = false;
                state.promise = null;

                // Defensive: a request should not land between the final check and cleanup
                if (state.fullUpdatePending || state.rowActions.size > 0) {
                    queueFullTableUpdate(tabName, state.loaderRequested, state.loadTable);
                }
            });
    }

    return state.promise;
}

// ======================================================================
// Search and rows
// ======================================================================
// Function to set up the search filter for the table
function setupSearchFilter(tabName) {
    const searchInput = document.getElementById(`${tabName}-search`);
    const tableBody = document.querySelector(`#${tabName} tbody`);

    searchInput.addEventListener('input', function () {
        const filter = searchInput.value.toLowerCase();
        const rows = tableBody.querySelectorAll('tr');
        const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;

        rows.forEach(row => {
            // Matches either language, falling back to the cell text when the map has no game
            const gameData = dataMap && dataMap.get(row.getAttribute('data-wiki-id'));
            const searchTargets = [];
            if (gameData) {
                if (gameData.title) searchTargets.push(gameData.title);
                if (gameData.zh_CN) searchTargets.push(gameData.zh_CN);
            }
            if (searchTargets.length === 0) {
                const gameNameCell = row.querySelector('th[scope="row"]');
                if (gameNameCell) searchTargets.push(gameNameCell.textContent);
            }

            const matches = searchTargets.some(name => name.toLowerCase().includes(filter));
            row.style.display = matches ? '' : 'none';
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

export const platformOrder = ['Custom', 'Steam', 'Epic', 'GOG', 'Xbox', 'EA', 'Ubisoft', 'Blizzard'];

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
        <th scope="row" class="pr-6 py-4 wrap-break-words font-medium text-gray-900 dark:text-white">
            <span data-icon="pin" class="hidden"><i class="fa-solid fa-thumbtack text-red-500 mr-2"></i></span>
            <span data-icon="star" class="hidden"><i class="fa-solid fa-star text-yellow-500 mr-2"></i></span>
            <span data-icon="timer" class="hidden"><i class="fa-solid fa-clock-rotate-left text-green-500 mr-2"></i></span>
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
            <button class="row-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-hidden dark:text-white"
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
        <th scope="row" class="pr-6 py-4 wrap-break-words font-medium text-gray-900 dark:text-white">
            <span data-icon="pin" class="hidden"><i class="fa-solid fa-thumbtack text-red-500 mr-2"></i></span>
            <span data-icon="star" class="hidden"><i class="fa-solid fa-star text-yellow-500 mr-2"></i></span>
            <span data-icon="timer" class="hidden"><i class="fa-solid fa-clock-rotate-left text-green-500 mr-2"></i></span>
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
            <button class="row-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-hidden dark:text-white"
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

// --- Column sorting ---

// ======================================================================
// Sorting
// ======================================================================
const DEFAULT_SORT = { key: 'title', direction: 'asc' };
const SORT_COALESCE_MS = 200;
const sortState = {
    backup: { ...DEFAULT_SORT },
    restore: { ...DEFAULT_SORT },
};
const pendingSorts = { backup: null, restore: null };
const sortRuns = { backup: 0, restore: 0 };

// The time each tab shows: backup rows date the save files, restore rows date the backup.
export const rowTime = (game) => (game && (game.latest_modified || game.latest_backup)) || '';

// Raw values from the data maps, not the cells; null sorts last.
const sortValueGetters = {
    size: (game) => Number(game && game.backup_size) || 0,
    count: (game) => (game && Array.isArray(game.backups) ? game.backups.length : 0),
    // Zero-padded YYYY/MM/DD HH:mm compares correctly as plain text.
    time: (game) => (/^\d{4}\/\d{2}\/\d{2}/.test(rowTime(game)) ? rowTime(game) : null),
    platform: (game) => {
        const ranks = ((game && game.platform) || [])
            .map(platform => platformOrder.indexOf(platform))
            .filter(rank => rank >= 0)
            .sort((a, b) => a - b);
        return ranks.length ? ranks.map(rank => String(rank).padStart(2, '0')).join(',') : null;
    },
};

function getSortEntries(tabName) {
    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;
    return Array.from(document.querySelectorAll(`#${tabName} tbody tr`)).map(row => {
        const wikiId = row.getAttribute('data-wiki-id');
        const game = dataMap && dataMap.get(wikiId);
        const titleCell = row.querySelector('th[scope="row"]');
        return {
            row,
            wikiId,
            game,
            pinned: !row.querySelector('span[data-icon="pin"].hidden'),
            titleToSort: (game && game.titleToSort) || (titleCell ? titleCell.textContent.trim() : ''),
        };
    });
}

function orderEntries(entries, { key, direction }, byTitle) {
    const sign = direction === 'desc' ? -1 : 1;

    if (key === 'title') {
        return [...entries].sort((a, b) => byTitle(a, b) * sign);
    }

    const getValue = sortValueGetters[key] || (() => null);
    const withValue = [];
    const withoutValue = [];
    entries.forEach(entry => {
        const value = getValue(entry.game);
        (value === null || value === undefined ? withoutValue : withValue).push({ ...entry, value });
    });

    // Direction flips the column only; ties stay alphabetical in both directions.
    withValue.sort((a, b) => {
        const primary = typeof a.value === 'number' && typeof b.value === 'number'
            ? a.value - b.value
            : String(a.value).localeCompare(String(b.value));
        return (primary * sign) || byTitle(a, b);
    });
    withoutValue.sort(byTitle);

    return [...withValue, ...withoutValue];
}

function updateSortIndicators(tabName) {
    const { key, direction } = sortState[tabName];

    document.querySelectorAll(`#${tabName} th[data-sort-key]`).forEach(header => {
        const active = header.dataset.sortKey === key;
        const ascending = active && direction === 'asc';
        header.setAttribute('aria-sort', active ? (ascending ? 'ascending' : 'descending') : 'none');

        const indicator = header.querySelector('.sort-indicator');
        if (!indicator) return;
        indicator.classList.toggle('fa-sort', !active);
        indicator.classList.toggle('fa-sort-up', ascending);
        indicator.classList.toggle('fa-sort-down', active && !ascending);
        indicator.classList.toggle('text-gray-300', !active);
        indicator.classList.toggle('dark:text-gray-500', !active);
        indicator.classList.toggle('text-blue-600', active);
        indicator.classList.toggle('dark:text-blue-500', active);
    });
}

async function applyTableSort(tabName) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    if (!tableBody) return;

    const run = ++sortRuns[tabName];
    const entries = getSortEntries(tabName);
    // Ranked once for the whole table; every column uses it to break ties.
    const ranked = await window.api.invoke('sort-games',
        entries.map(entry => ({ wikiId: entry.wikiId, titleToSort: entry.titleToSort })));

    // A newer sort started while this one waited, so its result is already stale.
    if (run !== sortRuns[tabName]) return;

    const titleRank = new Map(ranked.map((game, index) => [game.wikiId, index]));
    const byTitle = (a, b) => titleRank.get(a.wikiId) - titleRank.get(b.wikiId);

    // Pinned games stay grouped on top; the sort applies within each group.
    const state = sortState[tabName];
    const ordered = [
        ...orderEntries(entries.filter(entry => entry.pinned), state, byTitle),
        ...orderEntries(entries.filter(entry => !entry.pinned), state, byTitle),
    ];

    tableBody.append(...ordered.map(entry => entry.row));
    updateSortIndicators(tabName);
}

// The one ordering entry point; coalesced unless the caller needs it on screen now.
export function sortTable(tabName, { immediate = false } = {}) {
    // Never rejects, so callers cannot leave the table half-ordered or hang waiting.
    const runSort = () => applyTableSort(tabName)
        .catch(error => console.error(`Error sorting ${tabName} table: ${error.message}`));

    const queued = pendingSorts[tabName];

    if (immediate) {
        pendingSorts[tabName] = null;
        const done = runSort();
        if (queued) {
            clearTimeout(queued.timer);
            done.then(queued.resolve);
        }
        return done;
    }

    const pending = queued || {};
    if (!queued) {
        pending.promise = new Promise(resolve => { pending.resolve = resolve; });
        pendingSorts[tabName] = pending;
    }

    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
        pendingSorts[tabName] = null;
        runSort().then(pending.resolve);
    }, SORT_COALESCE_MS);

    return pending.promise;
}

function setupTableSorting(tabName) {
    document.querySelectorAll(`#${tabName} th[data-sort-key] .sort-header`).forEach(button => {
        button.addEventListener('click', async () => {
            const state = sortState[tabName];
            const key = button.closest('th').dataset.sortKey;
            // Re-clicking the active column flips it; a new column starts ascending.
            state.direction = state.key === key && state.direction === 'asc' ? 'desc' : 'asc';
            state.key = key;
            await sortTable(tabName, { immediate: true });
        });
    });

    updateSortIndicators(tabName);
}

// ======================================================================
// Row add and remove
// ======================================================================
async function performAddOrUpdateTableRow(tabName, wikiId) {
    let gameData;
    if (tabName === 'backup') {
        const games = await window.api.invoke('fetch-backup-table-data', null, wikiId);
        gameData = games && games.length > 0 ? games[0] : null;
    } else {
        const games = await window.api.invoke('fetch-restore-table-data', wikiId);
        gameData = games && games.length > 0 ? games[0] : null;
    }
    if (!gameData) return;

    const settings = await window.api.invoke('get-settings');
    // Stored alongside the row data so sorting never has to read it back off the DOM.
    gameData.titleToSort = settings.language === 'zh_CN' ? gameData.zh_CN || gameData.title : gameData.title;

    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;
    dataMap.set(wikiId, gameData);

    const existingRow = document.querySelector(`#${tabName} tbody tr[data-wiki-id="${wikiId}"]`);

    if (existingRow) {
        const sizeCell = existingRow.querySelector('.backup-size');
        if (sizeCell) sizeCell.textContent = formatSize(gameData.backup_size);
        const timeCell = existingRow.querySelector('.newest-backup-time');
        if (timeCell) timeCell.textContent = rowTime(gameData);
        if (tabName === 'restore') {
            const countCell = existingRow.querySelector('.backup-count');
            if (countCell) countCell.textContent = gameData.backups.length;
        }
    } else {
        // Don't re-add a row for a hidden game (e.g. triggered by auto backup)
        const hiddenGamesWikiIds = settings.hiddenGames || [];
        if (hiddenGamesWikiIds.includes(wikiId.toString())) return;

        const gameTitle = gameData.titleToSort;
        if (!gameTitle) return;

        let row;
        if (tabName === 'backup') {
            const iconMap = await window.api.invoke('get-icon-map');
            const sortedPlatforms = platformOrder.filter(platform => (gameData.platform || []).includes(platform));
            const platformIcons = sortedPlatforms.map(platform => getPlatformIcon(platform, iconMap)).join(' ');
            row = createBackupTableRow(gameTitle, platformIcons, formatSize(gameData.backup_size), rowTime(gameData), wikiId);

            const restoreGameData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
            const hasPermanent = restoreGameData && restoreGameData.backups && restoreGameData.backups.some(b => b.is_permanent);
            if (hasPermanent) setIcon(row, 'star', true);
        } else {
            row = createRestoreTableRow(gameTitle, gameData.backups.length, formatSize(gameData.backup_size), rowTime(gameData), wikiId);

            const hasPermanent = gameData.backups.some(b => b.is_permanent);
            if (hasPermanent) setIcon(row, 'star', true);
        }

        const pinnedGamesWikiIds = settings.pinnedGames || [];
        const isPinned = pinnedGamesWikiIds.includes(wikiId.toString());
        if (isPinned) {
            setIcon(row, 'pin', true);
        }

        const autoBackupState = await window.api.invoke('get-auto-backup-state');
        if (autoBackupState[wikiId.toString()]) {
            setIcon(row, 'timer', true);
        }

        // Appended anywhere; sortTable() puts it in place.
        document.querySelector(`#${tabName} tbody`).appendChild(row);
    }

    // Not awaited: waiting here would stall each row instead of batching them.
    sortTable(tabName);
}

export async function addOrUpdateTableRow(tabName, wikiId) {
    const state = getTableUpdateState(tabName);
    if (state.running) {
        state.rowActions.set(wikiId.toString(), { type: 'update', wikiId });
        return state.promise;
    }

    return performAddOrUpdateTableRow(tabName, wikiId);
}

// Helper function to remove a game row from a tab's table and clean up its data map
function performRemoveTableRow(tabName, wikiId) {
    const row = document.querySelector(`#${tabName} tbody tr[data-wiki-id="${wikiId}"]`);
    if (row) {
        row.remove();
    }
    const dataMap = tabName === 'backup' ? window.backupTableDataMap : window.restoreTableDataMap;
    dataMap.delete(wikiId);

    // Re-evaluate the "select all" checkbox now that a row is gone
    const selectAllCheckbox = document.getElementById(`${tabName}-checkbox-all-search`);
    const tableBody = document.querySelector(`#${tabName} tbody`);
    if (selectAllCheckbox && tableBody) {
        updateSelectAllCheckbox(selectAllCheckbox, tableBody);
    }

    updateSelectedCountAndSize(tabName);
}

export function removeTableRow(tabName, wikiId) {
    const state = getTableUpdateState(tabName);
    if (state.running) {
        state.rowActions.set(wikiId.toString(), { type: 'remove', wikiId });
        return;
    }

    performRemoveTableRow(tabName, wikiId);
}

// ======================================================================
// Row menu
// ======================================================================
// Labels are translated here; the menu window owns no i18n of its own.
async function buildRowMenuItems(wikiPageId, tabName) {
    const settings = await window.api.invoke('get-settings');
    const isPinned = settings && settings.pinnedGames.includes(wikiPageId.toString());
    const isCustomGame = wikiPageId.includes('-');

    const items = [
        isPinned
            ? { action: 'unpin', icon: 'thumbtack-slash', i18n: 'main.unpin', id: wikiPageId }
            : { action: 'pin-on-top', icon: 'thumbtack', i18n: 'main.pin_on_top', id: wikiPageId },
        { action: 'manage-backups', icon: 'box-archive', i18n: 'main.manage_backups', id: wikiPageId },
    ];

    // Auto backup targets a live save location, which the restore tab lacks.
    if (tabName !== 'restore') {
        items.push({ action: 'auto-backup', icon: 'clock-rotate-left', i18n: 'main.auto_backup', id: wikiPageId });
    }

    items.push({
        action: 'open-wiki',
        icon: 'arrow-up-right-from-square',
        i18n: 'main.view_wiki',
        url: !isCustomGame ? `https://www.pcgamingwiki.com/wiki/index.php?curid=${wikiPageId}` : 'none',
    });

    // Hiding a custom entry would strand it: no list to bring it back from.
    if (!isCustomGame) {
        items.push({ action: 'hide', icon: 'eye-slash', i18n: 'main.hide', id: wikiPageId, danger: true });
    }

    return Promise.all(items.map(async (item) => ({
        action: item.action,
        icon: item.icon,
        label: await window.i18n.translate(item.i18n),
        id: item.id || null,
        url: item.url || null,
        danger: Boolean(item.danger),
    })));
}

async function openRowMenu(button) {
    const wikiPageId = button.closest('tr').getAttribute('data-wiki-id');
    const tabName = button.closest('#backup, #restore, #custom')?.id || 'backup';
    const rect = button.getBoundingClientRect();

    window.api.send('show-row-menu', {
        items: await buildRowMenuItems(wikiPageId, tabName),
        // Window-relative; main converts to screen coords and picks the direction.
        anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    });
}

async function handleRowMenuAction({ action, id, url }) {
    switch (action) {
        case 'pin-on-top':
        case 'unpin': {
            if (!id) return;
            const settings = await window.api.invoke('get-settings');
            if (!settings) return;

            const pinnedGames = new Set(settings['pinnedGames']);
            if (action === 'pin-on-top') {
                pinnedGames.add(id);
            } else {
                pinnedGames.delete(id);
            }

            const saved = await window.api.invoke('save-settings', 'pinnedGames', Array.from(pinnedGames));
            if (!saved) {
                showAlert('warning', await window.i18n.translate('settings.save-settings-error'));
                return;
            }

            if (action === 'pin-on-top') {
                setGamePinned('backup', id, true);
                setGamePinned('restore', id, true);
            } else {
                setGamePinned('backup', id, false);
                setGamePinned('restore', id, false);
            }
            return;
        }

        case 'manage-backups':
            if (id) showManageBackupsModal(id);
            return;

        case 'auto-backup':
            if (id) showAutoBackupModal(id);
            return;

        case 'open-wiki':
            if (url && url !== 'none') {
                window.api.invoke('open-url', url);
            } else {
                showAlert('warning', await window.i18n.translate('alert.no_wiki_url'));
            }
            return;

        case 'hide': {
            if (!id) return;
            const settings = await window.api.invoke('get-settings');
            if (!settings) return;

            const hiddenGames = new Set(settings['hiddenGames']);
            hiddenGames.add(id);
            const saved = await window.api.invoke('save-settings', 'hiddenGames', Array.from(hiddenGames));
            if (!saved) {
                showAlert('warning', await window.i18n.translate('settings.save-settings-error'));
                return;
            }

            removeTableRow('backup', id);
            removeTableRow('restore', id);
            showAlert('success', await window.i18n.translate('alert.game_hidden'));

            // A hidden game can no longer be managed, so stop its auto backup.
            const autoBackupLogs = await window.api.invoke('stop-auto-backup', id);
            if (autoBackupLogs) {
                await showAutoBackupSummary(autoBackupLogs);
            }
            return;
        }
    }
}

function setupRowMenu() {
    // The menu is a separate window; only the opening button needs tracking.
    let openForButton = null;

    const closeMenu = () => {
        if (!openForButton) return;
        openForButton = null;
        window.api.send('hide-row-menu');
    };

    window.api.receive('row-menu-action', (action) => {
        openForButton = null;
        handleRowMenuAction(action);
    });

    document.addEventListener('click', async (event) => {
        const button = event.target.closest('.row-menu-button');

        if (!button) {
            closeMenu();
            return;
        }
        if (button === openForButton) {
            closeMenu();
            return;
        }

        openForButton = button;
        await openRowMenu(button);
    });

    // A separate window cannot ride along with the row, so dismiss on any move.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    document.querySelector('#backup .table-container').addEventListener('scroll', closeMenu);
    document.querySelector('#restore .table-container').addEventListener('scroll', closeMenu);
    document.querySelectorAll('#main-tab button[role="tab"]').forEach((tab) => {
        tab.addEventListener('click', closeMenu);
    });
}

// The sorter already groups pinned rows, so flipping the icon is the whole operation
async function setGamePinned(tabName, wikiId, pinned) {
    const row = document.querySelector(`#${tabName} tbody tr[data-wiki-id="${wikiId}"]`);
    if (!row) return;

    setIcon(row, 'pin', pinned);
    await sortTable(tabName, { immediate: true });
}

// ======================================================================
// Selection
// ======================================================================
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
    if (rowCheckboxes.length === 0) {
        // No rows: an empty table must not appear "all selected"
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }
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
