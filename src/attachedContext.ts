import type { VaultSecurity, VaultType } from './settings';

export type AttachedContext = {
  id: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
  content: string;
};

export type WorkspaceContexts = Record<string, AttachedContext[]>;

export function createAttachedContextId(
  vaultId: string,
  relativePath: string,
): string {
  return JSON.stringify([vaultId, relativePath]);
}
