import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import {
  type AddVaultInput,
  type MimoraIpcResult,
  type MimoraSettings,
  type UpdateVaultInput,
  type VaultDirectorySelection,
} from '../src/settings';
import { createSettingsStore } from './settingsStore';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const settingsFileName = 'mimora-settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), settingsFileName);
}

const settingsStore = createSettingsStore({
  getSettingsPath,
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '설정 처리 중 오류가 발생했습니다.';
}

async function toIpcResult<T>(
  operation: () => Promise<T>,
): Promise<MimoraIpcResult<T>> {
  try {
    return {
      ok: true,
      data: await operation(),
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error),
    };
  }
}

function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async (): Promise<MimoraIpcResult<MimoraSettings>> =>
    toIpcResult(() => settingsStore.getSettings()),
  );

  ipcMain.handle(
    'settings:addVault',
    async (
      _event,
      input: AddVaultInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.addVault(input)),
  );

  ipcMain.handle(
    'settings:updateVault',
    async (
      _event,
      input: UpdateVaultInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateVault(input)),
  );

  ipcMain.handle(
    'settings:deleteVault',
    async (_event, id: string): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.deleteVault(id)),
  );

  ipcMain.handle(
    'settings:selectVaultDirectory',
    async (): Promise<VaultDirectorySelection | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Obsidian Vault 폴더 선택',
    });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      const selectedPath = result.filePaths[0];

      return {
        path: selectedPath,
        suggestedName: path.basename(selectedPath),
      };
    },
  );
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Mimora',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

registerSettingsHandlers();

void app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
