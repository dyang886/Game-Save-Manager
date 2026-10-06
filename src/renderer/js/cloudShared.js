import { byteSize } from './cloudPresentation.js';

export function element(tag, text, className = '') {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
}

let labels = {};
export async function loadCloudLabels() {
    const translated = await window.i18n.translate('cloud', { returnObjects: true });
    labels = translated && typeof translated === 'object' ? translated : {};
}
export function t(key, values = {}) {
    let message = labels[key] || key;
    for (const [name, value] of Object.entries(values)) message = message.replaceAll(`{{${name}}}`, String(value));
    return message;
}

export function cloudErrorMessage(error) {
    return labels[`error_${error?.code}`] || error?.message || t('operation_failed');
}

export async function cloudCall(method, payload = {}) {
    const result = await window.api.cloud[method](payload);
    if (!result?.ok) {
        const code = result?.error?.code || 'UNKNOWN';
        const error = new Error(cloudErrorMessage(result?.error));
        error.code = code;
        throw error;
    }
    return result.data;
}

export function message(container, text, isError = false) {
    container.textContent = text;
    container.className = `cloud-message${isError ? ' cloud-error' : ''}`;
    container.setAttribute('role', isError ? 'alert' : 'status');
}

export function button(key, action, className = '') {
    const node = element('button', t(key), `cloud-button ${className}`);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
}

export function select(options, selected = '') {
    const node = element('select', null, 'cloud-input');
    for (const [value, label] of options) {
        const option = element('option', label);
        option.value = value;
        node.append(option);
    }
    node.value = selected;
    return node;
}

let fieldSequence = 0;
export function field(key, control) {
    const container = element('div', null, 'cloud-field');
    control.id ||= `cloud-field-${++fieldSequence}`;
    const label = element('label', t(key));
    label.htmlFor = control.id;
    container.append(label, control);
    return container;
}

export function input(type = 'text', value = '') {
    const node = element('input', null, 'cloud-input');
    node.type = type;
    node.value = value;
    node.maxLength = 2048;
    if (type === 'password') node.autocomplete = 'new-password';
    return node;
}

export function checkbox(key, checked = false) {
    const node = input('checkbox');
    node.checked = checked;
    const label = element('label', null, 'cloud-check');
    label.append(node, element('span', t(key)));
    return { node, label };
}

export function createDialog(title) {
    const previousFocus = document.activeElement;
    const dialog = element('dialog', null, 'cloud-dialog');
    const heading = element('h2', title);
    heading.id = `cloud-dialog-title-${++fieldSequence}`;
    dialog.setAttribute('aria-labelledby', heading.id);
    const body = element('div', null, 'cloud-dialog-body');
    const footer = element('div', null, 'cloud-actions');
    dialog.append(heading, body, footer);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
    });
    return { dialog, body, footer };
}

export function confirmCloud(title, detail, confirmKey = 'confirm') {
    return new Promise(resolve => {
        const { dialog, body, footer } = createDialog(title);
        body.append(element('p', detail, 'cloud-preserve-lines'));
        const cancel = button('cancel', () => dialog.close());
        const confirm = button(confirmKey, () => dialog.close('confirmed'), 'cloud-primary');
        footer.append(cancel, confirm);
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirmed'), { once: true });
        dialog.showModal();
        cancel.focus();
    });
}

export async function uploadLocalSnapshot(gameId, folder) {
    await loadCloudLabels();
    const state = await cloudCall('getState');
    const targets = (state.targets || []).filter(target => target.repositoryId && !target.readOnly && target.capabilities?.write !== false);
    const { dialog, body, footer } = createDialog(t('upload_version'));
    const status = element('p');
    if (!targets.length) {
        body.append(element('p', t('configure_first')));
        footer.append(button('close', () => dialog.close()));
    } else {
        const choice = select(targets.map(target => [target.id, target.name]), state.automatic?.targetId || targets[0].id);
        body.append(field('connection', choice), element('p', t('local_upload_hint')), status);
        footer.append(button('cancel', () => dialog.close()), button('upload', async event => {
            const control = event.currentTarget;
            control.disabled = true;
            try {
                await cloudCall('upload', { targetId: choice.value, gameId: String(gameId), folder });
                message(status, t('queued'));
            } catch (error) {
                message(status, error.message, true);
                control.disabled = false;
            }
        }, 'cloud-primary'));
    }
    dialog.showModal();
}

export async function previewAndUpload(targetId, selection, gameIds, status) {
    const preview = await cloudCall('previewUpload', { targetId, selection, ...(gameIds?.length ? { gameIds } : {}) });
    const count = preview.count ?? preview.snapshots?.length ?? 0;
    const size = byteSize(preview.totalBytes ?? preview.bytes ?? preview.size ?? 0);
    if (!count) { message(status, t('no_local_versions')); return; }
    if (!await confirmCloud(t('history_preview'), t('history_confirmation', { count, size }), 'upload')) return;
    const result = await cloudCall('uploadMany', { targetId, selection, ...(gameIds?.length ? { gameIds } : {}) });
    if (result?.rejected?.length) {
        message(status, t('batch_upload_result', { accepted: result.jobs?.length || 0, rejected: result.rejected.length }), true);
        const details = element('details');
        details.append(element('summary', t('error_details')), element('pre', result.rejected.map(item => `${item.gameId || item.snapshotId}: ${cloudErrorMessage(item.error)}`).join('\n'), 'cloud-preserve-lines'));
        status.append(details);
    } else message(status, t('queued'));
}
