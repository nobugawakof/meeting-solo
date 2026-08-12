/* Meeting Solo — Electron main process
 *
 * Wraps the web app as a desktop app and grants the renderer access to *system
 * (loopback) audio* so it can transcribe meetings from ANY program — Telegram,
 * Lark, Zoom, a browser tab — not just the microphone.
 *
 * The app files (including the vendored Whisper runtime and, when bundled, the
 * model) are served over a private http://127.0.0.1 origin rather than file://.
 * A localhost origin is a "secure context", so fetch(), ES module imports, WASM
 * streaming compilation, microphone/system-audio capture and the clipboard all
 * behave exactly as they do in a normal browser — which is the configuration
 * that has been tested. It also lets the offline Whisper model load from the
 * bundled ./models/ folder.
 */

const { app, BrowserWindow, Menu, desktopCapturer, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// No native menu bar (File / Edit / View / Window / Help).
Menu.setApplicationMenu(null);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

// Minimal, read-only static file server rooted at the app directory. fs can
// read files packed inside app.asar transparently, so this works packaged too.
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try {
        rel = decodeURIComponent((req.url || "/").split("?")[0]);
      } catch (_) {
        res.writeHead(400); res.end("Bad request"); return;
      }
      if (rel === "/" || rel === "") rel = "/index.html";
      const filePath = path.join(ROOT, rel.replace(/^\/+/, ""));
      // Prevent path traversal outside the app root.
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403); res.end("Forbidden"); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createWindow(baseUrl) {
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

  // When the renderer calls getDisplayMedia({audio:true}), hand it the screen
  // source plus the system audio as a loopback track.
  win.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback({ video: sources[0], audio: "loopback" }))
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  // Open external links (e.g. hf-mirror.com) in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });

  win.loadURL(baseUrl + "/index.html");
}

app.whenReady().then(async () => {
  const server = await startServer();
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  createWindow(baseUrl);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(baseUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
