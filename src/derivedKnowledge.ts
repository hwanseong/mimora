import {
  documentIdPattern,
  type DocumentSecurity,
  type MimoraDocumentMetadata,
} from './metadata/types';

export type DerivedKnowledgeSource = {
  vaultId: string;
  documentId?: string;
  relativePath: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  knowledgeDomains: string[];
  knowledgeTypes: string[];
  security: DocumentSecurity;
};

export type DerivedKnowledgeDraft = {
  title: string;
  content: string;
  sourceDocuments: DerivedKnowledgeSource[];
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  knowledgeDomains: string[];
  knowledgeTypes: string[];
  security: DocumentSecurity;
  contentOrigin: 'ai-derived';
  targetVaultId: string;
  documentId: string;
  filename: string;
};

export type SaveDerivedKnowledgeInput = DerivedKnowledgeDraft;

export type SaveDerivedKnowledgeResult = {
  vaultId: string;
  relativePath: string;
  fileName: string;
  documentId: string;
};

export type DerivedKnowledgeSuggestionInput = {
  question: string;
  content: string;
  sourceDocuments: DerivedKnowledgeSource[];
  sourceMetadata: MimoraDocumentMetadata[];
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

export function normalizeDerivedKnowledgeDraft(
  draft: DerivedKnowledgeDraft,
): DerivedKnowledgeDraft {
  const normalizedSources = draft.sourceDocuments.map((source) => ({
    vaultId: source.vaultId.trim(),
    ...(source.documentId?.trim()
      ? { documentId: source.documentId.trim() }
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
    security,
    contentOrigin: 'ai-derived',
    targetVaultId: draft.targetVaultId.trim(),
    documentId: draft.documentId.trim(),
    filename: draft.filename.trim(),
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
  const sourceKnowledgeDomains = [
    ...input.sourceDocuments.flatMap((source) => source.knowledgeDomains),
    ...input.sourceMetadata.flatMap((metadata) => metadata.knowledgeDomains),
  ];
  const sourceKnowledgeTypes = [
    ...input.sourceDocuments.flatMap((source) => source.knowledgeTypes),
    ...input.sourceMetadata.flatMap((metadata) => metadata.knowledgeTypes),
  ];
  const knowledgeDomains =
    sourceKnowledgeDomains.length > 0
      ? rankValues(sourceKnowledgeDomains, 3)
      : uniqueValues(
          input.fallbackKnowledgeDomain ? [input.fallbackKnowledgeDomain] : [],
        );
  const knowledgeTypes =
    sourceKnowledgeTypes.length > 0
      ? rankValues(sourceKnowledgeTypes, 1)
      : uniqueValues(input.fallbackKnowledgeType ? [input.fallbackKnowledgeType] : []);
  const title = createDraftTitle(input.question);

  return normalizeDerivedKnowledgeDraft({
    title,
    content: input.content,
    sourceDocuments: input.sourceDocuments,
    workspaceIds,
    originWorkspaceId,
    knowledgeDomains,
    knowledgeTypes,
    security: deriveSecurityFromSources(input.sourceDocuments),
    contentOrigin: 'ai-derived',
    targetVaultId: input.targetVaultId,
    documentId: '',
    filename: createDraftFilename(title),
  });
}

function formatMetadataValue(values: string[]): string {
  return uniqueValues(values).join(', ');
}

function formatSources(sources: DerivedKnowledgeSource[]): string {
  if (sources.length === 0) {
    return '- No source documents';
  }

  return sources
    .map((source) =>
      source.documentId
        ? `- ${source.documentId}`
        : `- ${source.vaultId}:${source.relativePath}`,
    )
    .join('\n');
}

export function buildDerivedKnowledgeMarkdown(
  draft: DerivedKnowledgeDraft,
): string {
  const normalizedDraft = normalizeDerivedKnowledgeDraft(draft);

  return [
    '## Mimora Metadata',
    '',
    '| field | value |',
    '| --- | --- |',
    `| document_id | ${normalizedDraft.documentId} |`,
    `| workspace_ids | ${formatMetadataValue(normalizedDraft.workspaceIds)} |`,
    `| origin_workspace_id | ${normalizedDraft.originWorkspaceId ?? ''} |`,
    `| knowledge_domains | ${formatMetadataValue(
      normalizedDraft.knowledgeDomains,
    )} |`,
    `| knowledge_type | ${formatMetadataValue(normalizedDraft.knowledgeTypes)} |`,
    `| security | ${normalizedDraft.security} |`,
    `| content_origin | ${normalizedDraft.contentOrigin} |`,
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
