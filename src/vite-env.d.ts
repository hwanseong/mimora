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
  SaveDerivedKnowledgeInput,
  SaveDerivedKnowledgeResult,
  SuggestedDocumentIdResult,
} from './derivedKnowledge';
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
} from './rag';
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
} from './schedule';
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
} from './issue';
import type {
  WeeklyReportRenderInput,
  WeeklyReportRenderResult,
} from './weeklyReport';
import type {
  ConnectionTestResult,
  LLMModel,
  LocalAIConnectionInput,
  LocalAISettings,
} from './localAI';
import type {
  ExternalAIChatInput,
  ExternalAIChatResult,
  ExternalChatProviderId,
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
import type { RegistryStatus } from './registry/types';
import type { KnowledgeDomainRegistryParseResult } from './registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistryParseResult } from './registry/knowledgeTypeRegistryTypes';
import type { WorkspaceRegistryParseResult } from './registry/workspaceRegistryTypes';
import type {
  AddVaultInput,
  MimoraSettings,
  SearchScopeSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from './settings';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from './vaultFiles';
import type { DocumentIdValidationSummary } from './documentIdValidation';
import type {
  WorkspaceInsightSnapshot,
  WorkspaceInsightStoreLoadResult,
  WorkspaceInsightStoreSaveResult,
} from './workspaceInsight';

type MimoraApi = {
    appName: string;
    loadChatHistory: () => Promise<ChatHistoryLoadResult>;
    saveChatHistory: (
      history: PersistedChatHistory,
    ) => Promise<ChatHistorySaveResult>;
    deleteWorkspaceChat: (
      workspaceId: string,
    ) => Promise<ChatHistorySaveResult>;
    loadWorkspaceInsights: () => Promise<WorkspaceInsightStoreLoadResult>;
    saveWorkspaceInsight: (
      snapshot: WorkspaceInsightSnapshot,
    ) => Promise<WorkspaceInsightStoreSaveResult>;
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
    updateRagSettings: (input: RagSettings) => Promise<MimoraSettings>;
    hasExternalCredential: (
      providerId: ExternalChatProviderId,
    ) => Promise<boolean>;
    saveExternalCredential: (
      providerId: ExternalChatProviderId,
      apiKey: string,
    ) => Promise<boolean>;
    deleteExternalCredential: (
      providerId: ExternalChatProviderId,
    ) => Promise<boolean>;
    listExternalAIModels: (
      providerId: ExternalChatProviderId,
    ) => Promise<LLMModel[]>;
    testExternalAIConnection: (
      providerId: ExternalChatProviderId,
    ) => Promise<ConnectionTestResult>;
    chatWithExternalAI: (
      input: ExternalAIChatInput,
    ) => Promise<ExternalAIChatResult>;
    hasOpenAIApiKey: () => Promise<boolean>;
    saveOpenAIApiKey: (apiKey: string) => Promise<boolean>;
    deleteOpenAIApiKey: () => Promise<boolean>;
    listOpenAIModels: () => Promise<LLMModel[]>;
    testOpenAIConnection: () => Promise<ConnectionTestResult>;
    chatWithOpenAI: (
      input: ExternalAIChatInput,
    ) => Promise<ExternalAIChatResult>;
    updateAIMode: (aiMode: AIMode) => Promise<MimoraSettings>;
    updateSearchScope: (
      input: SearchScopeSettings,
    ) => Promise<MimoraSettings>;
    updateRegistryHomeVault: (
      homeVaultId: string | null,
    ) => Promise<MimoraSettings>;
    getRegistryStatus: () => Promise<RegistryStatus>;
    loadWorkspaceRegistry: () => Promise<WorkspaceRegistryParseResult>;
    loadKnowledgeDomainRegistry: () => Promise<KnowledgeDomainRegistryParseResult>;
    loadKnowledgeTypeRegistry: () => Promise<KnowledgeTypeRegistryParseResult>;
    getRagPythonStatus: () => Promise<RagPythonStatus>;
    getRagStorageRoot: () => Promise<string>;
    selectRagDocumentFile: (
      purpose: RagFileSelectionPurpose,
    ) => Promise<RagFileSelection | null>;
    listRagDocuments: () => Promise<RagDocument[]>;
    importRagDocument: (input: RagImportInput) => Promise<RagImportResult>;
    deleteRagDocument: (
      ragDocumentId: string,
    ) => Promise<RagDeleteResult>;
    replaceRagDocument: (input: RagReplaceInput) => Promise<RagReplaceResult>;
    indexRagDocument: (input: RagIndexInput) => Promise<RagIndexResult>;
    searchRagDocuments: (input: RagSearchInput) => Promise<RagSearchResult[]>;
    checkRagEmbeddingStatus: (
      input: RagEmbeddingStatusInput,
    ) => Promise<RagEmbeddingStatus>;
    getScheduleStorageRoot: () => Promise<string>;
    selectScheduleSourceFile: () => Promise<ScheduleFileSelection | null>;
    registerScheduleSource: (
      input: ScheduleRegisterInput,
    ) => Promise<ScheduleSource>;
    getScheduleSource: (
      workspaceId: string,
    ) => Promise<ScheduleSource | null>;
    removeScheduleSource: (
      workspaceId: string,
    ) => Promise<ScheduleRemoveResult>;
    refreshSchedule: (
      workspaceId: string,
      options?: ScheduleRefreshOptions,
    ) => Promise<ScheduleParseResult>;
    getScheduleSummary: (workspaceId: string) => Promise<ScheduleSummary>;
    querySchedule: (
      input: ScheduleQueryInput,
    ) => Promise<ScheduleQueryResult>;
    getIssueStorageRoot: () => Promise<string>;
    selectIssueSourceFile: () => Promise<IssueFileSelection | null>;
    registerIssueDocument: (
      input: IssueRegisterInput,
    ) => Promise<IssueDocument>;
    getIssueDocument: (
      workspaceId: string,
    ) => Promise<IssueDocument | null>;
    removeIssueDocument: (
      workspaceId: string,
    ) => Promise<IssueRemoveResult>;
    refreshIssueDocument: (
      workspaceId: string,
      options?: IssueRefreshOptions,
    ) => Promise<IssueParseResult>;
    getIssueSummary: (workspaceId: string) => Promise<IssueSummary>;
    queryIssues: (
      input: IssueQueryInput,
    ) => Promise<IssueQueryResult>;
    getWeeklyReportStorageRoot: () => Promise<string>;
    renderWeeklyReport: (
      input: WeeklyReportRenderInput,
    ) => Promise<WeeklyReportRenderResult>;
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
    validateDocumentIds: () => Promise<DocumentIdValidationSummary>;
    readVaultFile: (
      vaultId: string,
      relativePath: string,
    ) => Promise<VaultFileContent>;
    searchVaultFiles: (input: VaultSearchInput) => Promise<VaultSearchResult[]>;
    retrieveAutoContext: (
      input: AutoContextRetrievalInput,
    ) => Promise<AutoRetrievedContext[]>;
    suggestDerivedKnowledgeDocumentId: (
      generatedAt?: string | null,
    ) => Promise<SuggestedDocumentIdResult>;
    saveDerivedKnowledgeDraft: (
      input: SaveDerivedKnowledgeInput,
    ) => Promise<SaveDerivedKnowledgeResult>;
    openExternalLink: (url: string) => Promise<boolean>;
};

declare global {
  interface Window {
    mimora: MimoraApi;
  }
}

export {};
