// VoxShelf desktop shell: boots the Next.js standalone server in-process and
// shows it in a window. Local data lives in the OS app-data dir; point the
// app at a Docker server in Settings > Library sync to sync between devices.
//
// Dev: run `npm run dev` first, then `electron .` (assumes the dev server on
// port 38492, or set ELECTRON_START_URL to override).

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const fs = require("fs");
const net = require("net");
const path = require("path");

const DEFAULT_PORT = 38492;
const APP_NAME = "VoxShelf";

if (!app.requestSingleInstanceLock()) app.quit();

function devStartUrl() {
  if (process.env.ELECTRON_START_URL) return process.env.ELECTRON_START_URL;
  if (!app.isPackaged) return `http://127.0.0.1:${DEFAULT_PORT}`;
  return null;
}

/** Bind-test a port; fall back to an ephemeral one when busy. */
function findPort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const any = net.createServer();
      any.listen(0, "127.0.0.1", () => {
        const port = any.address().port;
        any.close(() => resolve(port));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => {
      probe.close(() => resolve(preferred));
    });
  });
}

function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // Server not up yet.
      }
      if (Date.now() > deadline) return reject(new Error("Server did not start in time."));
      setTimeout(poll, 250);
    };
    poll();
  });
}

function logStartup(message) {
  console.error(`[voxshelf] ${message}`);
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "desktop-startup.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must never break startup.
  }
}

/**
 * The standalone server ships unpacked (asar has no real directories, so the
 * server couldn't chdir/require native modules from inside the archive).
 */
function resolveStandaloneDir() {
  const inTree = path.join(__dirname, "..", ".next", "standalone");
  const unpacked = inTree.replace(
    `app.asar${path.sep}`,
    `app.asar.unpacked${path.sep}`,
  );
  if (unpacked !== inTree && fs.existsSync(path.join(unpacked, "server.js"))) {
    return unpacked;
  }
  return inTree;
}

/** Start the bundled Next.js server, resolving to its local base URL. */
async function bootServer() {
  const port = await findPort(DEFAULT_PORT);
  const dir = resolveStandaloneDir();
  const entry = path.join(dir, "server.js");
  logStartup(`booting server from ${entry} on 127.0.0.1:${port}`);
  if (!fs.existsSync(entry)) {
    throw new Error(`Bundled server is missing (${entry}). Please reinstall VoxShelf.`);
  }
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "production";
  if (!process.env.DATA_DIR) {
    const dataDir = path.join(app.getPath("userData"), "voxshelf-data");
    try {
      // One-time upgrade from the pre-rename "VocalFlow" install layout.
      const legacyDir = path.join(
        path.dirname(app.getPath("userData")),
        "VocalFlow",
        "vocalflow-data",
      );
      if (!fs.existsSync(dataDir) && fs.existsSync(legacyDir)) {
        fs.mkdirSync(path.dirname(dataDir), { recursive: true });
        fs.renameSync(legacyDir, dataDir);
        logStartup(`migrated legacy data dir ${legacyDir}`);
      }
    } catch (err) {
      logStartup(
        `legacy data migration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.env.DATA_DIR = dataDir;
  }
  process.chdir(dir);
  require(entry);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/api/health`);
  logStartup(`server is healthy at ${base}`);
  return base;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        ...(devStartUrl() || process.env.ELECTRON_DEBUG
          ? [{ type: "separator" }, { role: "toggleDevTools" }]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, ...(isMac ? [{ role: "close" }] : [{ role: "quit" }])],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open data folder",
          click: () => shell.openPath(process.env.DATA_DIR || app.getPath("userData")),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 360,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Local app navigation stays in-window; anything else opens in a browser.
  const isLocal = (u) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    } catch {
      return false;
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url: next }) => {
    if (!isLocal(next)) shell.openExternal(next);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, next) => {
    if (!isLocal(next)) {
      event.preventDefault();
      shell.openExternal(next);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(url);
}

async function start() {
  await app.whenReady();
  buildMenu();
  try {
    const url = devStartUrl() || (await bootServer());
    createWindow(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStartup(`startup failed: ${message}`);
    dialog.showErrorBox(`${APP_NAME} failed to start`, message);
    app.quit();
  }
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  // The local server runs in this process, so quit on every platform.
  app.quit();
});

start();
