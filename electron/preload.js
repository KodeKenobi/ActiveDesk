const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("activeDesk", {
  getApps: () => ipcRenderer.invoke("activedesk:getApps"),
  getLicenseStatus: () => ipcRenderer.invoke("activedesk:getLicenseStatus"),
  activateLicense: (licenseKey) => ipcRenderer.invoke("activedesk:activateLicense", licenseKey),
  clearLicense: () => ipcRenderer.invoke("activedesk:clearLicense"),
  start: (payload) => ipcRenderer.invoke("activedesk:start", payload),
  stop: () => ipcRenderer.invoke("activedesk:stop"),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke("activedesk:setAlwaysOnTop", flag),
  getLaunchAtLogin: () => ipcRenderer.invoke("activedesk:getLaunchAtLogin"),
  setLaunchAtLogin: (openAtLogin) => ipcRenderer.invoke("activedesk:setLaunchAtLogin", openAtLogin),
  onTick: (callback) => ipcRenderer.on("activedesk:tick", (_event, data) => callback(data)),
  onError: (callback) => ipcRenderer.on("activedesk:error", (_event, data) => callback(data)),
  onHotkeyToggle: (callback) => ipcRenderer.on("activedesk:hotkey-toggle", () => callback()),
  openExternal: (url) => ipcRenderer.invoke("activedesk:openExternal", url),
});
