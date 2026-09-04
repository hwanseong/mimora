/// <reference types="vite/client" />

import type {
  AddVaultInput,
  MimoraSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from './settings';
import type { VaultFile, VaultFileContent } from './vaultFiles';

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
};

declare global {
  interface Window {
    mimora: MimoraApi;
  }
}

export {};
