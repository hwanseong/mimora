import type {
  DocumentMetadataValidationIssue,
  MimoraDocumentMetadata,
} from './metadata/types';
import type { KnowledgeSearchFilters } from './knowledgeSearch';
import type { ContentOriginSearchScope } from './contentOrigin';

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
  knowledgeFilters?: KnowledgeSearchFilters;
  contentOriginScope?: ContentOriginSearchScope;
};

export type VaultSearchResult = {
  vaultId: string;
  vaultName: string;
  vaultType: import('./settings').VaultType;
  security: import('./settings').VaultSecurity;
  documentId?: string;
  mimoraDocumentId?: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  documentSecurity?: MimoraDocumentMetadata['security'];
  contentOrigin?: MimoraDocumentMetadata['contentOrigin'];
  relativePath: string;
  fileName: string;
  matchType: 'filename' | 'path' | 'content' | 'metadata';
  metadata?: MimoraDocumentMetadata;
  metadataIssues?: DocumentMetadataValidationIssue[];
  snippet?: string;
};
