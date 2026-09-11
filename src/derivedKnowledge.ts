import {
  documentIdPattern,
  type DocumentSecurity,
  type MimoraDocumentMetadata,
} from './metadata/types';
import {
  resolveKnowledgeDomain,
} from './registry/knowledgeDomainRegistryParser';
import {
  resolveKnowledgeType,
} from './registry/knowledgeTypeRegistryParser';
import type { KnowledgeDomainRegistry } from './registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistry } from './registry/knowledgeTypeRegistryTypes';

export type DerivedKnowledgeSource = {
  sourceType?: 'vault' | 'rag' | 'schedule';
  vaultId: string;
  documentId?: string;
  ragDocumentId?: string;
  relativePath: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  knowledgeDomains: string[];
  knowledgeTypes: string[];
  security: DocumentSecurity;
};

export type ExcludedKnowledgeSuggestion = {
  value: string;
  category: 'domain' | 'type';
  reason: 'not-registered';
  sourceCount: number;
};

export type DerivedKnowledgeDraft = {
  title: string;
  content: string;
  sourceDocuments: DerivedKnowledgeSource[];
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  knowledgeDomains: string[];
  knowledgeTypes: string[];
  excludedKnowledgeSuggestions: ExcludedKnowledgeSuggestion[];
  security: DocumentSecurity;
  contentOrigin: 'ai-derived';
  targetVaultId: string;
  documentId: string;
  filename: string;
  generatedAt?: string;
};

export type SaveDerivedKnowledgeInput = DerivedKnowledgeDraft;

export type SaveDerivedKnowledgeResult = {
  vaultId: string;
  relativePath: string;
  fileName: string;
  documentId: string;
};

export type SuggestedDocumentIdResult = {
  documentId: string;
  year: number;
  sequence: number;
  scannedDocumentCount: number;
};

export type DerivedKnowledgeSuggestionInput = {
  question: string;
  content: string;
  sourceDocuments: DerivedKnowledgeSource[];
  sourceMetadata: MimoraDocumentMetadata[];
  knowledgeDomainRegistry?: KnowledgeDomainRegistry | null;
  knowledgeTypeRegistry?: KnowledgeTypeRegistry | null;
  fallbackWorkspaceId?: string | null;
  fallbackKnowledgeDomain?: string | null;
  fallbackKnowledgeType?: string | null;
  targetVaultId: string;
};

export function deriveSecurityFromSources(
  sources: DerivedKnowledgeSource[],
): DocumentSecurity {
  return sources.some((source) => source.security === 'private')
    ? 'private'
    : 'normal';
}

export function isDerivedKnowledgeRequest(query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase('ko-KR');

  return (
    normalizedQuery.includes('ai wiki') ||
    normalizedQuery.includes('wiki') ||
    normalizedQuery.includes('위키') ||
    normalizedQuery.includes('ai 위키') ||
    (normalizedQuery.includes('정리') &&
      (normalizedQuery.includes('교훈') ||
        normalizedQuery.includes('원칙') ||
        normalizedQuery.includes('재사용')))
  );
}

export function formatLocalIsoDateTime(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function uniqueValues(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function rankValues(values: string[], limit?: number): string[] {
  const rankedValues = [...countValues(values).entries()]
    .sort(
      ([leftValue, leftCount], [rightValue, rightCount]) =>
        rightCount - leftCount || leftValue.localeCompare(rightValue),
    )
    .map(([value]) => value);

  return limit === undefined ? rankedValues : rankedValues.slice(0, limit);
}

function createDraftTitle(question: string): string {
  const normalizedQuestion = question
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[?.!。！？]+$/u, '')
    .slice(0, 72);

  return normalizedQuestion || 'AI Wiki Draft';
}

function normalizeExcludedKnowledgeSuggestions(
  suggestions: ExcludedKnowledgeSuggestion[] = [],
): ExcludedKnowledgeSuggestion[] {
  const merged = new Map<string, ExcludedKnowledgeSuggestion>();

  for (const suggestion of suggestions) {
    const value = suggestion.value.trim();

    if (!value) {
      continue;
    }

    const key = `${suggestion.category}:${value}`;
    const current = merged.get(key);

    merged.set(key, {
      value,
      category: suggestion.category,
      reason: 'not-registered',
      sourceCount:
        (current?.sourceCount ?? 0) + Math.max(1, suggestion.sourceCount),
    });
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      right.sourceCount - left.sourceCount ||
      left.value.localeCompare(right.value),
  );
}

export function normalizeDerivedKnowledgeDraft(
  draft: DerivedKnowledgeDraft,
): DerivedKnowledgeDraft {
  const normalizedSources = draft.sourceDocuments.map((source) => ({
    ...(source.sourceType ? { sourceType: source.sourceType } : {}),
    vaultId: source.vaultId.trim(),
    ...(source.documentId?.trim()
      ? { documentId: source.documentId.trim() }
      : {}),
    ...(source.ragDocumentId?.trim()
      ? { ragDocumentId: source.ragDocumentId.trim() }
      : {}),
    relativePath: source.relativePath.trim(),
    workspaceIds: uniqueValues(source.workspaceIds ?? []),
    originWorkspaceId: source.originWorkspaceId?.trim() || null,
    knowledgeDomains: uniqueValues(source.knowledgeDomains ?? []),
    knowledgeTypes: uniqueValues(source.knowledgeTypes ?? []),
    security: source.security,
  }));
  const security = deriveSecurityFromSources(normalizedSources);

  return {
    title: draft.title.trim(),
    content: draft.content.trim(),
    sourceDocuments: normalizedSources,
    workspaceIds: uniqueValues(draft.workspaceIds),
    originWorkspaceId: draft.originWorkspaceId?.trim() || null,
    knowledgeDomains: uniqueValues(draft.knowledgeDomains),
    knowledgeTypes: uniqueValues(draft.knowledgeTypes),
    excludedKnowledgeSuggestions: normalizeExcludedKnowledgeSuggestions(
      draft.excludedKnowledgeSuggestions,
    ),
    security,
    contentOrigin: 'ai-derived',
    targetVaultId: draft.targetVaultId.trim(),
    documentId: draft.documentId.trim(),
    filename: draft.filename.trim(),
    generatedAt: draft.generatedAt?.trim() || formatLocalIsoDateTime(),
  };
}

export function createDraftFilename(title: string): string {
  const normalizedTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLocaleLowerCase('en-US');

  return `${normalizedTitle || 'ai-wiki-draft'}.md`;
}

export function validateDerivedKnowledgeDraft(
  draft: DerivedKnowledgeDraft,
): string[] {
  const errors: string[] = [];

  if (!draft.title) {
    errors.push('Title을 입력하세요.');
  }

  if (!draft.content) {
    errors.push('AI Wiki 본문이 비어 있습니다.');
  }

  if (!draft.documentId) {
    errors.push('Document ID를 입력하세요.');
  } else if (!documentIdPattern.test(draft.documentId)) {
    errors.push('Document ID 형식은 DOC-YYYY-NNNN이어야 합니다.');
  }

  if (!draft.filename) {
    errors.push('파일명을 입력하세요.');
  } else if (!/^[^\\/:*?"<>|]+\.md$/u.test(draft.filename)) {
    errors.push('파일명은 확장자 .md를 가진 안전한 파일명이어야 합니다.');
  }

  if (!draft.targetVaultId) {
    errors.push('Target Vault를 선택하세요.');
  }

  if (draft.security !== deriveSecurityFromSources(draft.sourceDocuments)) {
    errors.push('Derived Security는 Source 문서의 보안등급에서만 결정됩니다.');
  }

  if (draft.contentOrigin !== 'ai-derived') {
    errors.push('Content Origin은 ai-derived로 고정되어야 합니다.');
  }

  return errors;
}

function createExcludedSuggestionsFromCounts(
  counts: Map<string, number>,
  category: ExcludedKnowledgeSuggestion['category'],
): ExcludedKnowledgeSuggestion[] {
  return [...counts.entries()].map(([value, sourceCount]) => ({
    value,
    category,
    reason: 'not-registered',
    sourceCount,
  }));
}

function resolveDomainSuggestions(input: {
  sourceDocuments: DerivedKnowledgeSource[];
  sourceMetadata: MimoraDocumentMetadata[];
  registry?: KnowledgeDomainRegistry | null;
  fallback?: string | null;
}): {
  suggestions: string[];
  excluded: ExcludedKnowledgeSuggestion[];
} {
  const rawValues = [
    ...input.sourceDocuments.flatMap((source) => source.knowledgeDomains),
    ...input.sourceMetadata.flatMap((metadata) =>
      metadata.rawKnowledgeDomains?.length
        ? metadata.rawKnowledgeDomains
        : metadata.knowledgeDomains,
    ),
  ];

  if (!input.registry) {
    return {
      suggestions:
        rawValues.length > 0
          ? rankValues(rawValues, 3)
          : uniqueValues(input.fallback ? [input.fallback] : []),
      excluded: [],
    };
  }

  const resolvedValues: string[] = [];
  const excludedCounts = new Map<string, number>();

  for (const value of rawValues) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      continue;
    }

    const resolved = resolveKnowledgeDomain(trimmedValue, input.registry);

    if (resolved.canonicalName) {
      resolvedValues.push(resolved.canonicalName);
    } else {
      excludedCounts.set(trimmedValue, (excludedCounts.get(trimmedValue) ?? 0) + 1);
    }
  }

  return {
    suggestions:
      resolvedValues.length > 0
        ? rankValues(resolvedValues, 3)
        : uniqueValues(input.fallback ? [input.fallback] : []),
    excluded: createExcludedSuggestionsFromCounts(excludedCounts, 'domain'),
  };
}

function resolveTypeSuggestions(input: {
  sourceDocuments: DerivedKnowledgeSource[];
  sourceMetadata: MimoraDocumentMetadata[];
  registry?: KnowledgeTypeRegistry | null;
  fallback?: string | null;
}): {
  suggestions: string[];
  excluded: ExcludedKnowledgeSuggestion[];
} {
  const rawValues = [
    ...input.sourceDocuments.flatMap((source) => source.knowledgeTypes),
    ...input.sourceMetadata.flatMap((metadata) =>
      metadata.rawKnowledgeTypes?.length
        ? metadata.rawKnowledgeTypes
        : metadata.knowledgeTypes,
    ),
  ];

  if (!input.registry) {
    return {
      suggestions:
        rawValues.length > 0
          ? rankValues(rawValues, 1)
          : uniqueValues(input.fallback ? [input.fallback] : []),
      excluded: [],
    };
  }

  const resolvedValues: string[] = [];
  const excludedCounts = new Map<string, number>();

  for (const value of rawValues) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      continue;
    }

    const resolved = resolveKnowledgeType(trimmedValue, input.registry);

    if (resolved) {
      resolvedValues.push(resolved);
    } else {
      excludedCounts.set(trimmedValue, (excludedCounts.get(trimmedValue) ?? 0) + 1);
    }
  }

  return {
    suggestions:
      resolvedValues.length > 0
        ? rankValues(resolvedValues, 1)
        : uniqueValues(input.fallback ? [input.fallback] : []),
    excluded: createExcludedSuggestionsFromCounts(excludedCounts, 'type'),
  };
}

export function createDerivedKnowledgeSuggestion(
  input: DerivedKnowledgeSuggestionInput,
): DerivedKnowledgeDraft {
  const sourceWorkspaceIds = [
    ...input.sourceDocuments.flatMap((source) => source.workspaceIds),
    ...input.sourceMetadata.flatMap((metadata) => metadata.workspaceIds),
  ];
  const workspaceIds =
    sourceWorkspaceIds.length > 0
      ? rankValues(sourceWorkspaceIds)
      : uniqueValues(input.fallbackWorkspaceId ? [input.fallbackWorkspaceId] : []);
  const sourceOriginWorkspaceIds = uniqueValues([
    ...input.sourceDocuments.flatMap((source) =>
      source.originWorkspaceId ? [source.originWorkspaceId] : [],
    ),
    ...input.sourceMetadata.flatMap((metadata) =>
      metadata.originWorkspaceId ? [metadata.originWorkspaceId] : [],
    ),
  ]);
  const originWorkspaceId =
    sourceOriginWorkspaceIds.length === 1
      ? sourceOriginWorkspaceIds[0]
      : sourceOriginWorkspaceIds.length === 0
        ? workspaceIds[0] ?? null
        : null;
  const domainResult = resolveDomainSuggestions({
    sourceDocuments: input.sourceDocuments,
    sourceMetadata: input.sourceMetadata,
    registry: input.knowledgeDomainRegistry,
    fallback: input.fallbackKnowledgeDomain,
  });
  const typeResult = resolveTypeSuggestions({
    sourceDocuments: input.sourceDocuments,
    sourceMetadata: input.sourceMetadata,
    registry: input.knowledgeTypeRegistry,
    fallback: input.fallbackKnowledgeType,
  });
  const title = createDraftTitle(input.question);

  return normalizeDerivedKnowledgeDraft({
    title,
    content: input.content,
    sourceDocuments: input.sourceDocuments,
    workspaceIds,
    originWorkspaceId,
    knowledgeDomains: domainResult.suggestions,
    knowledgeTypes: typeResult.suggestions,
    excludedKnowledgeSuggestions: [
      ...domainResult.excluded,
      ...typeResult.excluded,
    ],
    security: deriveSecurityFromSources(input.sourceDocuments),
    contentOrigin: 'ai-derived',
    targetVaultId: input.targetVaultId,
    documentId: '',
    filename: createDraftFilename(title),
    generatedAt: formatLocalIsoDateTime(),
  });
}

function toYamlSecurity(security: DocumentSecurity): DocumentSecurity {
  return security === 'normal' ? 'internal' : security;
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function formatYamlScalar(value?: string | null): string {
  if (!value?.trim()) {
    return 'null';
  }

  return `"${escapeYamlString(value.trim())}"`;
}

function formatYamlList(fieldName: string, values: string[]): string[] {
  const unique = uniqueValues(values);

  if (unique.length === 0) {
    return [`${fieldName}: []`];
  }

  return [`${fieldName}:`, ...unique.map((value) => `  - ${formatYamlScalar(value)}`)];
}

function getSourceDocumentIds(sources: DerivedKnowledgeSource[]): string[] {
  return uniqueValues(
    sources.flatMap((source) => (source.documentId ? [source.documentId] : [])),
  );
}

function getSourceRagIds(sources: DerivedKnowledgeSource[]): string[] {
  return uniqueValues(
    sources.flatMap((source) =>
      source.ragDocumentId ? [source.ragDocumentId] : [],
    ),
  );
}

function getSourceWorkspaceIds(sources: DerivedKnowledgeSource[]): string[] {
  return uniqueValues(
    sources.flatMap((source) => [
      ...source.workspaceIds,
      ...(source.originWorkspaceId ? [source.originWorkspaceId] : []),
    ]),
  );
}

function buildDerivedKnowledgeFrontmatter(
  draft: DerivedKnowledgeDraft,
): string {
  const sourceWorkspaceIds = getSourceWorkspaceIds(draft.sourceDocuments);
  const knowledgeType = draft.knowledgeTypes[0] ?? null;

  return [
    '---',
    `document_id: ${formatYamlScalar(draft.documentId)}`,
    ...formatYamlList('workspace_ids', draft.workspaceIds),
    `origin_workspace_id: ${formatYamlScalar(draft.originWorkspaceId)}`,
    `security: ${formatYamlScalar(toYamlSecurity(draft.security))}`,
    ...formatYamlList('knowledge_domains', draft.knowledgeDomains),
    `knowledge_type: ${formatYamlScalar(knowledgeType)}`,
    `content_origin: ${formatYamlScalar(draft.contentOrigin)}`,
    ...formatYamlList('source_document_ids', getSourceDocumentIds(draft.sourceDocuments)),
    ...formatYamlList('source_rag_ids', getSourceRagIds(draft.sourceDocuments)),
    ...formatYamlList('source_workspace_ids', sourceWorkspaceIds),
    `generated_by: ${formatYamlScalar('mimora')}`,
    `generated_at: ${formatYamlScalar(draft.generatedAt ?? formatLocalIsoDateTime())}`,
    '---',
  ].join('\n');
}

function formatSources(sources: DerivedKnowledgeSource[]): string {
  if (sources.length === 0) {
    return '- No source documents';
  }

  return sources
    .map((source) => {
      const sourceLabel =
        source.sourceType === 'rag'
          ? `RAG ${source.ragDocumentId ?? source.relativePath}`
          : source.sourceType === 'schedule'
            ? `Schedule ${source.relativePath}`
            : source.documentId
              ? source.documentId
              : `${source.vaultId}:${source.relativePath}`;

      return `- ${sourceLabel}`;
    })
    .join('\n');
}

export function buildDerivedKnowledgeMarkdown(
  draft: DerivedKnowledgeDraft,
): string {
  const normalizedDraft = normalizeDerivedKnowledgeDraft(draft);

  return [
    buildDerivedKnowledgeFrontmatter(normalizedDraft),
    '',
    `# ${normalizedDraft.title}`,
    '',
    normalizedDraft.content,
    '',
    '## Sources',
    '',
    formatSources(normalizedDraft.sourceDocuments),
    '',
  ].join('\n');
}

export function buildDerivedKnowledgeBodyMarkdown(
  draft: DerivedKnowledgeDraft,
): string {
  const normalizedDraft = normalizeDerivedKnowledgeDraft(draft);

  return [
    `# ${normalizedDraft.title}`,
    '',
    normalizedDraft.content,
    '',
    '## Sources',
    '',
    formatSources(normalizedDraft.sourceDocuments),
    '',
  ].join('\n');
}
