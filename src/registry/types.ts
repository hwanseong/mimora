export const registryFileRelativePaths = {
  workspaces: '_mimora/workspaces.md',
  'knowledge-domains': '_mimora/knowledge-domains.md',
  'knowledge-types': '_mimora/knowledge-types.md',
} as const;

export type RegistryFileKey = keyof typeof registryFileRelativePaths;

export type RegistrySettings = {
  homeVaultId: string | null;
};

export type RegistryRuntimeMode = 'normal' | 'degraded' | 'unresolved';

export type RegistryRuntimeSource = 'registry' | 'cache' | 'none';

export type RegistryRuntimeIssue = {
  registry: RegistryFileKey | 'home';
  code: string;
  message: string;
};

export type RegistryRuntimeSummary = {
  mode: RegistryRuntimeMode;
  source: RegistryRuntimeSource;
  loadedAt?: string;
  lastSuccessfulLoad?: string;
  cacheVersion?: number;
  homeVaultId: string | null;
  homeVaultPath?: string;
  workspaceCount: number;
  knowledgeDomainCount: number;
  knowledgeTypeCount: number;
  issues: RegistryRuntimeIssue[];
};

export type RegistryFileStatus = {
  key: RegistryFileKey;
  relativePath: string;
  exists: boolean;
  modifiedAt?: string;
  size?: number;
};

export type RegistryStatus = {
  homeVaultId: string | null;
  homeVaultAvailable: boolean;
  files: RegistryFileStatus[];
  runtime: RegistryRuntimeSummary;
};

export const defaultRegistrySettings: RegistrySettings = {
  homeVaultId: null,
};
