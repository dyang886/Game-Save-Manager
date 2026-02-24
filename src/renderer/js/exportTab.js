import { showAlert, updateProgress, operationStartCheck } from './utility.js';
import { spinner, showLoadingIndicator, hideLoadingIndicator, formatSize, updateSelectedCountAndSize, setupSelectAllCheckbox, getSelectedWikiIds, setIcon } from './commonTabs.js';

const exportTableDataMap = new Map();
window.exportTableDataMap = exportTableDataMap;

document.addEventListener('DOMContentLoaded', () => {
    setupExportButton();
    updateExportTable(true);
});

window.api.receive('update-export-table', () => {
    updateExportTable(true);
});

async function updateExportTable(loader) {
    if (loader) {
        await showLoadingIndicator('export');
    }

    const gameData = await window.api.invoke('fetch-export-table-data');
    await populateExportTable(gameData);
    updateSelectedCountAndSize('export');

    if (loader) {
        hideLoadingIndicator('export');
    }
}
window.updateExportTable = updateExportTable;

async function populateExportTable(data) {
    const exportTable = document.querySelector('#export');
    const tableBody = document.querySelector('#export tbody');
    const selectAllCheckbox = exportTable.querySelector('#export-checkbox-all-search');

    const settings = await window.api.invoke('get-settings');
    const pinnedGamesWikiIds = settings.pinnedGames || [];
    const selectedWikiIds = getSelectedWikiIds('export');

    tableBody.innerHTML = '';
    exportTableDataMap.clear();

    const gamesWithTitleToSort = await Promise.all(
        data.map(async (game) => {
            const titleToSort = settings.language === 'zh_CN'
                ? game.zh_CN || game.title
                : game.title;
            return { ...game, titleToSort };
        })
    );

    const pinnedGames = await window.api.invoke(
        'sort-games',
        gamesWithTitleToSort.filter(game => pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    const otherGames = await window.api.invoke(
        'sort-games',
        gamesWithTitleToSort.filter(game => !pinnedGamesWikiIds.includes(game.wiki_page_id.toString()))
    );

    const appendRowsToTable = (games, isPinned) => {
        games.forEach((game) => {
            const wikiId = game.wiki_page_id;
            exportTableDataMap.set(wikiId, game);

            let gameTitle = game.title;
            if (game.zh_CN && settings.language === 'zh_CN') {
                gameTitle = game.zh_CN;
            }
            if (!gameTitle) {
                return;
            }

            const backupCount = game.backups.length;
            const backupSize = formatSize(game.backup_size);

            let row = createExportTableRow(gameTitle, backupCount, backupSize, game.latest_backup, game.wiki_page_id);

            if (selectedWikiIds.includes(wikiId)) {
                const checkbox = row.querySelector('.row-checkbox');
                if (checkbox) {
                    checkbox.checked = true;
                }
            }

            if (isPinned) {
                setIcon(row, 'pin', true);
            }

            const hasPermamentBackup = game.backups.some(backup => backup.is_permanent);
            if (hasPermamentBackup) {
                setIcon(row, 'star', true);
            }

            tableBody.appendChild(row);
        });
    };

    appendRowsToTable(pinnedGames, true);
    appendRowsToTable(otherGames, false);

    setupSelectAllCheckbox('export', selectAllCheckbox);
}

function createExportTableRow(gameTitle, backupCount, backupSize, newestBackupTime, wikiPageId) {
    const row = document.createElement('tr');
    row.setAttribute('data-wiki-id', wikiPageId);
    row.classList.add('bg-white', 'border-b', 'dark:bg-gray-800', 'dark:border-gray-700', 'hover:bg-gray-50', 'dark:hover:bg-gray-600');
    row.innerHTML = `
        <td class="w-4 py-4 pl-4">
            <div class="flex items-center">
                <input type="checkbox" class="row-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:outline-hidden dark:bg-gray-700 dark:border-gray-600">
                <label class="sr-only">checkbox</label>
            </div>
        </td>
        <th scope="row" class="pr-6 py-4 truncate font-medium text-gray-900 whitespace-nowrap dark:text-white">
            <span data-icon="pin" class="hidden"><i class="fa-solid fa-thumbtack text-red-500 mr-2"></i></span>
            <span data-icon="star" class="hidden"><i class="fa-solid fa-star text-yellow-500 mr-2"></i></span>
            <span data-icon="timer" class="hidden"><i class="fa-solid fa-hourglass text-blue-500 mr-2"></i></span>
            ${gameTitle}
        </th>
        <td class="px-6 py-4 truncate">
            ${backupCount}
        </td>
        <td class="px-6 py-4 truncate">
            ${backupSize}
        </td>
        <td class="px-6 py-4 truncate newest-backup-time">
            ${newestBackupTime}
        </td>
        <td class="px-6 py-4 truncate text-center">
            <button class="dropdown-menu-button inline-flex items-center p-2 text-sm font-medium text-center text-gray-900 hover:bg-transparent focus:outline-hidden dark:text-white"
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

function setupExportButton() {
    const exportButton = document.getElementById('export-button');
    const exportIcon = document.getElementById('export-icon');
    const exportText = document.getElementById('export-text');

    exportButton.addEventListener('click', async () => {
        const selectedGames = getSelectedWikiIds('export');

        if (exportButton.disabled) return;
        if (selectedGames.length === 0) {
            showAlert('warning', await window.i18n.translate('alert.no_games_selected'));
            return;
        }

        const modal = document.getElementById('modal-export');
        const modalOverlay = document.getElementById('modal-overlay');
        const exportCountInput = document.getElementById('modal-export-count');
        const exportPathInput = document.getElementById('modal-export-path');
        const exportSelectPathBtn = document.getElementById('modal-export-select-path');
        const exportConfirmBtn = document.getElementById('modal-export-confirm');
        const exportCloseBtn = document.getElementById('modal-export-close');

        const settings = await window.api.invoke('get-settings');
        exportCountInput.value = settings.exportCount || 1;
        exportPathInput.value = settings.exportPath || '';

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modalOverlay.classList.remove('hidden');

        exportSelectPathBtn.onclick = async () => {
            const result = await window.api.invoke('select-path', 'folder');
            if (result) {
                exportPathInput.value = result;
                window.api.send('save-settings', 'exportPath', result);
            }
        };

        exportConfirmBtn.onclick = async () => {
            if (!exportPathInput.value) {
                showAlert('warning', await window.i18n.translate('alert.empty_export_path'));
                return;
            }

            const count = parseInt(exportCountInput.value) || 1;
            const exportPath = exportPathInput.value;

            window.api.send('save-settings', 'exportCount', count);

            closeExportModal();

            exportButton.disabled = true;
            exportButton.classList.add('cursor-not-allowed');
            exportIcon.classList.remove('fa-file-export');
            exportIcon.innerHTML = spinner;
            exportButton.setAttribute('data-i18n', 'main.export_in_progress');
            exportText.textContent = await window.i18n.translate('main.export_in_progress');

            await performExport(selectedGames, count, exportPath);

            exportButton.disabled = false;
            exportButton.classList.remove('cursor-not-allowed');
            exportIcon.innerHTML = '';
            exportIcon.classList.add('fa-file-export');
            exportButton.setAttribute('data-i18n', 'main.export_selected');
            exportText.textContent = await window.i18n.translate('main.export_selected');
            window.api.send('update-status', 'exporting', false);
        };

        exportCloseBtn.onclick = closeExportModal;
        modalOverlay.onclick = (e) => {
            if (e.target === modalOverlay) {
                closeExportModal();
            }
        };

        function closeExportModal() {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modalOverlay.classList.add('hidden');
        }
    });
}

async function performExport(selectedWikiIds, count, exportPath) {
    const exportProgressId = 'export';
    const exportProgressTitle = await window.api.invoke('translate', 'main.export_in_progress');

    const start = await operationStartCheck('export');
    if (start) {
        // 主进程会在导出逻辑内部设置并管理 `exporting` 状态，
        // 这里不要预先设置以避免与主进程的状态检查产生竞态。
        updateProgress(exportProgressId, exportProgressTitle, 'start');

        try {
            const result = await window.api.invoke('export-selected-backups', selectedWikiIds, count, exportPath);
            updateProgress(exportProgressId, exportProgressTitle, 'end');
            
            // Show export summary
            const resultErrors = result && result.errors ? result.errors : [];
            const exportCount = selectedWikiIds.length - resultErrors.length;
            const exportFailed = resultErrors.length;
            showExportSummary(exportCount, exportFailed, resultErrors, exportPath);
            
            await updateExportTable(true);
        } catch (error) {
            console.error('Export error:', error);
            showAlert('modal', await window.i18n.translate('alert.error_during_export'), error.message || error);
            updateProgress(exportProgressId, exportProgressTitle, 'end');
        }

        window.api.send('update-status', 'exporting', false);
    }
}

function showExportSummary(exportCount, exportFailed, errors, exportPath) {
    const exportSummary = document.querySelector('#export-summary');
    const exportContent = document.querySelector('#export-content');
    const exportFailedContainer = document.querySelector('#export-summary-total-failed-container');
    
    exportSummary.classList.remove('hidden');
    exportContent.classList.add('hidden');

    window.api.invoke('get-settings').then(async (settings) => {
        if (settings) {
            document.getElementById('export-summary-total-games').textContent = exportCount;
            document.getElementById('export-summary-save-path').textContent = exportPath;

            // Calculate and display total export size based on currently selected games
            try {
                const selected = getSelectedWikiIds('export');
                let totalSize = 0;
                selected.forEach(id => {
                    const game = window.exportTableDataMap.get(id);
                    if (game && game.backup_size) totalSize += game.backup_size;
                });
                document.getElementById('export-summary-total-size').textContent = formatSize(totalSize);
            } catch (e) {
                document.getElementById('export-summary-total-size').textContent = '';
            }

            if (exportFailed > 0) {
                const failed_message = await window.i18n.translate('summary.total_export_failed', {
                    failed_count: exportFailed
                });
                document.getElementById('export-summary-total-failed').textContent = failed_message;
                document.getElementById('export-failed-learn-more').addEventListener('click', () => {
                    showAlert('modal', failed_message, errors);
                });
                exportFailedContainer.classList.remove('hidden');
            } else {
                exportFailedContainer.classList.add('hidden');
            }
        }
    });

    document.querySelector('#export-summary-done').addEventListener('click', (event) => {
        exportContent.classList.remove('animate-fadeInShift', 'animate-fadeOut');
        exportSummary.classList.add('hidden');
        exportContent.classList.remove('hidden');
        event.target.closest('button').classList.add('hidden');
    });
}
