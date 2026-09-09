import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeDomain } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeType } from '../registry/knowledgeTypeRegistryTypes';
import type { RegistryRuntimeMode } from '../registry/types';
import type { VaultConfig } from '../settings';
import { parseMimoraDocumentMetadata } from '../metadata/mimoraMetadataParser';
import type { VaultFile } from '../vaultFiles';
import type { Workspace } from '../workspaces';
import {
  createWorkspaceStatusDocument,
  createWorkspaceStatusPanelModel,
  type WorkspaceStatusDocument,
  type WorkspaceStatusPanelModel,
} from '../workspaceStatusPanel';
import {
  buildWorkspaceInsightQuestion,
  createWorkspaceInsightFingerprint,
  createWorkspaceInsightSnapshot,
  getInsightSourceLabel,
  selectWorkspaceInsightSourceDocuments,
  toWorkspaceInsightContextDocument,
  toWorkspaceInsightSourceDocument,
  workspaceInsightEmptyLabels,
  type InsightCategoryKey,
  type InsightItem,
  type WorkspaceInsightSnapshot,
  type WorkspaceInsightSnapshots,
} from '../workspaceInsight';

type ContextPanelProps = {
  selectedWorkspace: Workspace;
  registryRuntimeMode: RegistryRuntimeMode;
  registryWorkspaces: Workspace[];
  isKnowledgeDomainRegistryAvailable: boolean;
  isKnowledgeTypeRegistryAvailable: boolean;
  knowledgeDomainOptions: KnowledgeDomain[];
  knowledgeTypeOptions: KnowledgeType[];
  documentRefreshSignal: number;
  onRefreshDocuments: () => void;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function createKnowledgeDomainRegistry(
  domains: KnowledgeDomain[],
  isAvailable: boolean,
) {
  return isAvailable ? { version: 0, domains } : null;
}

function createKnowledgeTypeRegistry(
  types: KnowledgeType[],
  isAvailable: boolean,
) {
  return isAvailable ? { version: 0, types } : null;
}

async function loadWorkspaceStatusDocuments(input: {
  vaults: VaultConfig[];
  registryWorkspaces: Workspace[];
  knowledgeDomainOptions: KnowledgeDomain[];
  knowledgeTypeOptions: KnowledgeType[];
  isKnowledgeDomainRegistryAvailable: boolean;
  isKnowledgeTypeRegistryAvailable: boolean;
}): Promise<WorkspaceStatusDocument[]> {
  const knowledgeDomainRegistry = createKnowledgeDomainRegistry(
    input.knowledgeDomainOptions,
    input.isKnowledgeDomainRegistryAvailable,
  );
  const knowledgeTypeRegistry = createKnowledgeTypeRegistry(
    input.knowledgeTypeOptions,
    input.isKnowledgeTypeRegistryAvailable,
  );
  const knownWorkspaceIds = input.registryWorkspaces.map(
    (workspace) => workspace.id,
  );
  const documents: WorkspaceStatusDocument[] = [];

  for (const vault of input.vaults) {
    const files = await window.mimora.listVaultFiles(vault.id);

    for (const file of files) {
      const content = await window.mimora.readVaultFile(
        vault.id,
        file.relativePath,
      );
      const metadataResult = parseMimoraDocumentMetadata(content.content, {
        knownWorkspaceIds,
        knowledgeDomainRegistry,
        knowledgeTypeRegistry,
        knowledgeDomainRegistryUnavailable:
          !input.isKnowledgeDomainRegistryAvailable,
        knowledgeTypeRegistryUnavailable: !input.isKnowledgeTypeRegistryAvailable,
      });

      documents.push(
        createWorkspaceStatusDocument({
          vault,
          relativePath: file.relativePath,
          fileName: file.name,
          modifiedAt: file.modifiedAt,
          content: content.content,
          hasMetadata: metadataResult.hasMetadata,
          metadata: metadataResult.metadata,
        }),
      );
    }
  }

  return documents;
}

function formatRelativeTime(modifiedAt: string | undefined): string {
  if (!modifiedAt) {
    return '-';
  }

  const timestamp = Date.parse(modifiedAt);

  if (!Number.isFinite(timestamp)) {
    return '-';
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (elapsedSeconds < 60) {
    return '방금 전';
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 7) {
    return `${elapsedDays}일 전`;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function renderWorkspaceSummary(model: WorkspaceStatusPanelModel) {
  if (model.scope === 'portfolio') {
    return (
      <section className="context-section" aria-labelledby="portfolio-heading">
        <h3 id="portfolio-heading">Workspaces</h3>
        <div className="context-stat-list compact">
          <span>Projects</span>
          <strong>{model.portfolio.projects}</strong>
          <span>Operations</span>
          <strong>{model.portfolio.operations}</strong>
          <span>Planned</span>
          <strong>{model.portfolio.planned}</strong>
          <span>Active</span>
          <strong>{model.portfolio.active}</strong>
          <span>On Hold</span>
          <strong>{model.portfolio.onHold}</strong>
          <span>Closed</span>
          <strong>{model.portfolio.closed}</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="context-section" aria-labelledby="workspace-summary-heading">
      <h3 id="workspace-summary-heading">Workspace Summary</h3>
      <div className="workspace-context-summary">
        <strong>{model.workspaceLabel}</strong>
        <span>
          {model.workspaceTypeLabel} · {model.workspaceStatusLabel}
        </span>
        <span>Period {model.periodLabel}</span>
      </div>
    </section>
  );
}

function renderDocuments(model: WorkspaceStatusPanelModel) {
  return (
    <section className="context-section" aria-labelledby="documents-heading">
      <h3 id="documents-heading">Documents</h3>
      <div className="context-stat-list">
        <span>Total</span>
        <strong>{model.documents.total}</strong>
        <span>Original</span>
        <strong>{model.documents.original}</strong>
        <span>AI Wiki</span>
        <strong>{model.documents.aiWiki}</strong>
        <span>Private</span>
        <strong>{model.documents.private}</strong>
      </div>
    </section>
  );
}

function renderKnowledge(model: WorkspaceStatusPanelModel) {
  return (
    <section className="context-section" aria-labelledby="knowledge-heading">
      <h3 id="knowledge-heading">Knowledge</h3>
      {model.knowledge.length > 0 ? (
        <ul className="context-ranked-list">
          {model.knowledge.map((item) => (
            <li key={item.domain}>
              <span>{item.domain}</span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="context-empty">등록된 지식 메타데이터 없음</p>
      )}
    </section>
  );
}

function renderRecentDocuments(model: WorkspaceStatusPanelModel) {
  return (
    <section className="context-section" aria-labelledby="recent-documents-heading">
      <h3 id="recent-documents-heading">최근 변경</h3>
      {model.recentDocuments.length > 0 ? (
        <ul className="context-recent-list">
          {model.recentDocuments.map((document) => (
            <li key={`${document.vaultName}:${document.relativePath}`}>
              <div>
                <strong title={document.relativePath}>{document.fileName}</strong>
                <span>{formatRelativeTime(document.modifiedAt)}</span>
              </div>
              <div className="context-document-badges">
                {document.isAiWiki ? <em>AI Wiki</em> : null}
                {document.isPrivate ? <em>Private</em> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="context-empty">관련 문서 없음</p>
      )}
    </section>
  );
}

const insightCategoryLabels: Record<InsightCategoryKey, string> = {
  risks: 'Risks',
  notableChanges: 'Notable Changes',
  decisions: 'Decisions',
  openIssues: 'Open Issues',
};

function formatGeneratedAt(generatedAt: string): string {
  const timestamp = Date.parse(generatedAt);

  if (!Number.isFinite(timestamp)) {
    return generatedAt;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function renderInsightItems(
  category: InsightCategoryKey,
  items: InsightItem[],
) {
  if (items.length === 0) {
    return <p className="context-empty">{workspaceInsightEmptyLabels[category]}</p>;
  }

  return (
    <ul className="insight-item-list">
      {items.map((item, index) => (
        <li key={`${category}:${index}:${item.text}`}>
          <p>{item.text}</p>
          {item.sourceDocumentIds.length > 0 ? (
            <span title={item.sourceDocumentIds.join(', ')}>
              {formatInsightSources(item.sourceDocumentIds)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatInsightSources(sourceDocumentIds: string[]): string {
  if (sourceDocumentIds.length > 2) {
    return `Sources ${sourceDocumentIds.length}`;
  }

  return `Sources: ${sourceDocumentIds.join(', ')}`;
}

function renderInsightCategory(
  category: InsightCategoryKey,
  items: InsightItem[],
) {
  return (
    <div className="insight-category" key={category}>
      <h4>{insightCategoryLabels[category]}</h4>
      {renderInsightItems(category, items)}
    </div>
  );
}

function getInsightItems(
  snapshot: WorkspaceInsightSnapshot,
  category: InsightCategoryKey,
): InsightItem[] {
  if (category === 'risks') {
    return snapshot.risks;
  }

  if (category === 'notableChanges') {
    return snapshot.notableChanges;
  }

  if (category === 'decisions') {
    return snapshot.decisions;
  }

  return snapshot.openIssues;
}

export function ContextPanel({
  selectedWorkspace,
  registryRuntimeMode,
  registryWorkspaces,
  isKnowledgeDomainRegistryAvailable,
  isKnowledgeTypeRegistryAvailable,
  knowledgeDomainOptions,
  knowledgeTypeOptions,
  documentRefreshSignal,
  onRefreshDocuments,
}: ContextPanelProps) {
  const [documents, setDocuments] = useState<WorkspaceStatusDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [insightSnapshots, setInsightSnapshots] =
    useState<WorkspaceInsightSnapshots>({});
  const [insightStoreError, setInsightStoreError] = useState<string | null>(null);
  const [insightGenerationError, setInsightGenerationError] =
    useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadInsightSnapshots(): Promise<void> {
      try {
        const result = await window.mimora.loadWorkspaceInsights();

        if (!isActive) {
          return;
        }

        setInsightSnapshots(result.snapshots);
        setInsightStoreError(result.status === 'ready' ? null : result.error ?? null);
      } catch (error) {
        if (isActive) {
          setInsightSnapshots({});
          setInsightStoreError(
            getErrorMessage(error, 'AI Insight snapshot을 불러오지 못했습니다.'),
          );
        }
      }
    }

    void loadInsightSnapshots();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadDocuments(): Promise<void> {
      setIsLoading(true);
      setLoadError(null);

      try {
        const settings = await window.mimora.getSettings();
        const nextDocuments = await loadWorkspaceStatusDocuments({
          vaults: settings.vaults,
          registryWorkspaces,
          knowledgeDomainOptions,
          knowledgeTypeOptions,
          isKnowledgeDomainRegistryAvailable,
          isKnowledgeTypeRegistryAvailable,
        });

        if (isActive) {
          setDocuments(nextDocuments);
        }
      } catch (error) {
        if (isActive) {
          setDocuments([]);
          setLoadError(
            getErrorMessage(error, '업무현황 문서 통계를 불러오지 못했습니다.'),
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadDocuments();

    return () => {
      isActive = false;
    };
  }, [
    isKnowledgeDomainRegistryAvailable,
    isKnowledgeTypeRegistryAvailable,
    knowledgeDomainOptions,
    knowledgeTypeOptions,
    documentRefreshSignal,
    registryWorkspaces,
  ]);

  const model = useMemo(
    () =>
      createWorkspaceStatusPanelModel({
        selectedWorkspace,
        registryWorkspaces,
        documents,
        registryUnavailable: registryRuntimeMode === 'unresolved',
      }),
    [documents, registryRuntimeMode, registryWorkspaces, selectedWorkspace],
  );
  const insightSourceDocuments = useMemo(
    () =>
      selectWorkspaceInsightSourceDocuments({
        selectedWorkspace,
        registryWorkspaces,
        documents,
        limit: 8,
      }),
    [documents, registryWorkspaces, selectedWorkspace],
  );
  const insightSourceRefs = useMemo(
    () => insightSourceDocuments.map(toWorkspaceInsightSourceDocument),
    [insightSourceDocuments],
  );
  const currentInsightFingerprint = useMemo(
    () => createWorkspaceInsightFingerprint(insightSourceRefs),
    [insightSourceRefs],
  );
  const currentInsight = insightSnapshots[selectedWorkspace.id] ?? null;
  const isInsightStale = Boolean(
    currentInsight &&
      currentInsight.sourceFingerprint !== currentInsightFingerprint,
  );

  async function generateWorkspaceInsight(): Promise<void> {
    if (isGeneratingInsight || insightSourceDocuments.length === 0) {
      return;
    }

    setIsGeneratingInsight(true);
    setInsightGenerationError(null);

    try {
      const response = await window.mimora.chatWithLocalAI({
        workspaceId: selectedWorkspace.id,
        question: buildWorkspaceInsightQuestion({
          selectedWorkspace,
          sourceDocuments: insightSourceRefs,
        }),
        history: [],
        manualContexts: [],
        autoContexts: insightSourceDocuments.map(
          toWorkspaceInsightContextDocument,
        ),
      });
      const snapshot = createWorkspaceInsightSnapshot({
        workspaceId: selectedWorkspace.id,
        generatedAt: new Date().toISOString(),
        sourceDocuments: insightSourceRefs,
        responseContent: response.content,
      });

      setInsightSnapshots((currentSnapshots) => ({
        ...currentSnapshots,
        [snapshot.workspaceId]: snapshot,
      }));
      await window.mimora.saveWorkspaceInsight(snapshot);
      setInsightStoreError(null);
    } catch (error) {
      setInsightGenerationError(
        getErrorMessage(
          error,
          'Local AI에 연결할 수 없어 Insight를 생성하지 못했습니다.',
        ),
      );
    } finally {
      setIsGeneratingInsight(false);
    }
  }

  return (
    <aside className="context-panel" aria-label="업무 현황">
      <header className="context-panel-header">
        <h2>업무 현황</h2>
        <div>
          {isLoading ? <span>계산 중</span> : null}
          <button
            className="context-action-button"
            disabled={isLoading}
            onClick={onRefreshDocuments}
            type="button"
          >
            새로고침
          </button>
        </div>
      </header>

      {model.registryUnavailable ? (
        <p className="context-panel-note">
          Registry unavailable. 가능한 문서 통계만 표시합니다.
        </p>
      ) : null}
      {loadError ? (
        <p className="context-panel-error" role="status">
          {loadError}
        </p>
      ) : null}

      {renderWorkspaceSummary(model)}
      {renderDocuments(model)}
      {renderKnowledge(model)}
      {renderRecentDocuments(model)}
      <section className="context-section" aria-labelledby="ai-insight-heading">
        <div className="insight-section-header">
          <h3 id="ai-insight-heading">AI Insight</h3>
          <button
            className="context-action-button"
            disabled={isGeneratingInsight || insightSourceDocuments.length === 0}
            onClick={() => {
              void generateWorkspaceInsight();
            }}
            type="button"
          >
            {currentInsight ? '새로고침' : '생성'}
          </button>
        </div>
        {isGeneratingInsight ? (
          <p className="context-empty">AI Insight 분석 중...</p>
        ) : null}
        {insightStoreError ? (
          <p className="context-panel-error" role="status">
            {insightStoreError}
          </p>
        ) : null}
        {insightGenerationError ? (
          <p className="context-panel-error" role="status">
            {insightGenerationError}
          </p>
        ) : null}
        {currentInsight ? (
          <div className="insight-snapshot">
            <p className="insight-generated-at">
              마지막 분석: {formatGeneratedAt(currentInsight.generatedAt)}
            </p>
            {isInsightStale ? (
              <p className="context-panel-note">
                Vault 변경 이후 다시 분석하지 않았습니다.
              </p>
            ) : null}
            <p className="insight-source-summary">
              Sources {currentInsight.sourceDocuments.length.toLocaleString()}
            </p>
            {(
              [
                'risks',
                'notableChanges',
                'decisions',
                'openIssues',
              ] satisfies InsightCategoryKey[]
            ).map((category) =>
              renderInsightCategory(category, getInsightItems(currentInsight, category)),
            )}
          </div>
        ) : (
          <p className="context-empty">
            {insightSourceDocuments.length > 0
              ? '아직 생성된 AI Insight가 없습니다.'
              : 'Insight를 생성할 관련 문서가 없습니다.'}
          </p>
        )}
      </section>

      <p className="context-panel-footnote">
        Scanned {model.scannedDocumentCount.toLocaleString()} Markdown files.
      </p>
    </aside>
  );
}
