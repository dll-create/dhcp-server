/**
 * Electron Main Process
 *
 * Wraps the DHCP Server Web UI into a native macOS application.
 * Starts the Express server internally and opens the UI in a native window.
 */

const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let serverProcess = null;

const PORT = 3000;

// ── Start Express Server ───────────────────────────────────
function startServer() {
  // Load the Express server (this starts it listening)
  require('./server');
}

// ── Create Window ──────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 700,
    minHeight: 500,
    title: 'DHCP Server',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0e17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Menu ───────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'DHCP Server',
      submenu: [
        { label: 'About DHCP Server', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ──────────────────────────────────────────────

// Check if running with sudo (needed for DHCP port 67)
function checkPermissions() {
  if (process.getuid && process.getuid() !== 0) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: '权限提示',
      message: '当前未以管理员权限运行',
      detail: '浏览界面可正常使用，但启动 DHCP 服务需要管理员权限。\n\n如需使用 DHCP 功能，请从终端运行：\nsudo ' + process.execPath + '\n\n或使用 start.sh 脚本启动。',
      buttons: ['我知道了'],
    });
  }
}

app.whenReady().then(() => {
  startServer();
  buildMenu();
  createWindow();

  // Delay permission check so window shows first
  setTimeout(checkPermissions, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
