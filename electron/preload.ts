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
} from '../src/derivedKnowledge';
import type {
  ConnectionTestResult,
  LLMModel,
  LocalAIConnectionInput,
  LocalAISettings,
} from '../src/localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
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

function unwrapIpcResult<T>(result: MimoraIpcResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error(result.error);
}

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
  saveDerivedKnowledgeDraft: (input: SaveDerivedKnowledgeInput) =>
    (
      ipcRenderer.invoke('derivedKnowledge:saveDraft', input) as Promise<
        MimoraIpcResult<SaveDerivedKnowledgeResult>
      >
    ).then(unwrapIpcResult),
});
