import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type {
  ConnectionTestResult,
  LLMModel,
} from '../src/localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
  ExternalAISettings,
  ExternalChatProviderId,
} from '../src/externalAI';
import {
  getAIProviderDisplayName,
  isExternalChatProviderId,
} from '../src/externalAI';
import type {
  LocalAIChatResult,
  OllamaPerformanceMetrics,
  OllamaResponsePerformance,
} from '../src/llmChat';
import {
  evaluateSecurity,
  getRoutingProviderType,
  type AIMode,
} from '../src/security/securityRouter';
import {
  allWorkspaceId,
  type WorkspaceSecurity,
  type WorkspaceType,
} from '../src/workspaces';
import {
  authorizeExternalSend,
  evaluateOutboundPayload,
  type OutboundPayloadDocumentMetadata,
} from '../src/security/outboundPayloadSafety';
import { validateExternalLinkUrl } from '../src/security/externalLinkSafety';
import type {
  AddMaskingEntryInput,
  MaskingEntry,
  UpdateMaskingEntryInput,
} from '../src/security/maskingEngine';
import { maskingEntityTypes } from '../src/security/maskingEngine';
import type { ResponseUnmaskingSnapshotEntry } from '../src/security/responseUnmasking';
import type { RegistryStatus } from '../src/registry/types';
import type { KnowledgeDomainRegistryParseResult } from '../src/registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistryParseResult } from '../src/registry/knowledgeTypeRegistryTypes';
import type { WorkspaceRegistryParseResult } from '../src/registry/workspaceRegistryTypes';
import {
  detectSecrets,
  getSecretRules,
  type AddSecretRuleInput,
  type UpdateSecretRuleInput,
} from '../src/security/secretDetector';
import {
  type AddVaultInput,
  type MimoraIpcResult,
  type MimoraSettings,
  type SearchScopeSettings,
  type UpdateVaultInput,
  type VaultDirectorySelection,
} from '../src/settings';
import type { AutoRetrievedContext } from '../src/autoContext';
import type {
  ChatHistoryLoadResult,
  ChatHistorySaveResult,
} from '../src/chatHistory';
import type {
  SaveDerivedKnowledgeInput,
  SaveDerivedKnowledgeResult,
  SuggestedDocumentIdResult,
} from '../src/derivedKnowledge';
import type {
  RagDeleteResult,
  RagDocument,
  RagFileSelection,
  RagFileSelectionPurpose,
  RagEmbeddingStatus,
  RagEmbeddingStatusInput,
  RagIndexInput,
  RagIndexResult,
  RagImportInput,
  RagImportResult,
  RagPythonStatus,
  RagReplaceInput,
  RagReplaceResult,
  RagSearchInput,
  RagSearchResult,
  RagSettings,
} from '../src/rag';
import { ragFileSelectionPurposeOptions } from '../src/rag';
import type {
  ScheduleFileSelection,
  ScheduleParseResult,
  ScheduleQueryInput,
  ScheduleQueryResult,
  ScheduleRegisterInput,
  ScheduleRemoveResult,
  ScheduleRefreshOptions,
  ScheduleSource,
  ScheduleSummary,
} from '../src/schedule';
import type {
  IssueDocument,
  IssueFileSelection,
  IssueParseResult,
  IssueQueryInput,
  IssueQueryResult,
  IssueRegisterInput,
  IssueRemoveResult,
  IssueRefreshOptions,
  IssueSummary,
} from '../src/issue';
import type {
  WeeklyReportRenderInput,
  WeeklyReportRenderResult,
} from '../src/weeklyReport';
import { createChatHistoryStore } from './chatHistoryStore';
import { createSettingsStore } from './settingsStore';
import { createRegistryStatusService } from './registryStatus';
import { createVaultFilesService } from './vaultFiles';
import { createDerivedKnowledgeService } from './derivedKnowledgeService';
import {
  createRagService,
  ragFileDialogFilters,
} from './ragService';
import {
  createScheduleService,
  scheduleFileDialogFilters,
} from './scheduleService';
import {
  createIssueService,
  issueFileDialogFilters,
} from './issueService';
import {
  createSecureFileSelectionStore,
  validateSelectionOnlyIpcInput,
} from './secureFileSelection';
import { createWeeklyReportService } from './weeklyReportService';
import { createLLMProvider } from './llm/createLLMProvider';
import { createExternalChatProvider } from './llm/externalChatProviderFactory';
import { buildLocalAIChatRequest } from './llm/promptBuilder';
import { createExternalCredentialStore } from './externalCredentialStore';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchResult,
} from '../src/vaultFiles';
import type { DocumentIdValidationSummary } from '../src/documentIdValidation';
import type {
  WorkspaceInsightSnapshot,
  WorkspaceInsightStoreLoadResult,
  WorkspaceInsightStoreSaveResult,
} from '../src/workspaceInsight';
import { createWorkspaceInsightStore } from './workspaceInsightStore';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const devCompositorMode =
  process.env.MIMORA_ELECTRON_COMPOSITOR_MODE ??
  'hardware-acceleration';
const settingsFileName = 'mimora-settings.json';
const openAICredentialFileName = 'openai-api-key.safe';
const externalCredentialDirectoryName = 'credentials';
const chatHistoryFileName = 'chat-history.dat';
const registryCacheFileName = 'registry-runtime-cache.json';
const workspaceInsightFileName = 'workspace-insights.dat';

function configureDevCompositorWorkaround(): void {
  if (!devServerUrl) {
    return;
  }

  const normalizedMode = devCompositorMode.trim().toLowerCase();
  const appliedSwitches: string[] = [];

  if (normalizedMode !== 'off') {
    app.disableHardwareAcceleration();
  }

  if (
    normalizedMode === 'disable-gpu' ||
    normalizedMode === 'disable-direct-composition' ||
    normalizedMode === 'disable-features' ||
    normalizedMode === 'temp-user-data'
  ) {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    appliedSwitches.push('disable-gpu', 'disable-gpu-compositing');
  }

  if (
    normalizedMode === 'disable-direct-composition' ||
    normalizedMode === 'disable-features' ||
    normalizedMode === 'temp-user-data'
  ) {
    app.commandLine.appendSwitch('disable-direct-composition');
    appliedSwitches.push('disable-direct-composition');
  }

  if (normalizedMode === 'disable-features' || normalizedMode === 'temp-user-data') {
    app.commandLine.appendSwitch(
      'disable-features',
      'UseSkiaRenderer,VizDisplayCompositor,CanvasOopRasterization',
    );
    appliedSwitches.push(
      'disable-features=UseSkiaRenderer,VizDisplayCompositor,CanvasOopRasterization',
    );
  }

  if (normalizedMode === 'temp-user-data') {
    const userDataDir =
      process.env.MIMORA_ELECTRON_DEV_USER_DATA_DIR ??
      path.join(os.tmpdir(), 'mimora-electron-dev');
    app.commandLine.appendSwitch('user-data-dir', userDataDir);
    appliedSwitches.push(`user-data-dir=${userDataDir}`);
  }

  console.info('[Mimora Electron Dev] compositor workaround', {
    mode: normalizedMode,
    disableHardwareAcceleration: normalizedMode !== 'off',
    appliedSwitches,
  });
}

configureDevCompositorWorkaround();

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), settingsFileName);
}

function getRegistryCachePath(): string {
  return path.join(app.getPath('userData'), registryCacheFileName);
}

const settingsStore = createSettingsStore({
  getSettingsPath,
});
const externalCredentialStore = createExternalCredentialStore({
  getCredentialPath: (providerId) =>
    path.join(
      app.getPath('userData'),
      externalCredentialDirectoryName,
      `${providerId}.safe`,
    ),
  getLegacyOpenAICredentialPath: () =>
    path.join(app.getPath('userData'), openAICredentialFileName),
  safeStorage,
});
const chatHistoryStore = createChatHistoryStore({
  getHistoryPath: () => path.join(app.getPath('userData'), chatHistoryFileName),
  safeStorage,
});
const workspaceInsightStore = createWorkspaceInsightStore({
  getInsightPath: () =>
    path.join(app.getPath('userData'), workspaceInsightFileName),
  safeStorage,
});
const ragService = createRagService({
  getUserDataPath: () => app.getPath('userData'),
  getAppRoot: () => (app.isPackaged ? process.resourcesPath : process.cwd()),
  getOpenAIApiKey: () =>
    externalCredentialStore.readApiKeyForMainProcess('openai'),
  getRagSettings: async () => {
    const settings = await settingsStore.getSettings();
    return {
      rag: settings.rag,
      ollamaBaseUrl: settings.localAI.endpoint,
    };
  },
});
const scheduleService = createScheduleService({
  getUserDataPath: () => app.getPath('userData'),
  getAppRoot: () => (app.isPackaged ? process.resourcesPath : process.cwd()),
});
const issueService = createIssueService({
  getUserDataPath: () => app.getPath('userData'),
  getAppRoot: () => (app.isPackaged ? process.resourcesPath : process.cwd()),
});
const secureFileSelections = createSecureFileSelectionStore();
const weeklyReportService = createWeeklyReportService({
  getUserDataPath: () => app.getPath('userData'),
  getAppRoot: () => (app.isPackaged ? process.resourcesPath : process.cwd()),
});
const derivedKnowledgeService = createDerivedKnowledgeService(settingsStore);
const registryStatusService = createRegistryStatusService(settingsStore, {
  getCachePath: getRegistryCachePath,
});
const vaultFilesService = createVaultFilesService(settingsStore, {
  getRegistryCachePath,
});

async function getWorkspaceSecurityDescriptorForRequest(
  workspaceId: string,
): Promise<{
  type: WorkspaceType;
  security: WorkspaceSecurity;
}> {
  if (workspaceId === allWorkspaceId) {
    return { type: 'all', security: 'internal' };
  }

  const registry = await registryStatusService.loadWorkspaceRegistry();
  const workspace = registry.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error('External AI 요청의 Workspace를 확인할 수 없습니다.');
  }

  return {
    type: workspace.type,
    security: workspace.security,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '설정 처리 중 오류가 발생했습니다.';
}

function logArchivedRetrievalIpcInput(input: unknown): void {
  if (!devServerUrl && process.env.NODE_ENV !== 'development') {
    return;
  }

  if (!input || typeof input !== 'object') {
    return;
  }

  const candidate = input as {
    query?: unknown;
    workspaceId?: unknown;
    includeArchived?: unknown;
    knowledgeFilters?: {
      domains?: unknown;
      types?: unknown;
    };
    contentOriginScope?: unknown;
  };
  const query = typeof candidate.query === 'string' ? candidate.query : '';

  console.info('[Archived Debug]', {
    stage: 'retrieveAutoContext:ipc',
    workspaceId:
      typeof candidate.workspaceId === 'string' ? candidate.workspaceId : null,
    requestIncludeArchived: candidate.includeArchived === true,
    retrievalIncludeArchived: candidate.includeArchived === true,
    requestDomains: Array.isArray(candidate.knowledgeFilters?.domains)
      ? candidate.knowledgeFilters.domains
      : [],
    requestTypes: Array.isArray(candidate.knowledgeFilters?.types)
      ? candidate.knowledgeFilters.types
      : [],
    contentOriginScope:
      typeof candidate.contentOriginScope === 'string'
        ? candidate.contentOriginScope
        : 'all',
    questionContainsArchivedMarker: query.includes('ARCHIVED-ONLY-777'),
  });
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
    'settings:getExternalAI',
    async (): Promise<MimoraIpcResult<ExternalAISettings>> =>
      toIpcResult(async () => (await settingsStore.getSettings()).externalAI),
  );

  ipcMain.handle(
    'settings:updateExternalAI',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateExternalAISettings(input)),
  );

  ipcMain.handle(
    'settings:updateRag',
    async (
      _event,
      input: unknown,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateRagSettings(input)),
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
    'settings:updateSearchScope',
    async (
      _event,
      input: SearchScopeSettings,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateSearchScopeSettings(input)),
  );

  ipcMain.handle(
    'settings:updateRegistryHomeVault',
    async (
      _event,
      homeVaultId: string | null,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateRegistryHomeVault(homeVaultId)),
  );

  ipcMain.handle(
    'settings:addMaskingEntry',
    async (
      _event,
      input: AddMaskingEntryInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.addMaskingEntry(input)),
  );

  ipcMain.handle(
    'settings:updateMaskingEntry',
    async (
      _event,
      input: UpdateMaskingEntryInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateMaskingEntry(input)),
  );

  ipcMain.handle(
    'settings:deleteMaskingEntry',
    async (
      _event,
      id: string,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.deleteMaskingEntry(id)),
  );

  ipcMain.handle(
    'settings:addSecretRule',
    async (
      _event,
      input: AddSecretRuleInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.addSecretRule(input)),
  );

  ipcMain.handle(
    'settings:updateSecretRule',
    async (
      _event,
      input: UpdateSecretRuleInput,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.updateSecretRule(input)),
  );

  ipcMain.handle(
    'settings:deleteSecretRule',
    async (
      _event,
      id: string,
    ): Promise<MimoraIpcResult<MimoraSettings>> =>
      toIpcResult(() => settingsStore.deleteSecretRule(id)),
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

function registerRegistryHandlers(): void {
  ipcMain.handle(
    'registry:getStatus',
    async (): Promise<MimoraIpcResult<RegistryStatus>> =>
      toIpcResult(() => registryStatusService.getRegistryStatus()),
  );

  ipcMain.handle(
    'registry:loadWorkspaces',
    async (): Promise<MimoraIpcResult<WorkspaceRegistryParseResult>> =>
      toIpcResult(() => registryStatusService.loadWorkspaceRegistry()),
  );

  ipcMain.handle(
    'registry:loadKnowledgeDomains',
    async (): Promise<MimoraIpcResult<KnowledgeDomainRegistryParseResult>> =>
      toIpcResult(() => registryStatusService.loadKnowledgeDomainRegistry()),
  );

  ipcMain.handle(
    'registry:loadKnowledgeTypes',
    async (): Promise<MimoraIpcResult<KnowledgeTypeRegistryParseResult>> =>
      toIpcResult(() => registryStatusService.loadKnowledgeTypeRegistry()),
  );
}

function registerRagHandlers(): void {
  function validateRagSelectionPurpose(
    value: unknown,
  ): RagFileSelectionPurpose {
    if (
      typeof value === 'string' &&
      ragFileSelectionPurposeOptions.includes(value as RagFileSelectionPurpose)
    ) {
      return value as RagFileSelectionPurpose;
    }

    throw new Error('RAG file selection purpose is invalid.');
  }

  ipcMain.handle(
    'rag:getPythonStatus',
    async (): Promise<MimoraIpcResult<RagPythonStatus>> =>
      toIpcResult(() => ragService.getPythonStatus()),
  );

  ipcMain.handle(
    'rag:getStorageRoot',
    async (): Promise<MimoraIpcResult<string>> =>
      toIpcResult(async () => ragService.getStorageRoot()),
  );

  ipcMain.handle(
    'rag:selectDocumentFile',
    async (_event, purpose: unknown): Promise<RagFileSelection | null> => {
      const selectionPurpose = validateRagSelectionPurpose(purpose);
      const result = await dialog.showOpenDialog({
        filters: ragFileDialogFilters,
        properties: ['openFile'],
        title: 'RAG Document 선택',
      });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      return secureFileSelections.create(
        result.filePaths[0],
        selectionPurpose,
      ) as Promise<RagFileSelection>;
    },
  );

  ipcMain.handle(
    'rag:listDocuments',
    async (): Promise<MimoraIpcResult<RagDocument[]>> =>
      toIpcResult(() => ragService.listDocuments()),
  );

  ipcMain.handle(
    'rag:importDocument',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<RagImportResult>> =>
      toIpcResult(async () => {
        const input = validateSelectionOnlyIpcInput<RagImportInput>(
          rawInput,
          ['selectionId', 'workspaceIds', 'security'],
          'RAG import',
        );
        const sourcePath = await secureFileSelections.consume(
          input.selectionId,
          'rag-import',
        );

        return ragService.importDocument({
          sourcePath,
          workspaceIds: input.workspaceIds,
          security: input.security,
        });
      }),
  );

  ipcMain.handle(
    'rag:deleteDocument',
    async (
      _event,
      ragDocumentId: string,
    ): Promise<MimoraIpcResult<RagDeleteResult>> =>
      toIpcResult(() => ragService.deleteDocument(ragDocumentId)),
  );

  ipcMain.handle(
    'rag:replaceDocument',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<RagReplaceResult>> =>
      toIpcResult(async () => {
        const input = validateSelectionOnlyIpcInput<RagReplaceInput>(
          rawInput,
          ['ragDocumentId', 'selectionId'],
          'RAG replace',
        );
        const sourcePath = await secureFileSelections.consume(
          input.selectionId,
          'rag-replace',
        );

        return ragService.replaceDocument({
          ragDocumentId: input.ragDocumentId,
          sourcePath,
        });
      }),
  );

  ipcMain.handle(
    'rag:indexDocument',
    async (
      _event,
      input: RagIndexInput,
    ): Promise<MimoraIpcResult<RagIndexResult>> =>
      toIpcResult(() => ragService.indexDocument(input)),
  );

  ipcMain.handle(
    'rag:search',
    async (
      _event,
      input: RagSearchInput,
    ): Promise<MimoraIpcResult<RagSearchResult[]>> =>
      toIpcResult(() => ragService.search(input)),
  );

  ipcMain.handle(
    'rag:checkEmbeddingStatus',
    async (
      _event,
      input: RagEmbeddingStatusInput,
    ): Promise<MimoraIpcResult<RagEmbeddingStatus>> =>
      toIpcResult(() => ragService.checkEmbeddingStatus(input)),
  );
}

function registerScheduleHandlers(): void {
  ipcMain.handle(
    'schedule:getStorageRoot',
    async (): Promise<MimoraIpcResult<string>> =>
      toIpcResult(() => scheduleService.getScheduleRoot()),
  );

  ipcMain.handle(
    'schedule:selectSourceFile',
    async (): Promise<ScheduleFileSelection | null> => {
      const result = await dialog.showOpenDialog({
        filters: scheduleFileDialogFilters,
        properties: ['openFile'],
        title: 'Schedule Excel 선택',
      });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      return secureFileSelections.create(
        result.filePaths[0],
        'schedule-register',
      ) as Promise<ScheduleFileSelection>;
    },
  );

  ipcMain.handle(
    'schedule:registerSource',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<ScheduleSource>> =>
      toIpcResult(async () => {
        const input = validateSelectionOnlyIpcInput<ScheduleRegisterInput>(
          rawInput,
          ['workspaceId', 'selectionId'],
          'Schedule register',
        );
        const sourcePath = await secureFileSelections.consume(
          input.selectionId,
          'schedule-register',
        );

        return scheduleService.registerSource({
          workspaceId: input.workspaceId,
          sourcePath,
        });
      }),
  );

  ipcMain.handle(
    'schedule:getSource',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<ScheduleSource | null>> =>
      toIpcResult(() => scheduleService.getSource(workspaceId)),
  );

  ipcMain.handle(
    'schedule:removeSource',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<ScheduleRemoveResult>> =>
      toIpcResult(() => scheduleService.removeSource(workspaceId)),
  );

  ipcMain.handle(
    'schedule:refresh',
    async (
      _event,
      workspaceId: string,
      options?: ScheduleRefreshOptions,
    ): Promise<MimoraIpcResult<ScheduleParseResult>> =>
      toIpcResult(() => scheduleService.refresh(workspaceId, options)),
  );

  ipcMain.handle(
    'schedule:getSummary',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<ScheduleSummary>> =>
      toIpcResult(() => scheduleService.getSummary(workspaceId)),
  );

  ipcMain.handle(
    'schedule:query',
    async (
      _event,
      input: ScheduleQueryInput,
    ): Promise<MimoraIpcResult<ScheduleQueryResult>> =>
      toIpcResult(() => scheduleService.query(input)),
  );
}

function registerIssueHandlers(): void {
  ipcMain.handle(
    'issue:getStorageRoot',
    async (): Promise<MimoraIpcResult<string>> =>
      toIpcResult(() => issueService.getIssueRoot()),
  );

  ipcMain.handle(
    'issue:selectSourceFile',
    async (): Promise<IssueFileSelection | null> => {
      const result = await dialog.showOpenDialog({
        filters: issueFileDialogFilters,
        properties: ['openFile'],
        title: 'Issue Excel Select',
      });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      return secureFileSelections.create(
        result.filePaths[0],
        'issue-register',
      ) as Promise<IssueFileSelection>;
    },
  );

  ipcMain.handle(
    'issue:registerDocument',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<IssueDocument>> =>
      toIpcResult(async () => {
        const input = validateSelectionOnlyIpcInput<IssueRegisterInput>(
          rawInput,
          ['workspaceId', 'selectionId', 'security', 'notes'],
          'Issue register',
        );
        const sourcePath = await secureFileSelections.consume(
          input.selectionId,
          'issue-register',
        );

        return issueService.registerDocument({
          workspaceId: input.workspaceId,
          sourcePath,
          security: input.security,
          notes: input.notes,
        });
      }),
  );

  ipcMain.handle(
    'issue:getDocument',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<IssueDocument | null>> =>
      toIpcResult(() => issueService.getDocument(workspaceId)),
  );

  ipcMain.handle(
    'issue:removeDocument',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<IssueRemoveResult>> =>
      toIpcResult(() => issueService.removeDocument(workspaceId)),
  );

  ipcMain.handle(
    'issue:refresh',
    async (
      _event,
      workspaceId: string,
      options?: IssueRefreshOptions,
    ): Promise<MimoraIpcResult<IssueParseResult>> =>
      toIpcResult(() => issueService.refresh(workspaceId, options)),
  );

  ipcMain.handle(
    'issue:getSummary',
    async (
      _event,
      workspaceId: string,
    ): Promise<MimoraIpcResult<IssueSummary>> =>
      toIpcResult(() => issueService.getSummary(workspaceId)),
  );

  ipcMain.handle(
    'issue:query',
    async (
      _event,
      input: IssueQueryInput,
    ): Promise<MimoraIpcResult<IssueQueryResult>> =>
      toIpcResult(() => issueService.query(input)),
  );
}

function registerWeeklyReportHandlers(): void {
  ipcMain.handle(
    'weeklyReport:getStorageRoot',
    async (): Promise<MimoraIpcResult<string>> =>
      toIpcResult(() => weeklyReportService.getReportRoot()),
  );

  ipcMain.handle(
    'weeklyReport:render',
    async (
      _event,
      input: WeeklyReportRenderInput,
    ): Promise<MimoraIpcResult<WeeklyReportRenderResult>> =>
      toIpcResult(async () => {
        const result = await dialog.showSaveDialog({
          defaultPath: input.defaultFileName,
          filters: [
            {
              name: 'Word Document',
              extensions: ['docx'],
            },
          ],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
          title: '주간보고서 저장',
        });

        if (result.canceled || !result.filePath) {
          return {
            canceled: true,
          };
        }

        return weeklyReportService.renderWeeklyReport({
          data: input.data,
          outputPath: result.filePath,
          templatePath: input.templatePath ?? null,
        });
      }),
  );
}

function registerChatHistoryHandlers(): void {
  ipcMain.handle(
    'chatHistory:load',
    async (): Promise<MimoraIpcResult<ChatHistoryLoadResult>> =>
      toIpcResult(() => chatHistoryStore.loadChatHistory()),
  );
  ipcMain.handle(
    'chatHistory:save',
    async (
      _event,
      sessions: unknown,
    ): Promise<MimoraIpcResult<ChatHistorySaveResult>> =>
      toIpcResult(() => chatHistoryStore.saveChatHistory(sessions)),
  );
  ipcMain.handle(
    'chatHistory:deleteWorkspace',
    async (
      _event,
      workspaceId: unknown,
    ): Promise<MimoraIpcResult<ChatHistorySaveResult>> =>
      toIpcResult(() => chatHistoryStore.deleteWorkspaceChat(workspaceId)),
  );
}

function registerWorkspaceInsightHandlers(): void {
  ipcMain.handle(
    'workspaceInsights:load',
    async (): Promise<MimoraIpcResult<WorkspaceInsightStoreLoadResult>> =>
      toIpcResult(() => workspaceInsightStore.loadWorkspaceInsights()),
  );

  ipcMain.handle(
    'workspaceInsights:save',
    async (
      _event,
      snapshot: WorkspaceInsightSnapshot,
    ): Promise<MimoraIpcResult<WorkspaceInsightStoreSaveResult>> =>
      toIpcResult(() => workspaceInsightStore.saveWorkspaceInsight(snapshot)),
  );
}

function validateExternalChatProviderId(
  providerId: unknown,
): ExternalChatProviderId {
  if (!isExternalChatProviderId(providerId)) {
    throw new Error('지원하지 않는 External AI Provider입니다.');
  }

  return providerId;
}

function createProviderApiKeyMissingMessage(
  providerId: ExternalChatProviderId,
): string {
  return `${getAIProviderDisplayName(providerId)} API Key가 설정되지 않았습니다. Settings에서 API Key를 저장하세요.`;
}

function registerOpenAIHandlers(): void {
  ipcMain.handle(
    'externalAI:hasCredential',
    async (
      _event,
      providerId: unknown,
    ): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(() =>
        externalCredentialStore.hasApiKey(
          validateExternalChatProviderId(providerId),
        ),
      ),
  );

  ipcMain.handle(
    'externalAI:saveCredential',
    async (
      _event,
      providerId: unknown,
      apiKey: unknown,
    ): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await externalCredentialStore.saveApiKey(
          validateExternalChatProviderId(providerId),
          apiKey,
        );
        return true;
      }),
  );

  ipcMain.handle(
    'externalAI:deleteCredential',
    async (
      _event,
      providerId: unknown,
    ): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await externalCredentialStore.deleteApiKey(
          validateExternalChatProviderId(providerId),
        );
        return false;
      }),
  );

  ipcMain.handle(
    'externalAI:listModels',
    async (
      _event,
      providerId: unknown,
    ): Promise<MimoraIpcResult<LLMModel[]>> =>
      toIpcResult(async () => {
        const externalProviderId = validateExternalChatProviderId(providerId);
        const apiKey =
          await externalCredentialStore.readApiKeyForMainProcess(
            externalProviderId,
          );
        return createExternalChatProvider(externalProviderId, apiKey).listModels();
      }),
  );

  ipcMain.handle(
    'externalAI:testConnection',
    async (
      _event,
      providerId: unknown,
    ): Promise<MimoraIpcResult<ConnectionTestResult>> =>
      toIpcResult(async () => {
        const externalProviderId = validateExternalChatProviderId(providerId);
        const startedAt = performance.now();
        let result: ConnectionTestResult;

        try {
          const apiKey =
            await externalCredentialStore.readApiKeyForMainProcess(
              externalProviderId,
            );
          result = await createExternalChatProvider(
            externalProviderId,
            apiKey,
          ).testConnection();
        } catch (error) {
          result = {
            connected: false,
            message:
              error instanceof Error
                ? error.message
                : `${getAIProviderDisplayName(externalProviderId)}에 연결할 수 없습니다.`,
          };
        }

        console.info('[Mimora External AI] Connection test.', {
          provider: externalProviderId,
          status: result.connected ? 'success' : 'failure',
          elapsedMs: Math.round(performance.now() - startedAt),
        });

        return result;
      }),
  );

  ipcMain.handle(
    'externalAI:chat',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<ExternalAIChatResult>> =>
      toIpcResult(async () => executeExternalAIChat(rawInput)),
  );

  ipcMain.handle(
    'openAI:hasApiKey',
    async (): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(() => externalCredentialStore.hasApiKey('openai')),
  );

  ipcMain.handle(
    'openAI:saveApiKey',
    async (_event, apiKey: unknown): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await externalCredentialStore.saveApiKey('openai', apiKey);
        return true;
      }),
  );

  ipcMain.handle(
    'openAI:deleteApiKey',
    async (): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await externalCredentialStore.deleteApiKey('openai');
        return false;
      }),
  );

  ipcMain.handle(
    'openAI:listModels',
    async (): Promise<MimoraIpcResult<LLMModel[]>> =>
      toIpcResult(async () => {
        const apiKey =
          await externalCredentialStore.readApiKeyForMainProcess('openai');
        return createExternalChatProvider('openai', apiKey).listModels();
      }),
  );

  ipcMain.handle(
    'openAI:testConnection',
    async (): Promise<MimoraIpcResult<ConnectionTestResult>> =>
      toIpcResult(async () => {
        const startedAt = performance.now();
        let result: ConnectionTestResult;

        try {
          const apiKey =
            await externalCredentialStore.readApiKeyForMainProcess('openai');
          result = await createExternalChatProvider(
            'openai',
            apiKey,
          ).testConnection();
        } catch (error) {
          result = {
            connected: false,
            message:
              error instanceof Error
                ? error.message
                : 'OpenAI에 연결할 수 없습니다.',
          };
        }

        console.info('[Mimora External AI] Connection test.', {
          provider: 'openai',
          status: result.connected ? 'success' : 'failure',
          elapsedMs: Math.round(performance.now() - startedAt),
        });

        return result;
      }),
  );

  ipcMain.handle(
    'openAI:chat',
    async (
      _event,
      rawInput: unknown,
    ): Promise<MimoraIpcResult<ExternalAIChatResult>> =>
      toIpcResult(async () => {
        const input = validateExternalAIChatInput(rawInput);
        const startedTime = performance.now();
        const requestStartedAt = new Date();
        const settings = await settingsStore.getSettings();
        const workspaceSecurity =
          await getWorkspaceSecurityDescriptorForRequest(input.workspaceId);

        const effectiveSecurity = evaluateSecurity(
          workspaceSecurity.type,
          input.documents.map((document) => ({
            vaultId: document.documentId,
            relativePath: document.relativePath,
            vaultType: document.vaultType,
            security: document.security,
            documentSecurity:
              document.documentSecurity ?? document.metadata?.security,
          })),
          workspaceSecurity.security,
          input.externalText,
        ).security;
        const secretDetection = detectSecrets(
          input.externalText,
          getSecretRules(settings.secretDetection.customRules),
        );
        const maskingEntriesForTurn = createMaskingEntriesFromSnapshot(
          input.maskingSnapshot,
        );
        const matchedRuleIds = [
          ...new Set(
            secretDetection.detections.map(
              (detection) => detection.ruleId,
            ),
          ),
        ];

        console.info('[Mimora Secret Detection]', {
          documents: input.documents.length,
          detected: secretDetection.detected,
          rulesMatched: matchedRuleIds.length,
          totalMatches: secretDetection.totalCount,
          matchedRules: matchedRuleIds,
        });

        const safety = secretDetection.detected
          ? {
              status: 'block' as const,
              checks: [
                {
                  id: 'secret-detected',
                  label: 'Secret / Credential Detection',
                  status: 'fail' as const,
                  message:
                    'Secret 또는 Credential 정보가 감지되어 외부 전송을 차단했습니다.',
                },
              ],
              blockers: ['secret-detected'],
              warnings: [],
            }
          : evaluateOutboundPayload({
              externalText: input.externalText,
              documents: input.documents,
              maskingEntries: maskingEntriesForTurn,
              effectiveSecurity,
            });
        const providerId = settings.externalAI.provider;
        const providerType = getRoutingProviderType(providerId);
        const model = settings.externalAI.model;
        const hasExternalLocalOnlyContext =
          effectiveSecurity === 'private' ||
          effectiveSecurity === 'sensitive' ||
          input.documents.some(
            (document) =>
              document.vaultType === 'private' ||
              document.security === 'sensitive' ||
              document.documentSecurity === 'private' ||
              document.metadata?.security === 'private',
          ) ||
          safety.blockers.some((blocker) =>
            [
              'private-document-context',
              'private-vault-context',
              'sensitive-context',
            ].includes(blocker),
          );
        const authorization = authorizeExternalSend({
          status: safety.status,
          mode: input.mode,
          approved: input.approved,
          providerId,
          providerType,
          hasPrivateDocument: input.documents.some(
            (document) =>
              document.documentSecurity === 'private' ||
              document.metadata?.security === 'private',
          ),
          hasExternalLocalOnlyContext,
        });
        let status: 'success' | 'failure' = 'failure';
        let blockReason: string | undefined;

        try {
          if (!authorization.allowed) {
            blockReason = authorization.message;
            throw new Error(authorization.message);
          }

          if (!model) {
            throw new Error(
              'OpenAI 모델이 선택되지 않았습니다. Settings에서 모델을 선택하세요.',
            );
          }

          let apiKey: string;

          try {
            apiKey =
              await externalCredentialStore.readApiKeyForMainProcess(
                providerId,
              );
          } catch {
            throw new Error(
              'OpenAI API Key가 설정되지 않았습니다. Settings에서 API Key를 저장하세요.',
            );
          }

          const response = await createExternalChatProvider(providerId, apiKey).chat({
            model,
            input: input.externalText,
          });
          const responseCompletedAt = new Date();
          const openAIRoundTripMs = performance.now() - startedTime;

          status = 'success';

          return {
            ...response,
            model: response.model ?? model,
            safetyStatus: safety.status,
            performance: {
              externalRoundTripMs: openAIRoundTripMs,
              openAIRoundTripMs,
              providerId,
              payloadChars: input.externalText.length,
              documentCount: input.documents.length,
              responseChars: response.content.length,
              requestStartedAt: requestStartedAt.toISOString(),
              responseCompletedAt: responseCompletedAt.toISOString(),
            },
          };
        } finally {
          console.info('[Mimora External Request]', {
            providerId,
            providerType,
            workspace: input.workspaceId,
            mode: input.mode,
            safety: safety.status,
            blockReason,
            documents: input.documents.length,
            maskedPayloadChars: input.externalText.length,
            model: model ?? 'not-selected',
            approved: input.approved,
            status,
            elapsedMs: Math.round(performance.now() - startedTime),
          });
        }
      }),
  );
}

async function executeExternalAIChat(
  rawInput: unknown,
): Promise<ExternalAIChatResult> {
  const input = validateExternalAIChatInput(rawInput);
  const startedTime = performance.now();
  const requestStartedAt = new Date();
  const settings = await settingsStore.getSettings();
  const workspaceSecurity =
    await getWorkspaceSecurityDescriptorForRequest(input.workspaceId);

  const effectiveSecurity = evaluateSecurity(
    workspaceSecurity.type,
    input.documents.map((document) => ({
      vaultId: document.documentId,
      relativePath: document.relativePath,
      vaultType: document.vaultType,
      security: document.security,
      documentSecurity:
        document.documentSecurity ?? document.metadata?.security,
    })),
    workspaceSecurity.security,
    input.externalText,
  ).security;
  const secretDetection = detectSecrets(
    input.externalText,
    getSecretRules(settings.secretDetection.customRules),
  );
  const maskingEntriesForTurn = createMaskingEntriesFromSnapshot(
    input.maskingSnapshot,
  );
  const safety = secretDetection.detected
    ? {
        status: 'block' as const,
        checks: [
          {
            id: 'secret-detected',
            label: 'Secret / Credential Detection',
            status: 'fail' as const,
            message:
              'Secret 또는 Credential 정보가 감지되어 외부 전송을 차단했습니다.',
          },
        ],
        blockers: ['secret-detected'],
        warnings: [],
      }
    : evaluateOutboundPayload({
        externalText: input.externalText,
        documents: input.documents,
        maskingEntries: maskingEntriesForTurn,
        effectiveSecurity,
      });
  const providerId = settings.externalAI.provider;
  const providerType = getRoutingProviderType(providerId);
  const model = settings.externalAI.model;
  const providerDisplayName = getAIProviderDisplayName(providerId);
  const hasExternalLocalOnlyContext =
    effectiveSecurity === 'private' ||
    effectiveSecurity === 'sensitive' ||
    input.documents.some(
      (document) =>
        document.vaultType === 'private' ||
        document.security === 'sensitive' ||
        document.documentSecurity === 'private' ||
        document.metadata?.security === 'private',
    ) ||
    safety.blockers.some((blocker) =>
      [
        'private-document-context',
        'private-vault-context',
        'sensitive-context',
      ].includes(blocker),
    );
  const authorization = authorizeExternalSend({
    status: safety.status,
    mode: input.mode,
    approved: input.approved,
    providerId,
    providerType,
    hasPrivateDocument: input.documents.some(
      (document) =>
        document.documentSecurity === 'private' ||
        document.metadata?.security === 'private',
    ),
    hasExternalLocalOnlyContext,
  });
  let status: 'success' | 'failure' = 'failure';
  let blockReason: string | undefined;

  try {
    if (!authorization.allowed) {
      blockReason = authorization.message;
      throw new Error(authorization.message);
    }

    if (!model) {
      throw new Error(
        `${providerDisplayName} 모델이 선택되지 않았습니다. Settings에서 모델을 선택하세요.`,
      );
    }

    let apiKey: string;

    try {
      apiKey =
        await externalCredentialStore.readApiKeyForMainProcess(providerId);
    } catch {
      throw new Error(createProviderApiKeyMissingMessage(providerId));
    }

    const response = await createExternalChatProvider(providerId, apiKey).chat({
      model,
      input: input.externalText,
    });
    const responseCompletedAt = new Date();
    const externalRoundTripMs = performance.now() - startedTime;

    status = 'success';

    return {
      ...response,
      model: response.model ?? model,
      safetyStatus: safety.status,
      performance: {
        externalRoundTripMs,
        openAIRoundTripMs: externalRoundTripMs,
        providerId,
        payloadChars: input.externalText.length,
        documentCount: input.documents.length,
        responseChars: response.content.length,
        requestStartedAt: requestStartedAt.toISOString(),
        responseCompletedAt: responseCompletedAt.toISOString(),
      },
    };
  } finally {
    console.info('[Mimora External Request]', {
      providerId,
      providerType,
      workspace: input.workspaceId,
      mode: input.mode,
      safety: safety.status,
      blockReason,
      documents: input.documents.length,
      maskedPayloadChars: input.externalText.length,
      model: model ?? 'not-selected',
      approved: input.approved,
      status,
      elapsedMs: Math.round(performance.now() - startedTime),
    });
  }
}

function isExternalDocumentMetadata(
  value: unknown,
): value is OutboundPayloadDocumentMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const document = value as Partial<OutboundPayloadDocumentMetadata>;
  const allowedKeys = new Set([
    'documentId',
    'vaultName',
    'vaultType',
    'security',
    'documentSecurity',
    'relativePath',
    'fileName',
    'metadata',
  ]);

  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof document.documentId === 'string' &&
    /^DOCUMENT_\d+$/u.test(document.documentId) &&
    typeof document.vaultName === 'string' &&
    ['work', 'private', 'knowledge'].includes(document.vaultType ?? '') &&
    ['internal', 'sensitive', 'personal'].includes(document.security ?? '') &&
    (document.documentSecurity === undefined ||
      document.documentSecurity === 'normal' ||
      document.documentSecurity === 'private' ||
      document.documentSecurity === 'internal') &&
    typeof document.relativePath === 'string' &&
    typeof document.fileName === 'string' &&
    (document.metadata === undefined ||
      (typeof document.metadata === 'object' &&
        document.metadata !== null &&
        !Array.isArray(document.metadata)))
  );
}

function isResponseUnmaskingSnapshotEntry(
  value: unknown,
): value is ResponseUnmaskingSnapshotEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ResponseUnmaskingSnapshotEntry).alias === 'string' &&
    typeof (value as ResponseUnmaskingSnapshotEntry).original === 'string' &&
    maskingEntityTypes.includes(
      (value as ResponseUnmaskingSnapshotEntry).entityType,
    )
  );
}

function createMaskingEntriesFromSnapshot(
  snapshot: ResponseUnmaskingSnapshotEntry[],
): MaskingEntry[] {
  const now = '1970-01-01T00:00:00.000Z';

  return snapshot.map((entry) => ({
    id: `turn-snapshot:${entry.alias}`,
    type: entry.entityType,
    value: entry.original,
    alias: entry.alias,
    scope: 'global',
    source: 'user',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }));
}

function validateExternalAIChatInput(value: unknown): ExternalAIChatInput {
  if (typeof value !== 'object' || value === null) {
    throw new Error('External AI 요청 형식이 올바르지 않습니다.');
  }

  const input = value as Partial<ExternalAIChatInput>;
  const allowedKeys = new Set([
    'workspaceId',
    'mode',
    'externalText',
    'documents',
    'maskingSnapshot',
    'approved',
  ]);

  if (
    !Object.keys(value).every((key) => allowedKeys.has(key)) ||
    typeof input.workspaceId !== 'string' ||
    !input.workspaceId.trim() ||
    (input.mode !== 'auto' && input.mode !== 'external') ||
    typeof input.externalText !== 'string' ||
    !input.externalText.trim() ||
    !Array.isArray(input.documents) ||
    !input.documents.every(isExternalDocumentMetadata) ||
    !Array.isArray(input.maskingSnapshot) ||
    !input.maskingSnapshot.every(isResponseUnmaskingSnapshotEntry) ||
    typeof input.approved !== 'boolean'
  ) {
    throw new Error('External AI 요청 형식이 올바르지 않습니다.');
  }

  return {
    workspaceId: input.workspaceId.trim(),
    mode: input.mode,
    externalText: input.externalText,
    documents: input.documents.map((document) => ({ ...document })),
    maskingSnapshot: input.maskingSnapshot.map((entry) => ({ ...entry })),
    approved: input.approved,
  };
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
          buildLocalAIChatRequest(input, { model: settings.localAI.model });
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
              ragContextCount: diagnostics.ragDocumentCount,
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
    'vaultFiles:validateDocumentIds',
    async (): Promise<MimoraIpcResult<DocumentIdValidationSummary>> =>
      toIpcResult(() => vaultFilesService.validateDocumentIds()),
  );

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
    ): Promise<MimoraIpcResult<AutoRetrievedContext[]>> => {
      logArchivedRetrievalIpcInput(input);
      return toIpcResult(() => vaultFilesService.retrieveAutoContext(input));
    },
  );
}

function registerDerivedKnowledgeHandlers(): void {
  ipcMain.handle(
    'derivedKnowledge:suggestDocumentId',
    async (
      _event,
      generatedAt?: string | null,
    ): Promise<MimoraIpcResult<SuggestedDocumentIdResult>> =>
      toIpcResult(() =>
        derivedKnowledgeService.suggestDocumentId(generatedAt),
      ),
  );

  ipcMain.handle(
    'derivedKnowledge:saveDraft',
    async (
      _event,
      input: SaveDerivedKnowledgeInput,
    ): Promise<MimoraIpcResult<SaveDerivedKnowledgeResult>> =>
      toIpcResult(() =>
        derivedKnowledgeService.saveDerivedKnowledgeDraft(input),
      ),
  );
}

async function openValidatedExternalLink(
  url: string,
  source: 'markdown' | 'window-open' | 'will-navigate',
): Promise<boolean> {
  const decision = validateExternalLinkUrl(url);

  if (!decision.allowed) {
    console.warn('[Mimora External Link] Blocked.', {
      source,
      reason: decision.reason,
      protocol: decision.protocol ?? null,
    });

    return false;
  }

  await shell.openExternal(decision.normalizedUrl);

  console.info('[Mimora External Link] Opened.', {
    source,
    protocol: decision.protocol,
  });

  return true;
}

function openValidatedExternalLinkInBackground(
  url: string,
  source: 'window-open' | 'will-navigate',
): void {
  void openValidatedExternalLink(url, source).catch((error: unknown) => {
    console.warn('[Mimora External Link] Open failed.', {
      source,
      error: getErrorMessage(error),
    });
  });
}

function isAppNavigationUrl(navigationUrl: string): boolean {
  try {
    const parsed = new URL(navigationUrl);

    if (devServerUrl) {
      return parsed.origin === new URL(devServerUrl).origin;
    }

    if (parsed.protocol !== 'file:') {
      return false;
    }

    const appDistPath = path.resolve(__dirname, '../dist');
    const targetPath = path.resolve(fileURLToPath(parsed));

    return (
      targetPath === appDistPath ||
      targetPath.startsWith(`${appDistPath}${path.sep}`)
    );
  } catch {
    return false;
  }
}

function registerExternalLinkHandlers(): void {
  ipcMain.handle(
    'externalLink:open',
    async (_event, url: unknown): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        if (typeof url !== 'string') {
          throw new Error('External link URL must be a string.');
        }

        const opened = await openValidatedExternalLink(url, 'markdown');

        if (!opened) {
          throw new Error('Blocked external link protocol.');
        }

        return true;
      }),
  );
}

function createMainWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Mimora',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  console.info('[Mimora Window] created', {
    devServerUrl: devServerUrl ?? null,
    preloadPath,
    preloadExists: existsSync(preloadPath),
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl) => {
      console.error('[Mimora Window] did-fail-load', {
        errorCode,
        errorDescription,
        validatedUrl,
      });
    },
  );

  function inspectRenderer(label: string): void {
    void mainWindow.webContents
      .executeJavaScript(
        `(() => {
          const root = document.getElementById("root");
          const firstChild = root?.firstElementChild ?? null;
          const rootStyle = root ? getComputedStyle(root) : null;
          const firstStyle = firstChild ? getComputedStyle(firstChild) : null;
          const rootRect = root?.getBoundingClientRect();
          const firstRect = firstChild?.getBoundingClientRect();

          return {
            url: location.href,
            title: document.title,
            hasMimora: !!window.mimora,
            mimoraKeys: window.mimora ? Object.keys(window.mimora).slice(0, 12) : [],
            bodyText: document.body.innerText.slice(0, 500),
            rootChildren: root?.childElementCount ?? null,
            rootClass: root?.className ?? null,
            rootDisplay: rootStyle?.display ?? null,
            rootVisibility: rootStyle?.visibility ?? null,
            rootOpacity: rootStyle?.opacity ?? null,
            rootSize: rootRect
              ? { width: Math.round(rootRect.width), height: Math.round(rootRect.height) }
              : null,
            firstTag: firstChild?.tagName ?? null,
            firstClass: firstChild?.className ?? null,
            firstDisplay: firstStyle?.display ?? null,
            firstVisibility: firstStyle?.visibility ?? null,
            firstOpacity: firstStyle?.opacity ?? null,
            firstSize: firstRect
              ? { width: Math.round(firstRect.width), height: Math.round(firstRect.height) }
              : null,
          };
        })()`,
      )
      .then((state) => {
        console.info(`[Mimora Window] ${label}`, state);
      })
      .catch((error: unknown) => {
        console.error(`[Mimora Window] ${label} inspect failed`, error);
      });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (!devServerUrl) {
      console.info('[Mimora Window] did-finish-load', {
        url: mainWindow.webContents.getURL(),
        title: mainWindow.getTitle(),
      });
      return;
    }

    inspectRenderer('did-finish-load');
    setTimeout(() => {
      inspectRenderer('post-load');
    }, 1000);
  });

  mainWindow.webContents.on(
    'render-process-gone',
    (_event, details) => {
      console.error('[Mimora Window] render-process-gone', details);
    },
  );

  mainWindow.on('unresponsive', () => {
    console.error('[Mimora Window] unresponsive');
  });

  mainWindow.webContents.on(
    'console-message',
    (event) => {
      const details = event as unknown as {
        level?: 'debug' | 'error' | 'info' | 'warning';
        message?: string;
        lineNumber?: number;
        sourceId?: string;
        stack?: string;
        frame?: {
          url?: string;
          routingId?: number;
          processId?: number;
        };
      };
      const level = details.level ?? 'info';

      if (!devServerUrl && level !== 'error' && level !== 'warning') {
        return;
      }

      console.info('[Mimora Renderer Console]', {
        level,
        message: details.message,
        line: details.lineNumber,
        sourceId: details.sourceId,
        stack: details.stack ?? null,
        frame: details.frame
          ? {
              url: details.frame.url ?? null,
              routingId: details.frame.routingId ?? null,
              processId: details.frame.processId ?? null,
            }
          : null,
      });
    },
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openValidatedExternalLinkInBackground(url, 'window-open');
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isAppNavigationUrl(navigationUrl)) {
      return;
    }

    event.preventDefault();
    openValidatedExternalLinkInBackground(navigationUrl, 'will-navigate');
  });

  if (devServerUrl) {
    console.info('[Mimora Window] loadURL', devServerUrl);
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  const indexPath = path.join(__dirname, '../dist/index.html');
  console.info('[Mimora Window] loadFile', indexPath);
  void mainWindow.loadFile(indexPath);
}

registerSettingsHandlers();
registerRegistryHandlers();
registerRagHandlers();
registerScheduleHandlers();
registerIssueHandlers();
registerWeeklyReportHandlers();
registerChatHistoryHandlers();
registerWorkspaceInsightHandlers();
registerVaultFileHandlers();
registerDerivedKnowledgeHandlers();
registerLocalAIHandlers();
registerOpenAIHandlers();
registerExternalLinkHandlers();

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
