import { contextBridge, ipcRenderer } from 'electron';
import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from '../src/autoContext';
import type {
  ChatHistoryLoadResult,
  ChatHistorySaveResult,
  PersistedChatHistory,
} from '../src/chatHistory';
import type {
  SaveDerivedKnowledgeInput,
  SaveDerivedKnowledgeResult,
  SuggestedDocumentIdResult,
} from '../src/derivedKnowledge';
import type {
  RagDeleteResult,
  RagDocument,
  RagEmbeddingStatus,
  RagEmbeddingStatusInput,
  RagFileSelection,
  RagFileSelectionPurpose,
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
import type {
  ConnectionTestResult,
  LLMModel,
  LocalAIConnectionInput,
  LocalAISettings,
} from '../src/localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
  ExternalChatProviderId,
  ExternalAISettings,
} from '../src/externalAI';
import type {
  LocalAIChatInput,
  LocalAIChatResult,
} from '../src/llmChat';
import type {
  AddVaultInput,
  MimoraIpcResult,
  MimoraSettings,
  SearchScopeSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from '../src/settings';
import type { AIMode } from '../src/security/securityRouter';
import type {
  AddMaskingEntryInput,
  UpdateMaskingEntryInput,
} from '../src/security/maskingEngine';
import type {
  AddSecretRuleInput,
  UpdateSecretRuleInput,
} from '../src/security/secretDetector';
import type { RegistryStatus } from '../src/registry/types';
import type { KnowledgeDomainRegistryParseResult } from '../src/registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistryParseResult } from '../src/registry/knowledgeTypeRegistryTypes';
import type { WorkspaceRegistryParseResult } from '../src/registry/workspaceRegistryTypes';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from '../src/vaultFiles';
import type { DocumentIdValidationSummary } from '../src/documentIdValidation';
import type {
  WorkspaceInsightSnapshot,
  WorkspaceInsightStoreLoadResult,
  WorkspaceInsightStoreSaveResult,
} from '../src/workspaceInsight';

function unwrapIpcResult<T>(result: MimoraIpcResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error(result.error);
}

function writePreloadBootMarker(message: string): void {
  const marker = document.getElementById('mimora-boot-diagnostics');

  if (!marker) {
    return;
  }

  const line = document.createElement('span');
  line.textContent = message;
  marker.appendChild(line);
}

console.info('[Mimora Preload] loaded');
window.addEventListener('DOMContentLoaded', () => {
  writePreloadBootMarker('preload: loaded');
});

contextBridge.exposeInMainWorld('mimora', {
  appName: 'Mimora',
  loadChatHistory: () =>
    (
      ipcRenderer.invoke('chatHistory:load') as Promise<
        MimoraIpcResult<ChatHistoryLoadResult>
      >
    ).then(unwrapIpcResult),
  saveChatHistory: (history: PersistedChatHistory) =>
    (
      ipcRenderer.invoke('chatHistory:save', history) as Promise<
        MimoraIpcResult<ChatHistorySaveResult>
      >
    ).then(unwrapIpcResult),
  deleteWorkspaceChat: (workspaceId: string) =>
    (
      ipcRenderer.invoke(
        'chatHistory:deleteWorkspace',
        workspaceId,
      ) as Promise<MimoraIpcResult<ChatHistorySaveResult>>
    ).then(unwrapIpcResult),
  loadWorkspaceInsights: () =>
    (
      ipcRenderer.invoke('workspaceInsights:load') as Promise<
        MimoraIpcResult<WorkspaceInsightStoreLoadResult>
      >
    ).then(unwrapIpcResult),
  saveWorkspaceInsight: (snapshot: WorkspaceInsightSnapshot) =>
    (
      ipcRenderer.invoke('workspaceInsights:save', snapshot) as Promise<
        MimoraIpcResult<WorkspaceInsightStoreSaveResult>
      >
    ).then(unwrapIpcResult),
  getSettings: () =>
    (
      ipcRenderer.invoke('settings:get') as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  addVault: (input: AddVaultInput) =>
    (
      ipcRenderer.invoke('settings:addVault', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateVault: (input: UpdateVaultInput) =>
    (
      ipcRenderer.invoke('settings:updateVault', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  deleteVault: (id: string) =>
    (
      ipcRenderer.invoke('settings:deleteVault', id) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  selectVaultDirectory: () =>
    ipcRenderer.invoke(
      'settings:selectVaultDirectory',
    ) as Promise<VaultDirectorySelection | null>,
  listVaultFiles: (vaultId: string) =>
    (
      ipcRenderer.invoke('vaultFiles:list', vaultId) as Promise<
        MimoraIpcResult<VaultFile[]>
      >
    ).then(unwrapIpcResult),
  validateDocumentIds: () =>
    (
      ipcRenderer.invoke('vaultFiles:validateDocumentIds') as Promise<
        MimoraIpcResult<DocumentIdValidationSummary>
      >
    ).then(unwrapIpcResult),
  updateLocalAISettings: (input: LocalAISettings) =>
    (
      ipcRenderer.invoke('settings:updateLocalAI', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  getExternalAISettings: () =>
    (
      ipcRenderer.invoke('settings:getExternalAI') as Promise<
        MimoraIpcResult<ExternalAISettings>
      >
    ).then(unwrapIpcResult),
  updateExternalAISettings: (input: ExternalAISettings) =>
    (
      ipcRenderer.invoke('settings:updateExternalAI', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateRagSettings: (input: RagSettings) =>
    (
      ipcRenderer.invoke('settings:updateRag', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  hasExternalCredential: (providerId: ExternalChatProviderId) =>
    (
      ipcRenderer.invoke('externalAI:hasCredential', providerId) as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
  saveExternalCredential: (
    providerId: ExternalChatProviderId,
    apiKey: string,
  ) =>
    (
      ipcRenderer.invoke(
        'externalAI:saveCredential',
        providerId,
        apiKey,
      ) as Promise<MimoraIpcResult<boolean>>
    ).then(unwrapIpcResult),
  deleteExternalCredential: (providerId: ExternalChatProviderId) =>
    (
      ipcRenderer.invoke('externalAI:deleteCredential', providerId) as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
  listExternalAIModels: (providerId: ExternalChatProviderId) =>
    (
      ipcRenderer.invoke('externalAI:listModels', providerId) as Promise<
        MimoraIpcResult<LLMModel[]>
      >
    ).then(unwrapIpcResult),
  testExternalAIConnection: (providerId: ExternalChatProviderId) =>
    (
      ipcRenderer.invoke('externalAI:testConnection', providerId) as Promise<
        MimoraIpcResult<ConnectionTestResult>
      >
    ).then(unwrapIpcResult),
  chatWithExternalAI: (input: ExternalAIChatInput) =>
    (
      ipcRenderer.invoke('externalAI:chat', input) as Promise<
        MimoraIpcResult<ExternalAIChatResult>
      >
    ).then(unwrapIpcResult),
  hasOpenAIApiKey: () =>
    (
      ipcRenderer.invoke('openAI:hasApiKey') as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
  saveOpenAIApiKey: (apiKey: string) =>
    (
      ipcRenderer.invoke('openAI:saveApiKey', apiKey) as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
  deleteOpenAIApiKey: () =>
    (
      ipcRenderer.invoke('openAI:deleteApiKey') as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
  listOpenAIModels: () =>
    (
      ipcRenderer.invoke('openAI:listModels') as Promise<
        MimoraIpcResult<LLMModel[]>
      >
    ).then(unwrapIpcResult),
  testOpenAIConnection: () =>
    (
      ipcRenderer.invoke('openAI:testConnection') as Promise<
        MimoraIpcResult<ConnectionTestResult>
      >
    ).then(unwrapIpcResult),
  chatWithOpenAI: (input: ExternalAIChatInput) =>
    (
      ipcRenderer.invoke('openAI:chat', input) as Promise<
        MimoraIpcResult<ExternalAIChatResult>
      >
    ).then(unwrapIpcResult),
  updateAIMode: (aiMode: AIMode) =>
    (
      ipcRenderer.invoke('settings:updateAIMode', aiMode) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateSearchScope: (input: SearchScopeSettings) =>
    (
      ipcRenderer.invoke('settings:updateSearchScope', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateRegistryHomeVault: (homeVaultId: string | null) =>
    (
      ipcRenderer.invoke('settings:updateRegistryHomeVault', homeVaultId) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  getRegistryStatus: () =>
    (
      ipcRenderer.invoke('registry:getStatus') as Promise<
        MimoraIpcResult<RegistryStatus>
      >
    ).then(unwrapIpcResult),
  loadWorkspaceRegistry: () =>
    (
      ipcRenderer.invoke('registry:loadWorkspaces') as Promise<
        MimoraIpcResult<WorkspaceRegistryParseResult>
      >
    ).then(unwrapIpcResult),
  loadKnowledgeDomainRegistry: () =>
    (
      ipcRenderer.invoke('registry:loadKnowledgeDomains') as Promise<
        MimoraIpcResult<KnowledgeDomainRegistryParseResult>
      >
    ).then(unwrapIpcResult),
  loadKnowledgeTypeRegistry: () =>
    (
      ipcRenderer.invoke('registry:loadKnowledgeTypes') as Promise<
        MimoraIpcResult<KnowledgeTypeRegistryParseResult>
      >
    ).then(unwrapIpcResult),
  getRagPythonStatus: () =>
    (
      ipcRenderer.invoke('rag:getPythonStatus') as Promise<
        MimoraIpcResult<RagPythonStatus>
      >
    ).then(unwrapIpcResult),
  getRagStorageRoot: () =>
    (
      ipcRenderer.invoke('rag:getStorageRoot') as Promise<
        MimoraIpcResult<string>
      >
    ).then(unwrapIpcResult),
  selectRagDocumentFile: (purpose: RagFileSelectionPurpose) =>
    ipcRenderer.invoke(
      'rag:selectDocumentFile',
      purpose,
    ) as Promise<RagFileSelection | null>,
  listRagDocuments: () =>
    (
      ipcRenderer.invoke('rag:listDocuments') as Promise<
        MimoraIpcResult<RagDocument[]>
      >
    ).then(unwrapIpcResult),
  importRagDocument: (input: RagImportInput) =>
    (
      ipcRenderer.invoke('rag:importDocument', input) as Promise<
        MimoraIpcResult<RagImportResult>
      >
    ).then(unwrapIpcResult),
  deleteRagDocument: (ragDocumentId: string) =>
    (
      ipcRenderer.invoke('rag:deleteDocument', ragDocumentId) as Promise<
        MimoraIpcResult<RagDeleteResult>
      >
    ).then(unwrapIpcResult),
  replaceRagDocument: (input: RagReplaceInput) =>
    (
      ipcRenderer.invoke('rag:replaceDocument', input) as Promise<
        MimoraIpcResult<RagReplaceResult>
      >
    ).then(unwrapIpcResult),
  indexRagDocument: (input: RagIndexInput) =>
    (
      ipcRenderer.invoke('rag:indexDocument', input) as Promise<
        MimoraIpcResult<RagIndexResult>
      >
    ).then(unwrapIpcResult),
  searchRagDocuments: (input: RagSearchInput) =>
    (
      ipcRenderer.invoke('rag:search', input) as Promise<
        MimoraIpcResult<RagSearchResult[]>
      >
    ).then(unwrapIpcResult),
  checkRagEmbeddingStatus: (input: RagEmbeddingStatusInput) =>
    (
      ipcRenderer.invoke('rag:checkEmbeddingStatus', input) as Promise<
        MimoraIpcResult<RagEmbeddingStatus>
      >
    ).then(unwrapIpcResult),
  getScheduleStorageRoot: () =>
    (
      ipcRenderer.invoke('schedule:getStorageRoot') as Promise<
        MimoraIpcResult<string>
      >
    ).then(unwrapIpcResult),
  selectScheduleSourceFile: () =>
    ipcRenderer.invoke(
      'schedule:selectSourceFile',
    ) as Promise<ScheduleFileSelection | null>,
  registerScheduleSource: (input: ScheduleRegisterInput) =>
    (
      ipcRenderer.invoke('schedule:registerSource', input) as Promise<
        MimoraIpcResult<ScheduleSource>
      >
    ).then(unwrapIpcResult),
  getScheduleSource: (workspaceId: string) =>
    (
      ipcRenderer.invoke('schedule:getSource', workspaceId) as Promise<
        MimoraIpcResult<ScheduleSource | null>
      >
    ).then(unwrapIpcResult),
  removeScheduleSource: (workspaceId: string) =>
    (
      ipcRenderer.invoke('schedule:removeSource', workspaceId) as Promise<
        MimoraIpcResult<ScheduleRemoveResult>
      >
    ).then(unwrapIpcResult),
  refreshSchedule: (
    workspaceId: string,
    options?: ScheduleRefreshOptions,
  ) =>
    (
      ipcRenderer.invoke('schedule:refresh', workspaceId, options) as Promise<
        MimoraIpcResult<ScheduleParseResult>
      >
    ).then(unwrapIpcResult),
  getScheduleSummary: (workspaceId: string) =>
    (
      ipcRenderer.invoke('schedule:getSummary', workspaceId) as Promise<
        MimoraIpcResult<ScheduleSummary>
      >
    ).then(unwrapIpcResult),
  querySchedule: (input: ScheduleQueryInput) =>
    (
      ipcRenderer.invoke('schedule:query', input) as Promise<
        MimoraIpcResult<ScheduleQueryResult>
      >
    ).then(unwrapIpcResult),
  getIssueStorageRoot: () =>
    (
      ipcRenderer.invoke('issue:getStorageRoot') as Promise<
        MimoraIpcResult<string>
      >
    ).then(unwrapIpcResult),
  selectIssueSourceFile: () =>
    ipcRenderer.invoke(
      'issue:selectSourceFile',
    ) as Promise<IssueFileSelection | null>,
  registerIssueDocument: (input: IssueRegisterInput) =>
    (
      ipcRenderer.invoke('issue:registerDocument', input) as Promise<
        MimoraIpcResult<IssueDocument>
      >
    ).then(unwrapIpcResult),
  getIssueDocument: (workspaceId: string) =>
    (
      ipcRenderer.invoke('issue:getDocument', workspaceId) as Promise<
        MimoraIpcResult<IssueDocument | null>
      >
    ).then(unwrapIpcResult),
  removeIssueDocument: (workspaceId: string) =>
    (
      ipcRenderer.invoke('issue:removeDocument', workspaceId) as Promise<
        MimoraIpcResult<IssueRemoveResult>
      >
    ).then(unwrapIpcResult),
  refreshIssueDocument: (
    workspaceId: string,
    options?: IssueRefreshOptions,
  ) =>
    (
      ipcRenderer.invoke('issue:refresh', workspaceId, options) as Promise<
        MimoraIpcResult<IssueParseResult>
      >
    ).then(unwrapIpcResult),
  getIssueSummary: (workspaceId: string) =>
    (
      ipcRenderer.invoke('issue:getSummary', workspaceId) as Promise<
        MimoraIpcResult<IssueSummary>
      >
    ).then(unwrapIpcResult),
  queryIssues: (input: IssueQueryInput) =>
    (
      ipcRenderer.invoke('issue:query', input) as Promise<
        MimoraIpcResult<IssueQueryResult>
      >
    ).then(unwrapIpcResult),
  getWeeklyReportStorageRoot: () =>
    (
      ipcRenderer.invoke('weeklyReport:getStorageRoot') as Promise<
        MimoraIpcResult<string>
      >
    ).then(unwrapIpcResult),
  renderWeeklyReport: (input: WeeklyReportRenderInput) =>
    (
      ipcRenderer.invoke('weeklyReport:render', input) as Promise<
        MimoraIpcResult<WeeklyReportRenderResult>
      >
    ).then(unwrapIpcResult),
  addMaskingEntry: (input: AddMaskingEntryInput) =>
    (
      ipcRenderer.invoke('settings:addMaskingEntry', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateMaskingEntry: (input: UpdateMaskingEntryInput) =>
    (
      ipcRenderer.invoke('settings:updateMaskingEntry', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  deleteMaskingEntry: (id: string) =>
    (
      ipcRenderer.invoke('settings:deleteMaskingEntry', id) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  addSecretRule: (input: AddSecretRuleInput) =>
    (
      ipcRenderer.invoke('settings:addSecretRule', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  updateSecretRule: (input: UpdateSecretRuleInput) =>
    (
      ipcRenderer.invoke('settings:updateSecretRule', input) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  deleteSecretRule: (id: string) =>
    (
      ipcRenderer.invoke('settings:deleteSecretRule', id) as Promise<
        MimoraIpcResult<MimoraSettings>
      >
    ).then(unwrapIpcResult),
  listLocalAIModels: (input: LocalAIConnectionInput) =>
    (
      ipcRenderer.invoke('localAI:listModels', input) as Promise<
        MimoraIpcResult<LLMModel[]>
      >
    ).then(unwrapIpcResult),
  testLocalAIConnection: (input: LocalAIConnectionInput) =>
    (
      ipcRenderer.invoke('localAI:testConnection', input) as Promise<
        MimoraIpcResult<ConnectionTestResult>
      >
    ).then(unwrapIpcResult),
  chatWithLocalAI: (input: LocalAIChatInput) =>
    (
      ipcRenderer.invoke('localAI:chat', input) as Promise<
        MimoraIpcResult<LocalAIChatResult>
      >
    ).then(unwrapIpcResult),
  readVaultFile: (vaultId: string, relativePath: string) =>
    (
      ipcRenderer.invoke(
        'vaultFiles:read',
        vaultId,
        relativePath,
      ) as Promise<MimoraIpcResult<VaultFileContent>>
    ).then(unwrapIpcResult),
  searchVaultFiles: (input: VaultSearchInput) =>
    (
      ipcRenderer.invoke('vaultFiles:search', input) as Promise<
        MimoraIpcResult<VaultSearchResult[]>
      >
    ).then(unwrapIpcResult),
  retrieveAutoContext: (input: AutoContextRetrievalInput) =>
    (
      ipcRenderer.invoke('vaultFiles:retrieveAutoContext', input) as Promise<
        MimoraIpcResult<AutoRetrievedContext[]>
      >
    ).then(unwrapIpcResult),
  suggestDerivedKnowledgeDocumentId: (generatedAt?: string | null) =>
    (
      ipcRenderer.invoke(
        'derivedKnowledge:suggestDocumentId',
        generatedAt,
      ) as Promise<MimoraIpcResult<SuggestedDocumentIdResult>>
    ).then(unwrapIpcResult),
  saveDerivedKnowledgeDraft: (input: SaveDerivedKnowledgeInput) =>
    (
      ipcRenderer.invoke('derivedKnowledge:saveDraft', input) as Promise<
        MimoraIpcResult<SaveDerivedKnowledgeResult>
      >
    ).then(unwrapIpcResult),
  openExternalLink: (url: string) =>
    (
      ipcRenderer.invoke('externalLink:open', url) as Promise<
        MimoraIpcResult<boolean>
      >
    ).then(unwrapIpcResult),
});

console.info('[Mimora Preload] contextBridge exposed: window.mimora');
window.addEventListener('DOMContentLoaded', () => {
  writePreloadBootMarker('preload: contextBridge exposed window.mimora');
});
