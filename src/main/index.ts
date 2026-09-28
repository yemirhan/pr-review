import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { loadShellPath } from './system/shellPath';
import { shutdownAI } from './ai/provider';
import { shutdownSessions } from './ai/sessions';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // Pick up the user's shell PATH so gh / codex / claude resolve the same
  // way they do in a terminal, even when launched from the Dock.
  await loadShellPath();
  registerIpc(() => mainWindow);
  installMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  shutdownSessions();
  shutdownAI();
});
