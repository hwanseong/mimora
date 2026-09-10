export type DocumentSecurity = 'normal' | 'private' | 'internal';

export type ContentOrigin = 'human' | 'ai-derived';

export const mimoraMetadataFieldNames = [
  'document_id',
  'workspace_ids',
  'origin_workspace_id',
  'security',
  'knowledge_domains',
  'knowledge_type',
  'content_origin',
] as const;

export type MimoraMetadataFieldName =
  (typeof mimoraMetadataFieldNames)[number];

export type MimoraMetadataSource =
  | 'frontmatter'
  | 'legacy'
  | 'mixed'
  | 'none';

export type MimoraDocumentMetadata = {
  documentId?: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  rawKnowledgeDomains?: string[];
  knowledgeDomains: string[];
  rawKnowledgeTypes?: string[];
  knowledgeTypes: string[];
  security?: DocumentSecurity;
  contentOrigin?: ContentOrigin;
  source: MimoraMetadataSource;
};

export type MetadataIssueDetails = {
  field?: string;
  yamlValue?: unknown;
  legacyValue?: unknown;
  selectedValue?: unknown;
  [key: string]: unknown;
};

export type DocumentMetadataValidationIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  documentId?: string;
  details?: MetadataIssueDetails;
};

export type MimoraMetadataParseResult = {
  metadata: MimoraDocumentMetadata;
  issues: DocumentMetadataValidationIssue[];
  valid: boolean;
  hasMetadata: boolean;
  body: string;
};

export const documentIdPattern = /^DOC-\d{4}-\d{4}$/u;
