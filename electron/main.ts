import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from 'electron';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  ConnectionTestResult,
  LLMModel,
} from '../src/localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
  ExternalAISettings,
} from '../src/externalAI';
import type {
  LocalAIChatResult,
  OllamaPerformanceMetrics,
  OllamaResponsePerformance,
} from '../src/llmChat';
import {
  evaluateSecurity,
  type AIMode,
} from '../src/security/securityRouter';
import {
  allWorkspaceId,
  type WorkspaceType,
} from '../src/workspaces';
import {
  authorizeExternalSend,
  evaluateOutboundPayload,
  type OutboundPayloadDocumentMetadata,
} from '../src/security/outboundPayloadSafety';
import type {
  AddMaskingEntryInput,
  UpdateMaskingEntryInput,
} from '../src/security/maskingEngine';
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
} from '../src/derivedKnowledge';
import { createChatHistoryStore } from './chatHistoryStore';
import { createSettingsStore } from './settingsStore';
import { createRegistryStatusService } from './registryStatus';
import { createVaultFilesService } from './vaultFiles';
import { createDerivedKnowledgeService } from './derivedKnowledgeService';
import { createLLMProvider } from './llm/createLLMProvider';
import { OpenAIProvider } from './llm/OpenAIProvider';
import { buildLocalAIChatRequest } from './llm/promptBuilder';
import { createOpenAICredentialStore } from './openAICredentialStore';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchResult,
} from '../src/vaultFiles';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const settingsFileName = 'mimora-settings.json';
const openAICredentialFileName = 'openai-api-key.safe';
const chatHistoryFileName = 'chat-history.dat';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), settingsFileName);
}

const settingsStore = createSettingsStore({
  getSettingsPath,
});
const openAICredentialStore = createOpenAICredentialStore({
  getCredentialPath: () =>
    path.join(app.getPath('userData'), openAICredentialFileName),
  safeStorage,
});
const chatHistoryStore = createChatHistoryStore({
  getHistoryPath: () => path.join(app.getPath('userData'), chatHistoryFileName),
  safeStorage,
});
const vaultFilesService = createVaultFilesService(settingsStore);
const derivedKnowledgeService = createDerivedKnowledgeService(settingsStore);
const registryStatusService = createRegistryStatusService(settingsStore);

async function getWorkspaceTypeForRequest(
  workspaceId: string,
): Promise<WorkspaceType> {
  if (workspaceId === allWorkspaceId) {
    return 'all';
  }

  const registry = await registryStatusService.loadWorkspaceRegistry();
  const workspace = registry.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error('External AI 요청의 Workspace를 확인할 수 없습니다.');
  }

  return workspace.type;
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

function registerOpenAIHandlers(): void {
  ipcMain.handle(
    'openAI:hasApiKey',
    async (): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(() => openAICredentialStore.hasApiKey()),
  );

  ipcMain.handle(
    'openAI:saveApiKey',
    async (_event, apiKey: unknown): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await openAICredentialStore.saveApiKey(apiKey);
        return true;
      }),
  );

  ipcMain.handle(
    'openAI:deleteApiKey',
    async (): Promise<MimoraIpcResult<boolean>> =>
      toIpcResult(async () => {
        await openAICredentialStore.deleteApiKey();
        return false;
      }),
  );

  ipcMain.handle(
    'openAI:listModels',
    async (): Promise<MimoraIpcResult<LLMModel[]>> =>
      toIpcResult(async () => {
        const apiKey = await openAICredentialStore.readApiKeyForMainProcess();
        return new OpenAIProvider(apiKey).listModels();
      }),
  );

  ipcMain.handle(
    'openAI:testConnection',
    async (): Promise<MimoraIpcResult<ConnectionTestResult>> =>
      toIpcResult(async () => {
        const startedAt = performance.now();
        let result: ConnectionTestResult;

        try {
          const apiKey = await openAICredentialStore.readApiKeyForMainProcess();
          result = await new OpenAIProvider(apiKey).testConnection();
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
        const workspaceType = await getWorkspaceTypeForRequest(input.workspaceId);

        const effectiveSecurity = evaluateSecurity(
          workspaceType,
          input.documents.map((document) => ({
            vaultId: document.documentId,
            relativePath: document.relativePath,
            vaultType: document.vaultType,
            security: document.security,
          })),
        ).security;
        const secretDetection = detectSecrets(
          input.externalText,
          getSecretRules(settings.secretDetection.customRules),
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
              maskingEntries: settings.masking.entries,
              effectiveSecurity,
            });
        const model = settings.externalAI.model;
        const authorization = authorizeExternalSend({
          status: safety.status,
          mode: input.mode,
          approved: input.approved,
        });
        let status: 'success' | 'failure' = 'failure';

        try {
          if (!authorization.allowed) {
            throw new Error(authorization.message);
          }

          if (!model) {
            throw new Error(
              'OpenAI 모델이 선택되지 않았습니다. Settings에서 모델을 선택하세요.',
            );
          }

          let apiKey: string;

          try {
            apiKey = await openAICredentialStore.readApiKeyForMainProcess();
          } catch {
            throw new Error(
              'OpenAI API Key가 설정되지 않았습니다. Settings에서 API Key를 저장하세요.',
            );
          }

          const response = await new OpenAIProvider(apiKey).chat({
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
              openAIRoundTripMs,
              payloadChars: input.externalText.length,
              documentCount: input.documents.length,
              responseChars: response.content.length,
              requestStartedAt: requestStartedAt.toISOString(),
              responseCompletedAt: responseCompletedAt.toISOString(),
            },
          };
        } finally {
          console.info('[Mimora External Request]', {
            workspace: input.workspaceId,
            mode: input.mode,
            safety: safety.status,
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
    typeof document.relativePath === 'string' &&
    typeof document.fileName === 'string' &&
    (document.metadata === undefined ||
      (typeof document.metadata === 'object' &&
        document.metadata !== null &&
        !Array.isArray(document.metadata)))
  );
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
    typeof input.approved !== 'boolean'
  ) {
    throw new Error('External AI 요청 형식이 올바르지 않습니다.');
  }

  return {
    workspaceId: input.workspaceId.trim(),
    mode: input.mode,
    externalText: input.externalText,
    documents: input.documents.map((document) => ({ ...document })),
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
    ): Promise<MimoraIpcResult<AutoRetrievedContext[]>> => {
      logArchivedRetrievalIpcInput(input);
      return toIpcResult(() => vaultFilesService.retrieveAutoContext(input));
    },
  );
}

function registerDerivedKnowledgeHandlers(): void {
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
registerRegistryHandlers();
registerChatHistoryHandlers();
registerVaultFileHandlers();
registerDerivedKnowledgeHandlers();
registerLocalAIHandlers();
registerOpenAIHandlers();

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
