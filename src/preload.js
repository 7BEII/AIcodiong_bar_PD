const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quotaApi", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveConfig: (payload) => ipcRenderer.invoke("account:save-config", payload),
  syncRemaining: (payload) => ipcRenderer.invoke("account:sync-remaining", payload),
  consumeWindow: (id) => ipcRenderer.invoke("account:consume-window", { id }),
  resetWindow: (id) => ipcRenderer.invoke("account:reset-window", { id }),
  resetWeek: (id) => ipcRenderer.invoke("account:reset-week", { id })
});
