export const workspaceTypeOptions = ['project', 'operation'] as const;

export type WorkspaceType = string;
export type WorkspaceSecurity = 'internal' | 'private';

export const workspaceSecurityOptions = [
  'internal',
  'private',
] as const satisfies WorkspaceSecurity[];

export type WorkspaceStatus =
  | 'active'
  | 'closed'
  | 'archived';

export const workspaceStatusOptions = [
  'active',
  'closed',
  'archived',
] as const satisfies WorkspaceStatus[];

export type Workspace = {
  id: string;
  name: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  security: WorkspaceSecurity;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
};

export type WorkspaceRegistryRecord = {
  id: string;
  name: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  security?: WorkspaceSecurity;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
};

export const workspaceIdPattern = /^WS-\d{4}-\d{4}$/u;
