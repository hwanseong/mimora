import { getEffectiveContentOrigin } from './contentOrigin';
import type { MimoraDocumentMetadata } from './metadata/types';
import type { VaultConfig, VaultSecurity, VaultType } from './settings';
import {
  isAllWorkspaceScope,
  workspaceStatusLabels,
  type Workspace,
} from './workspaces';

export type WorkspaceStatusDocument = {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  vaultSecurity: VaultSecurity;
  relativePath: string;
  fileName: string;
  modifiedAt?: string;
  content: string;
  hasMetadata: boolean;
  metadata: MimoraDocumentMetadata;
};

export type WorkspaceStatusDocumentCounts = {
  total: number;
  original: number;
  aiWiki: number;
  private: number;
};

export type WorkspaceStatusKnowledgeItem = {
  domain: string;
  count: number;
};

export type WorkspaceStatusRecentDocument = {
  vaultName: string;
  relativePath: string;
  fileName: string;
  modifiedAt?: string;
  isAiWiki: boolean;
  isPrivate: boolean;
};

export type PortfolioWorkspaceCounts = {
  projects: number;
  operations: number;
  planned: number;
  active: number;
  onHold: number;
  closed: number;
};

export type WorkspaceStatusPanelModel =
  | {
      scope: 'portfolio';
      workspaceLabel: string;
      portfolio: PortfolioWorkspaceCounts;
      documents: WorkspaceStatusDocumentCounts;
      knowledge: WorkspaceStatusKnowledgeItem[];
      recentDocuments: WorkspaceStatusRecentDocument[];
      scannedDocumentCount: number;
      registryUnavailable: boolean;
    }
  | {
      scope: 'workspace';
      workspaceLabel: string;
      workspaceTypeLabel: string;
      workspaceStatusLabel: string;
      periodLabel: string;
      documents: WorkspaceStatusDocumentCounts;
      knowledge: WorkspaceStatusKnowledgeItem[];
      recentDocuments: WorkspaceStatusRecentDocument[];
      scannedDocumentCount: number;
      registryUnavailable: boolean;
    };

type CreateWorkspaceStatusPanelModelInput = {
  selectedWorkspace: Workspace;
  registryWorkspaces: Workspace[];
  documents: WorkspaceStatusDocument[];
  registryUnavailable: boolean;
};

export function createWorkspaceStatusDocument(input: {
  vault: VaultConfig;
  relativePath: string;
  fileName: string;
  modifiedAt?: string;
  content: string;
  hasMetadata: boolean;
  metadata: MimoraDocumentMetadata;
}): WorkspaceStatusDocument {
  return {
    vaultId: input.vault.id,
    vaultName: input.vault.name,
    vaultType: input.vault.type,
    vaultSecurity: input.vault.security,
    relativePath: input.relativePath,
    fileName: input.fileName,
    ...(input.modifiedAt ? { modifiedAt: input.modifiedAt } : {}),
    content: input.content,
    hasMetadata: input.hasMetadata,
    metadata: input.metadata,
  };
}

export function createWorkspaceStatusPanelModel({
  selectedWorkspace,
  registryWorkspaces,
  documents,
  registryUnavailable,
}: CreateWorkspaceStatusPanelModelInput): WorkspaceStatusPanelModel {
  const scopedDocuments = isAllWorkspaceScope(selectedWorkspace.id)
    ? documents
    : documents.filter((document) =>
        document.metadata.workspaceIds.includes(selectedWorkspace.id),
      );
  const baseModel = {
    documents: countDocuments(scopedDocuments),
    knowledge: aggregateKnowledgeDomains(scopedDocuments),
    recentDocuments: getRecentDocuments(scopedDocuments),
    scannedDocumentCount: documents.length,
    registryUnavailable,
  };

  if (isAllWorkspaceScope(selectedWorkspace.id)) {
    return {
      scope: 'portfolio',
      workspaceLabel: selectedWorkspace.label,
      portfolio: countPortfolioWorkspaces(registryWorkspaces),
      ...baseModel,
    };
  }

  return {
    scope: 'workspace',
    workspaceLabel: selectedWorkspace.label,
    workspaceTypeLabel: formatWorkspaceType(selectedWorkspace.type),
    workspaceStatusLabel: workspaceStatusLabels[selectedWorkspace.status],
    periodLabel: formatWorkspacePeriod(
      selectedWorkspace.startDate,
      selectedWorkspace.endDate,
    ),
    ...baseModel,
  };
}

function countPortfolioWorkspaces(
  registryWorkspaces: Workspace[],
): PortfolioWorkspaceCounts {
  const activePortfolioWorkspaces = registryWorkspaces.filter(
    (workspace) => workspace.status !== 'archived',
  );

  return {
    projects: activePortfolioWorkspaces.filter(
      (workspace) => workspace.type === 'project',
    ).length,
    operations: activePortfolioWorkspaces.filter(
      (workspace) => workspace.type === 'operation',
    ).length,
    planned: activePortfolioWorkspaces.filter(
      (workspace) => workspace.status === 'planned',
    ).length,
    active: activePortfolioWorkspaces.filter(
      (workspace) => workspace.status === 'active',
    ).length,
    onHold: activePortfolioWorkspaces.filter(
      (workspace) => workspace.status === 'on_hold',
    ).length,
    closed: activePortfolioWorkspaces.filter(
      (workspace) => workspace.status === 'closed',
    ).length,
  };
}

function countDocuments(
  documents: WorkspaceStatusDocument[],
): WorkspaceStatusDocumentCounts {
  return {
    total: documents.length,
    original: documents.filter(
      (document) => getEffectiveContentOrigin(document.metadata) !== 'ai-derived',
    ).length,
    aiWiki: documents.filter(
      (document) => getEffectiveContentOrigin(document.metadata) === 'ai-derived',
    ).length,
    private: documents.filter(
      (document) => document.metadata.security === 'private',
    ).length,
  };
}

function aggregateKnowledgeDomains(
  documents: WorkspaceStatusDocument[],
): WorkspaceStatusKnowledgeItem[] {
  const counts = new Map<string, number>();

  for (const document of documents) {
    for (const domain of document.metadata.knowledgeDomains) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.domain.localeCompare(right.domain),
    )
    .slice(0, 5);
}

function getRecentDocuments(
  documents: WorkspaceStatusDocument[],
): WorkspaceStatusRecentDocument[] {
  return [...documents]
    .sort(
      (left, right) =>
        getModifiedTime(right.modifiedAt) - getModifiedTime(left.modifiedAt) ||
        left.fileName.localeCompare(right.fileName),
    )
    .slice(0, 5)
    .map((document) => ({
      vaultName: document.vaultName,
      relativePath: document.relativePath,
      fileName: document.fileName,
      modifiedAt: document.modifiedAt,
      isAiWiki: getEffectiveContentOrigin(document.metadata) === 'ai-derived',
      isPrivate: document.metadata.security === 'private',
    }));
}

function getModifiedTime(modifiedAt: string | undefined): number {
  if (!modifiedAt) {
    return 0;
  }

  const timestamp = Date.parse(modifiedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatWorkspaceType(type: string): string {
  if (type === 'project') {
    return 'Project';
  }

  if (type === 'operation') {
    return 'Operation';
  }

  if (type === 'private') {
    return 'Private';
  }

  return type || 'Workspace';
}

function formatWorkspacePeriod(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) {
    return '-';
  }

  return `${startDate || '-'} ~ ${endDate || '-'}`;
}
