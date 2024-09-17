function setupCustomPage() {
    const addGameButton = document.querySelector('#custom-add-game');
    const saveAllButton = document.querySelector('#custom-save-all');

    addGameButton.addEventListener('click', (event) => {
        addTemplate();
    });

    saveAllButton.addEventListener('click', (event) => {
        // Logic for save all can go here
    });

    updateCustomEntryStyles();

    document.querySelectorAll('.custom-entry').forEach(entry => {
        const button = entry.querySelector('.custom-entry-title');

        button.addEventListener('click', () => {
            toggleEntry(entry);
        });
    });
}

// Function to collapse all entries except the one clicked
function toggleEntry(clickedEntry) {
    const allEntries = document.querySelectorAll('.custom-entry');

    allEntries.forEach(entry => {
        const content = entry.querySelector('.collapsed-content');
        const buttonSvg = entry.querySelector('.custom-entry-title svg');

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
        const button = entry.querySelector('.custom-entry-title');
        button.classList.remove('rounded-t-xl');
    });

    if (entries.length > 0) {
        const firstButton = entries[0].querySelector('.custom-entry-title');
        firstButton.classList.add('rounded-t-xl');
    }
}

function createCustomEntry() {
    return `
        <div class="custom-entry flex flex-col">
            <button type="button"
                class="custom-entry-title flex items-center justify-between w-full p-5 font-medium rtl:text-right text-gray-500 border border-gray-200 rounded-t-xl focus:outline-none dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 gap-3">
                <span>New Game Entry</span>
                <svg data-accordion-icon class="w-3 h-3 rotate-180 shrink-0" aria-hidden="true" fill="none" viewBox="0 0 10 6">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5 5 1 1 5" />
                </svg>
            </button>
            <div class="collapsed-content hidden text-right p-5 border border-gray-200 dark:border-gray-700 dark:bg-gray-900">
                ${createCollapsedRow()}
                <button type="button" id="custom-add-path" data-i18n="main.add_path"
                    class="inline text-white bg-green-600 hover:bg-green-700 font-medium rounded-lg text-sm px-5 py-2.5 mt-2 dark:bg-green-500 dark:hover:bg-green-600">
                    <i class="fa-solid fa-plus mr-1"></i>
                    <span class="text-content">Add Another Path</span>
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

function addTemplate() {
    const customTabContent = document.querySelector('#custom-content');

    customTabContent.insertAdjacentHTML('beforeend', createCustomEntry());
    const newEntry = customTabContent.lastElementChild;
    
    const button = newEntry.querySelector('.custom-entry-title');
    button.addEventListener('click', () => {
        toggleEntry(newEntry);
    });

    updateCustomEntryStyles();
}
