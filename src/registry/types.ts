export const registryFileRelativePaths = {
  workspaces: '_mimora/workspaces.md',
  'knowledge-domains': '_mimora/knowledge-domains.md',
  'knowledge-types': '_mimora/knowledge-types.md',
} as const;

export type RegistryFileKey = keyof typeof registryFileRelativePaths;

export type RegistrySettings = {
  homeVaultId: string | null;
};

export type RegistryFileStatus = {
  key: RegistryFileKey;
  relativePath: string;
  exists: boolean;
};

export type RegistryStatus = {
  homeVaultId: string | null;
  homeVaultAvailable: boolean;
  files: RegistryFileStatus[];
};

export const defaultRegistrySettings: RegistrySettings = {
  homeVaultId: null,
};
