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

type ContextPanelProps = {
  selectedWorkspace: Workspace;
  registryRuntimeMode: RegistryRuntimeMode;
  registryWorkspaces: Workspace[];
  isKnowledgeDomainRegistryAvailable: boolean;
  isKnowledgeTypeRegistryAvailable: boolean;
  knowledgeDomainOptions: KnowledgeDomain[];
  knowledgeTypeOptions: KnowledgeType[];
  refreshSignal: number;
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

export function ContextPanel({
  selectedWorkspace,
  registryRuntimeMode,
  registryWorkspaces,
  isKnowledgeDomainRegistryAvailable,
  isKnowledgeTypeRegistryAvailable,
  knowledgeDomainOptions,
  knowledgeTypeOptions,
  refreshSignal,
}: ContextPanelProps) {
  const [documents, setDocuments] = useState<WorkspaceStatusDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    refreshSignal,
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

  return (
    <aside className="context-panel" aria-label="업무 현황">
      <header className="context-panel-header">
        <h2>업무 현황</h2>
        {isLoading ? <span>계산 중</span> : null}
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

      <p className="context-panel-footnote">
        Scanned {model.scannedDocumentCount.toLocaleString()} Markdown files.
      </p>
    </aside>
  );
}
