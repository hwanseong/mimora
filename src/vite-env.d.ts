/// <reference types="vite/client" />

import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from './autoContext';
import type {
  ConnectionTestResult,
  LLMModel,
  LocalAIConnectionInput,
  LocalAISettings,
} from './localAI';
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
    getSettings: () => Promise<MimoraSettings>;
    addVault: (input: AddVaultInput) => Promise<MimoraSettings>;
    updateVault: (input: UpdateVaultInput) => Promise<MimoraSettings>;
    deleteVault: (id: string) => Promise<MimoraSettings>;
    updateLocalAISettings: (
      input: LocalAISettings,
    ) => Promise<MimoraSettings>;
    listLocalAIModels: (
      input: LocalAIConnectionInput,
    ) => Promise<LLMModel[]>;
    testLocalAIConnection: (
      input: LocalAIConnectionInput,
    ) => Promise<ConnectionTestResult>;
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
