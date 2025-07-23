import { operationStartCheck, updateTranslations } from './utility.js';

document.addEventListener('DOMContentLoaded', () => {
    setupCustomPage();
});

function setupCustomPage() {
    const addGameButton = document.querySelector('#custom-add-game');
    const saveAllButton = document.querySelector('#custom-save-all');
    const placeholderButton = document.querySelector('#custom-view-placeholder');
    const placeholderGuide = document.querySelector('#placeholder-guide');
    const placeholderGuideClose = document.querySelector('#placeholder-guide-close');
    const modalOverlay = document.getElementById('modal-overlay');

    addGameButton.addEventListener('click', async () => {
        const allTitles = document.querySelectorAll('.custom-entry-title');
        const foundEmptyEntry = Array.from(allTitles).some(title => {
            if (!title.innerText.trim()) {
                const titleInput = title.closest('.custom-entry').querySelector('.custom-entry-title-input');
                title.classList.add('hidden');
                titleInput.classList.remove('hidden');
                titleInput.focus();
                return true;
            }
            return false;
        });

        if (!foundEmptyEntry) {
            await addTemplate();
        }
    });

    saveAllButton.addEventListener('click', () => {
        const start = operationStartCheck('save-custom');
        if (start) saveEntriesToJson(saveAllButton);
    });

    placeholderButton.addEventListener('click', () => {
        modalOverlay.classList.remove('hidden');
        placeholderGuide.classList.remove('hidden');
    });

    placeholderGuide.addEventListener('click', (event) => {
        if (event.target.matches('i.fa-copy')) {
            const icon = event.target;
            const placeholderText = icon.parentElement.textContent.trim();

            if (placeholderText) {
                navigator.clipboard.writeText(placeholderText).then(() => {
                    const originalClass = icon.className;
                    icon.className = 'fa-solid fa-check mr-2 text-green-500';

                    setTimeout(() => {
                        icon.className = originalClass;
                    }, 1500);

                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                });
            }
        }
    });

    placeholderGuideClose.addEventListener('click', () => {
        modalOverlay.classList.add('hidden');
        placeholderGuide.classList.add('hidden');
    });

    loadEntriesFromJson();
}

async function generateUniqueId() {
    return window.api.invoke('get-uuid');
}

// Function to collapse all entries except the one clicked
function toggleEntry(clickedEntry) {
    const allEntries = document.querySelectorAll('.custom-entry');

    allEntries.forEach(entry => {
        const content = entry.querySelector('.collapsed-content');
        const buttonSvg = entry.querySelector('.custom-entry-dropdown');

        if (entry === clickedEntry) {
            content.classList.toggle('hidden');
            buttonSvg.classList.toggle('rotate-180');
        } else {
            content.classList.add('hidden');
            buttonSvg.classList.remove('rotate-180');
        }
    });
}

function updateCustomEntryStyles() {
    const entries = document.querySelectorAll('.custom-entry');

    entries.forEach(entry => {
        const button = entry.querySelector('.custom-entry-header');
        button.classList.remove('rounded-t-xl');
    });

    if (entries.length > 0) {
        const firstButton = entries[0].querySelector('.custom-entry-header');
        firstButton.classList.add('rounded-t-xl');
    }

    updateTranslations(document.querySelector("#custom"));
}

function createCustomEntry() {
    return `
        <div class="custom-entry flex flex-col">
            <div class="custom-entry-header flex items-center justify-between w-full p-5 font-medium rtl:text-right text-gray-500 border border-gray-200 rounded-t-xl focus:outline-hidden dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <div class="flex items-center gap-3">
                    <input type="text" class="custom-entry-title-input hidden bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-hidden dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                        data-i18n-placeholder="custom.enter_game_name" placeholder="Please enter game name" />
                    <span class="custom-entry-title"></span>
                    <button type="button" class="custom-entry-rename text-blue-500 hover:text-blue-600">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                    <button type="button" class="custom-entry-delete text-red-500 hover:text-red-600">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <svg data-accordion-icon class="custom-entry-dropdown w-3 h-3 shrink-0 cursor-pointer" aria-hidden="true" fill="none" viewBox="0 0 10 6">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5 5 1 1 5" />
                </svg>
            </div>

            <div class="collapsed-content hidden text-right p-5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900">
                <div class="text-left flex items-center mb-3">
                    <div class="group relative inline-flex w-11 shrink-0 rounded-full bg-gray-200 p-0.5 inset-ring inset-ring-gray-900/5 outline-offset-2 outline-blue-600 transition-colors duration-200 ease-in-out has-checked:bg-blue-600 has-focus-visible:outline-2 dark:bg-white/5 dark:inset-ring-white/10 dark:outline-blue-500 dark:has-checked:bg-blue-500">
                        <span class="size-5 rounded-full bg-white shadow-xs ring-1 ring-gray-900/5 transition-transform duration-200 ease-in-out group-has-checked:translate-x-5"></span>
                        <input type="checkbox" name="annual-billing" class="game-install-folder-toggle absolute inset-0 appearance-none focus:outline-hidden" />
                    </div>
                    <span class="my-1.5 ms-3 text-sm font-medium text-gray-900 dark:text-gray-300 select-none text-content" data-i18n="custom.add_game_install_folder">Add Game Install Folder Name</span>
                    <input type="text" class="folder-name-input hidden grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-sm p-1 ml-2 focus:outline-hidden dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                        data-i18n-placeholder="custom.folder_name" placeholder="Folder name">
                </div>

                <div class="collapsed-rows"></div>

                <button type="button" class="custom-add-path select-none inline text-white bg-green-600 hover:bg-green-700 font-medium rounded-lg text-sm px-5 py-2.5 mt-2 dark:bg-green-500 dark:hover:bg-green-600"
                    data-i18n="custom.add_path">
                    <i class="fa-solid fa-plus mr-1"></i>
                    <span class="text-content">Add Path</span>
                </button>
            </div>
        </div>
    `;
}

function createCollapsedRow() {
    return `
        <div class="collapsed-row">
            <div class="flex items-center mb-3">
                <select class="custom-backup-type-dropdown select-none bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-hidden dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white mr-3">
                    <option value="file" data-i18n="custom.file" class="text-content">File</option>
                    <option value="folder" data-i18n="custom.folder" class="text-content">Folder</option>
                    <option value="registry" data-i18n="custom.registry" class="text-content">Registry</option>
                </select>

                <input type="text" class="custom-path-select-input grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-hidden dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white mr-3"
                    data-i18n-placeholder="settings.select_path" placeholder="Select a path">

                <button type="button" class="custom-path-select-button text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-lg text-sm px-4 py-2 dark:bg-blue-600 dark:hover:bg-blue-700">
                    <i class="fa-solid fa-ellipsis"></i>
                </button>

                <button type="button" class="custom-delete-collapsed-row text-white bg-red-600 hover:bg-red-700 font-medium rounded-lg text-sm px-4 py-2 ml-3 dark:bg-red-500 dark:hover:bg-red-600">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function addCollapsedRow(entry) {
    const collapsedRowsContainer = entry.querySelector('.collapsed-rows');
    collapsedRowsContainer.insertAdjacentHTML('beforeend', createCollapsedRow());

    const newRow = collapsedRowsContainer.lastElementChild;

    // Listener for dropdown change
    const dropDown = newRow.querySelector('.custom-backup-type-dropdown');
    const pathInput = newRow.querySelector('.custom-path-select-input');
    dropDown.addEventListener('change', () => {
        pathInput.value = '';
    });

    // Listener for add path button
    const addPathButton = newRow.querySelector('.custom-path-select-button');
    addPathButton.addEventListener('click', async () => {
        const result = await window.api.invoke('select-path', dropDown.value);

        if (result) {
            pathInput.value = result;
        }
    });

    // Listener for delete path row button
    const deletePathButton = newRow.querySelector('.custom-delete-collapsed-row');
    deletePathButton.addEventListener('click', () => {
        newRow.remove();
    });

    updateTranslations(collapsedRowsContainer);
}

async function addTemplate(renameTitleFocus = true, wikiId = null) {
    const customTabContent = document.querySelector('#custom-content');

    customTabContent.insertAdjacentHTML('beforeend', createCustomEntry());
    const newEntry = customTabContent.lastElementChild;

    if (!wikiId) {
        wikiId = await generateUniqueId();
    }
    newEntry.dataset.wikiId = wikiId;

    const entryTitle = newEntry.querySelector('.custom-entry-title');
    const folderToggle = newEntry.querySelector('.game-install-folder-toggle');
    const folderInput = newEntry.querySelector('.folder-name-input');
    const titleInput = newEntry.querySelector('.custom-entry-title-input');
    const renameButton = newEntry.querySelector('.custom-entry-rename');
    const deleteButton = newEntry.querySelector('.custom-entry-delete');
    const dropdownIcon = newEntry.querySelector('.custom-entry-dropdown');

    let hasToggled = false;

    // Toggle collapsed content when the dropdown icon is clicked
    dropdownIcon.addEventListener('click', () => {
        if (!entryTitle.innerHTML.trim()) {
            renameEntry();
        } else {
            toggleEntry(newEntry);
        }
    });

    // Handle game install folder toggle
    folderToggle.addEventListener('change', () => {
        folderInput.classList.toggle('hidden', !folderToggle.checked);
    });

    // Rename the title
    const renameEntry = () => {
        titleInput.classList.remove('hidden');
        entryTitle.classList.add('hidden');
        titleInput.value = entryTitle.innerText;
        titleInput.focus();
    }
    renameButton.addEventListener('click', () => {
        renameEntry()
    });

    // Save the new title on blur or Enter key press
    titleInput.addEventListener('blur', () => {
        const newTitle = titleInput.value.trim();
        if (newTitle) {
            entryTitle.innerText = newTitle;
        }
        titleInput.classList.add('hidden');
        entryTitle.classList.remove('hidden');

        if (entryTitle.innerHTML.trim() && !hasToggled) {
            toggleEntry(newEntry);
            hasToggled = true;
        }
    });

    titleInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            titleInput.blur();
        }
    });

    // Handle delete button
    deleteButton.addEventListener('click', () => {
        newEntry.remove();
    });

    const addPathButton = newEntry.querySelector('.custom-add-path');
    addPathButton.addEventListener('click', () => {
        addCollapsedRow(newEntry);
    });

    updateCustomEntryStyles();

    // If not loaded from json
    if (renameTitleFocus) {
        renameEntry();
        addCollapsedRow(newEntry);
    }
}

async function saveEntriesToJson(saveAllButton) {
    // TODO: name duplicates check
    // TODO: tab exist warning for unsaved changes
    saveAllButton.disabled = true;
    saveAllButton.classList.add('cursor-not-allowed');

    const allEntries = document.querySelectorAll('.custom-entry');
    const entriesArray = [];
    const platform = await window.api.invoke('get-platform');

    allEntries.forEach(entry => {
        const entryTitle = entry.querySelector('.custom-entry-title').innerText.trim();
        const collapsedRows = entry.querySelectorAll('.collapsed-row');
        const wikiId = entry.dataset.wikiId;
        const installFolderName = entry.querySelector('.folder-name-input').value.trim();
        const saveLocations = {
            win: [],
            reg: [],
            mac: [],
            linux: []
        };

        if (!entryTitle) {
            return;
        }

        // Collect all paths in the collapsed content
        collapsedRows.forEach(row => {
            const backupType = row.querySelector('.custom-backup-type-dropdown').value;
            const path = row.querySelector('.custom-path-select-input').value.trim();

            if (path) {
                if (backupType === 'registry') {
                    saveLocations.reg.push({ template: path, type: null });
                } else {
                    saveLocations[platform].push({ template: path, type: backupType });
                }
            }
        });

        const hasPaths = Object.values(saveLocations).some(locationArray => locationArray.length > 0);
        if (hasPaths) {
            const gameObject = {
                title: entryTitle,
                wiki_page_id: wikiId,
                install_folder: installFolderName,
                save_location: saveLocations
            };

            entriesArray.push(gameObject);
        }
    });

    await window.api.invoke('save-custom-entries', entriesArray);
    saveAllButton.disabled = false;
    saveAllButton.classList.remove('cursor-not-allowed');
}

async function loadEntriesFromJson() {
    const jsonEntries = await window.api.invoke('load-custom-entries');
    const platform = await window.api.invoke('get-platform');

    const customTabContent = document.querySelector('#custom-content');
    customTabContent.innerHTML = '';

    for (const gameEntry of jsonEntries) {
        await addTemplate(false, gameEntry.wiki_page_id);
        const newEntry = document.querySelector('.custom-entry:last-child');

        // Set the entry title
        const entryTitleElement = newEntry.querySelector('.custom-entry-title');
        entryTitleElement.innerText = gameEntry.title;

        // Set the entry game install folder name
        if (gameEntry.install_folder) {
            const folderToggle = newEntry.querySelector('.game-install-folder-toggle');
            folderToggle.checked = true;

            const folderInput = newEntry.querySelector('.folder-name-input');
            folderInput.classList.remove('hidden');
            folderInput.value = gameEntry.install_folder;
        }

        const collapsedRowsContainer = newEntry.querySelector('.collapsed-rows');

        // Populate paths for the current platform
        const platformPaths = gameEntry.save_location[platform];
        platformPaths.forEach(pathObj => {
            addCollapsedRow(newEntry);
            const newRow = collapsedRowsContainer.lastElementChild;

            // Set the path and type
            const pathInput = newRow.querySelector('.custom-path-select-input');
            pathInput.value = pathObj.template;

            const backupTypeDropdown = newRow.querySelector('.custom-backup-type-dropdown');
            backupTypeDropdown.value = pathObj.type;
        });

        if (platform === 'win' && gameEntry.save_location.reg) {
            gameEntry.save_location.reg.forEach(pathObj => {
                addCollapsedRow(newEntry);
                const newRow = collapsedRowsContainer.lastElementChild;

                // Set the registry path
                const pathInput = newRow.querySelector('.custom-path-select-input');
                pathInput.value = pathObj.template;

                const backupTypeDropdown = newRow.querySelector('.custom-backup-type-dropdown');
                backupTypeDropdown.value = 'registry';
            });
        }
    }

    updateCustomEntryStyles();
}
window.loadEntriesFromJson = loadEntriesFromJson;
