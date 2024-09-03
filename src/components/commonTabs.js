document.addEventListener('DOMContentLoaded', async () => {
    updateTranslations();
    initializeTabs();
    setupSearchFilter();
    setupBackupButton();
    setDropDownAction();

    await updateBackupTable();
    updateSelectedCountAndSize('backup');
});

window.api.receive('apply-language', () => {
    updateTranslations();
    updateSelectedCountAndSize('backup');
});

const backupTableDataMap = new Map();

const loader = `
    <svg aria-hidden="true" class="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none">
        <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
        <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
    </svg>
    <span class="text-content pl-3 text-gray-900 dark:text-white">Loading...</span>
`;

async function updateBackupTable() {
    await showLoadingIndicator('backup');
    const gameData = await window.api.invoke('fetch-game-saves');
    const iconMap = await window.api.invoke('get-icon-map');
    await populateBackupTable(gameData, iconMap);
    hideLoadingIndicator('backup');
}

window.api.receive('update-backup-table', async () => {
    await updateBackupTable();
})

async function showLoadingIndicator(tabId) {
    const loadingContainer = document.getElementById(`${tabId}-loading`);
    const contentContainer = document.getElementById(`${tabId}-content`);
    const backupButton = document.getElementById('backup-button');

    backupButton.disabled = true;
    backupButton.classList.add('cursor-not-allowed');

    if (contentContainer && window.getComputedStyle(contentContainer).display !== 'none') {
        contentContainer.classList.remove('animate-fadeInShift');
        contentContainer.classList.add('animate-fadeOut');

        setTimeout(async () => {
            contentContainer.classList.add('hidden');

            if (loadingContainer) {
                loadingContainer.innerHTML = loader;
                const loadingTextKey = loadingContainer.getAttribute('data-i18n');
                loadingContainer.querySelector('.text-content').textContent = await window.i18n.translate(loadingTextKey);
                loadingContainer.classList.remove('hidden');
            }
        }, 300);

        // First time showing loader without table content
    } else {
        if (loadingContainer) {
            loadingContainer.innerHTML = loader;
            loadingContainer.classList.remove('hidden');
        }
    }
}

function hideLoadingIndicator(tabId) {
    const loadingContainer = document.getElementById(`${tabId}-loading`);
    const contentContainer = document.getElementById(`${tabId}-content`);
    const backupButton = document.getElementById('backup-button');

    backupButton.disabled = false;
    backupButton.classList.remove('cursor-not-allowed');

    if (loadingContainer) {
        loadingContainer.classList.add('hidden');
    }

    if (contentContainer) {
        contentContainer.classList.remove('hidden');
        contentContainer.classList.remove('animate-fadeOut');
        contentContainer.classList.add('animate-fadeInShift');
    }
}

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
        onShow: () => console.log('Tab is shown'),
    };

    if (tabsElement) {
        const defaultTab = tabElements.find(tab => tab.id === options.defaultTabId);
        if (defaultTab) {
            showTab(defaultTab, tabElements, options);
        }

        tabElements.forEach(tab => {
            tab.triggerEl.addEventListener('click', () => {
                const contentEl = document.getElementById(`${tab.id}-content`);
                if (contentEl) {
                    contentEl.classList.remove('animate-fadeInShift', 'animate-fadeOut');
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

// Function to set up the search filter for the table
function setupSearchFilter() {
    const searchInput = document.getElementById('backup-search');
    const tableBody = document.querySelector('#backup tbody');

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

// Function to populate backup table
async function populateBackupTable(data, iconMap) {
    const backupTable = document.querySelector('#backup');
    const tableBody = document.querySelector('#backup tbody');
    const selectedRowIds = Array.from(tableBody.querySelectorAll('.row-checkbox:checked'))
        .map(checkbox => checkbox.closest('tr').getAttribute('data-row-id'));
    tableBody.innerHTML = '';
    const selectAllCheckbox = backupTable.querySelector('#checkbox-all-search');
    const settings = await window.api.invoke('get-settings');
    const pinnedGamesWikiIds = settings.pinnedGames || [];
    backupTableDataMap.clear();

    const platformOrder = ['Steam', 'Ubisoft', 'EA', 'Epic', 'GOG', 'Xbox', 'Blizzard'];

    const pinnedGames = data.filter(game => pinnedGamesWikiIds.includes(game.wiki_page_id.toString()));
    const otherGames = data.filter(game => !pinnedGamesWikiIds.includes(game.wiki_page_id.toString()));

    // Function to append rows to the table body
    const appendRowsToTable = (games, isPinned) => {
        games.forEach((game) => {
            const index = backupTableDataMap.size;
            backupTableDataMap.set(index, game);

            let gameTitle = game.title;
            if (game.zh_CN && settings.language === 'zh_CN') {
                gameTitle = game.zh_CN;
            }

            const sortedPlatforms = platformOrder.filter(platform => game.platform.includes(platform));
            const platformIcons = sortedPlatforms.map(platform => getPlatformIcon(platform, iconMap)).join(' ');
            const backupSize = formatSize(game.backup_size);

            let row = createBackupTableRow(index, gameTitle, platformIcons, backupSize, game.latest_backup, game.wiki_page_id);

            // Check if selected
            if (selectedRowIds.includes(index.toString())) {
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

    setupBackupSelectAllCheckbox(selectAllCheckbox);
}


function addPinIcon(row) {
    const titleCell = row.querySelector('th[scope="row"]');

    if (titleCell) {
        const pinIcon = document.createElement('i');
        pinIcon.classList.add('fa-solid', 'fa-thumbtack', 'mr-2');

        titleCell.prepend(pinIcon);
    }

    return row;
}

function getPlatformIcon(platform, iconMap) {
    return iconMap[platform] || '';
}

function formatSize(sizeInBytes) {
    if (sizeInBytes === 0) return '0 B';
    const i = Math.floor(Math.log(sizeInBytes) / Math.log(1024));
    return (sizeInBytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}

// Function to create a backup table row
function createBackupTableRow(index, gameTitle, platformIcons, backupSize, lastBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-row-id', index);
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
        <td class="px-6 py-4 truncate">
            ${lastBackupTime}
        </td>
        <td class="px-6 py-4 truncate text-center">
            <button class="dropdown-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-none dark:text-white"
                data-wiki-id="${wikiPageId}"
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

async function createDropdownMenu(wikiPageId) {
    let action = 'pin-on-top';
    let i18nKey = 'main.pin_on_top';

    const settings = await window.api.invoke('get-settings');
    if (settings && settings.pinnedGames.includes(wikiPageId.toString())) {
        action = 'unpin';
        i18nKey = 'main.unpin';
    }

    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'bg-white rounded-lg shadow w-46 dark:bg-gray-700 absolute hidden animate-fadeInShift';
    dropdownMenu.innerHTML = `
        <ul class="py-2 text-sm text-gray-700 dark:text-gray-200">
            <li>
                <a href="#" data-action="${action}" data-id="${wikiPageId}" data-i18n="${i18nKey}"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content"></span>
                </a>
            </li>
            <li>
                <a href="#" data-action="open-wiki" data-url="https://www.pcgamingwiki.com/wiki/index.php?curid=${wikiPageId}" data-i18n="main.view_wiki"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content">View on PCGamingWiki</span>
                </a>
            </li>
            <li>
                <a href="#" data-action="open-backup-folder" data-id="${wikiPageId}" data-i18n="main.open_backup_folder"
                    class="block px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white">
                    <span class="text-content">Open backup folder</span>
                </a>
            </li>
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
                        pinGameOnTop(wikiId);
                    }
                });
                removeDropDown();
                return;
            }
        }
        if (actionElement && actionElement.dataset.action === 'unpin') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                window.api.invoke('get-settings').then((settings) => {
                    if (settings) {
                        let pinned_games_wiki_ids = new Set(settings['pinnedGames']);
                        pinned_games_wiki_ids.delete(wikiId);
                        window.api.send('save-settings', 'pinnedGames', Array.from(pinned_games_wiki_ids));
                        unpinGameFromTop(wikiId);
                    }
                });
                removeDropDown();
                return;
            }
        }
        if (actionElement && actionElement.dataset.action === 'open-wiki') {
            const wikiUrl = actionElement.dataset.url;
            if (wikiUrl) {
                window.api.invoke('open-url', wikiUrl);
                removeDropDown();
                return;
            }
        }
        if (actionElement && actionElement.dataset.action === 'open-backup-folder') {
            const wikiId = actionElement.dataset.id;
            if (wikiId) {
                window.api.invoke('open-backup-folder', wikiId);
                removeDropDown();
                return;
            }
        }

        // If clicking outside any dropdown, remove the active one
        if (!button && activeDropdownMenu) {
            removeDropDown();
            return;
        }

        // If clicking the same button, toggle the dropdown visibility
        if (button === lastButtonClicked) {
            if (activeDropdownMenu) {
                removeDropDown();
            }
            return;
        }

        // If clicking a different button or first time clicking
        if (button) {
            const wikiPageId = button.getAttribute('data-wiki-id');

            if (activeDropdownMenu) {
                activeDropdownMenu.remove();
            }
            const dropdownMenu = await createDropdownMenu(wikiPageId);
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
}

async function pinGameOnTop(wikiId) {
    const tableBody = document.querySelector('#backup tbody');
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    let rowToMove = rows.find(row => row.querySelector('[data-wiki-id]').getAttribute('data-wiki-id') === wikiId);

    if (rowToMove) {
        tableBody.removeChild(rowToMove);
        rowToMove = addPinIcon(rowToMove);
        tableBody.insertBefore(rowToMove, tableBody.firstChild);

        // Remap backupTableDataMap to reflect the new order
        const newBackupTableDataMap = new Map();
        Array.from(tableBody.querySelectorAll('tr')).forEach((row, index) => {
            const rowId = row.getAttribute('data-row-id');
            const gameData = backupTableDataMap.get(parseInt(rowId));
            newBackupTableDataMap.set(index, gameData);
        });
        backupTableDataMap = newBackupTableDataMap;
    }
}

async function unpinGameFromTop(wikiId) {
    const tableBody = document.querySelector('#backup tbody');
    const rows = Array.from(tableBody.querySelectorAll('tr'));
    let rowToMove = rows.find(row => row.querySelector('[data-wiki-id]').getAttribute('data-wiki-id') === wikiId);

    if (rowToMove) {
        tableBody.removeChild(rowToMove);

        const pinIcon = rowToMove.querySelector('.fa-thumbtack');
        if (pinIcon) {
            pinIcon.remove();
        }

        // Find the correct position after pinned games
        const pinnedRows = Array.from(tableBody.querySelectorAll('tr')).filter(row => {
            return row.querySelector('.fa-thumbtack');
        });

        if (pinnedRows.length > 0) {
            const lastPinnedRow = pinnedRows[pinnedRows.length - 1];
            tableBody.insertBefore(rowToMove, lastPinnedRow.nextSibling);
        } else {
            tableBody.insertBefore(rowToMove, tableBody.firstChild);
        }

        // Remap backupTableDataMap to reflect the new order
        const newBackupTableDataMap = new Map();
        Array.from(tableBody.querySelectorAll('tr')).forEach((row, index) => {
            const rowId = row.getAttribute('data-row-id');
            const gameData = backupTableDataMap.get(parseInt(rowId));
            newBackupTableDataMap.set(index, gameData);
        });
        backupTableDataMap = newBackupTableDataMap;
    }
}

// Function to update the count and size display
async function updateSelectedCountAndSize(tableName) {
    const selectedCountWidget = document.querySelector(`#${tableName}-selected-count`);
    const totalSizeWidget = document.querySelector(`#${tableName}-selected-size`);
    const tableBody = document.querySelector(`#${tableName} tbody`)
    let total_size = 0;
    let selected_games_count = 0;
    let total_games_count = 0;

    Array.from(tableBody.querySelectorAll('.row-checkbox:checked'))
        .map(checkbox => checkbox.closest('tr').getAttribute('data-row-id'))
        .forEach(rowId => {
            if (tableName === 'backup') {
                const gameData = backupTableDataMap.get(parseInt(rowId));
                total_games_count = backupTableDataMap.size
                if (gameData) {
                    total_size += gameData.backup_size;
                    selected_games_count += 1;
                }
            } else if (tableName === 'restore') {
                // TODO: restore tabledatamap
            }
        });
    
    if (selected_games_count === 0) {
        total_games_count = tableBody.querySelectorAll('.row-checkbox').length;
    }

    selectedCountWidget.innerHTML = await window.i18n.translate('main.selected_games_count', {
        count: selected_games_count,
        total: total_games_count
    });
    totalSizeWidget.innerHTML = await window.i18n.translate(`main.total_${tableName}_size`, {
        size: formatSize(total_size)
    });
}

// Function to setup "Select All" checkbox functionality
function setupBackupSelectAllCheckbox(selectAllCheckbox) {
    const tableBody = document.querySelector('#backup tbody');

    // Handle the "Select All" checkbox change
    selectAllCheckbox.addEventListener('change', function () {
        const isChecked = this.checked;
        const rowCheckboxes = tableBody.querySelectorAll('.row-checkbox');
        rowCheckboxes.forEach(checkbox => {
            checkbox.checked = isChecked;
        });

        updateBackupSelectAllCheckbox(selectAllCheckbox, tableBody);
        updateSelectedCountAndSize('backup');
    });

    // Handle individual row checkbox changes
    tableBody.addEventListener('change', function (event) {
        if (event.target.classList.contains('row-checkbox')) {
            updateBackupSelectAllCheckbox(selectAllCheckbox, tableBody);
            updateSelectedCountAndSize('backup');
        }
    });
}

// Function to update the "Select All" checkbox state
function updateBackupSelectAllCheckbox(selectAllCheckbox, tableContainer) {
    const rowCheckboxes = tableContainer.querySelectorAll('.row-checkbox');
    const allChecked = Array.from(rowCheckboxes).every(checkbox => checkbox.checked);
    const anyChecked = Array.from(rowCheckboxes).some(checkbox => checkbox.checked);
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = !allChecked && anyChecked;
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

        // Re-enable the button and revert to the original state
        backupButton.disabled = false;
        backupButton.classList.remove('cursor-not-allowed');
        backupIcon.innerHTML = '';
        backupIcon.classList.add('fa-arrow-right-long');
        backupButton.setAttribute('data-i18n', 'main.backup_selected');
        backupText.textContent = await window.i18n.translate('main.backup_selected');

        if (!exitCode) {
            await updateBackupTable();
        }
    });
}

async function performBackup() {
    const backupTable = document.querySelector('#backup');
    const selectedRows = backupTable.querySelectorAll('.row-checkbox:checked');
    if (selectedRows.length === 0) {
        showAlert('warning', await window.i18n.translate('main.no_games_selected'));
        return 1;
    }

    selectedRows.forEach(async checkbox => {
        const row = checkbox.closest('tr');
        const rowId = row.getAttribute('data-row-id');
        const gameData = backupTableDataMap.get(parseInt(rowId));

        await window.api.invoke('backup-game', gameData);
    });

    showAlert('success', await window.i18n.translate('main.backup_complete'));
    return 0
}
