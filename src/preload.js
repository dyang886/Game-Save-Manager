const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  receive: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});

contextBridge.exposeInMainWorld('i18n', {
  changeLanguage: (lng) => ipcRenderer.invoke('change-language', lng),
  translate: (key) => ipcRenderer.invoke('translate', key)
});
