/* Meeting Solo — Electron main process
 *
 * Wraps the web app as a desktop app and, crucially, grants the renderer access
 * to *system (loopback) audio* so it can transcribe meetings from ANY program
 * — Telegram, Lark, Zoom, a browser tab — not just the microphone.
 *
 * System-audio loopback is fully supported on Windows. On macOS it depends on
 * the OS version (ScreenCaptureKit) and may require a loopback device; on Linux
 * it uses the PulseAudio monitor source.
 */

const { app, BrowserWindow, desktopCapturer, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // When the renderer calls navigator.mediaDevices.getDisplayMedia({audio:true}),
  // hand it the screen source plus the system audio as a loopback track.
  win.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          callback({ video: sources[0], audio: "loopback" });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  // Open external links (e.g. hf-mirror.com) in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
