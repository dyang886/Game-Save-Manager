document.addEventListener("DOMContentLoaded", function () {
    const tabsElement = document.getElementById('main-tab');

    const tabElements = [
        {
            id: 'backup',
            triggerEl: document.querySelector('#backup-tab'),
            targetEl: document.querySelector('#backup'),
        },
        {
            id: 'restore',
            triggerEl: document.querySelector('#restore-tab'),
            targetEl: document.querySelector('#restore'),
        },
        {
            id: 'custom',
            triggerEl: document.querySelector('#custom-tab'),
            targetEl: document.querySelector('#custom'),
        },
    ];

    // Options with default values
    const options = {
        defaultTabId: 'backup',
        activeClasses:
            'text-blue-600 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-400 border-blue-600 dark:border-blue-500',
        inactiveClasses:
            'text-gray-500 hover:text-gray-600 dark:text-gray-400 border-gray-100 hover:border-gray-300 dark:border-gray-700 dark:hover:text-gray-300',
        onShow: () => {
            console.log('tab is shown');
        },
    };

    // Initialize the tabs
    if (tabsElement) {
        const defaultTab = tabElements.find(tab => tab.id === options.defaultTabId);

        if (defaultTab) {
            showTab(defaultTab);
        }

        tabElements.forEach(tab => {
            tab.triggerEl.addEventListener('click', () => {
                showTab(tab);
            });
        });
    }

    function showTab(tab) {
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

    // Data for testing
    const testData = [
        {
            name: 'The Witcher 3',
            platforms: 'Steam, GOG',
            size: '25MB',
            date: '2024/01/15',
            link: '#'
        },
        {
            name: 'Cyberpunk 2077',
            platforms: 'Steam, Epic Games',
            size: '50MB',
            date: '2024/02/20',
            link: '#'
        },
        {
            name: 'Red Dead Redemption 2',
            platforms: 'Rockstar Launcher, Steam',
            size: '30MB',
            date: '2024/03/10',
            link: '#'
        }
    ];

    // Function to populate the table
    const populateTable = () => {
        const tables = ['#backup tbody', '#restore tbody'];
        tables.forEach(selector => {
            const tableBody = document.querySelector(selector);
            for (let i = 0; i < 5; i++) {
                testData.forEach(data => {
                    const row = document.createElement('tr');
                    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
                    row.innerHTML = `
                        <td class="w-4 p-4">
                            <div class="flex items-center">
                                <input type="checkbox" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:outline-none dark:bg-gray-700 dark:border-gray-600">
                                <label class="sr-only">checkbox</label>
                            </div>
                        </td>
                        <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white">
                            ${data.name}
                        </th>
                        <td class="px-6 py-4">
                            ${data.platforms}
                        </td>
                        <td class="px-6 py-4">
                            ${data.size}
                        </td>
                        <td class="px-6 py-4">
                            ${data.date}
                        </td>
                        <td class="px-6 py-4">
                            <a href="${data.link}" class="font-medium text-blue-600 dark:text-blue-500 hover:underline">Link</a>
                        </td>
                    `;
                    tableBody.appendChild(row);
                });
            }
        });
    };

    // Call the function to populate the table
    populateTable();
});
