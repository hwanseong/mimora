import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  ConnectionTestResult,
  LLMModel,
} from '../src/localAI';
import type {
  LocalAIChatResult,
  OllamaPerformanceMetrics,
  OllamaResponsePerformance,
} from '../src/llmChat';
import type { AIMode } from '../src/security/securityRouter';
import {
  type AddVaultInput,
  type MimoraIpcResult,
  type MimoraSettings,
  type UpdateVaultInput,
  type VaultDirectorySelection,
} from '../src/settings';
import type { AutoRetrievedContext } from '../src/autoContext';
import { createSettingsStore } from './settingsStore';
import { createVaultFilesService } from './vaultFiles';
import { createLLMProvider } from './llm/createLLMProvider';
import { buildLocalAIChatRequest } from './llm/promptBuilder';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchResult,
} from '../src/vaultFiles';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const settingsFileName = 'mimora-settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), settingsFileName);
}

const settingsStore = createSettingsStore({
  getSettingsPath,
});
const vaultFilesService = createVaultFilesService(settingsStore);

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
    'settings:updateLocalAI',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateLocalAISettings(input)),
  );

  ipcMain.handle(
    'settings:updateAIMode',
    async (
      _event,
      aiMode: unknown,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateAIMode(aiMode as AIMode)),
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

function nanosecondsToMilliseconds(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value / 1_000_000;
}

function tokensPerSecond(
  count: number | undefined,
  durationNs: number | undefined,
): number | undefined {
  if (count === undefined || durationNs === undefined || durationNs <= 0) {
    return undefined;
  }

  return count / (durationNs / 1_000_000_000);
}

function toOllamaPerformanceMetrics(
  performanceMetadata: OllamaResponsePerformance | undefined,
): OllamaPerformanceMetrics | undefined {
  if (!performanceMetadata) {
    return undefined;
  }

  return {
    ...(performanceMetadata.totalDurationNs !== undefined
      ? {
          totalMs: nanosecondsToMilliseconds(
            performanceMetadata.totalDurationNs,
          ),
        }
      : {}),
    ...(performanceMetadata.loadDurationNs !== undefined
      ? {
          loadMs: nanosecondsToMilliseconds(
            performanceMetadata.loadDurationNs,
          ),
        }
      : {}),
    ...(performanceMetadata.promptEvalCount !== undefined
      ? { promptEvalCount: performanceMetadata.promptEvalCount }
      : {}),
    ...(performanceMetadata.promptEvalDurationNs !== undefined
      ? {
          promptEvalMs: nanosecondsToMilliseconds(
            performanceMetadata.promptEvalDurationNs,
          ),
        }
      : {}),
    ...(tokensPerSecond(
      performanceMetadata.promptEvalCount,
      performanceMetadata.promptEvalDurationNs,
    ) !== undefined
      ? {
          promptTokensPerSecond: tokensPerSecond(
            performanceMetadata.promptEvalCount,
            performanceMetadata.promptEvalDurationNs,
          ),
        }
      : {}),
    ...(performanceMetadata.evalCount !== undefined
      ? { evalCount: performanceMetadata.evalCount }
      : {}),
    ...(performanceMetadata.evalDurationNs !== undefined
      ? {
          evalMs: nanosecondsToMilliseconds(
            performanceMetadata.evalDurationNs,
          ),
        }
      : {}),
    ...(tokensPerSecond(
      performanceMetadata.evalCount,
      performanceMetadata.evalDurationNs,
    ) !== undefined
      ? {
          generationTokensPerSecond: tokensPerSecond(
            performanceMetadata.evalCount,
            performanceMetadata.evalDurationNs,
          ),
        }
      : {}),
  };
}

function registerLocalAIHandlers(): void {
  ipcMain.handle(
    'localAI:listModels',
    async (_event, input: unknown): Promise<MimoraIpcResult<LLMModel[]>> =>
      toIpcResult(() => createLLMProvider(input).listModels()),
  );

  ipcMain.handle(
    'localAI:testConnection',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<ConnectionTestResult>> =>
      toIpcResult(() => createLLMProvider(input).testConnection()),
  );

  ipcMain.handle(
    'localAI:chat',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<LocalAIChatResult>> =>
      toIpcResult(async () => {
        const settings = await settingsStore.getSettings();

        if (!settings.localAI.model) {
          throw new Error(
            'Local AI 모델이 선택되지 않았습니다. Settings에서 모델을 선택하세요.',
          );
        }

        const contextBuildStartedTime = performance.now();
        const { workspaceId, request, sources, diagnostics } =
          buildLocalAIChatRequest(input);
        const contextBuildMs = performance.now() - contextBuildStartedTime;
        const requestStartedAt = new Date();
        const requestStartedTime = performance.now();

        try {
          const response = await createLLMProvider(settings.localAI).chat(
            request,
          );
          const responseCompletedAt = new Date();
          const ollamaRoundTripMs = performance.now() - requestStartedTime;
          const { performance: ollamaResponsePerformance, ...chatResponse } =
            response;

          return {
            ...chatResponse,
            sources,
            performance: {
              contextBuildMs,
              ollamaRoundTripMs,
              queryChars: diagnostics.queryChars,
              manualContextCount: diagnostics.manualDocumentCount,
              autoContextCount: diagnostics.autoDocumentCount,
              documentCount: diagnostics.deliveredDocumentCount,
              deduplicatedDocumentCount:
                diagnostics.deduplicatedDocumentCount,
              rawContextChars: diagnostics.rawContextChars,
              finalContextChars: diagnostics.finalContextChars,
              historyMessageCount: diagnostics.historyMessageCount,
              historyChars: diagnostics.historyChars,
              systemPromptChars: diagnostics.systemPromptChars,
              finalPromptChars: diagnostics.finalUserPromptChars,
              requestChars: diagnostics.totalRequestChars,
              responseChars: response.content.length,
              ollamaRequestStartedAt: requestStartedAt.toISOString(),
              ollamaResponseCompletedAt: responseCompletedAt.toISOString(),
              ...(ollamaResponsePerformance
                ? {
                    ollama: toOllamaPerformanceMetrics(
                      ollamaResponsePerformance,
                    ),
                  }
                : {}),
            },
          };
        } catch (error) {
          console.error('[Mimora Local AI] Request failed.', {
            workspaceId,
            requestStartedAt: requestStartedAt.toISOString(),
            requestFailedAt: new Date().toISOString(),
            elapsedMs: Math.round(performance.now() - requestStartedTime),
            error: getErrorMessage(error),
          });

          throw error;
        }
      }),
  );
}

function registerVaultFileHandlers(): void {
  ipcMain.handle(
    'vaultFiles:list',
    async (_event, vaultId: unknown): Promise<MimoraIpcResult<VaultFile[]>> =>
      toIpcResult(() => vaultFilesService.listVaultFiles(vaultId)),
  );

  ipcMain.handle(
    'vaultFiles:read',
    async (
      _event,
      vaultId: unknown,
      relativePath: unknown,
    ): Promise<MimoraIpcResult<VaultFileContent>> =>
      toIpcResult(() => vaultFilesService.readVaultFile(vaultId, relativePath)),
  );

  ipcMain.handle(
    'vaultFiles:search',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<VaultSearchResult[]>> =>
      toIpcResult(() => vaultFilesService.searchVaultFiles(input)),
  );

  ipcMain.handle(
    'vaultFiles:retrieveAutoContext',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<AutoRetrievedContext[]>> =>
      toIpcResult(() => vaultFilesService.retrieveAutoContext(input)),
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
registerVaultFileHandlers();
registerLocalAIHandlers();

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
