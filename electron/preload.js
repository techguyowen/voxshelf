// Minimal desktop bridge: lets the web UI detect the packaged app.
const { contextBridge, ipcRenderer } = require("electron");

let meta = {
  isDesktop: true,
  platform: typeof process !== "undefined" ? process.platform : "unknown",
};

try {
  const res = ipcRenderer.sendSync("voxshelf:meta");
  if (res && typeof res === "object") {
    meta = res;
  }
} catch {
  // Fall back to basic platform metadata if IPC is unavailable.
}

contextBridge.exposeInMainWorld("voxshelf", meta);
