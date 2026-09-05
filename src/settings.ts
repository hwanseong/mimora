import {
  defaultLocalAISettings,
  type LocalAISettings,
} from './localAI';
import type { AIMode } from './security/securityRouter';
import {
  createDefaultMaskingSettings,
  type MaskingSettings,
} from './security/maskingEngine';

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
  localAI: LocalAISettings;
  aiMode: AIMode;
  masking: MaskingSettings;
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
  localAI: { ...defaultLocalAISettings },
  aiMode: 'auto',
  masking: createDefaultMaskingSettings(),
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
