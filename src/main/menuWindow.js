const { BrowserWindow, screen } = require('electron');
const path = require('path');

// The row menus live in their own window so they are never clipped by the app
// window, which a DOM menu cannot avoid (body computes to overflow:hidden).

const PARKED_BOUNDS = { x: -10000, y: -10000, width: 1, height: 1 };
const ANCHOR_GAP = 6;
const MIN_WIDTH = 160;
const MAX_WIDTH = 420;
const MAX_INSET = 48;

let menuWindow = null;
let parentWindow = null;
let pendingAnchor = null;
let pendingSend = null;
let parentListeners = null;
let visible = false;
// Bumped on every show and dismiss so a late measurement is seen as stale.
let placementToken = 0;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function createMenuWindow(parent) {
    const win = new BrowserWindow({
        ...PARKED_BOUNDS,
        parent,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // The shadow is CSS so it follows the rounded corners, not the window frame.
        hasShadow: false,
        // Never take focus, so clicking the menu cannot blur the parent.
        focusable: false,
        type: 'toolbar',
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            sandbox: false,
        },
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '../renderer/menu.html'));

    return win;
}

function attachParentListeners(parent) {
    if (parentListeners && parentListeners.parent === parent) return;

    // Any parent movement invalidates the anchor, so dismiss instead of chasing it.
    const dismiss = () => hideRowMenu();
    const events = ['move', 'resize', 'blur', 'minimize'];
    events.forEach(name => parent.on(name, dismiss));
    parentListeners = { parent, dismiss, events };

    parent.once('closed', () => {
        events.forEach(name => parent.off(name, dismiss));
        parentListeners = null;
        if (menuWindow && !menuWindow.isDestroyed()) {
            menuWindow.destroy();
        }
        menuWindow = null;
        parentWindow = null;
        pendingSend = null;
        pendingAnchor = null;
        visible = false;
    });
}

function ensureMenuWindow(parent) {
    parentWindow = parent;
    attachParentListeners(parent);

    if (menuWindow && !menuWindow.isDestroyed()) {
        return menuWindow;
    }

    visible = false;
    menuWindow = createMenuWindow(parent);
    menuWindow.webContents.once('did-finish-load', () => {
        if (!pendingSend) return;
        const payload = pendingSend;
        pendingSend = null;
        if (menuWindow && !menuWindow.isDestroyed()) {
            menuWindow.webContents.send('render-row-menu', payload);
        }
    });

    return menuWindow;
}

function showRowMenu(parent, payload) {
    const anchor = payload && payload.anchor;
    if (!parent || parent.isDestroyed() || !anchor) return;

    const win = ensureMenuWindow(parent);
    hideRowMenu();

    placementToken += 1;
    pendingAnchor = {
        x: Number(anchor.x) || 0,
        y: Number(anchor.y) || 0,
        width: Number(anchor.width) || 0,
        height: Number(anchor.height) || 0,
    };

    const message = {
        items: Array.isArray(payload.items) ? payload.items : [],
        theme: payload.theme === 'dark' ? 'dark' : 'light',
        token: placementToken,
    };

    if (win.webContents.isLoading()) {
        pendingSend = message;
    } else {
        win.webContents.send('render-row-menu', message);
    }
}

function placeAndShowRowMenu(size) {
    if (!menuWindow || menuWindow.isDestroyed()) return;
    if (!parentWindow || parentWindow.isDestroyed()) return;
    if (!pendingAnchor || !size) return;
    // A menu dismissed while measuring must not appear afterwards.
    if (size.token !== placementToken) return;

    const rawInset = size.inset || {};
    const inset = {
        top: clamp(Math.ceil(rawInset.top || 0), 0, MAX_INSET),
        right: clamp(Math.ceil(rawInset.right || 0), 0, MAX_INSET),
        bottom: clamp(Math.ceil(rawInset.bottom || 0), 0, MAX_INSET),
        left: clamp(Math.ceil(rawInset.left || 0), 0, MAX_INSET),
    };

    const windowWidth = clamp(Math.ceil(size.width || 0), MIN_WIDTH, MAX_WIDTH) + inset.left + inset.right;
    const windowHeight = Math.max(1, Math.ceil(size.height || 0)) + inset.top + inset.bottom;

    // Placement works on the visual menu; the inset is transparent shadow padding.
    const visualWidth = windowWidth - inset.left - inset.right;
    const visualHeight = windowHeight - inset.top - inset.bottom;

    const content = parentWindow.getContentBounds();
    const anchorScreen = {
        left: content.x + pendingAnchor.x,
        top: content.y + pendingAnchor.y,
        bottom: content.y + pendingAnchor.y + pendingAnchor.height,
    };

    const workArea = screen.getDisplayNearestPoint({
        x: Math.round(anchorScreen.left),
        y: Math.round(anchorScreen.top),
    }).workArea;

    // Flip above only when the screen runs out, using the real measured height.
    const spaceBelow = workArea.y + workArea.height - anchorScreen.bottom;
    const spaceAbove = anchorScreen.top - workArea.y;
    const openUp = spaceBelow < visualHeight + ANCHOR_GAP && spaceAbove > spaceBelow;

    let visualTop = openUp
        ? anchorScreen.top - ANCHOR_GAP - visualHeight
        : anchorScreen.bottom + ANCHOR_GAP;
    let visualLeft = anchorScreen.left;

    // Clamped to the screen, not the app window: overflowing the app window is the point.
    visualLeft = clamp(visualLeft, workArea.x, workArea.x + workArea.width - visualWidth);
    visualTop = clamp(visualTop, workArea.y, workArea.y + workArea.height - visualHeight);

    menuWindow.setBounds({
        x: Math.round(visualLeft - inset.left),
        y: Math.round(visualTop - inset.top),
        width: windowWidth,
        height: windowHeight,
    }, false);

    menuWindow.setOpacity(1);
    if (!menuWindow.isVisible()) {
        menuWindow.showInactive();
    }
    visible = true;
}

function hideRowMenu() {
    placementToken += 1;
    pendingAnchor = null;

    if (!menuWindow || menuWindow.isDestroyed()) return;
    if (!visible) return;

    // Parked rather than hidden: a hidden window produces no frames, which stalls
    // the renderer's measure-then-place handshake.
    menuWindow.setOpacity(0);
    menuWindow.setBounds(PARKED_BOUNDS, false);
    visible = false;
}

module.exports = {
    showRowMenu,
    placeAndShowRowMenu,
    hideRowMenu,
};
