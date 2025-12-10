const path = require('path');
const { app, BrowserWindow } = require('electron');
const chokidar = require('chokidar');

/**
 * Setup hot reload for renderer process (development only)
 */
function setupHotReload() {
    if (process.env.NODE_ENV === 'production') {
        return;
    }

    // From dist/out/
    const rendererPath = path.resolve(__dirname, '../renderer');
    let reloadTimeout;

    const watcher = chokidar.watch(rendererPath, {
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        ignored: [/(^|[/\\])\.\./, '**/node_modules', '**/*.map']
    });

    watcher.on('change', () => {
        clearTimeout(reloadTimeout);
        reloadTimeout = setTimeout(() => {
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.reloadIgnoringCache();
            });
        }, 300);
    });

    app.on('quit', () => watcher.close());

    return watcher;
}

module.exports = setupHotReload;
