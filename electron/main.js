/**
 * Electron main process for Hope Tender Proposal Generator desktop app.
 *
 * TWO MODES (PR #246):
 *
 * 1) HOSTED MODE (default, recommended)
 *    The desktop window points at the production Vercel deployment
 *    (or any URL set via HOPE_TENDER_DESKTOP_URL). No local server,
 *    no local postgres, no local AI keys needed — desktop is just a
 *    distribution channel for the same web app the user already has.
 *    Set HOPE_TENDER_DESKTOP_URL=https://hope-tender-path-b.vercel.app
 *    to enable; defaults to the project's known Vercel URL.
 *
 * 2) LOCAL-SERVER MODE
 *    Spawns `next dev` (or `next start`) in-process and points the
 *    window at http://localhost:3000. Requires the user to have:
 *      • PostgreSQL running and DATABASE_URL exported
 *      • ANTHROPIC_API_KEY exported
 *      • node_modules installed
 *    Useful for offline / air-gapped builds. Enable by setting
 *    HOPE_TENDER_DESKTOP_MODE=local-server in the launch env.
 *
 * Build:
 *   npm install --save-dev electron electron-builder
 *   npm run electron               # dev launch (hosted mode)
 *   npm run build:desktop          # produce installers (Win/Mac/Linux)
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { exec } = require("child_process");

let mainWindow;
let nextServer;

const isDev = process.env.NODE_ENV === "development";
const PORT = 3000;
// Mode selection — see comments at top of file. Defaults to hosted mode
// because it's a simpler user experience and works on any machine
// without requiring local backend setup.
const MODE = (process.env.HOPE_TENDER_DESKTOP_MODE || "hosted").toLowerCase();
const HOSTED_URL = process.env.HOPE_TENDER_DESKTOP_URL || "https://hope-tender-path-b.vercel.app";
const LOCAL_URL = `http://localhost:${PORT}`;
const TARGET_URL = MODE === "local-server" ? LOCAL_URL : HOSTED_URL;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    title: "Hope Tender Proposal Generator",
    icon: path.join(__dirname, "../public/icon-512.png"),
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadURL(TARGET_URL).catch((err) => {
    dialog.showErrorBox(
      "Cannot connect to Hope Tender",
      `The desktop app could not reach ${TARGET_URL}.\n\n${err.message ?? err}\n\nCheck your network connection and try again. To use a different server, set the HOPE_TENDER_DESKTOP_URL environment variable before launching.`,
    );
  });

  // Open external links (anything outside our domain) in the system browser
  // — keeps third-party sites from being hosted inside our app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(TARGET_URL.split("/").slice(0, 3).join("/"))) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New Tender", accelerator: "CmdOrCtrl+N", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/tenders/new`) },
        { label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard`) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Navigate",
      submenu: [
        { label: "Company Vault", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/company`) },
        { label: "Analysis", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/analysis`) },
        { label: "Compliance", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/compliance`) },
        { label: "Export Packages", click: () => mainWindow.loadURL(`${TARGET_URL}/dashboard/export`) },
      ],
    },
  ];

  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" }, { type: "separator" },
        { role: "services" }, { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" }, { role: "quit" },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    const cmd = isDev
      ? `npx next dev --port ${PORT}`
      : `npx next start --port ${PORT}`;

    nextServer = exec(cmd, { cwd: path.join(__dirname, "..") }, (err) => {
      if (err && !err.killed) reject(err);
    });

    // Wait for Next.js to be ready
    const checkReady = () => {
      fetch(`${TARGET_URL}`).then(() => resolve()).catch(() => setTimeout(checkReady, 500));
    };
    setTimeout(checkReady, 1500);
  });
}

app.whenReady().then(async () => {
  // Hosted mode skips the local server entirely — the URL is already
  // a live Vercel deployment, no need to spawn `next start`.
  if (MODE === "local-server") {
    try {
      await startNextServer();
    } catch (err) {
      console.error("Failed to start Next.js server:", err);
      dialog.showErrorBox(
        "Local-server mode failed to start",
        `Could not start the local Next.js server.\n\n${err?.message ?? err}\n\nMake sure DATABASE_URL and ANTHROPIC_API_KEY are exported and node_modules are installed. To use the hosted Vercel deployment instead, unset HOPE_TENDER_DESKTOP_MODE.`,
      );
      app.quit();
      return;
    }
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (nextServer) nextServer.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (nextServer) nextServer.kill();
});
