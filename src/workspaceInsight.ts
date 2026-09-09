import type { LLMContextDocument } from './llmChat';
import type { WorkspaceStatusDocument } from './workspaceStatusPanel';
import {
  isAllWorkspaceScope,
  type Workspace,
} from './workspaces';

export type InsightCategoryKey =
  | 'risks'
  | 'notableChanges'
  | 'decisions'
  | 'openIssues';

export type InsightItem = {
  text: string;
  sourceDocumentIds: string[];
};

export type WorkspaceInsightSourceDocument = {
  vaultId: string;
  vaultName: string;
  relativePath: string;
  fileName: string;
  documentId?: string;
  modifiedAt?: string;
};

export type WorkspaceInsightSnapshot = {
  workspaceId: string;
  generatedAt: string;
  sourceDocuments: WorkspaceInsightSourceDocument[];
  sourceFingerprint: string;
  risks: InsightItem[];
  notableChanges: InsightItem[];
  decisions: InsightItem[];
  openIssues: InsightItem[];
};

export type WorkspaceInsightSnapshots = Record<string, WorkspaceInsightSnapshot>;

export type WorkspaceInsightStoreLoadResult = {
  snapshots: WorkspaceInsightSnapshots;
  status: 'ready' | 'unavailable' | 'error' | 'corrupt';
  error?: string;
};

export type WorkspaceInsightStoreSaveResult = {
  snapshotCount: number;
};

type WorkspaceInsightResponse = {
  risks?: unknown;
  notable_changes?: unknown;
  notableChanges?: unknown;
  decisions?: unknown;
  open_issues?: unknown;
  openIssues?: unknown;
};

type WorkspaceIndexEntry = Pick<Workspace, 'id' | 'status'>;

export const workspaceInsightEmptyLabels: Record<InsightCategoryKey, string> = {
  risks: '확인된 신규 위험 없음',
  notableChanges: '확인된 주요 변화 없음',
  decisions: '확인된 의사결정 필요사항 없음',
  openIssues: '확인된 미해결 이슈 없음',
};

export function getInsightSourceLabel(
  document: WorkspaceInsightSourceDocument,
): string {
  return document.documentId || document.fileName;
}

export function createWorkspaceInsightFingerprint(
  sourceDocuments: WorkspaceInsightSourceDocument[],
): string {
  return JSON.stringify(
    sourceDocuments.map((document) => [
      document.vaultId,
      document.relativePath,
      document.modifiedAt ?? '',
      document.documentId ?? '',
    ]),
  );
}

export function selectWorkspaceInsightSourceDocuments(input: {
  selectedWorkspace: Workspace;
  registryWorkspaces: Workspace[];
  documents: WorkspaceStatusDocument[];
  limit?: number;
}): WorkspaceStatusDocument[] {
  const workspaceIndex = new Map<string, WorkspaceIndexEntry>(
    input.registryWorkspaces.map((workspace) => [
      workspace.id,
      { id: workspace.id, status: workspace.status },
    ]),
  );
  const eligibleDocuments = input.documents.filter((document) =>
    isDocumentEligibleForInsight({
      document,
      selectedWorkspace: input.selectedWorkspace,
      workspaceIndex,
    }),
  );
  const selectedDocuments: WorkspaceStatusDocument[] = [];
  const selectedWorkspaceIds = new Set<string>();

  for (const document of [...eligibleDocuments].sort(
    (left, right) =>
      getInsightScore(right) - getInsightScore(left) ||
      getModifiedTime(right.modifiedAt) - getModifiedTime(left.modifiedAt) ||
      left.fileName.localeCompare(right.fileName),
  )) {
    if (
      isAllWorkspaceScope(input.selectedWorkspace.id) &&
      selectedDocuments.length < 4
    ) {
      const primaryWorkspaceId = document.metadata.workspaceIds.find(
        (workspaceId) => workspaceIndex.get(workspaceId)?.status !== 'archived',
      );

      if (
        primaryWorkspaceId &&
        selectedWorkspaceIds.has(primaryWorkspaceId) &&
        eligibleDocuments.some((candidate) =>
          candidate.metadata.workspaceIds.some(
            (workspaceId) =>
              workspaceId !== primaryWorkspaceId &&
              !selectedWorkspaceIds.has(workspaceId) &&
              workspaceIndex.get(workspaceId)?.status !== 'archived',
          ),
        )
      ) {
        continue;
      }

      if (primaryWorkspaceId) {
        selectedWorkspaceIds.add(primaryWorkspaceId);
      }
    }

    selectedDocuments.push(document);

    if (selectedDocuments.length >= (input.limit ?? 8)) {
      break;
    }
  }

  return selectedDocuments;
}

export function toWorkspaceInsightSourceDocument(
  document: WorkspaceStatusDocument,
): WorkspaceInsightSourceDocument {
  return {
    vaultId: document.vaultId,
    vaultName: document.vaultName,
    relativePath: document.relativePath,
    fileName: document.fileName,
    ...(document.metadata.documentId
      ? { documentId: document.metadata.documentId }
      : {}),
    ...(document.modifiedAt ? { modifiedAt: document.modifiedAt } : {}),
  };
}

export function toWorkspaceInsightContextDocument(
  document: WorkspaceStatusDocument,
): LLMContextDocument {
  return {
    vaultId: document.vaultId,
    vaultName: document.vaultName,
    vaultType: document.vaultType,
    security: document.vaultSecurity,
    ...(document.metadata.security
      ? { documentSecurity: document.metadata.security }
      : {}),
    relativePath: document.relativePath,
    fileName: document.fileName,
    metadata: document.metadata,
    content: document.content,
  };
}

export function buildWorkspaceInsightQuestion(input: {
  selectedWorkspace: Workspace;
  sourceDocuments: WorkspaceInsightSourceDocument[];
}): string {
  const isPortfolio = isAllWorkspaceScope(input.selectedWorkspace.id);
  const scopeInstruction = isPortfolio
    ? '현재 진행 중이거나 보이는 Project/Operation 전체를 Portfolio 관점에서 검토한다.'
    : `현재 Workspace "${input.selectedWorkspace.label}"를 기준으로 검토한다.`;
  const sourceList = input.sourceDocuments
    .map((document, index) => {
      const sourceId = getInsightSourceLabel(document);

      return `${index + 1}. ${sourceId} (${document.relativePath})`;
    })
    .join('\n');

  return `${scopeInstruction}

다음 문서들은 현재 scope의 참고 문서이다.
${sourceList || '- No source documents'}

프로젝트/운영 관리자의 관점에서 최근 변화, 위험, 결정사항, 미해결 이슈를 추출하라.
문서에 없는 사실은 만들지 마라.
각 insight item에는 근거 source를 document_id 우선, 없으면 filename으로 연결하라.
각 category는 0~3개 item만 작성하라.

반드시 아래 JSON object만 출력하라. Markdown code fence를 쓰지 마라.
{
  "risks": [{"text": "...", "sourceDocumentIds": ["DOC-YYYY-NNNN 또는 filename.md"]}],
  "notable_changes": [{"text": "...", "sourceDocumentIds": ["DOC-YYYY-NNNN 또는 filename.md"]}],
  "decisions": [{"text": "...", "sourceDocumentIds": ["DOC-YYYY-NNNN 또는 filename.md"]}],
  "open_issues": [{"text": "...", "sourceDocumentIds": ["DOC-YYYY-NNNN 또는 filename.md"]}]
}`;
}

export function createWorkspaceInsightSnapshot(input: {
  workspaceId: string;
  generatedAt?: string;
  sourceDocuments: WorkspaceInsightSourceDocument[];
  responseContent: string;
}): WorkspaceInsightSnapshot {
  const parsed = parseWorkspaceInsightResponse(input.responseContent);

  return {
    workspaceId: input.workspaceId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceDocuments: input.sourceDocuments,
    sourceFingerprint: createWorkspaceInsightFingerprint(input.sourceDocuments),
    risks: parsed.risks,
    notableChanges: parsed.notableChanges,
    decisions: parsed.decisions,
    openIssues: parsed.openIssues,
  };
}

export function parseWorkspaceInsightSnapshots(
  value: unknown,
): WorkspaceInsightSnapshots {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const candidate = value as { snapshots?: unknown };
  const rawSnapshots =
    candidate.snapshots &&
    typeof candidate.snapshots === 'object' &&
    !Array.isArray(candidate.snapshots)
      ? candidate.snapshots
      : value;
  const snapshots: WorkspaceInsightSnapshots = {};

  for (const [workspaceId, snapshot] of Object.entries(rawSnapshots)) {
    const parsedSnapshot = parseWorkspaceInsightSnapshot(snapshot);

    if (parsedSnapshot && parsedSnapshot.workspaceId === workspaceId) {
      snapshots[workspaceId] = parsedSnapshot;
    }
  }

  return snapshots;
}

export function createWorkspaceInsightStorePayload(
  snapshots: WorkspaceInsightSnapshots,
): {
  version: 1;
  snapshots: WorkspaceInsightSnapshots;
} {
  return {
    version: 1,
    snapshots,
  };
}

function isDocumentEligibleForInsight(input: {
  document: WorkspaceStatusDocument;
  selectedWorkspace: Workspace;
  workspaceIndex: Map<string, WorkspaceIndexEntry>;
}): boolean {
  if (!isAllWorkspaceScope(input.selectedWorkspace.id)) {
    return input.document.metadata.workspaceIds.includes(input.selectedWorkspace.id);
  }

  if (input.document.metadata.workspaceIds.length === 0) {
    return true;
  }

  return input.document.metadata.workspaceIds.some(
    (workspaceId) => input.workspaceIndex.get(workspaceId)?.status !== 'archived',
  );
}

function getInsightScore(document: WorkspaceStatusDocument): number {
  const ageMs = Date.now() - getModifiedTime(document.modifiedAt);
  const dayMs = 24 * 60 * 60 * 1000;
  const recencyScore =
    ageMs <= dayMs
      ? 30
      : ageMs <= 7 * dayMs
        ? 20
        : ageMs <= 30 * dayMs
          ? 10
          : 0;
  const metadataScore = document.hasMetadata ? 5 : 0;
  const workspaceScore = document.metadata.workspaceIds.length > 0 ? 5 : 0;
  const knowledgeScore = document.metadata.knowledgeDomains.length > 0 ? 3 : 0;

  return recencyScore + metadataScore + workspaceScore + knowledgeScore;
}

function getModifiedTime(modifiedAt: string | undefined): number {
  if (!modifiedAt) {
    return 0;
  }

  const timestamp = Date.parse(modifiedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseWorkspaceInsightResponse(content: string): {
  risks: InsightItem[];
  notableChanges: InsightItem[];
  decisions: InsightItem[];
  openIssues: InsightItem[];
} {
  const parsed = parseJsonObject(content);

  if (!parsed) {
    return {
      risks: [],
      notableChanges: [],
      decisions: [],
      openIssues: [],
    };
  }

  return {
    risks: parseInsightItems(parsed.risks),
    notableChanges: parseInsightItems(
      parsed.notable_changes ?? parsed.notableChanges,
    ),
    decisions: parseInsightItems(parsed.decisions),
    openIssues: parseInsightItems(parsed.open_issues ?? parsed.openIssues),
  };
}

function parseJsonObject(content: string): WorkspaceInsightResponse | null {
  const trimmedContent = content.trim();
  const withoutFence = trimmedContent
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  const objectStart = withoutFence.indexOf('{');
  const objectEnd = withoutFence.lastIndexOf('}');

  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(withoutFence.slice(objectStart, objectEnd + 1));

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as WorkspaceInsightResponse)
      : null;
  } catch {
    return null;
  }
}

function parseInsightItems(value: unknown): InsightItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item): InsightItem[] => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const candidate = item as {
        text?: unknown;
        sourceDocumentIds?: unknown;
        source_document_ids?: unknown;
      };
      const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
      const rawSourceIds = candidate.sourceDocumentIds ?? candidate.source_document_ids;

      if (!text) {
        return [];
      }

      return [
        {
          text,
          sourceDocumentIds: parseStringArray(rawSourceIds).slice(0, 5),
        },
      ];
    })
    .slice(0, 3);
}

function parseWorkspaceInsightSnapshot(
  value: unknown,
): WorkspaceInsightSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkspaceInsightSnapshot>;

  if (
    typeof candidate.workspaceId !== 'string' ||
    typeof candidate.generatedAt !== 'string' ||
    typeof candidate.sourceFingerprint !== 'string' ||
    !Array.isArray(candidate.sourceDocuments)
  ) {
    return null;
  }

  return {
    workspaceId: candidate.workspaceId,
    generatedAt: candidate.generatedAt,
    sourceDocuments: candidate.sourceDocuments.flatMap(
      (document): WorkspaceInsightSourceDocument[] =>
        parseWorkspaceInsightSourceDocument(document),
    ),
    sourceFingerprint: candidate.sourceFingerprint,
    risks: parseInsightItems(candidate.risks),
    notableChanges: parseInsightItems(candidate.notableChanges),
    decisions: parseInsightItems(candidate.decisions),
    openIssues: parseInsightItems(candidate.openIssues),
  };
}

function parseWorkspaceInsightSourceDocument(
  value: unknown,
): WorkspaceInsightSourceDocument[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<WorkspaceInsightSourceDocument>;

  if (
    typeof candidate.vaultId !== 'string' ||
    typeof candidate.vaultName !== 'string' ||
    typeof candidate.relativePath !== 'string' ||
    typeof candidate.fileName !== 'string'
  ) {
    return [];
  }

  return [
    {
      vaultId: candidate.vaultId,
      vaultName: candidate.vaultName,
      relativePath: candidate.relativePath,
      fileName: candidate.fileName,
      ...(typeof candidate.documentId === 'string' && candidate.documentId
        ? { documentId: candidate.documentId }
        : {}),
      ...(typeof candidate.modifiedAt === 'string' && candidate.modifiedAt
        ? { modifiedAt: candidate.modifiedAt }
        : {}),
    },
  ];
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  ];
}
