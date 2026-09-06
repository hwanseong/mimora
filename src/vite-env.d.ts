/// <reference types="vite/client" />

import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from './autoContext';
import type {
  ChatHistoryLoadResult,
  ChatHistorySaveResult,
  PersistedChatHistory,
} from './chatHistory';
import type {
  ConnectionTestResult,
  LLMModel,
  LocalAIConnectionInput,
  LocalAISettings,
} from './localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
  ExternalAISettings,
} from './externalAI';
import type { LocalAIChatInput, LocalAIChatResult } from './llmChat';
import type { AIMode } from './security/securityRouter';
import type {
  AddMaskingEntryInput,
  UpdateMaskingEntryInput,
} from './security/maskingEngine';
import type {
  AddSecretRuleInput,
  UpdateSecretRuleInput,
} from './security/secretDetector';
import type {
  AddVaultInput,
  MimoraSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from './settings';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from './vaultFiles';

type MimoraApi = {
    appName: string;
    loadChatHistory: () => Promise<ChatHistoryLoadResult>;
    saveChatHistory: (
      history: PersistedChatHistory,
    ) => Promise<ChatHistorySaveResult>;
    deleteWorkspaceChat: (
      workspaceId: string,
    ) => Promise<ChatHistorySaveResult>;
    getSettings: () => Promise<MimoraSettings>;
    addVault: (input: AddVaultInput) => Promise<MimoraSettings>;
    updateVault: (input: UpdateVaultInput) => Promise<MimoraSettings>;
    deleteVault: (id: string) => Promise<MimoraSettings>;
    updateLocalAISettings: (
      input: LocalAISettings,
    ) => Promise<MimoraSettings>;
    getExternalAISettings: () => Promise<ExternalAISettings>;
    updateExternalAISettings: (
      input: ExternalAISettings,
    ) => Promise<MimoraSettings>;
    hasOpenAIApiKey: () => Promise<boolean>;
    saveOpenAIApiKey: (apiKey: string) => Promise<boolean>;
    deleteOpenAIApiKey: () => Promise<boolean>;
    listOpenAIModels: () => Promise<LLMModel[]>;
    testOpenAIConnection: () => Promise<ConnectionTestResult>;
    chatWithOpenAI: (
      input: ExternalAIChatInput,
    ) => Promise<ExternalAIChatResult>;
    updateAIMode: (aiMode: AIMode) => Promise<MimoraSettings>;
    addMaskingEntry: (
      input: AddMaskingEntryInput,
    ) => Promise<MimoraSettings>;
    updateMaskingEntry: (
      input: UpdateMaskingEntryInput,
    ) => Promise<MimoraSettings>;
    deleteMaskingEntry: (id: string) => Promise<MimoraSettings>;
    addSecretRule: (
      input: AddSecretRuleInput,
    ) => Promise<MimoraSettings>;
    updateSecretRule: (
      input: UpdateSecretRuleInput,
    ) => Promise<MimoraSettings>;
    deleteSecretRule: (id: string) => Promise<MimoraSettings>;
    listLocalAIModels: (
      input: LocalAIConnectionInput,
    ) => Promise<LLMModel[]>;
    testLocalAIConnection: (
      input: LocalAIConnectionInput,
    ) => Promise<ConnectionTestResult>;
    chatWithLocalAI: (
      input: LocalAIChatInput,
    ) => Promise<LocalAIChatResult>;
    selectVaultDirectory: () => Promise<VaultDirectorySelection | null>;
    listVaultFiles: (vaultId: string) => Promise<VaultFile[]>;
    readVaultFile: (
      vaultId: string,
      relativePath: string,
    ) => Promise<VaultFileContent>;
    searchVaultFiles: (input: VaultSearchInput) => Promise<VaultSearchResult[]>;
    retrieveAutoContext: (
      input: AutoContextRetrievalInput,
    ) => Promise<AutoRetrievedContext[]>;
};

declare global {
  interface Window {
    mimora: MimoraApi;
  }
}

export {};
