/* Preload for the "drag around the text" overlay (snip.html). Two calls only: get the screenshot, report the chosen rectangle. */
const { contextBridge, ipcRenderer: ipc } = require('electron');
contextBridge.exposeInMainWorld('snip', {
  init: () => ipc.invoke('snip:init'),
  done: (rect) => ipc.send('snip:done', rect || null)
});
