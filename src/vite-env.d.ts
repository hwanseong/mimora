/// <reference types="vite/client" />

import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from './autoContext';
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
