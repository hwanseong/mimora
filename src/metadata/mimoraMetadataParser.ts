import { workspaceIdPattern } from '../workspace/types';
import {
  documentIdPattern,
  type ContentOrigin,
  type DocumentMetadataValidationIssue,
  type DocumentSecurity,
  type MimoraDocumentMetadata,
  type MimoraMetadataParseResult,
} from './types';

const metadataHeading = '## Mimora Metadata';
const metadataFields = [
  'document_id',
  'workspace_ids',
  'origin_workspace_id',
  'knowledge_domains',
  'knowledge_type',
  'security',
  'content_origin',
] as const;
const documentSecurityOptions = ['normal', 'private'] as const;
const contentOriginOptions = ['human', 'ai-derived'] as const;

type MetadataField = (typeof metadataFields)[number];

const emptyMetadata: MimoraDocumentMetadata = {
  workspaceIds: [],
  knowledgeDomains: [],
  knowledgeTypes: [],
};

function createEmptyMetadata(): MimoraDocumentMetadata {
  return {
    workspaceIds: [],
    knowledgeDomains: [],
    knowledgeTypes: [],
  };
}

function normalizeMarkdownText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

function normalizeCell(value: string): string {
  return value.replace(/^\uFEFF/u, '').trim();
}

function normalizeHeader(value: string): string {
  return normalizeCell(value).toLowerCase();
}

function splitMarkdownTableRow(line: string): string[] {
  const withoutOuterPipes = line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '');
  const cells: string[] = [];
  let currentCell = '';
  let escaped = false;

  for (const character of withoutOuterPipes) {
    if (escaped) {
      currentCell += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '|') {
      cells.push(normalizeCell(currentCell));
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  cells.push(normalizeCell(currentCell));
  return cells;
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes('|')) {
    return false;
  }

  const cells = splitMarkdownTableRow(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
  );
}

function splitListValue(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function getKnownWorkspaceIdSet(
  knownWorkspaceIds?: Iterable<string>,
): Set<string> | null {
  return knownWorkspaceIds ? new Set(knownWorkspaceIds) : null;
}

function createIssue(
  issue: DocumentMetadataValidationIssue,
): DocumentMetadataValidationIssue {
  return issue;
}

function validateWorkspaceReference(input: {
  workspaceId: string;
  field: string;
  knownWorkspaceIds: Set<string> | null;
  documentId?: string;
  issues: DocumentMetadataValidationIssue[];
}): void {
  if (!workspaceIdPattern.test(input.workspaceId)) {
    input.issues.push(
      createIssue({
        severity: 'error',
        code: 'invalid-workspace-id',
        message: 'Workspace ID 형식은 WS-YYYY-NNNN이어야 합니다.',
        field: input.field,
        documentId: input.documentId,
      }),
    );
    return;
  }

  if (input.knownWorkspaceIds && !input.knownWorkspaceIds.has(input.workspaceId)) {
    input.issues.push(
      createIssue({
        severity: 'warning',
        code: 'unknown-workspace-id',
        message: 'Workspace Registry에 존재하지 않는 Workspace ID입니다.',
        field: input.field,
        documentId: input.documentId,
      }),
    );
  }
}

function parseMetadataRows(lines: string[], headingIndex: number): {
  values: Map<MetadataField, string>;
  tableStartIndex: number;
  tableEndIndex: number;
} | null {
  for (let index = headingIndex + 1; index < lines.length - 1; index += 1) {
    const line = lines[index];

    if (index > headingIndex + 1 && /^#{1,6}\s+/u.test(line.trim())) {
      return null;
    }

    if (!line.includes('|') || !isSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headers = splitMarkdownTableRow(line).map(normalizeHeader);
    const fieldColumn = headers.indexOf('field');
    const valueColumn = headers.indexOf('value');

    if (fieldColumn === -1 || valueColumn === -1) {
      continue;
    }

    const values = new Map<MetadataField, string>();
    let tableEndIndex = index + 1;

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex];

      if (!row.includes('|')) {
        break;
      }

      const cells = splitMarkdownTableRow(row);
      const field = normalizeHeader(cells[fieldColumn] ?? '');
      const value = normalizeCell(cells[valueColumn] ?? '');

      if (metadataFields.includes(field as MetadataField)) {
        values.set(field as MetadataField, value);
      }

      tableEndIndex = rowIndex;
    }

    return {
      values,
      tableStartIndex: index,
      tableEndIndex,
    };
  }

  return null;
}

function createBodyWithoutMetadata(
  lines: string[],
  headingIndex: number,
  tableEndIndex: number,
): string {
  return [
    ...lines.slice(0, headingIndex),
    ...lines.slice(tableEndIndex + 1),
  ].join('\n');
}

export function parseMimoraDocumentMetadata(
  markdown: string,
  options: {
    knownWorkspaceIds?: Iterable<string>;
  } = {},
): MimoraMetadataParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const lines = normalizedMarkdown.split('\n');
  const headingIndex = lines.findIndex(
    (line) => line.trim() === metadataHeading,
  );

  if (headingIndex === -1) {
    return {
      metadata: { ...emptyMetadata },
      issues: [],
      valid: true,
      hasMetadata: false,
      body: normalizedMarkdown,
    };
  }

  const table = parseMetadataRows(lines, headingIndex);

  if (!table) {
    return {
      metadata: createEmptyMetadata(),
      issues: [
        createIssue({
          severity: 'error',
          code: 'metadata-table-not-found',
          message: 'Mimora Metadata Markdown table을 찾을 수 없습니다.',
        }),
      ],
      valid: false,
      hasMetadata: true,
      body: normalizedMarkdown,
    };
  }

  const metadata = createEmptyMetadata();
  const issues: DocumentMetadataValidationIssue[] = [];
  const knownWorkspaceIds = getKnownWorkspaceIdSet(options.knownWorkspaceIds);
  const documentId = table.values.get('document_id')?.trim();

  if (documentId) {
    metadata.documentId = documentId;

    if (!documentIdPattern.test(documentId)) {
      issues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-document-id',
          message: 'document_id 형식은 DOC-YYYY-NNNN이어야 합니다.',
          field: 'document_id',
          documentId,
        }),
      );
    }
  }

  metadata.workspaceIds = splitListValue(table.values.get('workspace_ids') ?? '');

  if (metadata.workspaceIds.length > 0) {
    const rawWorkspaceIds = (table.values.get('workspace_ids') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (new Set(rawWorkspaceIds).size !== rawWorkspaceIds.length) {
      issues.push(
        createIssue({
          severity: 'warning',
          code: 'duplicate-workspace-id',
          message: 'workspace_ids에 중복된 Workspace ID가 있습니다.',
          field: 'workspace_ids',
          documentId,
        }),
      );
    }

    for (const workspaceId of metadata.workspaceIds) {
      validateWorkspaceReference({
        workspaceId,
        field: 'workspace_ids',
        knownWorkspaceIds,
        documentId,
        issues,
      });
    }
  }

  const originWorkspaceId = table.values.get('origin_workspace_id')?.trim();

  if (originWorkspaceId) {
    metadata.originWorkspaceId = originWorkspaceId;
    validateWorkspaceReference({
      workspaceId: originWorkspaceId,
      field: 'origin_workspace_id',
      knownWorkspaceIds,
      documentId,
      issues,
    });

    if (!metadata.workspaceIds.includes(originWorkspaceId)) {
      issues.push(
        createIssue({
          severity: 'warning',
          code: 'origin-not-in-workspace-ids',
          message: 'origin_workspace_id가 workspace_ids에 포함되어 있지 않습니다.',
          field: 'origin_workspace_id',
          documentId,
        }),
      );
    }
  }

  metadata.knowledgeDomains = splitListValue(
    table.values.get('knowledge_domains') ?? '',
  );
  metadata.knowledgeTypes = splitListValue(
    table.values.get('knowledge_type') ?? '',
  );

  const security = table.values.get('security')?.trim() as
    | DocumentSecurity
    | undefined;

  if (security) {
    if (documentSecurityOptions.includes(security)) {
      metadata.security = security;
    } else {
      issues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-security',
          message: 'security는 normal 또는 private이어야 합니다.',
          field: 'security',
          documentId,
        }),
      );
    }
  }

  const contentOrigin = table.values.get('content_origin')?.trim() as
    | ContentOrigin
    | undefined;

  if (contentOrigin) {
    if (contentOriginOptions.includes(contentOrigin)) {
      metadata.contentOrigin = contentOrigin;
    } else {
      issues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-content-origin',
          message: 'content_origin은 human 또는 ai-derived여야 합니다.',
          field: 'content_origin',
          documentId,
        }),
      );
    }
  }

  return {
    metadata,
    issues,
    valid: !issues.some((issue) => issue.severity === 'error'),
    hasMetadata: true,
    body: createBodyWithoutMetadata(lines, headingIndex, table.tableEndIndex),
  };
}
