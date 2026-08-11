/* Meeting Solo — Electron preload
 *
 * Exposes a tiny, safe flag so the renderer knows it's running inside the
 * desktop app (and can therefore offer system-audio capture). No Node APIs are
 * exposed to the page.
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("meetingSoloDesktop", {
  platform: process.platform, // "win32" | "darwin" | "linux"
  electron: process.versions.electron,
});
