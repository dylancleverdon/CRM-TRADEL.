const { app, BrowserWindow, ipcMain, shell, Menu, screen } = require('electron');
const path = require('path');
const updater = require('./updater.cjs');

let win = null;
let side = null;

/**
 * Yelp / Google pages open in a window docked to the right of the CRM, so they stay visible during a call.
 * It's a plain sandboxed browser window (no access to the app) with its own saved session.
 */
function openSide(url) {
  if (!/^https:\/\//i.test(url)) return shell.openExternal(url);
  const b = win ? win.getBounds() : { x: 0, y: 0, width: 0, height: 900 };
  const area = screen.getDisplayMatching(b).workArea;
  const width = Math.max(420, Math.min(620, Math.round(area.width * 0.36)));
  if (!side || side.isDestroyed()) {
    side = new BrowserWindow({
      width, height: b.height, title: 'Online presence', backgroundColor: '#ffffff', show: false,
      webPreferences: { partition: 'persist:presence', contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Look like a normal browser so Yelp and Google serve their regular pages.
    side.webContents.setUserAgent(side.webContents.getUserAgent().replace(/ (Electron|TradeLink CRM|tradelink-crm)\/\S+/g, ''));
    side.webContents.setWindowOpenHandler(({ url: next }) => {
      if (/^https:\/\//i.test(next)) side.loadURL(next);
      return { action: 'deny' };
    });
    side.on('closed', () => { side = null; });
  }
  const roomRight = b.x + b.width + width <= area.x + area.width;
  side.setBounds({ x: roomRight ? b.x + b.width : area.x + area.width - width, y: b.y, width, height: b.height });
  side.loadURL(url);
  side.show();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'TradeLink CRM',
    backgroundColor: '#0b1a12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  updater.attach(win);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const template = [
      ...(process.platform === 'darwin' ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: () => updater.check(true) },
          { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }] : []),
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    createWindow();
    updater.start();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (e) => updater.onBeforeQuit(e));
}

// ---- IPC ----
ipcMain.handle('http', async (_e, { url, method, body }) => {
  const res = await fetch(url, {
    method,
    body: method === 'POST' ? body : undefined,
    headers: method === 'POST' ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined,
    redirect: 'follow',
  });
  return { status: res.status, text: await res.text() };
});
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('open-side', (_e, url) => openSide(url));
ipcMain.handle('focus-window', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
ipcMain.handle('set-badge', (_e, n) => {
  const count = Math.max(0, Number(n) || 0);
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(count ? String(count) : '');
  else app.setBadgeCount(count);
});
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('update-check', () => updater.check(true));
ipcMain.handle('update-install', () => updater.installNow());
