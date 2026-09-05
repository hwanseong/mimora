import type { VaultSecurity, VaultType } from './settings';

export type AutoRetrievedContext = {
  documentId: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
  score: number;
  snippet: string;
  content: string;
};

export type AutoContextRetrievalInput = {
  query: string;
  limit?: number;
};
