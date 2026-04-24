/**
 * Electron main process for Hope Tender Proposal Generator desktop app.
 * Run: npx electron . (after building the Next.js app)
 * Package: npx electron-builder --config electron-builder.json
 */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");
const { exec } = require("child_process");

let mainWindow;
let nextServer;

const isDev = process.env.NODE_ENV === "development";
const PORT = 3000;

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

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New Tender", accelerator: "CmdOrCtrl+N", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard/tenders/new`) },
        { label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard`) },
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
        { label: "Company Vault", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard/company`) },
        { label: "Analysis", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard/analysis`) },
        { label: "Compliance", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard/compliance`) },
        { label: "Export Packages", click: () => mainWindow.loadURL(`http://localhost:${PORT}/dashboard/export`) },
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
      fetch(`http://localhost:${PORT}`).then(() => resolve()).catch(() => setTimeout(checkReady, 500));
    };
    setTimeout(checkReady, 1500);
  });
}

app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
  } catch (err) {
    console.error("Failed to start Next.js server:", err);
    app.quit();
  }

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
