import { showAlert, updateProgress, operationStartCheck, wrapNumberInput } from './utility.js';
import { setIcon, formatSize, addOrUpdateTableRow, removeTableRow, updateSelectedCountAndSize } from './commonTabs.js';

// Helper function for Backup Management Modal to update backup date display
function updateBackupDateDisplay(backupDateDisplay, backupDate, customName, isPermanent) {
    const formattedDate = backupDate.replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
        return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });

    if (isPermanent) {
        const permanentIcon = '<i class="fa-solid fa-star text-yellow-500 mr-2"></i>';
        const renameIcon = `<button type="button" class="rename-backup-btn text-gray-400 hover:text-blue-500 transition-colors duration-150 ml-2" data-backup-date="${backupDate}"><i class="fa-solid fa-pencil"></i></button>`;

        if (customName) {
            backupDateDisplay.innerHTML = `${permanentIcon}<div class="flex flex-col"><span class="backup-custom-name font-medium">${customName}</span><span class="text-xs text-gray-500 dark:text-gray-400">${formattedDate}</span></div>${renameIcon}`;
        } else {
            backupDateDisplay.innerHTML = `${permanentIcon}<span class="backup-date-text">${formattedDate}</span>${renameIcon}`;
        }
    } else {
        backupDateDisplay.innerHTML = `<span class="backup-date-text">${formattedDate}</span>`;
    }
}

// Helper function for Backup Management Modal to attach rename button listener
function attachRenameButtonListener(renameBtn) {
    const row = renameBtn.closest('tr');
    renameBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const renameMode = row.querySelector('.rename-mode');
        const backupDateDisplay = row.querySelector('.backup-date-display');
        const nameInput = row.querySelector('.backup-name-input');
        const currentCustomName = row.getAttribute('data-custom-name');

        renameMode.classList.remove('hidden');
        renameMode.classList.add('flex');
        backupDateDisplay.classList.add('hidden');
        nameInput.value = currentCustomName || '';
        nameInput.focus();
        nameInput.select();
    });
}

export async function showManageBackupsModal(wikiId) {
    const gamesList = await window.api.invoke('fetch-restore-table-data', wikiId);

    // Extract the single game from the returned array, fall back to backupTableDataMap if no backups exist
    const gameData = gamesList && gamesList.length > 0
        ? gamesList[0]
        : { backups: [], latest_backup: '-', title: '', zh_CN: '' };

    // If no restore data, use backupTableDataMap for game info
    if (!gamesList || gamesList.length === 0) {
        const backupData = window.backupTableDataMap.get(wikiId);
        if (backupData) {
            gameData.title = backupData.title;
            gameData.zh_CN = backupData.zh_CN;
        }
    }

    const modal = document.getElementById('modal-manage-backups');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-manage-backups-title');
    const headerInfo = document.getElementById('modal-manage-backups-header-info');
    const modalContent = document.getElementById('modal-manage-backups-content');

    // Set title
    let gameTitle = gameData.title;
    await window.api.invoke('get-settings').then((settings) => {
        if (gameData.zh_CN && settings.language === 'zh_CN') {
            gameTitle = gameData.zh_CN;
        }
    });
    const backupCount = gameData.backups.length;
    const latestBackup = gameData.latest_backup;
    modalTitle.textContent = gameTitle;

    // Create header info with translations
    const newestBackupLabel = await window.i18n.translate('main.newest_backup_time');
    const backupCountLabel = await window.i18n.translate('main.backup_count');
    headerInfo.innerHTML = `
        <p><span class="font-medium">${newestBackupLabel}:</span> <span class="newest-backup-value">${latestBackup}</span></p>
        <p><span class="font-medium">${backupCountLabel}:</span> <span class="backup-count-value">${backupCount}</span></p>
    `;

    const backupTimeLabel = await window.i18n.translate('main.backup_time');
    const backupSizeLabel = await window.i18n.translate('main.backup_size');
    const actionLabel = await window.i18n.translate('main.action');
    const restoreLabel = await window.i18n.translate('main.restore');
    const deleteLabel = await window.i18n.translate('main.delete');
    const makePermanentLabel = await window.i18n.translate('main.make_permanent');
    const removePermanentLabel = await window.i18n.translate('main.remove_permanent');
    const enterBackupNameLabel = await window.i18n.translate('main.enter_backup_name');
    const openBackupFolderLabel = await window.i18n.translate('main.open_backup_folder');
    const browseLocalSaveLabel = await window.i18n.translate('main.browse_local_save');
    const deleteLocalSaveLabel = await window.i18n.translate('main.delete_local_save');

    const rowsHtml = gameData.backups
        .sort((a, b) => {
            // Sort by is_permanent (true first), then by date
            if (a.is_permanent !== b.is_permanent) {
                return b.is_permanent - a.is_permanent;
            }
            return b.date.localeCompare(a.date);
        })
        .map(backup => {
            const formattedDate = backup.date.replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
                return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            });
            const backupSize = formatSize(backup.backup_size);
            const permanentIcon = backup.is_permanent ? '<i class="fa-solid fa-star text-yellow-500 mr-2"></i>' : '';
            const renameIcon = backup.is_permanent ? `<button type="button" class="rename-backup-btn text-gray-400 hover:text-blue-500 transition-colors duration-150 ml-2" data-backup-date="${backup.date}"><i class="fa-solid fa-pencil"></i></button>` : '';

            // Display logic: if permanent and has custom name, show custom name with date below; otherwise just show date
            let dateDisplay;
            if (backup.is_permanent && backup.custom_name) {
                dateDisplay = `${permanentIcon}<div class="flex flex-col"><span class="backup-custom-name font-medium">${backup.custom_name}</span><span class="text-xs text-gray-500 dark:text-gray-400">${formattedDate}</span></div>${renameIcon}`;
            } else {
                dateDisplay = `${permanentIcon}<span class="backup-date-text">${formattedDate}</span>${renameIcon}`;
            }

            return `<tr class="bg-white border-b dark:bg-[#2d3748] dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-600" data-custom-name="${backup.custom_name || ''}">
                <td class="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    <div class="flex items-center">
                        <div class="rename-mode hidden items-center bg-white dark:bg-gray-700 rounded-md border border-gray-300 dark:border-gray-600">
                            <input type="text" class="backup-name-input pl-3 py-2 flex-1 min-w-0 bg-transparent border-0 text-gray-900 text-sm focus:outline-none dark:text-white placeholder-gray-500 dark:placeholder-gray-400" placeholder="${enterBackupNameLabel}" />
                            <button type="button" class="confirm-rename-btn px-3 py-2 text-green-500 hover:text-green-600 transition-colors duration-150">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        </div>
                        <div class="backup-date-display flex items-center">
                            ${dateDisplay}
                        </div>
                    </div>
                </td>
                <td class="px-6 py-3">${backupSize}</td>
                <td class="px-6 py-3 text-center">
                    <div class="flex justify-center gap-2">
                        <button type="button" class="restore-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors duration-150 dark:bg-blue-700 dark:hover:bg-blue-600" data-backup-date="${backup.date}">
                            <i class="fa-solid fa-arrow-left mr-1"></i>
                            ${restoreLabel}
                        </button>
                        <button type="button" class="permanent-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 rounded-md transition-colors duration-150 dark:bg-yellow-600 dark:hover:bg-yellow-500" data-backup-date="${backup.date}" data-is-permanent="${backup.is_permanent}">
                            <i class="fa-solid fa-star mr-1"></i>
                            ${backup.is_permanent ? removePermanentLabel : makePermanentLabel}
                        </button>
                        <button type="button" class="delete-backup-btn inline-flex items-center px-3 py-1 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors duration-150 dark:bg-red-700 dark:hover:bg-red-600" data-backup-date="${backup.date}">
                            <i class="fa-solid fa-trash mr-1"></i>
                            ${deleteLabel}
                        </button>
                    </div>
                </td>
            </tr>`;
        })
        .join('');

    const tableHtml = `
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left rtl:text-right text-gray-500 dark:text-gray-400">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-200 rounded-t-lg">
                    <tr>
                        <th scope="col" class="px-4 py-3 rounded-tl-lg">${backupTimeLabel}</th>
                        <th scope="col" class="px-6 py-3">${backupSizeLabel}</th>
                        <th scope="col" class="px-6 py-3 text-center rounded-tr-lg">${actionLabel}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;

    const footerButtonsHtml = `
        <div class="mt-4 flex flex-wrap items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
            <button type="button" id="modal-open-backup-folder" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600">
                <i class="fa-solid fa-folder-open mr-2"></i>
                ${openBackupFolderLabel}
            </button>

            <div class="flex gap-3">
                <button type="button" id="modal-browse-local-save" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:hover:bg-gray-600">
                    <i class="fa-solid fa-folder-tree mr-2"></i>
                    ${browseLocalSaveLabel}
                </button>
                <button type="button" id="modal-delete-local-save" class="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-70 dark:bg-red-700 dark:hover:bg-red-600">
                    <i class="fa-solid fa-trash-can mr-2"></i>
                    ${deleteLocalSaveLabel}
                </button>
            </div>
        </div>
    `;

    modalContent.innerHTML = tableHtml + footerButtonsHtml;

    // Add event listeners to 'open backup folder' button
    document.getElementById('modal-open-backup-folder').addEventListener('click', () => {
        window.api.send('open-backup-folder', wikiId);
    });

    // Add event listeners to 'browse local save' button
    document.getElementById('modal-browse-local-save').addEventListener('click', async () => {
        // Check 1: make sure we have valid backupTableDataMap (backup tab finished loading)
        const backupLoaderContainer = document.getElementById('backup-loading');
        const isBackupLoading = backupLoaderContainer && !backupLoaderContainer.classList.contains('hidden') && backupLoaderContainer.querySelector('[data-loader-active="true"]');
        if (isBackupLoading) {
            showAlert('warning', await window.i18n.translate('alert.wait_for_backup_loading'));
            return;
        }

        // Check 2: make sure local save data exists
        const gameData = window.backupTableDataMap.get(wikiId);
        const resolvedPaths = gameData?.resolved_paths;

        if (!gameData || !resolvedPaths || resolvedPaths.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_local_save_found'));
            return;
        }

        window.api.send('browse-local-save', resolvedPaths);
    });

    // Add event listeners to 'delete local save' button
    document.getElementById('modal-delete-local-save').addEventListener('click', async () => {
        const backupLoaderContainer = document.getElementById('backup-loading');
        const isBackupLoading = backupLoaderContainer && !backupLoaderContainer.classList.contains('hidden') && backupLoaderContainer.querySelector('[data-loader-active="true"]');
        if (isBackupLoading) {
            showAlert('warning', await window.i18n.translate('alert.wait_for_backup_loading'));
            return;
        }

        const gameData = window.backupTableDataMap.get(wikiId);
        const resolvedPaths = gameData?.resolved_paths;

        if (!gameData || !resolvedPaths || resolvedPaths.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_local_save_found'));
            return;
        }

        const success = await window.api.invoke('confirm-delete-local-save', resolvedPaths);
        if (success) {
            removeTableRow('backup', wikiId);
            showAlert('success', await window.i18n.translate('alert.local_save_deleted'));
        }
    });

    // Add event listeners to restore buttons
    modalContent.querySelectorAll('.restore-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            closeManageBackupsModal();
            const backupDate = btn.dataset.backupDate;
            await restoreBackupInstance(backupDate, gameData);
        });
    });

    // Add event listeners to permanent buttons
    modalContent.querySelectorAll('.permanent-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const backupDate = btn.dataset.backupDate;
            const isPermanent = btn.dataset.isPermanent === 'true';
            const newIsPermanent = !isPermanent;

            const success = await window.api.invoke('update-backup-info', wikiId, backupDate, 'is_permanent', newIsPermanent);

            if (success) {
                const row = btn.closest('tr');
                const backupDateDisplay = row.querySelector('.backup-date-display');
                const customName = row.getAttribute('data-custom-name');

                // Update star icon/custom name on modal
                if (newIsPermanent) {
                    btn.dataset.isPermanent = 'true';
                    btn.innerHTML = `<i class="fa-solid fa-star mr-1"></i>${removePermanentLabel}`;

                    updateBackupDateDisplay(backupDateDisplay, backupDate, customName, true);

                    const renameBtn = backupDateDisplay.querySelector('.rename-backup-btn');
                    if (renameBtn) {
                        attachRenameButtonListener(renameBtn);
                    }
                } else {
                    btn.dataset.isPermanent = 'false';
                    btn.innerHTML = `<i class="fa-solid fa-star mr-1"></i>${makePermanentLabel}`;

                    updateBackupDateDisplay(backupDateDisplay, backupDate, customName, false);
                }

                // Show star icon on main tables if ANY permanent backups exist
                const hasAnyPermanentBackup = gameData.backups.some(backup => {
                    const btn = modalContent.querySelector(`.permanent-backup-btn[data-backup-date="${backup.date}"]`);
                    return btn && btn.dataset.isPermanent === 'true';
                });
                const backupTableRow = document.querySelector(`#backup tbody tr[data-wiki-id="${wikiId}"]`);
                const restoreTableRow = document.querySelector(`#restore tbody tr[data-wiki-id="${wikiId}"]`);
                if (backupTableRow) {
                    setIcon(backupTableRow, 'star', hasAnyPermanentBackup);
                }
                if (restoreTableRow) {
                    setIcon(restoreTableRow, 'star', hasAnyPermanentBackup);
                }
                // Update restoreTableDataMap with the new permanent status so backup tab has the latest data
                const restoreGameData = window.restoreTableDataMap.get(wikiId);
                if (restoreGameData) {
                    const backupToUpdate = restoreGameData.backups.find(b => b.date === backupDate);
                    if (backupToUpdate) {
                        backupToUpdate.is_permanent = newIsPermanent;
                    }
                }

                // Re-sort table with permanent backups on top
                const tbody = modalContent.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                rows.sort((a, b) => {
                    const aIsPermanent = a.querySelector('.permanent-backup-btn').dataset.isPermanent === 'true';
                    const bIsPermanent = b.querySelector('.permanent-backup-btn').dataset.isPermanent === 'true';
                    if (aIsPermanent !== bIsPermanent) {
                        return bIsPermanent - aIsPermanent;
                    }
                    // Then sort by date (newest first)
                    const aDate = a.querySelector('.permanent-backup-btn').dataset.backupDate;
                    const bDate = b.querySelector('.permanent-backup-btn').dataset.backupDate;
                    return bDate.localeCompare(aDate);
                });
                rows.forEach(row => tbody.appendChild(row));
            }
        });
    });

    // Add event listeners to delete backup buttons
    modalContent.querySelectorAll('.delete-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const backupDate = btn.dataset.backupDate;
            const row = btn.closest('tr');
            const success = await window.api.invoke('confirm-delete-backup', wikiId, backupDate);

            if (success) {
                row.remove();
                const countElement = headerInfo.querySelector('.backup-count-value');
                const currentCount = parseInt(countElement.textContent);
                const newCount = currentCount - 1;
                countElement.textContent = newCount;

                // Update newest backup date in modal header
                const newestBackupElement = headerInfo.querySelector('.newest-backup-value');
                const remainingDates = Array.from(modalContent.querySelectorAll('.permanent-backup-btn'))
                    .map(b => b.dataset.backupDate)
                    .sort((a, b) => b.localeCompare(a));
                if (remainingDates.length > 0) {
                    const formatted = remainingDates[0].replace(/(\d{4})-(\d{1,2})-(\d{1,2})_(\d{1,2})-(\d{1,2})/, (match, year, month, day, hour, minute) => {
                        return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    });
                    newestBackupElement.textContent = formatted;
                }

                if (newCount === 0) {
                    // If all backups are deleted, remove the row from the restore table
                    removeTableRow('restore', wikiId);
                } else {
                    // Update restore tab row
                    await addOrUpdateTableRow('restore', wikiId);
                    updateSelectedCountAndSize('restore');
                }

                // Update backup tab row
                await addOrUpdateTableRow('backup', wikiId);
                updateSelectedCountAndSize('backup');
            }
        });
    });

    // Add event listeners to rename backup buttons
    modalContent.querySelectorAll('.rename-backup-btn').forEach(btn => {
        attachRenameButtonListener(btn);
    });

    // Add event listeners to confirm rename backup buttons
    modalContent.querySelectorAll('.confirm-rename-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const row = btn.closest('tr');
            const backupDate = row.querySelector('.permanent-backup-btn').dataset.backupDate;
            const nameInput = row.querySelector('.backup-name-input');
            const newName = nameInput.value.trim();

            const success = await window.api.invoke('update-backup-info', wikiId, backupDate, 'custom_name', newName);

            if (success) {
                row.setAttribute('data-custom-name', newName);
                const renameMode = row.querySelector('.rename-mode');
                const backupDateDisplay = row.querySelector('.backup-date-display');
                updateBackupDateDisplay(backupDateDisplay, backupDate, newName, true);

                renameMode.classList.add('hidden');
                renameMode.classList.remove('flex');
                backupDateDisplay.classList.remove('hidden');

                // Update restoreTableDataMap with custom name
                const restoreGameData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
                if (restoreGameData) {
                    const backupToUpdate = restoreGameData.backups.find(b => b.date === backupDate);
                    if (backupToUpdate) {
                        backupToUpdate.custom_name = newName;
                    }
                }

                // Re-attach rename button event listener
                const newRenameBtn = backupDateDisplay.querySelector('.rename-backup-btn');
                if (newRenameBtn) {
                    attachRenameButtonListener(newRenameBtn);
                }
            }
        });
    });

    // Add keydown listener to rename input fields to trigger confirm on Enter
    modalContent.querySelectorAll('.backup-name-input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const confirmBtn = input.closest('.rename-mode').querySelector('.confirm-rename-btn');
                if (confirmBtn) {
                    confirmBtn.click();
                }
            }
        });
    });

    // Show modal
    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');

    // Close button handler
    document.getElementById('modal-manage-backups-close').onclick = closeManageBackupsModal;
}

function closeManageBackupsModal() {
    const modal = document.getElementById('modal-manage-backups');
    const modalOverlay = document.getElementById('modal-overlay');

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalOverlay.classList.add('hidden');
}

export async function showAutoBackupModal(wikiId) {
    const modal = document.getElementById('modal-auto-backup');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-auto-backup-title');
    const modalContent = document.getElementById('modal-auto-backup-content');
    const confirmButton = document.getElementById('modal-auto-backup-confirm');
    const closeButton = document.getElementById('modal-auto-backup-close');

    if (!modalOverlay.classList.contains('hidden')) return;

    // Get game title
    const settings = await window.api.invoke('get-settings');
    const backupData = window.backupTableDataMap.get(wikiId);
    const restoreData = window.restoreTableDataMap && window.restoreTableDataMap.get(wikiId);
    const gameData = backupData || restoreData;
    let gameTitle = '';
    if (gameData) {
        gameTitle = (gameData.zh_CN && settings.language === 'zh_CN') ? gameData.zh_CN : gameData.title;
    }

    const autoBackupState = await window.api.invoke('get-auto-backup-state');
    const isActive = !!autoBackupState[wikiId];
    const status = autoBackupState[wikiId] || null;

    // Set title
    const autoBackupLabel = await window.i18n.translate('main.auto_backup');
    modalTitle.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-2"></i><span class="text-content">${autoBackupLabel}</span>`;

    // Build content
    const enableLabel = await window.i18n.translate('main.auto_backup_enable');
    const disableLabel = await window.i18n.translate('main.auto_backup_disable');
    const modeIntervalLabel = await window.i18n.translate('main.auto_backup_mode_interval');
    const modeWatcherLabel = await window.i18n.translate('main.auto_backup_mode_watcher');
    const intervalLabel = await window.i18n.translate('main.auto_backup_interval_minutes');
    const modeLabel = await window.i18n.translate('main.auto_backup_mode');
    const statusActiveLabel = await window.i18n.translate('main.auto_backup_status_active');
    const statusInactiveLabel = await window.i18n.translate('main.auto_backup_status_inactive');

    const currentMode = status ? status.mode : 'interval';
    const currentInterval = status ? (status.intervalMinutes || 30) : 30;

    let statusHtml = '';
    if (isActive) {
        const modeDisplay = status.mode === 'interval'
            ? await window.i18n.translate('main.auto_backup_mode_interval_detail', { minutes: status.intervalMinutes })
            : modeWatcherLabel;
        const backupsPerformed = await window.i18n.translate('main.auto_backup_backups_performed', { count: status.logCount });
        const failedCount = status.failCount > 0
            ? await window.i18n.translate('main.auto_backup_failures', { count: status.failCount })
            : '';
        statusHtml = `
            <div class="mb-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
                <p class="text-sm text-green-800 dark:text-green-200">
                    <i class="fa-solid fa-circle-check mr-1"></i>
                    <strong>${statusActiveLabel}</strong> — ${modeDisplay}
                </p>
                <p class="text-sm text-green-700 dark:text-green-300 mt-1">${backupsPerformed}</p>
                ${failedCount ? `<p class="text-sm text-red-600 dark:text-red-400 mt-1">${failedCount}</p>` : ''}
            </div>
        `;
    } else {
        statusHtml = `
            <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg">
                <p class="text-sm text-gray-600 dark:text-gray-300">
                    <i class="fa-solid fa-circle-xmark mr-1"></i>
                    ${statusInactiveLabel}
                </p>
            </div>
        `;
    }

    modalContent.innerHTML = `
        <p class="text-base font-medium text-gray-900 dark:text-white mb-4">${gameTitle}</p>
        ${statusHtml}
        <div id="auto-backup-config" class="${isActive ? 'hidden' : ''}">
            <label class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">${modeLabel}</label>
            <div class="flex flex-col gap-2 mb-4">
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="auto-backup-mode" value="interval" ${currentMode === 'interval' ? 'checked' : ''}
                        class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                    <span class="ms-2 text-sm text-gray-900 dark:text-gray-300">${modeIntervalLabel}</span>
                </label>
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="auto-backup-mode" value="watcher" ${currentMode === 'watcher' ? 'checked' : ''}
                        class="w-4 h-4 text-blue-600 dark:text-blue-500 bg-gray-100 dark:bg-gray-700 dark:border-gray-600">
                    <span class="ms-2 text-sm text-gray-900 dark:text-gray-300">${modeWatcherLabel}</span>
                </label>
            </div>

            <div id="auto-backup-interval-config" class="${currentMode === 'watcher' ? 'hidden' : ''}">
                <label class="block mb-1 text-sm font-medium text-gray-900 dark:text-white">${intervalLabel}</label>
                <input type="number" id="auto-backup-interval" value="${currentInterval}" min="1"
                    class="mb-4 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:outline-hidden block w-full p-2.5 dark:bg-gray-600 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white" />
            </div>
        </div>
    `;

    // Toggle interval config visibility based on mode selection
    modalContent.querySelectorAll('input[name="auto-backup-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const intervalConfig = document.getElementById('auto-backup-interval-config');
            if (radio.value === 'watcher') {
                intervalConfig.classList.add('hidden');
            } else {
                intervalConfig.classList.remove('hidden');
            }
        });
    });

    // Wrap interval input with custom controls
    const intervalInput = document.getElementById('auto-backup-interval');
    if (intervalInput) {
        wrapNumberInput(intervalInput);
    }

    // Update confirm button text
    if (isActive) {
        confirmButton.innerHTML = `<span class="text-content">${disableLabel}</span>`;
        confirmButton.className = confirmButton.className.replace(/bg-blue-700 hover:bg-blue-800/, 'bg-red-600 hover:bg-red-700').replace(/dark:bg-blue-600 dark:hover:bg-blue-700/, 'dark:bg-red-700 dark:hover:bg-red-600');
    } else {
        confirmButton.innerHTML = `<span class="text-content">${enableLabel}</span>`;
        confirmButton.className = confirmButton.className.replace(/bg-red-600 hover:bg-red-700/, 'bg-blue-700 hover:bg-blue-800').replace(/dark:bg-red-700 dark:hover:bg-red-600/, 'dark:bg-blue-600 dark:hover:bg-blue-700');
    }

    const handleClose = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modalOverlay.classList.add('hidden');
    };

    const handleConfirm = async () => {
        if (isActive) {
            // Disable auto backup and show summary
            const logs = await window.api.invoke('stop-auto-backup', wikiId);
            handleClose();

            if (logs && logs.length > 0) {
                const failCount = logs.filter(l => !l.success).length;
                const summaryMessage = await window.i18n.translate('main.auto_backup_summary', {
                    total: logs.length,
                    failed: failCount
                });

                if (failCount > 0) {
                    const failedDetails = logs
                        .filter(l => !l.success)
                        .map(l => `[${l.timestamp}] ${l.error}`);
                    showAlert('modal', summaryMessage, failedDetails.length === 1 ? failedDetails[0] : [failedDetails]);
                } else {
                    showAlert('success', summaryMessage);
                }
            } else {
                showAlert('info', await window.i18n.translate('main.auto_backup_disabled'));
            }
        } else {
            // Enable auto backup
            const mode = modalContent.querySelector('input[name="auto-backup-mode"]:checked').value;
            const intervalMinutes = parseInt(document.getElementById('auto-backup-interval').value, 10) || 30;
            await window.api.invoke('start-auto-backup', wikiId, mode, intervalMinutes);
            handleClose();
            showAlert('success', await window.i18n.translate('main.auto_backup_enabled'));
        }
    };

    // Clear previous listeners by cloning
    const newCloseButton = closeButton.cloneNode(true);
    closeButton.parentNode.replaceChild(newCloseButton, closeButton);
    newCloseButton.addEventListener('click', handleClose);

    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    newConfirmButton.addEventListener('click', handleConfirm);

    modal.classList.add('flex');
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');
}

async function restoreBackupInstance(backupDate, gameData) {
    const start = await operationStartCheck('restore');

    if (start) {
        window.api.send('update-status', 'restoring', true);
        const restoreButton = document.getElementById('restore-button');
        restoreButton.disabled = true;
        restoreButton.classList.add('cursor-not-allowed');
        const restoreProgressId = 'restore-progress';
        const restoreProgressTitle = await window.api.invoke('translate', 'main.restore_in_progress');
        updateProgress(restoreProgressId, restoreProgressTitle, 'start');

        // Find the specific backup instance
        const backupInstance = gameData.backups.find(b => b.date === backupDate);
        // Create a game object with just this backup instance
        const gameObjForRestore = { ...gameData, backups: [backupInstance] };
        const { action, error } = await window.api.invoke('restore-game', gameObjForRestore, null);

        const restoreFailed = error ? 1 : 0;
        updateProgress(restoreProgressId, restoreProgressTitle, 'end');
        document.querySelector('#restore-tab').click();
        showRestoreSummary(1, restoreFailed, error, backupInstance.backup_size);
        document.querySelector('#restore-summary-done').classList.remove('hidden');
        restoreButton.disabled = false;
        restoreButton.classList.remove('cursor-not-allowed');
        window.api.send('update-status', 'restoring', false);

        // Update backup tab entry in background
        const wikiId = gameData.wiki_page_id;
        (async () => {
            window.api.send('update-status', 'updating_backup', true);
            await addOrUpdateTableRow('backup', wikiId);
            window.api.send('update-status', 'updating_backup', false);
        })();
    }
}
