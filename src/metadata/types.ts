export type DocumentSecurity = 'normal' | 'private';

export type ContentOrigin = 'human' | 'ai-derived';

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
};

export type DocumentMetadataValidationIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  documentId?: string;
};

export type MimoraMetadataParseResult = {
  metadata: MimoraDocumentMetadata;
  issues: DocumentMetadataValidationIssue[];
  valid: boolean;
  hasMetadata: boolean;
  body: string;
};

export const documentIdPattern = /^DOC-\d{4}-\d{4}$/u;
