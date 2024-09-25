function setupCustomPage() {
    const addGameButton = document.querySelector('#custom-add-game');
    const saveAllButton = document.querySelector('#custom-save-all');

    addGameButton.addEventListener('click', (event) => {
        addTemplate();
    });

    saveAllButton.addEventListener('click', (event) => {
        saveEntriesToJson(saveAllButton);
    });

    loadEntriesFromJson();
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
}

function createCustomEntry() {
    return `
        <div class="custom-entry flex flex-col">
            <div class="custom-entry-header flex items-center justify-between w-full p-5 font-medium rtl:text-right text-gray-500 border border-gray-200 rounded-t-xl focus:outline-none dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <div class="flex items-center gap-3">
                    <input type="text" class="custom-entry-title-input hidden bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                        placeholder="Enter Game Name" />
                    <span class="custom-entry-title">New Game Entry</span>
                    <button type="button" class="custom-entry-rename text-blue-700 hover:text-blue-800">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                    <button type="button" class="custom-entry-delete text-red-600 hover:text-red-700">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <svg data-accordion-icon class="custom-entry-dropdown w-3 h-3 shrink-0 cursor-pointer" aria-hidden="true" fill="none" viewBox="0 0 10 6">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5 5 1 1 5" />
                </svg>
            </div>
            <div class="collapsed-content hidden text-right p-5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900">
                <div class="collapsed-rows"></div>
                <button type="button" class="custom-add-path inline text-white bg-green-600 hover:bg-green-700 font-medium rounded-lg text-sm px-5 py-2.5 mt-2 dark:bg-green-500 dark:hover:bg-green-600">
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
                <select class="custom-backup-type-dropdown bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white mr-3">
                    <option value="file">File</option>
                    <option value="folder">Folder</option>
                    <option value="registry">Registry</option>
                </select>

                <input type="text" class="custom-path-select-input flex-grow bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white mr-3"
                    placeholder="Select Path">

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

    // Add path row
    const addPathButton = newRow.querySelector('.custom-path-select-button');
    addPathButton.addEventListener('click', async () => {
        const fileType = newRow.querySelector('.custom-backup-type-dropdown').value;
        const result = await window.api.invoke('select-path', fileType);

        if (result) {
            const pathInput = newRow.querySelector('.custom-path-select-input');
            pathInput.value = result;
        }
    });

    // Delete path row
    const deletePathButton = newRow.querySelector('.custom-delete-collapsed-row');
    deletePathButton.addEventListener('click', () => {
        newRow.remove();
    });
}

function addTemplate() {
    const customTabContent = document.querySelector('#custom-content');

    customTabContent.insertAdjacentHTML('beforeend', createCustomEntry());
    const newEntry = customTabContent.lastElementChild;

    const titleInput = newEntry.querySelector('.custom-entry-title-input');
    const entryTitle = newEntry.querySelector('.custom-entry-title');
    const renameButton = newEntry.querySelector('.custom-entry-rename');
    const deleteButton = newEntry.querySelector('.custom-entry-delete');
    const dropdownIcon = newEntry.querySelector('.custom-entry-dropdown');

    // Toggle collapsed content when the whole header is clicked
    dropdownIcon.addEventListener('click', () => {
        toggleEntry(newEntry);
    });

    // Rename the title
    renameButton.addEventListener('click', () => {
        titleInput.classList.remove('hidden');
        entryTitle.classList.add('hidden');
        titleInput.value = entryTitle.innerText;
        titleInput.focus();
    });

    // Save the new title on blur or Enter key press
    titleInput.addEventListener('blur', () => {
        const newTitle = titleInput.value.trim();
        if (newTitle) {
            entryTitle.innerText = newTitle;
        }
        titleInput.classList.add('hidden');
        entryTitle.classList.remove('hidden');
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
}

async function saveEntriesToJson(saveAllButton) {
    // TODO: name duplicates check
    // TODO: tab exist warning for unsaved changes
    saveAllButton.disabled = true;
    saveAllButton.classList.add('cursor-not-allowed');

    const allEntries = document.querySelectorAll('.custom-entry');
    const entriesArray = [];
    const platform = await window.api.invoke('get-platform');
    let currentWikiId = -1;

    allEntries.forEach(entry => {
        const entryTitle = entry.querySelector('.custom-entry-title').innerText.trim();
        const collapsedRows = entry.querySelectorAll('.collapsed-row');
        const saveLocations = {
            win: [],
            reg: [],
            mac: [],
            linux: []
        };

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
                wiki_page_id: currentWikiId--,
                install_folder: '',
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

    jsonEntries.forEach(gameEntry => {
        addTemplate();
        const newEntry = document.querySelector('.custom-entry:last-child');

        // Set the entry title
        const entryTitleElement = newEntry.querySelector('.custom-entry-title');
        entryTitleElement.innerText = gameEntry.title;

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
    });

    updateCustomEntryStyles();
}
