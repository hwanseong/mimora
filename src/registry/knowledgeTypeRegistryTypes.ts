import type { RegistryValidationSeverity } from './workspaceRegistryTypes';

export type KnowledgeTypeRegistryFrontmatter = {
  registryType: 'knowledge-types';
  registryVersion: number;
};

export type KnowledgeType = {
  canonicalName: string;
  description?: string | null;
};

export type KnowledgeTypeRegistry = {
  version: number;
  types: KnowledgeType[];
};

export type KnowledgeTypeRegistryRow = {
  canonicalName: string;
  description: string;
  rowNumber: number;
};

export type KnowledgeTypeRegistryValidationIssue = {
  severity: RegistryValidationSeverity;
  code: string;
  message: string;
  row?: number;
  canonicalName?: string;
  field?: string;
};

export type KnowledgeTypeRegistryParseResult = {
  state:
    | 'unavailable'
    | 'inaccessible'
    | 'not-found'
    | 'loaded'
    | 'loaded-with-errors';
  registryVersion: number | null;
  registry: KnowledgeTypeRegistry | null;
  types: KnowledgeType[];
  issues: KnowledgeTypeRegistryValidationIssue[];
  valid: boolean;
  message?: string;
};
