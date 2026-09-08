export type WorkspaceType = string;

export type WorkspaceStatus =
  | 'planned'
  | 'active'
  | 'on_hold'
  | 'closed'
  | 'archived';

export const workspaceStatusOptions = [
  'planned',
  'active',
  'on_hold',
  'closed',
  'archived',
] as const satisfies WorkspaceStatus[];

export type Workspace = {
  id: string;
  name: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
};

export type WorkspaceRegistryRecord = {
  id: string;
  name: string;
  type: WorkspaceType;
  status: WorkspaceStatus;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
};

export const workspaceIdPattern = /^WS-\d{4}-\d{4}$/u;
