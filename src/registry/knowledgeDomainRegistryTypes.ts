import type { RegistryValidationSeverity } from './workspaceRegistryTypes';

export type KnowledgeDomainRegistryFrontmatter = {
  registryType: 'knowledge-domains';
  registryVersion: number;
};

export type KnowledgeDomain = {
  canonicalName: string;
  aliases: string[];
  description?: string | null;
};

export type KnowledgeDomainRegistry = {
  version: number;
  domains: KnowledgeDomain[];
};

export type KnowledgeDomainRegistryRow = {
  canonicalName: string;
  aliases: string;
  description: string;
  rowNumber: number;
};

export type KnowledgeRegistryLoadState =
  | 'unavailable'
  | 'inaccessible'
  | 'not-found'
  | 'loaded'
  | 'loaded-with-errors';

export type KnowledgeRegistryValidationIssue = {
  severity: RegistryValidationSeverity;
  code: string;
  message: string;
  row?: number;
  canonicalName?: string;
  field?: string;
};

export type KnowledgeDomainRegistryParseResult = {
  state: KnowledgeRegistryLoadState;
  registryVersion: number | null;
  registry: KnowledgeDomainRegistry | null;
  domains: KnowledgeDomain[];
  issues: KnowledgeRegistryValidationIssue[];
  valid: boolean;
  message?: string;
};

export type KnowledgeDomainResolveResult = {
  input: string;
  canonicalName: string | null;
  matchedBy: 'canonical' | 'alias' | 'none';
};
