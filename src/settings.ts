export const vaultTypeOptions = ['work', 'private', 'knowledge'] as const;
export const vaultSecurityOptions = [
  'internal',
  'sensitive',
  'personal',
] as const;

export type VaultType = (typeof vaultTypeOptions)[number];
export type VaultSecurity = (typeof vaultSecurityOptions)[number];

export type VaultConfig = {
  id: string;
  name: string;
  type: VaultType;
  security: VaultSecurity;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type MimoraSettings = {
  vaults: VaultConfig[];
};

export type AddVaultInput = {
  name: string;
  type: VaultType;
  security: VaultSecurity;
  path: string;
};

export type UpdateVaultInput = AddVaultInput & {
  id: string;
};

export type VaultDirectorySelection = {
  path: string;
  suggestedName: string;
};

export type MimoraIpcResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export const defaultSettings: MimoraSettings = {
  vaults: [],
};

export const vaultTypeLabels: Record<VaultType, string> = {
  work: 'Work',
  private: 'Private',
  knowledge: 'Knowledge',
};

export const vaultSecurityLabels: Record<VaultSecurity, string> = {
  internal: 'Internal',
  sensitive: 'Sensitive',
  personal: 'Personal',
};
