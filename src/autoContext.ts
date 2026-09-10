import type { VaultSecurity, VaultType } from './settings';
import type {
  DocumentMetadataValidationIssue,
  MimoraDocumentMetadata,
} from './metadata/types';
import type { KnowledgeSearchFilters } from './knowledgeSearch';
import type { ContentOriginSearchScope } from './contentOrigin';

export type AutoRetrievedContext = {
  sourceType?: 'vault' | 'rag' | 'schedule';
  documentId: string;
  mimoraDocumentId?: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  documentSecurity?: MimoraDocumentMetadata['security'];
  contentOrigin?: MimoraDocumentMetadata['contentOrigin'];
  metadata?: MimoraDocumentMetadata;
  metadataIssues?: DocumentMetadataValidationIssue[];
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
  ragDocumentId?: string;
  page?: number | null;
  heading?: string | null;
  score: number;
  snippet: string;
  content: string;
};

export type AutoContextRetrievalInput = {
  query: string;
  workspaceId?: string;
  limit?: number;
  includeArchived?: boolean;
  knowledgeFilters?: KnowledgeSearchFilters;
  contentOriginScope?: ContentOriginSearchScope;
};
