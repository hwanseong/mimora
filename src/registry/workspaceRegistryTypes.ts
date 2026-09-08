import type { Workspace } from '../workspace/types';
import type {
  RegistryRuntimeIssue,
  RegistryRuntimeMode,
  RegistryRuntimeSource,
} from './types';

export type WorkspaceRegistryFrontmatter = {
  registryType: 'workspaces';
  registryVersion: number;
};

export type WorkspaceRegistryRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  description: string;
  rowNumber: number;
};

export type RegistryValidationSeverity = 'error' | 'warning';

export type WorkspaceRegistryValidationIssue = {
  severity: RegistryValidationSeverity;
  code: string;
  message: string;
  row?: number;
  workspaceId?: string;
  field?: string;
};

export type WorkspaceRegistryLoadState =
  | 'unavailable'
  | 'inaccessible'
  | 'not-found'
  | 'loaded'
  | 'loaded-with-errors';

export type WorkspaceRegistryParseResult = {
  state: WorkspaceRegistryLoadState;
  registryVersion: number | null;
  workspaces: Workspace[];
  issues: WorkspaceRegistryValidationIssue[];
  valid: boolean;
  message?: string;
  runtimeMode?: RegistryRuntimeMode;
  source?: RegistryRuntimeSource;
  lastSuccessfulLoad?: string;
  runtimeIssues?: RegistryRuntimeIssue[];
};
