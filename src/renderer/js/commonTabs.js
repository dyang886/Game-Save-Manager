document.addEventListener('DOMContentLoaded', async () => {
    updateTranslations(document);
    initializeTabs();
    setupSearchFilter('backup');
    setupSearchFilter('restore');
    setupBackupButton();
    setupRestoreButton();
    setupCustomPage();
    setDropDownAction();

    updateBackupTable(true);
    updateRestoreTable(true);
});

window.api.receive('apply-language', () => {
    updateTranslations(document);
    updateSelectedCountAndSize('backup');
    updateSelectedCountAndSize('restore');
});

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
    <svg aria-hidden="true" class="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none">
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

async function updateNewestBackupTime(tabName, wikiId) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const row = tableBody.querySelector(`tr[data-wiki-id="${wikiId}"]`);
    const newestBackupTime = await window.api.invoke('get-newest-backup-time', wikiId);

    if (row) {
        const newestBackupCell = row.querySelector('.newest-backup-time');
        if (newestBackupCell) {
            newestBackupCell.textContent = newestBackupTime;
        }

        const dataMap = tabName === 'backup' ? backupTableDataMap : restoreTableDataMap;

        const gameData = dataMap.get(wikiId);
        if (gameData) {
            gameData.latest_backup = newestBackupTime;
            dataMap.set(wikiId, gameData);
        }
    }
}

function addPinIcon(row) {
    const titleCell = row.querySelector('th[scope="row"]');

    if (titleCell) {
        const pinIcon = document.createElement('i');
        pinIcon.classList.add('fa-solid', 'fa-thumbtack', 'text-red-500', 'mr-2');

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
                        pinGameOnTop('backup', wikiId);
                        pinGameOnTop('restore', wikiId);
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
                        unpinGameFromTop('backup', wikiId);
                        unpinGameFromTop('restore', wikiId);
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
            const wikiPageId = button.closest('tr').getAttribute('data-wiki-id');

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
    document.querySelector('#restore .table-container').addEventListener('scroll', () => {
        if (activeDropdownMenu) {
            removeDropDown();
        }
    });
}

// Sort objects using object.titleToSort
async function sortGames(games) {
    const promises = games.map(async (game) => {
        try {
            const isChinese = /[\u4e00-\u9fff]/.test(game.titleToSort);
            const titleToSort = isChinese ? await window.api.invoke('get-pinyin', game.titleToSort) : game.titleToSort.toLowerCase();
            return { ...game, titleToSort };
        } catch (error) {
            showAlert('error', `${await window.i18n.translate('alert.incorrect_backup_structure')} [id: ${game.wiki_page_id}]`);
            console.error("Error during game sorting:", error);
            return { ...game, titleToSort: '' };
        }
    });

    const gamesWithSortedTitles = await Promise.all(promises);

    return gamesWithSortedTitles.sort((a, b) => {
        return a.titleToSort.localeCompare(b.titleToSort);
    });
}

async function pinGameOnTop(tabName, wikiId) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const rowToMove = tableBody.querySelector(`tr[data-wiki-id="${wikiId}"]`);

    if (rowToMove) {
        tableBody.removeChild(rowToMove);
        const newRow = addPinIcon(rowToMove);

        const pinnedGames = Array.from(tableBody.querySelectorAll('tr')).filter(row => {
            return row.querySelector('i.fa-thumbtack');
        }).map(row => ({
            row,
            titleToSort: row.querySelector('th[scope="row"]').textContent.trim()
        }));

        pinnedGames.push({ row: newRow, titleToSort: newRow.querySelector('th[scope="row"]').textContent.trim() });
        const sortedPinnedGames = await sortGames(pinnedGames);
        const indexToInsert = sortedPinnedGames.findIndex(game => game.row === newRow);

        // Insert the row in the correct sorted position
        if (indexToInsert === 0) {
            tableBody.insertBefore(newRow, tableBody.firstChild);
        } else {
            const previousRow = sortedPinnedGames[indexToInsert - 1].row;
            tableBody.insertBefore(newRow, previousRow.nextSibling);
        }
    }
}

async function unpinGameFromTop(tabName, wikiId) {
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const rowToMove = tableBody.querySelector(`tr[data-wiki-id="${wikiId}"]`);

    if (rowToMove) {
        const pinIcon = rowToMove.querySelector('.fa-thumbtack');
        if (pinIcon) {
            pinIcon.remove();
        }
        tableBody.removeChild(rowToMove);

        const unpinnedGames = Array.from(tableBody.querySelectorAll('tr')).filter(row => {
            return !row.querySelector('i.fa-thumbtack');
        }).map(row => ({
            row,
            titleToSort: row.querySelector('th[scope="row"]').textContent.trim()
        }));

        unpinnedGames.push({ row: rowToMove, titleToSort: rowToMove.querySelector('th[scope="row"]').textContent.trim() });
        const sortedUnpinnedGames = await sortGames(unpinnedGames);
        const indexToInsert = sortedUnpinnedGames.findIndex(game => game.row === rowToMove);

        // Insert the row in the correct sorted position
        const lastPinnedRow = Array.from(tableBody.querySelectorAll('tr')).reverse().find(row => row.querySelector('i.fa-thumbtack'));
        if (indexToInsert === 0) {
            if (lastPinnedRow) {
                tableBody.insertBefore(rowToMove, lastPinnedRow.nextSibling);
            } else {
                tableBody.appendChild(rowToMove);
            }
        } else {
            const previousRow = sortedUnpinnedGames[indexToInsert - 1].row;
            tableBody.insertBefore(rowToMove, previousRow.nextSibling);
        }
    }
}

// Function to update the count and size display
async function updateSelectedCountAndSize(tabName) {
    const selectedCountWidget = document.querySelector(`#${tabName}-selected-count`);
    const totalSizeWidget = document.querySelector(`#${tabName}-selected-size`);
    const tableBody = document.querySelector(`#${tabName} tbody`);
    const selectedWikiIds = getSelectedWikiIds(tabName);
    const total_games_count = tableBody.querySelectorAll('.row-checkbox').length;

    let total_size = 0;
    let total_selected = 0;

    const dataMap = tabName === 'backup' ? backupTableDataMap : restoreTableDataMap;

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
function setupSelectAllCheckbox(tabName, selectAllCheckbox) {
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

function getSelectedWikiIds(tabName) {
    const table = document.querySelector(`#${tabName}`);
    const selectedRows = table.querySelectorAll('.row-checkbox:checked');
    return Array.from(selectedRows).map(checkbox => {
        const row = checkbox.closest('tr');
        return parseInt(row.getAttribute('data-wiki-id'));
    });
}
