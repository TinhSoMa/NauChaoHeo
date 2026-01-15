"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Example API methods - add more as needed
  sendMessage: (channel, data) => {
    electron.ipcRenderer.send(channel, data);
  },
  onMessage: (channel, callback) => {
    electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  invoke: (channel, data) => {
    return electron.ipcRenderer.invoke(channel, data);
  }
});
