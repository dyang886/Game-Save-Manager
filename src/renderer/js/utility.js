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

window.api.receive('view_account_ids', () => {
    showAccountModal();
});

export async function updateTranslations(container) {
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

export async function showAlert(type, message, modalContent) {
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
        <svg class="shrink-0 w-4 h-4" aria-hidden="true" fill="currentColor"
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

// Info modal, showing either "ok" or "yesno" style
export async function showInfoModal(modalTitle, modalContent, style = 'ok') {
    return new Promise(async (resolve) => {
        const modal = document.getElementById('modal-info');
        const modalOverlay = document.getElementById('modal-overlay');
        const modalTitleElement = document.getElementById('modal-info-title');
        const modalContentElement = document.getElementById('modal-info-content');
        const closeButton = document.getElementById('modal-info-close');
        const noButton = document.getElementById('modal-info-no');
        const confirmButton = document.getElementById('modal-info-confirm');

        modalTitleElement.textContent = modalTitle;

        // Handle mixed content: strings as plain text, arrays as list items
        if (Array.isArray(modalContent)) {
            const contentElements = modalContent.map(item => {
                if (Array.isArray(item)) {
                    // Nested array becomes a list
                    const listItems = item.map(listItem => `<li>${listItem}</li>`).join('');
                    return `<ul class="list-disc list-inside ml-3">${listItems}</ul>`;
                } else {
                    // String becomes a paragraph
                    return `<p>${item}</p>`;
                }
            }).join('');
            modalContentElement.innerHTML = contentElements;
        } else {
            modalContentElement.textContent = modalContent;
        }

        const closeModal = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modalOverlay.classList.add('hidden');
            cleanupListeners();
        };

        const cleanupListeners = () => {
            closeButton.removeEventListener('click', handleClose);
            noButton.removeEventListener('click', handleNo);
            confirmButton.removeEventListener('click', handleConfirm);
        };

        const handleClose = () => {
            closeModal();
            if (style === 'yesno') {
                resolve(false);
            } else {
                resolve(true);
            }
        };

        const handleNo = () => {
            closeModal();
            resolve(false);
        };

        const handleConfirm = () => {
            closeModal();
            resolve(true);
        };

        if (style === 'yesno') {
            noButton.style.display = '';
            noButton.textContent = await window.i18n.translate('alert.no');
            confirmButton.textContent = await window.i18n.translate('alert.yes');
        } else {
            noButton.style.display = 'none';
            confirmButton.textContent = 'Ok';
        }

        modal.classList.add('flex');
        modal.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');

        closeButton.addEventListener('click', handleClose);
        noButton.addEventListener('click', handleNo);
        confirmButton.addEventListener('click', handleConfirm);
    });
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

export function updateProgress(progressId, progressTitle, percentage) {
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

function showAccountModal() {
    const modal = document.getElementById('modal-info');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitleElement = document.getElementById('modal-info-title');
    const modalContentElement = document.getElementById('modal-info-content');
    const closeButton = document.getElementById('modal-info-close');
    const confirmButton = document.getElementById('modal-info-confirm');

    if (!modalOverlay.classList.contains('hidden')) return;

    Promise.all([
        window.api.invoke('get-account-data'),
        window.api.invoke('get-settings')
    ]).then(([accountData, settings]) => {
        modalTitleElement.setAttribute('data-i18n', 'main.view_account_ids');
        const titleSpan = document.createElement('span');
        titleSpan.className = 'text-content';
        modalTitleElement.appendChild(titleSpan);

        const isBackupAllAccounts = settings.backupAllAccounts || false;

        let contentHTML = `
            <div class="space-y-4">
                <div class="space-y-2">
                    <h4 class="font-semibold text-gray-900 dark:text-white text-content" data-i18n="alert.detected_accounts"></h4>
                    <div class="bg-gray-50 dark:bg-gray-600 p-4 rounded-lg space-y-2">
        `;

        if (accountData && Object.keys(accountData).length > 0) {
            for (const [platform, id] of Object.entries(accountData)) {
                if (id && id !== 'N/A' && id !== null) {
                    const platformKeys = {
                        steamId64: 'alert.steam_user_id64',
                        steamId3: 'alert.steam_user_id3',
                        ubisoftId: 'alert.ubisoft_user_id',
                        xboxId: 'alert.xbox_user_id',
                        rockStarId: 'alert.rockstar_user_id'
                    };
                    contentHTML += `
                        <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-700 dark:text-gray-300 text-content" data-i18n="${platformKeys[platform] || platform}"></span>
                            <code class="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded text-gray-900 dark:text-gray-100">${id}</code>
                        </div>
                    `;
                }
            }
        } else {
            contentHTML += `<p class="text-gray-600 dark:text-gray-400 text-content" data-i18n="alert.no_accounts_detected"></p>`;
        }

        contentHTML += `
                    </div>
                </div>

                <div class="border-t border-gray-300 dark:border-gray-600 pt-4">
                    <h4 class="font-semibold text-gray-900 dark:text-white mb-3 text-content" data-i18n="alert.backup_scope"></h4>
                    <div class="space-y-3">
                        <div class="flex items-center">
                            <input id="backup-scope-current" type="radio" name="backup-scope" 
                                ${!isBackupAllAccounts ? 'checked' : ''}
                                class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                            <label for="backup-scope-current" class="ms-2 text-sm text-gray-900 dark:text-gray-300">
                                <span class="font-medium text-content" data-i18n="alert.current_account_only"></span>
                            </label>
                        </div>

                        <div class="flex items-center mt-4">
                            <input id="backup-scope-all" type="radio" name="backup-scope" 
                                ${isBackupAllAccounts ? 'checked' : ''}
                                class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                            <label for="backup-scope-all" class="ms-2 text-sm text-gray-900 dark:text-gray-300">
                                <span class="font-medium text-content" data-i18n="alert.all_accounts"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mt-4">
                    <p class="text-sm text-blue-800 dark:text-blue-200">
                        <strong>Note:</strong> <span class="text-content" data-i18n="alert.account_backup_note"></span>
                    </p>
                </div>
            </div>
        `;

        modalContentElement.innerHTML = contentHTML;

        const handleClose = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modalOverlay.classList.add('hidden');
        };

        const handleConfirm = () => {
            const isAllAccountsSelected = document.getElementById('backup-scope-all').checked;
            window.api.send('save-settings', 'backupAllAccounts', isAllAccountsSelected);
            window.api.send('update-backup-table');
            handleClose();
        };

        confirmButton.setAttribute('data-i18n', 'alert.confirm');
        confirmButton.className += ' text-content';

        // Clear previous listeners
        const newCloseButton = closeButton.cloneNode(true);
        closeButton.parentNode.replaceChild(newCloseButton, closeButton);
        document.getElementById('modal-info-close').addEventListener('click', handleClose);

        const newConfirmButton = confirmButton.cloneNode(true);
        confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
        document.getElementById('modal-info-confirm').addEventListener('click', handleConfirm);

        updateTranslations(modal);

        modal.classList.add('flex');
        modal.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
    }).catch(err => {
        console.error('Error fetching account data:', err);
        modalTitleElement.textContent = 'Error';
        modalContentElement.textContent = 'Failed to load account information.';
        modal.classList.add('flex');
        modal.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
    });
}

export async function operationStartCheck(operation) {
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
            restoring: 'alert.wait_for_restore',
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
