import type { VaultSecurity, VaultType } from './settings';

export const DOCUMENT_ID_PATTERN = /^DOC-\d{4}-\d{4}$/u;

export type DocumentIdValidationStatus =
  | 'valid'
  | 'missing'
  | 'invalid-format'
  | 'duplicate';

export type DocumentIdValidationDocument = {
  documentKey: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  vaultSecurity: VaultSecurity;
  relativePath: string;
  fileName: string;
  documentId: string | null;
  status: DocumentIdValidationStatus;
  duplicateGroupId?: string;
};

export type DocumentIdValidationDuplicateGroup = {
  documentId: string;
  documents: DocumentIdValidationDocument[];
};

export type DocumentIdValidationSummary = {
  scannedAt: string;
  vaultCount: number;
  documentCount: number;
  counts: Record<DocumentIdValidationStatus, number>;
  documents: DocumentIdValidationDocument[];
  duplicateGroups: DocumentIdValidationDuplicateGroup[];
  errors: Array<{
    vaultId: string;
    vaultName: string;
    message: string;
  }>;
};

export const documentIdValidationStatusLabels: Record<
  DocumentIdValidationStatus,
  string
> = {
  valid: 'Valid',
  missing: 'Missing',
  'invalid-format': 'Invalid format',
  duplicate: 'Duplicate',
};

export function getDocumentIdFormatStatus(
  documentId: string | null | undefined,
): Exclude<DocumentIdValidationStatus, 'duplicate'> {
  const normalizedDocumentId = documentId?.trim();

  if (!normalizedDocumentId) {
    return 'missing';
  }

  return DOCUMENT_ID_PATTERN.test(normalizedDocumentId)
    ? 'valid'
    : 'invalid-format';
}

export function createEmptyDocumentIdCounts(): Record<
  DocumentIdValidationStatus,
  number
> {
  return {
    valid: 0,
    missing: 0,
    'invalid-format': 0,
    duplicate: 0,
  };
}
