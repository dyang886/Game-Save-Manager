import { element, t, loadCloudLabels, cloudCall, cloudErrorMessage, message, button, select, field, input, checkbox, createDialog, confirmCloud } from './cloudShared.js';
import { byteSize } from './cloudPresentation.js';

function targetConfig(target) { return target?.config ? { ...target, ...target.config } : target || {}; }

export async function showConnectionWizard(existing, onSaved = () => {}) {
    await loadCloudLabels();
    const saved = targetConfig(existing);
    let targetId = saved.id;
    let selectedRepositoryId = saved.repositoryId;
    const { dialog, body, footer } = createDialog(t(existing ? 'edit_connection' : 'add_connection'));
    body.append(element('p', t('wizard_steps'), 'cloud-hint'));
    const form = element('form', null, 'cloud-form-grid');
    const name = input('text', saved.name || ''); name.required = true; name.maxLength = 120;
    const type = select([['webdav', 'WebDAV'], ['s3', 'S3']], saved.type || 'webdav');
    const url = input('url', saved.url || saved.endpoint || 'https://'); url.required = true;
    const prefix = input('text', saved.prefix || '');
    const username = input('text'); username.autocomplete = 'username';
    const password = input('password');
    const region = input('text', saved.region || 'us-east-1');
    const bucket = input('text', saved.bucket || '');
    const accessKey = input('password');
    const secretKey = input('password');
    const sessionToken = input('password');
    const pathStyle = checkbox('path_style', saved.forcePathStyle !== false);
    const insecure = checkbox('allow_http', Boolean(saved.allowInsecureHttp));
    const readOnly = checkbox('read_only', Boolean(saved.readOnly));
    const sessionOnly = checkbox('session_only', Boolean(saved.sessionOnly));
    const proxyMode = select([['auto', t('proxy_auto')], ['direct', t('proxy_direct')], ['manual', t('proxy_manual')]], saved.proxy?.mode || 'auto');
    const proxyUrl = input('url', saved.proxy?.url || '');
    const proxyUsername = input('text');
    const proxyPassword = input('password');
    const webdavFields = element('div', null, 'cloud-form-grid cloud-full');
    webdavFields.append(field('username', username), field('password', password));
    const s3Fields = element('div', null, 'cloud-form-grid cloud-full');
    s3Fields.append(field('region', region), field('bucket', bucket), field('access_key', accessKey), field('secret_key', secretKey));
    const advanced = element('details', null, 'cloud-full');
    advanced.append(element('summary', t('advanced')), field('session_token', sessionToken), pathStyle.label);
    s3Fields.append(advanced);
    const proxyFields = element('div', null, 'cloud-form-grid cloud-full');
    proxyFields.append(field('proxy_url', proxyUrl), field('proxy_username', proxyUsername), field('proxy_password', proxyPassword));
    form.append(field('name', name), field('protocol', type), field('endpoint', url), field('prefix', prefix), webdavFields, s3Fields,
        readOnly.label, sessionOnly.label, insecure.label, field('proxy', proxyMode), proxyFields);
    const httpHint = element('p', t('http_warning'), 'cloud-hint cloud-full');
    form.append(httpHint);
    const status = element('p');
    const tests = element('ul', null, 'cloud-test-results');
    const repository = element('section', null, 'cloud-card');
    repository.hidden = true;
    const repositoryChoice = select([]);
    const repositoryStatus = element('p');
    const repositoryButtons = element('div', null, 'cloud-actions');
    repository.append(element('h3', t('choose_repository')), field('repository', repositoryChoice), repositoryButtons, repositoryStatus);
    const automatic = element('section', null, 'cloud-card'); automatic.hidden = true;
    body.append(form, element('p', existing?.credentialsConfigured ? t('credentials_configured') : t('credentials_hint'), 'cloud-hint'), status, tests, repository, automatic);
    const close = button('close', () => dialog.close());
    const saveAndTest = button('save_test', async () => {
        if (!form.reportValidity()) return;
        saveAndTest.disabled = true;
        repository.hidden = true;
        automatic.hidden = true;
        tests.replaceChildren();
        try {
            const config = {
                ...(targetId ? { id: targetId } : {}), name: name.value.trim(), type: type.value,
                ...(type.value === 'webdav' ? { url: url.value.trim() } : {
                    endpoint: url.value.trim(), bucket: bucket.value.trim(), region: region.value.trim(), forcePathStyle: pathStyle.node.checked
                }),
                prefix: prefix.value.trim(), allowInsecureHttp: insecure.node.checked, readOnly: readOnly.node.checked,
                proxy: { mode: proxyMode.value, ...(proxyMode.value === 'manual' ? { url: proxyUrl.value.trim() } : {}) },
                ...(selectedRepositoryId ? { repositoryId: selectedRepositoryId } : {})
            };
            const credentialFields = { username, password, accessKeyId: accessKey, secretAccessKey: secretKey, sessionToken, proxyUsername, proxyPassword };
            const secrets = Object.fromEntries(Object.entries(credentialFields).filter(([, control]) => control.value).map(([key, control]) => [key, control.value]));
            // Blank untouched inputs keep credentials. Replacing an S3 key pair
            // also replaces its optional token, including an explicitly empty one.
            if (type.value === 's3' && (accessKey.value || secretKey.value)) secrets.sessionToken = sessionToken.value;
            message(status, t('testing'));
            const result = await cloudCall('saveTarget', { config, secrets, sessionOnly: sessionOnly.node.checked });
            for (const control of Object.values(credentialFields)) control.value = '';
            targetId = result.id || result.targetId || result.target?.id || targetId;
            onSaved();
            const report = await cloudCall('testConnection', { targetId });
            renderTestResults(tests, report);
            const failed = report.authentication === false || report.list === false || (!readOnly.node.checked && (report.write !== true || report.readback !== true));
            message(status, t(failed ? 'test_failed' : 'test_complete'), failed);
            if (failed) return;
            repository.hidden = false;
            createButton.disabled = readOnly.node.checked || report.write === false;
            await discover();
        } catch (error) {
            message(status, error.message, true);
        } finally { saveAndTest.disabled = false; }
    }, 'cloud-primary');
    const discover = async () => {
        message(repositoryStatus, t('discovering'));
        const response = await cloudCall('discoverRepositories', { targetId });
        const repositories = Array.isArray(response) ? response : response.repositories || [];
        repositoryChoice.replaceChildren(...repositories.map(item => {
            const id = typeof item === 'string' ? item : item.id || item.repositoryId;
            const option = element('option', item.name || id); option.value = id; return option;
        }));
        if (selectedRepositoryId) repositoryChoice.value = selectedRepositoryId;
        message(repositoryStatus, repositories.length ? t('select_repository_hint') : t('no_repositories'));
    };
    const repositoryAction = async (create) => {
        try {
            if (!create && !repositoryChoice.value) return;
            if (create && !await confirmCloud(t('new_repository'), t('new_repository_hint'))) return;
            const result = await cloudCall(create ? 'createRepository' : 'selectRepository', { targetId, ...(!create ? { repositoryId: repositoryChoice.value } : {}) });
            selectedRepositoryId = result.repositoryId || result.config?.repositoryId;
            message(repositoryStatus, t('repository_ready'));
            automatic.hidden = false;
            await renderAutomatic(automatic, targetId);
            onSaved();
        } catch (error) { message(repositoryStatus, error.message, true); }
    };
    const createButton = button('new_repository', () => repositoryAction(true));
    repositoryButtons.append(button('discover', async () => { try { await discover(); } catch (error) { message(repositoryStatus, error.message, true); } }),
        button('use_repository', () => repositoryAction(false), 'cloud-primary'), createButton);
    footer.append(close, saveAndTest);
    const toggleFields = () => {
        webdavFields.hidden = type.value !== 'webdav'; s3Fields.hidden = type.value !== 's3';
        bucket.required = type.value === 's3'; proxyFields.hidden = proxyMode.value !== 'manual';
        proxyUrl.required = proxyMode.value === 'manual'; httpHint.hidden = !insecure.node.checked;
    };
    for (const control of [type, proxyMode, insecure.node]) control.addEventListener('change', toggleFields);
    form.addEventListener('submit', event => { event.preventDefault(); saveAndTest.click(); });
    form.addEventListener('input', () => { repository.hidden = true; automatic.hidden = true; });
    dialog.addEventListener('close', () => { for (const control of [username, password, accessKey, secretKey, sessionToken, proxyUsername, proxyPassword]) control.value = ''; });
    toggleFields(); dialog.showModal(); name.focus();
}

function renderTestResults(container, report) {
    const checks = report?.checks || report?.results || report || {};
    const entries = Array.isArray(checks) ? checks : Object.entries(checks).filter(([key]) => ['authentication', 'auth', 'list', 'listing', 'write', 'read', 'readback', 'verify', 'delete', 'cleanup'].includes(key))
        .map(([name, result]) => ({ name, ...(result && typeof result === 'object' ? result : { status: result }) }));
    for (const item of entries) {
        const status = item.status ?? item.ok ?? item.success;
        const state = status === true || ['ok', 'passed', 'success'].includes(status) ? t('check_passed') : status === false || ['failed', 'error'].includes(status) ? t('check_failed') : t('check_skipped');
        container.append(element('li', `${t(`check_${item.name || item.step}`)}: ${state}${item.message ? ` — ${item.message}` : ''}`));
    }
    if (report?.residualKey) container.append(element('li', t('cleanup_residual', { key: report.residualKey }), 'cloud-error'));
    if (report?.error) container.append(element('li', `${cloudErrorMessage(report.error)}${report.error.status ? ` (HTTP ${report.error.status})` : ''}`, 'cloud-error'));
}

async function renderAutomatic(container, preferredTargetId) {
    const state = await cloudCall('getState');
    const local = await cloudCall('listLocalSnapshots');
    const snapshots = Array.isArray(local) ? local : local.snapshots || [];
    const games = new Map();
    for (const snapshot of snapshots) {
        const gameKey = snapshot.gameKey || snapshot.metadata?.gameKey;
        if (gameKey) games.set(gameKey, snapshot.gameTitle || snapshot.title || snapshot.metadata?.title || gameKey);
    }
    const enabled = checkbox('automatic_enabled', Boolean(state.automatic?.targetId));
    const allGames = checkbox('automatic_all_games', Boolean(state.automatic?.targetId && !state.automatic?.gameKeys?.length));
    const targets = (state.targets || []).filter(target => target.repositoryId && !target.readOnly && target.capabilities?.write !== false);
    const target = select(targets.map(item => [item.id, item.name]), state.automatic?.targetId || preferredTargetId || targets[0]?.id || '');
    const checks = [];
    const list = element('div', null, 'cloud-game-choices');
    for (const [key, title] of games) {
        const control = input('checkbox'); control.value = key; control.checked = (state.automatic?.gameKeys || []).includes(key);
        const label = element('label', null, 'cloud-check'); label.append(control, element('span', title)); list.append(label); checks.push(control);
    }
    const status = element('p');
    container.replaceChildren(element('h3', t('automatic')), element('p', t('automatic_hint'), 'cloud-hint'), enabled.label, field('automatic_target', target), allGames.label, list);
    if (!games.size) container.append(element('p', t('no_local_versions'), 'cloud-hint'));
    const save = button('save_automatic', async () => {
        save.disabled = true;
        try {
            const gameKeys = allGames.node.checked ? [] : checks.filter(item => item.checked).map(item => item.value);
            if (enabled.node.checked && !allGames.node.checked && !gameKeys.length) { message(status, t('select_games_required'), true); return; }
            await cloudCall('setAutomatic', { targetId: enabled.node.checked ? target.value : null, gameKeys });
            message(status, t('saved'));
        } catch (error) { message(status, error.message, true); }
        finally { save.disabled = false; }
    }, 'cloud-primary');
    container.append(save, status);
    allGames.node.addEventListener('change', () => { list.hidden = allGames.node.checked; });
    list.hidden = allGames.node.checked;
}

export async function mountCloudSettings(container) {
    await loadCloudLabels();
    const status = element('p');
    const list = element('div', null, 'cloud-connection-list');
    const device = element('section', null, 'cloud-card');
    const automatic = element('section', null, 'cloud-card');
    const cache = element('section', null, 'cloud-card');
    const reload = async () => {
        try {
            const state = await cloudCall('getState');
            const deviceName = input('text', state.device?.name || ''); deviceName.maxLength = 100;
            device.replaceChildren(element('h3', t('this_device')), field('device_name', deviceName), button('save_device', async () => {
                try { await cloudCall('setDevice', { name: deviceName.value.trim() }); message(status, t('saved')); }
                catch (error) { message(status, error.message, true); }
            }));
            list.replaceChildren();
            if (!state.targets?.length) list.append(element('p', t('no_connections'), 'cloud-hint'));
            for (const raw of state.targets || []) {
                const target = targetConfig(raw);
                const row = element('div', null, 'cloud-connection');
                const detail = element('div');
                detail.append(element('strong', target.name), element('p', `${target.type.toUpperCase()} · ${target.repositoryId || t('repository_not_selected')}`, 'cloud-hint'));
                const actions = element('div', null, 'cloud-actions');
                actions.append(button('edit', () => showConnectionWizard(target, reload)), button('remove_connection', async () => {
                    if (!await confirmCloud(t('remove_connection'), t('remove_connection_hint', { name: target.name }))) return;
                    try { await cloudCall('removeTarget', { targetId: target.id }); await reload(); } catch (error) { message(status, error.message, true); }
                }));
                row.append(detail, actions); list.append(row);
            }
            await renderAutomatic(automatic);
            const budget = input('number', String((state.cache?.budgetBytes || 5 * 1024 ** 3) / 1024 ** 3)); budget.min = '0.1'; budget.step = '0.1';
            cache.replaceChildren(element('h3', t('cache')), element('p', t('cache_used', { size: byteSize(state.cache?.usedBytes || 0) }), 'cloud-hint'), field('cache_budget', budget), button('save_cache', async () => {
                try {
                    await cloudCall('setCacheBudget', { bytes: Math.round(Number(budget.value) * 1024 ** 3) }); message(status, t('saved'));
                } catch (error) { message(status, error.message, true); }
            }));
        } catch (error) { message(status, error.message, true); }
    };
    container.replaceChildren(element('h2', t('title')), element('p', t('settings_intro'), 'cloud-hint'), button('add_connection', () => showConnectionWizard(null, reload), 'cloud-primary'), list, device, automatic, cache, status);
    await reload();
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('cloud-settings');
    if (container) mountCloudSettings(container);
});
window.api.receive('apply-language', () => {
    const container = document.getElementById('cloud-settings');
    if (container) mountCloudSettings(container);
});
