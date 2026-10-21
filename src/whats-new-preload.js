// Preload do popup de novidades.
// RODA EM SANDBOX: apenas require('electron') aqui — literais de IPC em vez de
// importar constants.js (mesmo padrão de screenshare-preload.js).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whatsNew', {
	getState: () => ipcRenderer.invoke('whats-new:get-state'),
	dismiss: () => ipcRenderer.send('whats-new:dismiss'),
	getUiTheme: () => ipcRenderer.invoke('get-ui-theme'),
	onUiTheme: (cb) => ipcRenderer.on('ui-theme', (e, dark) => cb(!!dark))
});
