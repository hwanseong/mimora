import type { VaultSecurity, VaultType } from './settings';
import type { MimoraDocumentMetadata } from './metadata/types';

export type AutoRetrievedContext = {
  documentId: string;
  metadata?: MimoraDocumentMetadata;
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
  workspaceId?: string;
  limit?: number;
};
