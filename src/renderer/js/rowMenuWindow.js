const ALLOWED_ICON = /^[a-z0-9-]+$/;

const menuRoot = document.getElementById('row-menu');
const itemList = document.getElementById('row-menu-items');

let currentToken = 0;

function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

function createItem(item) {
    const li = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
        'row-menu-item flex w-full items-center gap-3 px-4 py-2 text-left whitespace-nowrap',
        'hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white',
        item.danger ? 'text-red-600 dark:text-red-400' : '',
    ].join(' ');
    button.dataset.action = item.action;
    if (item.id) button.dataset.id = item.id;
    if (item.url) button.dataset.url = item.url;

    const icon = document.createElement('i');
    const iconName = ALLOWED_ICON.test(item.icon || '') ? item.icon : 'circle';
    icon.className = `fa-solid fa-${iconName} w-4 shrink-0 text-center ${item.danger ? '' : 'text-gray-400 dark:text-gray-400'}`;

    const label = document.createElement('span');
    label.textContent = item.label || '';

    button.appendChild(icon);
    button.appendChild(label);
    li.appendChild(button);
    return li;
}

async function measureAndReport(token) {
    // Wait for the icon font: glyph metrics change the width.
    await document.fonts.ready;
    if (token !== currentToken) return;

    const bodyStyle = getComputedStyle(document.body);
    const inset = {
        top: parseFloat(bodyStyle.paddingTop) || 0,
        right: parseFloat(bodyStyle.paddingRight) || 0,
        bottom: parseFloat(bodyStyle.paddingBottom) || 0,
        left: parseFloat(bodyStyle.paddingLeft) || 0,
    };

    // Measured synchronously: while parked off-screen no frames are produced,
    // so a requestAnimationFrame callback would never fire.
    const rect = menuRoot.getBoundingClientRect();

    window.api.send('row-menu-measured', {
        width: Math.ceil(rect.width) + 1,
        height: Math.ceil(rect.height),
        inset,
        token,
    });
}

function render(payload) {
    currentToken = payload.token;
    applyTheme(payload.theme);

    itemList.replaceChildren(...(payload.items || []).map(createItem));
    measureAndReport(payload.token);
}

window.api.receive('render-row-menu', render);

itemList.addEventListener('click', (event) => {
    const button = event.target.closest('.row-menu-item');
    if (!button) return;

    window.api.send('row-menu-action', {
        action: button.dataset.action,
        id: button.dataset.id || null,
        url: button.dataset.url || null,
    });
});
