window.api.send('load-theme');

window.api.receive('apply-theme', (theme) => {
    changeTheme(theme);
});

window.api.receive('show-alert', (type, message, modalContent) => {
    showAlert(type, message, modalContent);
});

window.api.receive('open-export-modal', () => {
    showExportModal();
});

window.api.receive('open-import-modal', (gsmPath) => {
    showImportModal(gsmPath);
});

window.api.receive('update-progress', (progressId, progressTitle, percentage) => {
    updateProgress(progressId, progressTitle, percentage);
});

async function updateTranslations(container) {
    container.querySelectorAll("[data-i18n]").forEach(async (el) => {
        const key = el.getAttribute("data-i18n");
        const translation = await window.i18n.translate(key);
        if (translation) {

            // The element itself has .text-content
            if (el.classList.contains('text-content')) {
                el.innerText = translation;
            }

            // The element has a child that contains .text-content
            const textContentElement = el.querySelector('.text-content');
            if (textContentElement) {
                textContentElement.innerText = translation;
            }
        }
    });

    // Translate placeholders
    container.querySelectorAll('[data-i18n-placeholder]').forEach(async element => {
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

async function showAlert(type, message, modalContent) {
    const alertContainer = document.getElementById('alert-container');

    const alertClasses = {
        info: 'text-blue-800 bg-blue-50 dark:bg-gray-800 dark:text-blue-400',
        error: 'text-red-800 bg-red-50 dark:bg-gray-800 dark:text-red-400',
        success: 'text-green-800 bg-green-50 dark:bg-gray-800 dark:text-green-400',
        warning: 'text-yellow-800 bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300',
        modal: 'text-red-800 bg-red-50 dark:bg-gray-800 dark:text-red-400',
    };

    const iconPaths = {
        info: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        error: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        success: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        warning: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
        modal: 'M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z',
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
    `;

    if (type === 'modal') {
        alertElement.innerHTML += `
            <button type="button" class="ms-2 text-blue-500 text-sm font-medium underline" data-i18n="alert.learn_more">
                <span class="text-content">Learn More</span>
            </button>
        `;

        alertElement.querySelector('button').addEventListener('click', () => {
            showInfoModal(message, modalContent);
        });

    } else {
        alertElement.innerHTML += `
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
    }

    alertContainer.appendChild(alertElement);
    updateTranslations(alertElement);

    // Handle automatic removal after 5 seconds
    setTimeout(() => {
        alertElement.classList.replace('animate-fadeInShift', 'animate-fadeOutShift');
        alertElement.addEventListener('animationend', () => {
            alertElement.remove();
        });
    }, 5000);
}

function showInfoModal(modalTitle, modalContent) {
    const modal = document.getElementById('modal-info');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitleElement = document.getElementById('modal-info-title');
    const modalContentElement = document.getElementById('modal-info-content');

    modalTitleElement.textContent = modalTitle;

    if (Array.isArray(modalContent)) {
        modalContentElement.innerHTML = modalContent.map(item => `<li>${item}</li>`).join('');
    } else {
        modalContentElement.textContent = modalContent;
    }

    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');

    document.getElementById('modal-info-close').addEventListener('click', closeInfoModal);
    document.getElementById('modal-info-confirm').addEventListener('click', closeInfoModal);
}

function closeInfoModal() {
    const modal = document.getElementById('modal-info');
    const modalOverlay = document.getElementById('modal-overlay');

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalOverlay.classList.add('hidden');
}

// Export modal
function showExportModal() {
    const modal = document.getElementById('modal-export');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalExportCountInput = document.getElementById('modal-export-count');
    const modalExportPathInput = document.getElementById('modal-export-path');
    const modalExportPathSelectButton = document.getElementById('modal-export-select-path');

    if (!modalOverlay.classList.contains('hidden')) return;

    window.api.invoke('get-settings').then((settings) => {
        if (settings) {
            modalExportCountInput.max = settings.maxBackups;
            modalExportPathInput.value = settings.exportPath;
        }
    });

    if (!modal.dataset.listenerAdded) {
        modalExportCountInput.addEventListener('input', () => {
            const min = parseInt(modalExportCountInput.min, 10);
            const max = parseInt(modalExportCountInput.max, 10);
            let value = parseInt(modalExportCountInput.value, 10);

            if (isNaN(value) || value < 1) {
                modalExportCountInput.value = min;
            } else if (value > max) {
                modalExportCountInput.value = max;
            }
        });

        modalExportPathSelectButton.addEventListener('click', async () => {
            const result = await window.api.invoke('select-path', 'folder');
            if (result) {
                modalExportPathInput.value = result;
            }
        });
        modal.dataset.listenerAdded = true;
    }

    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');

    document.getElementById('modal-export-close').addEventListener('click', closeExportModal);
    document.getElementById('modal-export-confirm').addEventListener('click', exportConfirm);
}

async function exportConfirm() {
    const start = await operationStartCheck('export');
    if (start) {
        const count = document.getElementById('modal-export-count').value;
        const exportPath = document.getElementById('modal-export-path').value;
        window.api.send("export-backups", count, exportPath);
    }
    closeExportModal();
}

function closeExportModal() {
    const modal = document.getElementById('modal-export');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalExportPathInput = document.getElementById('modal-export-path');

    window.api.send('save-settings', 'exportPath', modalExportPathInput.value);
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalOverlay.classList.add('hidden');
}

// Import modal
function showImportModal(gsmPath) {
    const modal = document.getElementById('modal-import');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalImportPathInput = document.getElementById('modal-import-path');
    const modalImportPathSelectButton = document.getElementById('modal-import-select-path');

    if (!modalOverlay.classList.contains('hidden')) return;

    if (gsmPath) modalImportPathInput.value = gsmPath;
    if (!modal.dataset.listenerAdded) {
        modalImportPathSelectButton.addEventListener('click', async () => {
            const result = await window.api.invoke('select-path', 'gsmr');
            if (result) {
                modalImportPathInput.value = result;
            }
        });
        modal.dataset.listenerAdded = true;
    }

    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');

    document.getElementById('modal-import-close').addEventListener('click', closeImportModal);
    document.getElementById('modal-import-confirm').addEventListener('click', importConfirm);
}

async function importConfirm() {
    const start = await operationStartCheck('import');
    if (start) {
        const importPath = document.getElementById('modal-import-path').value;
        window.api.send("import-backups", importPath);
    }
    closeImportModal();
}

function closeImportModal() {
    const modal = document.getElementById('modal-import');
    const modalOverlay = document.getElementById('modal-overlay');

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalOverlay.classList.add('hidden');
}

function updateProgress(progressId, progressTitle, percentage) {
    const progressContainer = document.getElementById('progress-container');

    if (percentage === 'start') {
        const progressElement = document.createElement('div');
        progressElement.id = progressId;
        progressElement.className = "ml-auto max-w-max p-4 mb-2 rounded-lg bg-blue-50 dark:bg-gray-800 animate-fadeIn";
        progressElement.innerHTML = `
            <div class="flex justify-between mb-1 text-sm font-medium text-blue-700 dark:text-white">
                <span>${progressTitle}</span>
                <span id="${progressId}-percentage">0%</span>
            </div>
            <div class="w-60 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div id="${progressId}-bar" class="bg-blue-600 w-0 h-2.5 rounded-full"></div>
            </div>
        `;

        progressContainer.appendChild(progressElement);
        return;

    } else if (percentage === 'end') {
        const progressElement = document.getElementById(progressId);
        if (progressElement) progressElement.remove();
        return;
    }

    const progressBar = document.getElementById(`${progressId}-bar`);
    const progressPercentage = document.getElementById(`${progressId}-percentage`);
    progressBar.style.width = `${percentage}%`;
    progressPercentage.innerText = `${percentage}%`;
}

async function operationStartCheck(operation) {
    const status = await window.api.invoke('get-status');

    // Define contradicting operations
    const statusChecks = {
        'backup': {
            restoring: 'alert.wait_for_restore',
            migrating: 'alert.wait_for_migrate',
            updating_db: 'alert.wait_for_updating_db',
            exporting: 'alert.wait_for_export',
            importing: 'alert.wait_for_import',
            scanning_full: 'alert.wait_for_scan_full'
        },
        'scan-full': {
            backuping: 'alert.wait_for_backup',
            restoring: 'alert.wait_for_restore',
            updating_db: 'alert.wait_for_updating_db',
        },
        'restore': {
            backuping: 'alert.wait_for_backup',
            migrating: 'alert.wait_for_migrate',
            importing: 'alert.wait_for_import'
        },
        'change-settings': {
            backuping: 'alert.wait_for_backup',
            restoring: 'alert.wait_for_restore',
            migrating: 'alert.wait_for_migrate',
            exporting: 'alert.wait_for_export',
            importing: 'alert.wait_for_import',
            scanning_full: 'alert.wait_for_scan_full'
        },
        'save-custom': {
            backuping: 'alert.wait_for_backup',
            restoring: 'alert.wait_for_restore',
            migrating: 'alert.wait_for_migrate',
            exporting: 'alert.wait_for_export',
            importing: 'alert.wait_for_import',
            scanning_full: 'alert.wait_for_scan_full'
        },
        'update-db': {
            backuping: 'alert.wait_for_backup',
            importing: 'alert.wait_for_import',
            scanning_full: 'alert.wait_for_scan_full'
        },
        'export': {
            backuping: 'alert.wait_for_backup',
            migrating: 'alert.wait_for_migrate',
            importing: 'alert.wait_for_import'
        },
        'import': {
            backuping: 'alert.wait_for_backup',
            restoring: 'alert.wait_for_restore',
            migrating: 'alert.wait_for_migrate',
            exporting: 'alert.wait_for_export',
            scanning_full: 'alert.wait_for_scan_full'
        }
    };

    const alerts = statusChecks[operation];
    for (const [key, message] of Object.entries(alerts)) {
        if (status[key]) {
            showAlert('warning', await window.i18n.translate(message));
            return false;
        }
    }

    return true;
}
