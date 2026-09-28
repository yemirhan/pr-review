import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

/** Commands the renderer handles (tab management). */
export type MenuCommand = 'close-tab' | 'next-tab' | 'prev-tab';

function send(cmd: MenuCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', cmd);
}

/**
 * App menu. Mostly the standard roles (so copy/paste and friends keep
 * working), but ⌘W closes the current PR tab instead of the window.
 */
export function installMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => send('prev-tab') },
        // Browser-style alternates; hidden so the menu lists each command once.
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => send('next-tab')
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => send('prev-tab')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
