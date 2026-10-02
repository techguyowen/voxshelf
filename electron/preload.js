// Minimal desktop bridge: lets the web UI detect the packaged app.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("voxshelf", {
  isDesktop: true,
  platform: process.platform,
});
