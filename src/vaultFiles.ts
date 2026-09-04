export type VaultFile = {
  relativePath: string;
  name: string;
  folder: string;
};

export type VaultFileContent = {
  relativePath: string;
  content: string;
};

export type VaultSearchScope = 'current' | 'all';

export type VaultSearchInput = {
  query: string;
  scope: VaultSearchScope;
  vaultId?: string;
};

export type VaultSearchResult = {
  vaultId: string;
  vaultName: string;
  vaultType: import('./settings').VaultType;
  security: import('./settings').VaultSecurity;
  relativePath: string;
  fileName: string;
  matchType: 'filename' | 'path' | 'content';
  snippet?: string;
};
