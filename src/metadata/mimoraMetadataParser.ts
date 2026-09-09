import { workspaceIdPattern } from '../workspace/types';
import {
  resolveKnowledgeDomain,
} from '../registry/knowledgeDomainRegistryParser';
import type { KnowledgeDomainRegistry } from '../registry/knowledgeDomainRegistryTypes';
import {
  resolveKnowledgeType,
} from '../registry/knowledgeTypeRegistryParser';
import type { KnowledgeTypeRegistry } from '../registry/knowledgeTypeRegistryTypes';
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

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
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

function getMarkdownBodyStartIndex(lines: string[]): number {
  if (lines[0]?.trim() !== '---') {
    return 0;
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );

  return closingIndex === -1 ? 0 : closingIndex + 1;
}

function findMetadataTables(
  lines: string[],
  bodyStartIndex: number,
): Array<{
  headingIndex: number;
  values: Map<MetadataField, string>;
  tableStartIndex: number;
  tableEndIndex: number;
}> {
  return lines.flatMap((line, index) => {
    if (index < bodyStartIndex || line.trim() !== metadataHeading) {
      return [];
    }

    const table = parseMetadataRows(lines, index);

    return table ? [{ headingIndex: index, ...table }] : [];
  });
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
    knowledgeDomainRegistry?: KnowledgeDomainRegistry | null;
    knowledgeTypeRegistry?: KnowledgeTypeRegistry | null;
    knowledgeDomainRegistryUnavailable?: boolean;
    knowledgeTypeRegistryUnavailable?: boolean;
  } = {},
): MimoraMetadataParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const lines = normalizedMarkdown.split('\n');
  const bodyStartIndex = getMarkdownBodyStartIndex(lines);
  const hasMetadataHeading = lines.some(
    (line, index) => index >= bodyStartIndex && line.trim() === metadataHeading,
  );

  if (!hasMetadataHeading) {
    return {
      metadata: { ...emptyMetadata },
      issues: [],
      valid: true,
      hasMetadata: false,
      body: normalizedMarkdown,
    };
  }

  const metadataTables = findMetadataTables(lines, bodyStartIndex);
  const table = metadataTables.at(-1) ?? null;

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

  const rawKnowledgeDomains = splitListValue(
    table.values.get('knowledge_domains') ?? '',
  );
  metadata.rawKnowledgeDomains = rawKnowledgeDomains;

  if (options.knowledgeDomainRegistry) {
    const normalizedDomains: string[] = [];

    for (const rawKnowledgeDomain of rawKnowledgeDomains) {
      const resolvedDomain = resolveKnowledgeDomain(
        rawKnowledgeDomain,
        options.knowledgeDomainRegistry,
      );

      if (resolvedDomain.canonicalName) {
        normalizedDomains.push(resolvedDomain.canonicalName);
      } else {
        issues.push(
          createIssue({
            severity: 'warning',
            code: 'unknown-knowledge-domain',
            message: `등록되지 않은 Knowledge Domain입니다: ${rawKnowledgeDomain}`,
            field: 'knowledge_domains',
            documentId,
          }),
        );
      }
    }

    metadata.knowledgeDomains = uniqueValues(normalizedDomains);

    if (metadata.knowledgeDomains.length !== normalizedDomains.length) {
      issues.push(
        createIssue({
          severity: 'warning',
          code: 'duplicate-normalized-domain',
          message: '여러 knowledge_domains 값이 같은 canonical domain으로 정규화되었습니다.',
          field: 'knowledge_domains',
          documentId,
        }),
      );
    }
  } else {
    metadata.knowledgeDomains = rawKnowledgeDomains;

    if (
      options.knowledgeDomainRegistryUnavailable &&
      rawKnowledgeDomains.length > 0
    ) {
      issues.push(
        createIssue({
          severity: 'warning',
          code: 'knowledge-domain-registry-unavailable',
          message: 'Knowledge Domain Registry를 읽을 수 없어 raw domain 값을 유지했습니다.',
          field: 'knowledge_domains',
          documentId,
        }),
      );
    }
  }

  const rawKnowledgeTypes = splitListValue(table.values.get('knowledge_type') ?? '');
  metadata.rawKnowledgeTypes = rawKnowledgeTypes;

  if (options.knowledgeTypeRegistry) {
    const normalizedTypes: string[] = [];

    for (const rawKnowledgeType of rawKnowledgeTypes) {
      const resolvedType = resolveKnowledgeType(
        rawKnowledgeType,
        options.knowledgeTypeRegistry,
      );

      if (resolvedType) {
        normalizedTypes.push(resolvedType);
      } else {
        issues.push(
          createIssue({
            severity: 'warning',
            code: 'unknown-knowledge-type',
            message: `등록되지 않은 Knowledge Type입니다: ${rawKnowledgeType}`,
            field: 'knowledge_type',
            documentId,
          }),
        );
      }
    }

    metadata.knowledgeTypes = uniqueValues(normalizedTypes);
  } else {
    metadata.knowledgeTypes = rawKnowledgeTypes;

    if (
      options.knowledgeTypeRegistryUnavailable &&
      rawKnowledgeTypes.length > 0
    ) {
      issues.push(
        createIssue({
          severity: 'warning',
          code: 'knowledge-type-registry-unavailable',
          message: 'Knowledge Type Registry를 읽을 수 없어 raw type 값을 유지했습니다.',
          field: 'knowledge_type',
          documentId,
        }),
      );
    }
  }

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
    body: createBodyWithoutMetadata(
      lines,
      table.headingIndex,
      table.tableEndIndex,
    ),
  };
}
