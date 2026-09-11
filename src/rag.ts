import type { VaultSecurity } from './settings';

export const ragSupportedExtensions = ['.pdf', '.docx', '.md', '.txt'] as const;
export const ragFileSelectionPurposeOptions = [
  'rag-import',
  'rag-replace',
] as const;
export const ragEmbeddingProviderOptions = ['local', 'openai'] as const;
export const defaultRagEmbeddingProvider = 'local';
export const defaultLocalRagEmbeddingModel = 'bge-m3';
export const defaultOpenAIRagEmbeddingModel = 'text-embedding-3-small';
export const defaultRagEmbeddingModel = defaultLocalRagEmbeddingModel;
export const defaultRagChunkSize = 3600;
export const defaultRagChunkOverlap = 500;
export const defaultRagSimilarityThreshold = 0.22;
export const defaultRagWorkspaceScoreBonus = 0.03;
export const defaultRagMaxChunksPerDocument = 2;
export const defaultRagSearchCandidateCount = 50;
export const defaultRagTopK = 5;
export const defaultRagDenseOnlyThreshold = 0.55;

export const ragDocumentStatusOptions = [
  'imported',
  'indexing',
  'indexed',
  'failed',
] as const;

export type RagDocumentStatus = (typeof ragDocumentStatusOptions)[number];
export type RagDocumentSecurity = VaultSecurity | 'private';
export type RagEmbeddingProvider = (typeof ragEmbeddingProviderOptions)[number];
export type RagFileSelectionPurpose =
  (typeof ragFileSelectionPurposeOptions)[number];

export type RagSettings = {
  embeddingProvider: RagEmbeddingProvider;
  localEmbeddingModel: string;
  openAIEmbeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  similarityThreshold: number;
  workspaceScoreBonus: number;
  maxChunksPerDocument: number;
  searchCandidateCount: number;
  defaultTopK: number;
  denseOnlyThreshold: number;
};

export const defaultRagSettings: RagSettings = {
  embeddingProvider: defaultRagEmbeddingProvider,
  localEmbeddingModel: defaultLocalRagEmbeddingModel,
  openAIEmbeddingModel: defaultOpenAIRagEmbeddingModel,
  chunkSize: defaultRagChunkSize,
  chunkOverlap: defaultRagChunkOverlap,
  similarityThreshold: defaultRagSimilarityThreshold,
  workspaceScoreBonus: defaultRagWorkspaceScoreBonus,
  maxChunksPerDocument: defaultRagMaxChunksPerDocument,
  searchCandidateCount: defaultRagSearchCandidateCount,
  defaultTopK: defaultRagTopK,
  denseOnlyThreshold: defaultRagDenseOnlyThreshold,
};

export type RagDocument = {
  ragDocumentId: string;
  originalFilename: string;
  managedFilePath: string;
  fileType: string;
  fileSize: number;
  fileHash: string;
  security: RagDocumentSecurity;
  status: RagDocumentStatus;
  createdAt: string;
  indexedAt: string | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDimension: number | null;
  chunkCount: number;
  workspaceIds: string[];
};

export type RagPythonStatus = {
  available: boolean;
  executable?: string;
  version?: string;
  error?: string;
};

export type RagImportInput = {
  selectionId: string;
  workspaceIds: string[];
  security: RagDocumentSecurity;
};

export type RagReplaceInput = {
  ragDocumentId: string;
  selectionId: string;
};

export type RagImportResult = {
  status: 'imported' | 'duplicate';
  document: RagDocument;
  duplicateOf?: string;
};

export type RagDeleteResult = {
  ragDocumentId: string;
  deleted: true;
};

export type RagReplaceResult = {
  status: 'replaced' | 'duplicate' | 'unchanged';
  document: RagDocument;
  duplicateOf?: string;
};

export type RagFileSelection = {
  selectionId: string;
  name: string;
};

export type RagIndexInput = {
  ragDocumentId: string;
  embeddingProvider?: RagEmbeddingProvider;
  embeddingModel?: string;
};

export type RagIndexResult = {
  status: 'indexed';
  document: RagDocument;
};

export type RagSearchInput = {
  query: string;
  workspaceIds: string[];
  includeGlobal: boolean;
  security: RagDocumentSecurity;
  topK: number;
  embeddingProvider?: RagEmbeddingProvider;
  embeddingModel?: string;
  similarityThreshold?: number;
};

export type RagSearchResult = {
  score: number;
  rawScore?: number;
  denseScore?: number | null;
  denseRank?: number | null;
  lexicalScore?: number | null;
  lexicalRank?: number | null;
  hybridScore?: number;
  hybridRank?: number;
  adjustedScore?: number;
  scope?: 'workspace' | 'global';
  ragDocumentId: string;
  filename: string;
  workspaceIds: string[];
  security: RagDocumentSecurity;
  chunkId: string;
  chunkIndex: number;
  heading: string | null;
  page: number | null;
  text: string;
};

export type RagEmbeddingStatusInput = {
  provider?: RagEmbeddingProvider;
  embeddingModel?: string;
};

export type RagEmbeddingStatus = {
  available: boolean;
  provider: RagEmbeddingProvider;
  model: string;
  endpoint?: string;
  dimension?: number;
  message: string;
};
