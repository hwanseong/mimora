import {
  workspaceIdPattern,
  type Workspace as RegistryWorkspace,
  type WorkspaceStatus,
  type WorkspaceType,
} from './workspace/types';

export type { WorkspaceStatus, WorkspaceType };

export type Workspace = RegistryWorkspace & {
  label: string;
  isSystem?: boolean;
};

export type WorkspaceSection = {
  title: string;
  items: Workspace[];
  message?: string;
};

export const allWorkspaceId = '__all__';
export const legacyAllWorkspaceId = 'all';

export function isAllWorkspaceScope(workspaceId: string): boolean {
  return workspaceId === allWorkspaceId || workspaceId === legacyAllWorkspaceId;
}

export const defaultWorkspace: Workspace = {
  id: allWorkspaceId,
  name: '전체 업무',
  label: '전체 업무',
  type: 'all',
  status: 'active',
  isSystem: true,
};

export function isChatHistoryWorkspaceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === allWorkspaceId ||
      value === legacyAllWorkspaceId ||
      workspaceIdPattern.test(value))
  );
}

export function normalizeChatHistoryWorkspaceId(workspaceId: string): string {
  return workspaceId === legacyAllWorkspaceId ? allWorkspaceId : workspaceId;
}

export function toSelectableWorkspace(
  workspace: RegistryWorkspace,
): Workspace {
  return {
    ...workspace,
    label: workspace.name,
  };
}

function byRegistryOrder(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => workspace.status !== 'archived');
}

export function createWorkspaceSections({
  registryWorkspaces,
  registryUnavailable,
}: {
  registryWorkspaces: Workspace[];
  registryUnavailable: boolean;
}): WorkspaceSection[] {
  const visibleWorkspaces = byRegistryOrder(registryWorkspaces);
  const projects = visibleWorkspaces.filter(
    (workspace) => workspace.type === 'project',
  );
  const operations = visibleWorkspaces.filter(
    (workspace) => workspace.type === 'operation',
  );
  const otherWorkspaces = visibleWorkspaces.filter(
    (workspace) =>
      workspace.type !== 'project' && workspace.type !== 'operation',
  );
  const sections: WorkspaceSection[] = [
    {
      title: 'Workspace',
      items: [defaultWorkspace],
    },
  ];

  if (registryUnavailable) {
    sections.push({
      title: 'Projects',
      items: [],
      message: 'Workspace Registry를 사용할 수 없습니다.',
    });
    return sections;
  }

  sections.push({
    title: 'Projects',
    items: projects,
  });
  sections.push({
    title: 'Operations',
    items: operations,
  });

  if (otherWorkspaces.length > 0) {
    sections.push({
      title: 'Other Workspaces',
      items: otherWorkspaces,
    });
  }

  return sections;
}

export function createSelectableWorkspaces(
  sections: WorkspaceSection[],
): Workspace[] {
  return sections.flatMap((section) => section.items);
}
