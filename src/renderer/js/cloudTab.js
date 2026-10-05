import { element, t, loadCloudLabels, cloudCall, cloudErrorMessage, message, button, select, field, input, checkbox, confirmCloud, createDialog, previewAndUpload } from './cloudShared.js';
import { mountCloudSettings } from './cloudSettings.js';
import { byteSize, snapshotDate, versionData, filterVersions, jobActions } from './cloudPresentation.js';
import { showManageBackupsModal } from './modalDisplay.js';

let reloadTab;

async function mountCloudTab(container) {
    await loadCloudLabels();
    let state = { targets: [], versions: [], jobs: [] };
    let refreshing = false;
    let refreshInfo = '';
    const registryConfirmations = new Map();
    const toolbar = element('div', null, 'cloud-toolbar');
    const target = select([]); target.setAttribute('aria-label', t('connection'));
    const device = select([['', t('all_devices')]]); device.setAttribute('aria-label', t('device'));
    const search = input('search'); search.placeholder = t('search_games'); search.setAttribute('aria-label', t('search_games'));
    const status = element('div');
    const freshness = element('p', t('cache_hint'), 'cloud-hint');
    const settings = button('settings', async () => {
        const { dialog, body, footer } = createDialog(t('title'));
        footer.append(button('close', () => dialog.close()));
        dialog.addEventListener('close', () => reload());
        dialog.showModal();
        await mountCloudSettings(body);
    });
    const refresh = button('refresh', async () => {
        if (!target.value || refreshing) return;
        refreshing = true; refresh.disabled = true; message(status, t('refreshing'));
        try {
            const result = await cloudCall('refresh', { targetId: target.value });
            refreshInfo = result?.refreshedAt || new Date().toISOString();
            await reload();
            message(status, result?.invalidCount ? t('refresh_invalid', { count: result.invalidCount }) : t('refresh_complete'), Boolean(result?.invalidCount));
        } catch (error) { message(status, `${error.message} ${t('cache_hint')}`, true); }
        finally { refreshing = false; refresh.disabled = !target.value; }
    });
    toolbar.append(field('connection', target), field('device', device), field('search_games', search), refresh, settings);
    const batch = element('div', null, 'cloud-toolbar');
    const selection = select([['latest', t('latest_versions')], ['permanent', t('permanent_versions')], ['all', t('all_versions')]], 'latest');
    const upload = button('preview_upload', async () => {
        upload.disabled = true;
        try { await previewAndUpload(target.value, selection.value, undefined, status); await reload(); }
        catch (error) { message(status, error.message, true); }
        finally { updateButtons(); }
    });
    batch.append(field('history_scope', selection), upload);
    const list = element('div', null, 'cloud-versions');
    const jobs = element('section', null, 'cloud-jobs');
    container.replaceChildren(element('p', t('intro'), 'cloud-hint'), toolbar, freshness, status, batch, list, jobs);

    const selectedTarget = () => state.targets.find(item => item.id === target.value);
    const updateButtons = () => {
        refresh.disabled = refreshing || !target.value;
        upload.disabled = !target.value || !selectedTarget()?.repositoryId || selectedTarget()?.readOnly || selectedTarget()?.capabilities?.write === false;
    };
    const performVersionAction = async (version, action, control) => {
        const targetId = version.targetId || target.value;
        const name = version.gameTitle || version.title || version.gameKey;
        const identity = `${selectedTarget()?.name || target.value}\n${name}\n${snapshotDate(version)}\n${t('device')}: ${version.publisherDeviceId || version.originDeviceId}\n${t('account')}: ${JSON.stringify(version.accountScope || version.account || '—')}\n${byteSize(version.archiveSize)}`;
        if (action === 'restore' && !await confirmCloud(t('restore_version'), `${identity}\n\n${t('restore_confirmation')}`, 'restore')) return;
        if (action === 'deleteVersion') {
            if (!await confirmCloud(t('delete_version'), `${identity}\n\n${t('delete_confirmation')}`, 'delete')) return;
            if (version.isPermanent && !await confirmCloud(t('delete_permanent'), t('delete_permanent_confirmation'), 'delete')) return;
        }
        control.disabled = true;
        try {
            await cloudCall(action, { targetId, versionId: version.versionId, revision: version.revision, ...(action === 'deleteVersion' ? { confirmPermanent: Boolean(version.isPermanent) } : {}) });
            message(status, t('queued'));
            await reload();
        } catch (error) { message(status, error.message, true); control.disabled = false; }
    };
    const renderVersions = () => {
        list.replaceChildren();
        const filtered = filterVersions(state.versions || [], { targetId: target.value, deviceId: device.value, search: search.value });
        if (!target.value || !filtered.length) { list.append(element('p', t(target.value ? 'no_cloud_versions' : 'configure_first'), 'cloud-empty')); return; }
        const table = element('table', null, 'cloud-table');
        const header = element('tr');
        for (const key of ['game', 'version', 'device', 'size', 'actions']) { const th = element('th', t(key)); th.scope = 'col'; header.append(th); }
        const head = element('thead'); head.append(header); table.append(head);
        const body = element('tbody');
        for (const version of filtered) {
            const row = element('tr');
            const game = element('td'); game.append(element('strong', version.gameTitle || version.title || version.gameKey), element('p', version.gameKey, 'cloud-hint'));
            const detail = element('td'); detail.append(element('p', snapshotDate(version)), element('p', version.customName || '', 'cloud-hint'));
            if (version.isPermanent) detail.append(element('span', t('permanent'), 'cloud-badge'));
            if (version.stale) detail.append(element('p', t('cached_unconfirmed'), 'cloud-hint'));
            const deviceCell = element('td', version.deviceName || version.publisherDeviceId || version.originDeviceId);
            const actions = element('td'); const actionsInner = element('div', null, 'cloud-actions');
            const download = button('download', event => performVersionAction(version, 'download', event.currentTarget));
            const restore = button('restore', event => performVersionAction(version, 'restore', event.currentTarget));
            const remove = button('delete', event => performVersionAction(version, 'deleteVersion', event.currentTarget), 'cloud-danger');
            remove.disabled = Boolean(selectedTarget()?.readOnly || selectedTarget()?.capabilities?.delete === false || selectedTarget()?.capabilities?.canDelete === false);
            actionsInner.append(download, restore, remove); actions.append(actionsInner);
            row.append(game, detail, deviceCell, element('td', byteSize(version.archiveSize)), actions); body.append(row);
        }
        table.append(body); list.append(table);
    };
    const renderJobs = () => {
        for (const id of registryConfirmations.keys()) {
            const job = (state.jobs || []).find(item => (item.jobId || item.id) === id);
            if (!job || job.kind !== 'restore' || !['PATH_MAPPING_REQUIRED', 'REGISTRY_CONFIRMATION_REQUIRED'].includes(job.error?.code)) registryConfirmations.delete(id);
        }
        jobs.replaceChildren(element('h3', t('tasks')), element('p', t('local_cloud_separate'), 'cloud-hint'));
        for (const notice of state.notices || []) {
            const warning = element('p', `${t('not_queued', { game: notice.gameId || notice.snapshotId || '' })} ${cloudErrorMessage(notice.error)}`, 'cloud-error');
            warning.setAttribute('role', 'status'); jobs.append(warning);
        }
        const currentJobs = (state.jobs || []).filter(job => !target.value || job.targetId === target.value);
        if (!currentJobs.length) { jobs.append(element('p', t('no_tasks'), 'cloud-hint')); return; }
        for (const job of currentJobs) {
            const card = element('article', null, 'cloud-job');
            const detail = element('div');
            detail.append(element('strong', `${job.title || job.gameTitle || job.gameId || job.snapshotId || job.id} · ${t(`kind_${job.kind || 'upload'}`)}`), element('p', t(`stage_${job.stage}`)));
            if (job.cleanupPending) detail.append(element('p', t('multipart_cleanup_pending'), 'cloud-error'));
            if (job.result?.duplicateContent) detail.append(element('p', t('duplicate_content'), 'cloud-hint'));
            const protection = job.result?.protectionFolder || job.result?.protectionSnapshotId;
            if (protection) detail.append(element('p', t('protection_version', { id: protection }), 'cloud-hint'));
            if (job.result?.pathResults?.length) {
                const results = element('details', null, 'cloud-restore-results'); results.open = true;
                results.append(element('summary', t('restore_path_results')));
                const paths = element('ul');
                for (const result of job.result.pathResults) {
                    const succeeded = result.success === true;
                    const line = element('li', t(succeeded ? 'restore_path_success' : 'restore_path_failed', { folder: result.folder }), succeeded ? '' : 'cloud-error');
                    if (!succeeded) {
                        const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(result.error?.code || '') ? result.error.code : 'RESTORE_FAILED';
                        line.append(element('p', `${code}: ${cloudErrorMessage({ code, message: t('error_RESTORE_FAILED') })}`, 'cloud-hint'));
                    }
                    paths.append(line);
                }
                results.append(paths); detail.append(results);
            }
            const registration = job.result?.customGameRegistration?.status;
            if (['registered', 'existing', 'failed'].includes(registration)) detail.append(element('p', t(`custom_game_${registration}`), registration === 'failed' ? 'cloud-error' : 'cloud-hint'));
            if (job.stage === 'verifying') detail.append(element('p', t('verification_traffic'), 'cloud-hint'));
            if (job.nextAttemptAt && job.stage === 'retry_wait') detail.append(element('p', t('next_retry', { time: snapshotDate({ createdAt: job.nextAttemptAt }) }), 'cloud-hint'));
            if (job.error) {
                const error = element('details'); error.append(element('summary', t('error_details')), element('pre', `${job.error.code || ''}${job.error.status ? ` (${job.error.status})` : ''}\n${cloudErrorMessage(job.error)}`, 'cloud-preserve-lines')); detail.append(error);
            }
            if (job.progress && !['succeeded', 'cancelled', 'failed'].includes(job.stage)) {
                const progress = element('progress'); progress.setAttribute('aria-label', t(`stage_${job.stage}`));
                if (job.progress.total > 0) { progress.max = job.progress.total; progress.value = Math.min(job.progress.total, job.progress.completed || 0); }
                detail.append(progress);
            }
            const controls = element('div', null, 'cloud-actions');
            if (job.result?.folder && job.result?.gameId) controls.append(button('view_local_versions', async () => {
                try { await showManageBackupsModal(job.result.gameId); }
                catch (error) { message(status, error.message, true); }
            }));
            if (job.kind === 'restore' && ['PATH_MAPPING_REQUIRED', 'REGISTRY_CONFIRMATION_REQUIRED'].includes(job.error?.code)) {
                const mapping = element('section', null, 'cloud-card');
                mapping.append(element('h3', t('restore_mapping')), element('p', t('restore_mapping_hint'), 'cloud-hint'));
                for (const item of (job.result?.mappingsRequired || []).filter(item => item.type !== 'reg')) {
                    const row = element('div', null, 'cloud-field');
                    row.append(element('p', `${item.template || item.folder} (${item.type || ''})`));
                    if (item.originalMissing) row.append(element('p', t('restore_missing_target'), 'cloud-hint'));
                    if (job.result?.restoreMappings?.[item.folder]) row.append(element('p', job.result.restoreMappings[item.folder], 'cloud-hint'));
                    row.append(button('choose_restore_path', async event => {
                        const control = event.currentTarget;
                        control.disabled = true;
                        try { await cloudCall('chooseRestoreMapping', { jobId: job.jobId || job.id, folder: item.folder }); await reload(); }
                        catch (error) { message(status, error.message, true); control.disabled = false; }
                    }));
                    mapping.append(row);
                }
                const jobId = job.jobId || job.id;
                const confirmationKey = JSON.stringify([job.targetId, job.revision, job.snapshotId, job.result?.folder, job.result?.registryTargets, job.result?.restoreMappings]);
                const registry = checkbox('confirm_registry', registryConfirmations.get(jobId) === confirmationKey);
                const requiresRegistry = job.error.code === 'REGISTRY_CONFIRMATION_REQUIRED' || Boolean(job.result?.registryTargets?.length);
                if (requiresRegistry) {
                    for (const registryTarget of job.result?.registryTargets || []) mapping.append(element('p', typeof registryTarget === 'string' ? registryTarget : registryTarget.template || registryTarget.path || registryTarget.key || '', 'cloud-hint'));
                    mapping.append(registry.label);
                }
                const confirmMapping = button('confirm_restore_mapping', async event => {
                    const control = event.currentTarget;
                    const destinations = Object.values(job.result?.restoreMappings || {}).join('\n');
                    if (!await confirmCloud(t('restore_version'), `${job.title || job.gameId}\n${destinations}\n\n${t('restore_confirmation')}`, 'restore')) return;
                    control.disabled = true;
                    try { await cloudCall('confirmRestore', { jobId, confirmRegistry: registry.node.checked }); registryConfirmations.delete(jobId); await reload(); }
                    catch (error) { message(status, error.message, true); control.disabled = false; }
                }, 'cloud-primary');
                const updateConfirmation = () => {
                    confirmMapping.disabled = (job.result?.mappingsRequired || []).some(item => item.type !== 'reg' && !job.result?.restoreMappings?.[item.folder]) || (requiresRegistry && !registry.node.checked);
                };
                registry.node.addEventListener('change', () => {
                    if (registry.node.checked) registryConfirmations.set(jobId, confirmationKey);
                    else registryConfirmations.delete(jobId);
                    updateConfirmation();
                });
                updateConfirmation();
                mapping.append(confirmMapping);
                detail.append(mapping);
            }
            const actions = jobActions(job.stage).filter(action => action !== 'retry' || !['PATH_MAPPING_REQUIRED', 'REGISTRY_CONFIRMATION_REQUIRED'].includes(job.error?.code));
            for (const action of actions) controls.append(button(action, async event => {
                const control = event.currentTarget;
                control.disabled = true;
                try { await cloudCall('controlJob', { jobId: job.jobId || job.id, action }); await reload(); }
                catch (error) { message(status, error.message, true); control.disabled = false; }
            }));
            card.append(detail, controls); jobs.append(card);
        }
    };
    const reload = async () => {
        try {
            state = await cloudCall('getState');
            const attention = (state.jobs || []).filter(job => !['succeeded', 'cancelled'].includes(job.stage)).length + (state.notices || []).length;
            const tabStatus = document.getElementById('cloud-tab-status');
            if (tabStatus) {
                tabStatus.hidden = !attention;
                tabStatus.textContent = attention;
                tabStatus.title = t('attention_count', { count: attention });
            }
            const previousTarget = target.value;
            target.replaceChildren(...(state.targets || []).map(item => { const option = element('option', item.name); option.value = item.id; return option; }));
            target.value = state.targets.some(item => item.id === previousTarget) ? previousTarget : state.automatic?.targetId || state.targets[0]?.id || '';
            const previousDevice = device.value;
            const all = element('option', t('all_devices')); all.value = '';
            device.replaceChildren(all);
            const devices = new Map((state.versions || []).filter(item => item.targetId === target.value).map(item => {
                const data = versionData(item);
                return [data.publisherDeviceId || data.originDeviceId, data.deviceName || data.publisherDeviceId || data.originDeviceId];
            }));
            for (const [id, name] of devices) { const option = element('option', name); option.value = id; device.append(option); }
            device.value = devices.has(previousDevice) ? previousDevice : '';
            const cachedRefresh = (state.versions || []).filter(item => item.targetId === target.value && item.refreshedAt)
                .map(item => item.refreshedAt).sort().at(-1);
            const timestamp = refreshInfo || selectedTarget()?.lastRefreshedAt || state.lastRefreshedAt || cachedRefresh;
            freshness.textContent = timestamp ? `${t('last_refreshed', { time: snapshotDate({ createdAt: timestamp }) })} ${t('cache_hint')}` : t('cache_hint');
            updateButtons(); renderVersions(); renderJobs();
        } catch (error) { message(status, error.message, true); }
    };
    target.addEventListener('change', () => { refreshInfo = ''; reload(); });
    device.addEventListener('change', renderVersions);
    search.addEventListener('input', renderVersions);
    reloadTab = reload;
    await reload();
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('cloud-content');
    if (container) mountCloudTab(container);
});
window.api.cloud.onState(() => { if (reloadTab) reloadTab(); });
window.api.receive('apply-language', () => {
    const container = document.getElementById('cloud-content');
    if (container) mountCloudTab(container);
});
