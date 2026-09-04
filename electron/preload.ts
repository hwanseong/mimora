import { contextBridge, ipcRenderer } from 'electron';
import type {
  AddVaultInput,
  MimoraIpcResult,
  MimoraSettings,
  UpdateVaultInput,
  VaultDirectorySelection,
} from '../src/settings';
import type { VaultFile, VaultFileContent } from '../src/vaultFiles';

function unwrapIpcResult<T>(result: MimoraIpcResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error(result.error);
}

contextBridge.exposeInMainWorld('mimora', {
  appName: 'Mimora',
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
  readVaultFile: (vaultId: string, relativePath: string) =>
    (
      ipcRenderer.invoke(
        'vaultFiles:read',
        vaultId,
        relativePath,
      ) as Promise<MimoraIpcResult<VaultFileContent>>
    ).then(unwrapIpcResult),
});
