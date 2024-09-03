async function updateTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(async (el) => {
        const key = el.getAttribute("data-i18n");
        const translation = await window.i18n.translate(key);
        if (translation) {
            if (el.classList.contains('text-content')) {
                el.innerText = translation;
            }
            const textContentElement = el.querySelector('.text-content');
            if (textContentElement) {
                textContentElement.innerText = translation;
            }
        }
    });

    // Translate placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(async element => {
        const i18nKey = element.getAttribute('data-i18n-placeholder');
        element.setAttribute('placeholder', await window.i18n.translate(i18nKey));
    });
}

function changeTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

window.api.receive('apply-theme', (theme) => {
    changeTheme(theme);
});

window.api.send('load-theme');

async function showAlert(type, message) {
    const alertContainer = document.getElementById('alert-container');

    const alertClasses = {
        info: 'text-blue-800 bg-blue-50 dark:bg-gray-800 dark:text-blue-400',
        error: 'text-red-800 bg-red-50 dark:bg-gray-800 dark:text-red-400',
        success: 'text-green-800 bg-green-50 dark:bg-gray-800 dark:text-green-400',
        warning: 'text-yellow-800 bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300',
    };

    const iconPaths = {
        info: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        error: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        success: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        warning: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
    };

    const alertElement = document.createElement('div');
    alertElement.className = `flex ml-auto max-w-max items-center p-4 mb-2 rounded-lg ${alertClasses[type]} animate-fadeInShift`;

    alertElement.innerHTML = `
        <svg class="flex-shrink-0 w-4 h-4" aria-hidden="true" fill="currentColor"
            viewBox="0 0 20 20">
            <path
                d="${iconPaths[type]}" />
        </svg>
        <span class="sr-only">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
        <div class="ms-3 text-sm font-medium">
            <span class="text-content">${message}</span>
        </div>
        <button type="button"
            class="ms-auto -mx-1.5 -my-1.5 rounded-lg p-1.5 inline-flex items-center justify-center h-8 w-8 hover:bg-opacity-75"
            aria-label="Close">
            <span class="sr-only">Close</span>
            <svg class="w-3 h-3" aria-hidden="true" fill="none"
                viewBox="0 0 14 14">
                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
            </svg>
        </button>
    `;

    // Handle manual close
    alertElement.querySelector('button').addEventListener('click', () => {
        alertElement.classList.replace('animate-fadeInShift', 'animate-fadeOutShift');
        alertElement.addEventListener('animationend', () => {
            alertElement.remove();
        });
    });

    alertContainer.appendChild(alertElement);

    // Handle automatic removal after 5 seconds
    setTimeout(() => {
        alertElement.classList.replace('animate-fadeInShift', 'animate-fadeOutShift');
        alertElement.addEventListener('animationend', () => {
            alertElement.remove();
        });
    }, 5000);
}

window.api.receive('show-alert', (type, message) => {
    showAlert(type, message);
});
