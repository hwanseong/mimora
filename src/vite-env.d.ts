/// <reference types="vite/client" />

import type {
  AddVaultInput,
  MimoraSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from './settings';

type MimoraApi = {
    appName: string;
    getSettings: () => Promise<MimoraSettings>;
    addVault: (input: AddVaultInput) => Promise<MimoraSettings>;
    updateVault: (input: UpdateVaultInput) => Promise<MimoraSettings>;
    deleteVault: (id: string) => Promise<MimoraSettings>;
    selectVaultDirectory: () => Promise<VaultDirectorySelection | null>;
};

declare global {
  interface Window {
    mimora: MimoraApi;
  }
}

export {};
