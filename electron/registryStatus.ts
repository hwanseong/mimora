import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  registryFileRelativePaths,
  type RegistryFileKey,
  type RegistryFileStatus,
  type RegistryRuntimeIssue,
  type RegistryRuntimeSummary,
  type RegistryStatus,
} from '../src/registry/types';
import { parseKnowledgeDomainRegistry } from '../src/registry/knowledgeDomainRegistryParser';
import type {
  KnowledgeDomain,
  KnowledgeDomainRegistry,
  KnowledgeDomainRegistryParseResult,
  KnowledgeRegistryValidationIssue,
} from '../src/registry/knowledgeDomainRegistryTypes';
import { parseKnowledgeTypeRegistry } from '../src/registry/knowledgeTypeRegistryParser';
import type {
  KnowledgeType,
  KnowledgeTypeRegistry,
  KnowledgeTypeRegistryParseResult,
  KnowledgeTypeRegistryValidationIssue,
} from '../src/registry/knowledgeTypeRegistryTypes';
import { parseWorkspaceRegistry } from '../src/registry/workspaceRegistryParser';
import type {
  WorkspaceRegistryParseResult,
  WorkspaceRegistryValidationIssue,
} from '../src/registry/workspaceRegistryTypes';
import type { MimoraSettings, VaultConfig } from '../src/settings';
import type { Workspace } from '../src/workspace/types';

const registryCacheVersion = 1 as const;

type SettingsReader = {
  getSettings: () => Promise<MimoraSettings>;
};

type RegistryStatusServiceOptions = {
  getCachePath?: () => string;
  getNow?: () => string;
};

type RegistryFingerprint = {
  relativePath: string;
  modifiedAt: string;
  size: number;
};

type RegistryCache = {
  version: typeof registryCacheVersion;
  homeVaultId: string;
  homeVaultPath: string;
  loadedAt: string;
  fingerprints: Record<RegistryFileKey, RegistryFingerprint>;
  workspaces: {
    registryVersion: number | null;
    workspaces: Workspace[];
  };
  knowledgeDomains: {
    registryVersion: number | null;
    registry: KnowledgeDomainRegistry;
    domains: KnowledgeDomain[];
  };
  knowledgeTypes: {
    registryVersion: number | null;
    registry: KnowledgeTypeRegistry;
    types: KnowledgeType[];
  };
};

type DecodedRegistryMarkdown =
  | {
      ok: true;
      text: string;
      encoding: 'utf8' | 'utf8-bom' | 'utf16-le';
    }
  | {
      ok: false;
      encoding: 'utf16-be' | 'unknown';
      message: string;
    };

type RegistryRuntime = {
  status: RegistryStatus;
  workspaceRegistry: WorkspaceRegistryParseResult;
  knowledgeDomainRegistry: KnowledgeDomainRegistryParseResult;
  knowledgeTypeRegistry: KnowledgeTypeRegistryParseResult;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isWorkspace(value: unknown): value is Workspace {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.status === 'string' &&
    (value.startDate === undefined ||
      value.startDate === null ||
      typeof value.startDate === 'string') &&
    (value.endDate === undefined ||
      value.endDate === null ||
      typeof value.endDate === 'string') &&
    (value.description === undefined ||
      value.description === null ||
      typeof value.description === 'string')
  );
}

function isKnowledgeDomain(value: unknown): value is KnowledgeDomain {
  return (
    isRecord(value) &&
    typeof value.canonicalName === 'string' &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === 'string') &&
    (value.description === undefined ||
      value.description === null ||
      typeof value.description === 'string')
  );
}

function isKnowledgeType(value: unknown): value is KnowledgeType {
  return (
    isRecord(value) &&
    typeof value.canonicalName === 'string' &&
    (value.description === undefined ||
      value.description === null ||
      typeof value.description === 'string')
  );
}

function normalizeHomeVaultPath(value: string): string {
  const resolvedPath = path.resolve(value);

  return process.platform === 'win32'
    ? resolvedPath.toLocaleLowerCase('en-US')
    : resolvedPath;
}

function createMissingFileStatuses(): RegistryFileStatus[] {
  return Object.entries(registryFileRelativePaths).map(
    ([key, relativePath]) => ({
      key: key as RegistryFileKey,
      relativePath,
      exists: false,
    }),
  );
}

function createRuntimeSummary(input: {
  mode: RegistryRuntimeSummary['mode'];
  source: RegistryRuntimeSummary['source'];
  loadedAt?: string;
  lastSuccessfulLoad?: string;
  homeVaultId: string | null;
  homeVaultPath?: string;
  workspaceCount: number;
  knowledgeDomainCount: number;
  knowledgeTypeCount: number;
  issues: RegistryRuntimeIssue[];
}): RegistryRuntimeSummary {
  return {
    ...input,
    cacheVersion: registryCacheVersion,
  };
}

function createStatus(input: {
  homeVaultId: string | null;
  homeVaultAvailable: boolean;
  files: RegistryFileStatus[];
  runtime: RegistryRuntimeSummary;
}): RegistryStatus {
  return input;
}

function createWorkspaceRegistryResult(
  state: WorkspaceRegistryParseResult['state'],
  message: string,
  issue?: WorkspaceRegistryValidationIssue,
): WorkspaceRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    workspaces: [],
    issues,
    valid: false,
    message,
  };
}

function createKnowledgeDomainRegistryResult(
  state: KnowledgeDomainRegistryParseResult['state'],
  message: string,
  issue?: KnowledgeRegistryValidationIssue,
): KnowledgeDomainRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    registry: null,
    domains: [],
    issues,
    valid: false,
    message,
  };
}

function createKnowledgeTypeRegistryResult(
  state: KnowledgeTypeRegistryParseResult['state'],
  message: string,
  issue?: KnowledgeTypeRegistryValidationIssue,
): KnowledgeTypeRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    registry: null,
    types: [],
    issues,
    valid: false,
    message,
  };
}

function hasUtf16LePattern(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }

  const sampleLength = Math.min(buffer.length, 256);
  let oddNullBytes = 0;

  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0x00) {
      oddNullBytes += 1;
    }
  }

  return oddNullBytes >= Math.floor(sampleLength / 4);
}

function decodeRegistryMarkdown(buffer: Buffer): DecodedRegistryMarkdown {
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      ok: false,
      encoding: 'utf16-be',
      message: 'UTF-16 BE encoding is not supported for Registry files.',
    };
  }

  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    hasUtf16LePattern(buffer)
  ) {
    return {
      ok: true,
      text: buffer.toString('utf16le'),
      encoding: 'utf16-le',
    };
  }

  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      ok: true,
      text: buffer.toString('utf8'),
      encoding: 'utf8-bom',
    };
  }

  return {
    ok: true,
    text: buffer.toString('utf8'),
    encoding: 'utf8',
  };
}

async function createFileStatuses(
  homeVaultPath: string,
): Promise<RegistryFileStatus[]> {
  return Promise.all(
    Object.entries(registryFileRelativePaths).map(
      async ([key, relativePath]) => {
        const filePath = path.resolve(homeVaultPath, relativePath);

        try {
          const fileStat = await stat(filePath);

          return {
            key: key as RegistryFileKey,
            relativePath,
            exists: true,
            modifiedAt: fileStat.mtime.toISOString(),
            size: fileStat.size,
          };
        } catch {
          return {
            key: key as RegistryFileKey,
            relativePath,
            exists: false,
          };
        }
      },
    ),
  );
}

async function createFingerprints(
  homeVaultPath: string,
): Promise<Record<RegistryFileKey, RegistryFingerprint>> {
  const entries = await Promise.all(
    Object.entries(registryFileRelativePaths).map(
      async ([key, relativePath]) => {
        const fileStat = await stat(path.resolve(homeVaultPath, relativePath));

        return [
          key,
          {
            relativePath,
            modifiedAt: fileStat.mtime.toISOString(),
            size: fileStat.size,
          },
        ] as const;
      },
    ),
  );

  return Object.fromEntries(entries) as Record<
    RegistryFileKey,
    RegistryFingerprint
  >;
}

function createRuntimeIssue(
  registry: RegistryRuntimeIssue['registry'],
  code: string,
  message: string,
): RegistryRuntimeIssue {
  return { registry, code, message };
}

async function readRegistryMarkdown(
  homeVaultPath: string,
  key: RegistryFileKey,
): Promise<
  | { ok: true; text: string }
  | { ok: false; issue: RegistryRuntimeIssue; state: 'not-found' | 'loaded-with-errors' }
> {
  const relativePath = registryFileRelativePaths[key];
  const registryPath = path.resolve(homeVaultPath, relativePath);

  if (!(await exists(registryPath))) {
    return {
      ok: false,
      state: 'not-found',
      issue: createRuntimeIssue(
        key,
        `${key}-not-found`,
        `${relativePath} not found.`,
      ),
    };
  }

  try {
    const decoded = decodeRegistryMarkdown(await readFile(registryPath));

    if (!decoded.ok) {
      return {
        ok: false,
        state: 'loaded-with-errors',
        issue: createRuntimeIssue(key, `${key}-unsupported-encoding`, decoded.message),
      };
    }

    return { ok: true, text: decoded.text };
  } catch {
    return {
      ok: false,
      state: 'loaded-with-errors',
      issue: createRuntimeIssue(
        key,
        `${key}-read-failed`,
        `${relativePath} could not be read.`,
      ),
    };
  }
}

function collectRegistryIssues(
  key: RegistryFileKey,
  issues: Array<{ code: string; message: string; severity: string }>,
): RegistryRuntimeIssue[] {
  return issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => createRuntimeIssue(key, issue.code, issue.message));
}

function annotateWorkspaceRegistry(
  result: WorkspaceRegistryParseResult,
  runtime: RegistryRuntimeSummary,
): WorkspaceRegistryParseResult {
  return {
    ...result,
    runtimeMode: runtime.mode,
    source: runtime.source,
    lastSuccessfulLoad: runtime.lastSuccessfulLoad,
    runtimeIssues: runtime.issues,
  };
}

function annotateKnowledgeDomainRegistry(
  result: KnowledgeDomainRegistryParseResult,
  runtime: RegistryRuntimeSummary,
): KnowledgeDomainRegistryParseResult {
  return {
    ...result,
    runtimeMode: runtime.mode,
    source: runtime.source,
    lastSuccessfulLoad: runtime.lastSuccessfulLoad,
    runtimeIssues: runtime.issues,
  };
}

function annotateKnowledgeTypeRegistry(
  result: KnowledgeTypeRegistryParseResult,
  runtime: RegistryRuntimeSummary,
): KnowledgeTypeRegistryParseResult {
  return {
    ...result,
    runtimeMode: runtime.mode,
    source: runtime.source,
    lastSuccessfulLoad: runtime.lastSuccessfulLoad,
    runtimeIssues: runtime.issues,
  };
}

function createCache(input: {
  homeVault: VaultConfig;
  loadedAt: string;
  fingerprints: Record<RegistryFileKey, RegistryFingerprint>;
  workspaceRegistry: WorkspaceRegistryParseResult;
  knowledgeDomainRegistry: KnowledgeDomainRegistryParseResult & {
    registry: KnowledgeDomainRegistry;
  };
  knowledgeTypeRegistry: KnowledgeTypeRegistryParseResult & {
    registry: KnowledgeTypeRegistry;
  };
}): RegistryCache {
  return {
    version: registryCacheVersion,
    homeVaultId: input.homeVault.id,
    homeVaultPath: normalizeHomeVaultPath(input.homeVault.path),
    loadedAt: input.loadedAt,
    fingerprints: input.fingerprints,
    workspaces: {
      registryVersion: input.workspaceRegistry.registryVersion,
      workspaces: input.workspaceRegistry.workspaces,
    },
    knowledgeDomains: {
      registryVersion: input.knowledgeDomainRegistry.registryVersion,
      registry: input.knowledgeDomainRegistry.registry,
      domains: input.knowledgeDomainRegistry.domains,
    },
    knowledgeTypes: {
      registryVersion: input.knowledgeTypeRegistry.registryVersion,
      registry: input.knowledgeTypeRegistry.registry,
      types: input.knowledgeTypeRegistry.types,
    },
  };
}

function isMatchingCache(
  cache: RegistryCache,
  homeVault: VaultConfig,
): boolean {
  return (
    cache.homeVaultId === homeVault.id &&
    cache.homeVaultPath === normalizeHomeVaultPath(homeVault.path)
  );
}

function parseRegistryCache(value: unknown): RegistryCache | null {
  if (!isRecord(value) || value.version !== registryCacheVersion) {
    return null;
  }

  if (
    typeof value.homeVaultId !== 'string' ||
    typeof value.homeVaultPath !== 'string' ||
    typeof value.loadedAt !== 'string' ||
    !isRecord(value.workspaces) ||
    !Array.isArray(value.workspaces.workspaces) ||
    !isRecord(value.knowledgeDomains) ||
    !isRecord(value.knowledgeDomains.registry) ||
    !Array.isArray(value.knowledgeDomains.domains) ||
    !isRecord(value.knowledgeTypes) ||
    !isRecord(value.knowledgeTypes.registry) ||
    !Array.isArray(value.knowledgeTypes.types)
  ) {
    return null;
  }

  const workspaces = value.workspaces.workspaces.filter(isWorkspace);
  const domains = value.knowledgeDomains.domains.filter(isKnowledgeDomain);
  const types = value.knowledgeTypes.types.filter(isKnowledgeType);

  if (
    workspaces.length !== value.workspaces.workspaces.length ||
    domains.length !== value.knowledgeDomains.domains.length ||
    types.length !== value.knowledgeTypes.types.length
  ) {
    return null;
  }

  return {
    version: registryCacheVersion,
    homeVaultId: value.homeVaultId,
    homeVaultPath: value.homeVaultPath,
    loadedAt: value.loadedAt,
    fingerprints: isRecord(value.fingerprints)
      ? (value.fingerprints as Record<RegistryFileKey, RegistryFingerprint>)
      : ({} as Record<RegistryFileKey, RegistryFingerprint>),
    workspaces: {
      registryVersion:
        typeof value.workspaces.registryVersion === 'number'
          ? value.workspaces.registryVersion
          : null,
      workspaces,
    },
    knowledgeDomains: {
      registryVersion:
        typeof value.knowledgeDomains.registryVersion === 'number'
          ? value.knowledgeDomains.registryVersion
          : null,
      registry: {
        version:
          typeof value.knowledgeDomains.registry.version === 'number'
            ? value.knowledgeDomains.registry.version
            : 1,
        domains,
      },
      domains,
    },
    knowledgeTypes: {
      registryVersion:
        typeof value.knowledgeTypes.registryVersion === 'number'
          ? value.knowledgeTypes.registryVersion
          : null,
      registry: {
        version:
          typeof value.knowledgeTypes.registry.version === 'number'
            ? value.knowledgeTypes.registry.version
            : 1,
        types,
      },
      types,
    },
  };
}

function createRuntimeFromCache(input: {
  cache: RegistryCache;
  homeVault: VaultConfig;
  homeVaultAvailable: boolean;
  files: RegistryFileStatus[];
  issues: RegistryRuntimeIssue[];
}): RegistryRuntime {
  const runtime = createRuntimeSummary({
    mode: 'degraded',
    source: 'cache',
    lastSuccessfulLoad: input.cache.loadedAt,
    homeVaultId: input.homeVault.id,
    homeVaultPath: normalizeHomeVaultPath(input.homeVault.path),
    workspaceCount: input.cache.workspaces.workspaces.length,
    knowledgeDomainCount: input.cache.knowledgeDomains.domains.length,
    knowledgeTypeCount: input.cache.knowledgeTypes.types.length,
    issues: input.issues,
  });

  return {
    status: createStatus({
      homeVaultId: input.homeVault.id,
      homeVaultAvailable: input.homeVaultAvailable,
      files: input.files,
      runtime,
    }),
    workspaceRegistry: annotateWorkspaceRegistry(
      {
        state: 'loaded',
        registryVersion: input.cache.workspaces.registryVersion,
        workspaces: input.cache.workspaces.workspaces,
        issues: [],
        valid: true,
        message: 'Using cached workspace registry snapshot.',
      },
      runtime,
    ),
    knowledgeDomainRegistry: annotateKnowledgeDomainRegistry(
      {
        state: 'loaded',
        registryVersion: input.cache.knowledgeDomains.registryVersion,
        registry: input.cache.knowledgeDomains.registry,
        domains: input.cache.knowledgeDomains.domains,
        issues: [],
        valid: true,
        message: 'Using cached knowledge domain registry snapshot.',
      },
      runtime,
    ),
    knowledgeTypeRegistry: annotateKnowledgeTypeRegistry(
      {
        state: 'loaded',
        registryVersion: input.cache.knowledgeTypes.registryVersion,
        registry: input.cache.knowledgeTypes.registry,
        types: input.cache.knowledgeTypes.types,
        issues: [],
        valid: true,
        message: 'Using cached knowledge type registry snapshot.',
      },
      runtime,
    ),
  };
}

function createUnresolvedRuntime(input: {
  homeVaultId: string | null;
  homeVaultPath?: string;
  homeVaultAvailable: boolean;
  files: RegistryFileStatus[];
  issues: RegistryRuntimeIssue[];
  workspaceRegistry: WorkspaceRegistryParseResult;
  knowledgeDomainRegistry: KnowledgeDomainRegistryParseResult;
  knowledgeTypeRegistry: KnowledgeTypeRegistryParseResult;
}): RegistryRuntime {
  const unresolvedMessage =
    'Registry snapshot is unavailable because one or more Registry files could not be validated.';
  const workspaceRegistry =
    input.workspaceRegistry.state === 'loaded' && input.workspaceRegistry.valid
      ? createWorkspaceRegistryResult('unavailable', unresolvedMessage)
      : input.workspaceRegistry;
  const knowledgeDomainRegistry =
    input.knowledgeDomainRegistry.state === 'loaded' &&
    input.knowledgeDomainRegistry.valid
      ? createKnowledgeDomainRegistryResult('unavailable', unresolvedMessage)
      : input.knowledgeDomainRegistry;
  const knowledgeTypeRegistry =
    input.knowledgeTypeRegistry.state === 'loaded' &&
    input.knowledgeTypeRegistry.valid
      ? createKnowledgeTypeRegistryResult('unavailable', unresolvedMessage)
      : input.knowledgeTypeRegistry;
  const runtime = createRuntimeSummary({
    mode: 'unresolved',
    source: 'none',
    homeVaultId: input.homeVaultId,
    homeVaultPath: input.homeVaultPath,
    workspaceCount: 0,
    knowledgeDomainCount: 0,
    knowledgeTypeCount: 0,
    issues: input.issues,
  });

  return {
    status: createStatus({
      homeVaultId: input.homeVaultId,
      homeVaultAvailable: input.homeVaultAvailable,
      files: input.files,
      runtime,
    }),
    workspaceRegistry: annotateWorkspaceRegistry(workspaceRegistry, runtime),
    knowledgeDomainRegistry: annotateKnowledgeDomainRegistry(
      knowledgeDomainRegistry,
      runtime,
    ),
    knowledgeTypeRegistry: annotateKnowledgeTypeRegistry(
      knowledgeTypeRegistry,
      runtime,
    ),
  };
}

async function writeCache(
  cachePath: string | undefined,
  cache: RegistryCache,
): Promise<void> {
  if (!cachePath) {
    return;
  }

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function readCache(cachePath: string | undefined): Promise<RegistryCache | null> {
  if (!cachePath) {
    return null;
  }

  try {
    return parseRegistryCache(JSON.parse(await readFile(cachePath, 'utf8')));
  } catch {
    return null;
  }
}

function createCurrentFailureResults(
  issue: RegistryRuntimeIssue,
): {
  workspaceRegistry: WorkspaceRegistryParseResult;
  knowledgeDomainRegistry: KnowledgeDomainRegistryParseResult;
  knowledgeTypeRegistry: KnowledgeTypeRegistryParseResult;
} {
  const message = issue.message;

  return {
    workspaceRegistry: createWorkspaceRegistryResult('inaccessible', message),
    knowledgeDomainRegistry: createKnowledgeDomainRegistryResult(
      'inaccessible',
      message,
    ),
    knowledgeTypeRegistry: createKnowledgeTypeRegistryResult(
      'inaccessible',
      message,
    ),
  };
}

export function createRegistryStatusService(
  settingsReader: SettingsReader,
  options: RegistryStatusServiceOptions = {},
) {
  const getCachePath = options.getCachePath;
  const getNow = options.getNow ?? (() => new Date().toISOString());

  async function loadRegistryRuntime(): Promise<RegistryRuntime> {
    const settings = await settingsReader.getSettings();
    const homeVaultId = settings.registry.homeVaultId;

    if (!homeVaultId) {
      const issue = createRuntimeIssue(
        'home',
        'registry-home-vault-not-configured',
        'Registry Home Vault is not configured.',
      );
      const failures = createCurrentFailureResults(issue);

      return createUnresolvedRuntime({
        homeVaultId: null,
        homeVaultAvailable: false,
        files: createMissingFileStatuses(),
        issues: [issue],
        ...failures,
      });
    }

    const homeVault = settings.vaults.find((vault) => vault.id === homeVaultId);

    if (!homeVault) {
      const issue = createRuntimeIssue(
        'home',
        'registry-home-vault-not-found',
        'Registry Home Vault is not registered.',
      );
      const failures = createCurrentFailureResults(issue);

      return createUnresolvedRuntime({
        homeVaultId,
        homeVaultAvailable: false,
        files: createMissingFileStatuses(),
        issues: [issue],
        ...failures,
      });
    }

    const homeVaultAvailable = await exists(homeVault.path);
    const files = homeVaultAvailable
      ? await createFileStatuses(homeVault.path)
      : createMissingFileStatuses();
    const cachePath = getCachePath?.();

    if (!homeVaultAvailable) {
      const issue = createRuntimeIssue(
        'home',
        'registry-home-vault-inaccessible',
        'Registry Home Vault is unavailable.',
      );
      const cache = await readCache(cachePath);

      if (cache && isMatchingCache(cache, homeVault)) {
        return createRuntimeFromCache({
          cache,
          homeVault,
          homeVaultAvailable,
          files,
          issues: [issue],
        });
      }

      const failures = createCurrentFailureResults(issue);

      return createUnresolvedRuntime({
        homeVaultId,
        homeVaultPath: normalizeHomeVaultPath(homeVault.path),
        homeVaultAvailable,
        files,
        issues: [issue],
        ...failures,
      });
    }

    const workspaceRead = await readRegistryMarkdown(homeVault.path, 'workspaces');
    const domainRead = await readRegistryMarkdown(
      homeVault.path,
      'knowledge-domains',
    );
    const typeRead = await readRegistryMarkdown(homeVault.path, 'knowledge-types');
    const readIssues = [workspaceRead, domainRead, typeRead].flatMap((result) =>
      result.ok ? [] : [result.issue],
    );
    const workspaceRegistry = workspaceRead.ok
      ? parseWorkspaceRegistry(workspaceRead.text)
      : createWorkspaceRegistryResult(
          workspaceRead.state,
          workspaceRead.issue.message,
        );
    const knowledgeDomainRegistry = domainRead.ok
      ? parseKnowledgeDomainRegistry(domainRead.text)
      : createKnowledgeDomainRegistryResult(
          domainRead.state,
          domainRead.issue.message,
        );
    const knowledgeTypeRegistry = typeRead.ok
      ? parseKnowledgeTypeRegistry(typeRead.text)
      : createKnowledgeTypeRegistryResult(
          typeRead.state,
          typeRead.issue.message,
        );
    const validationIssues = [
      ...collectRegistryIssues('workspaces', workspaceRegistry.issues),
      ...collectRegistryIssues('knowledge-domains', knowledgeDomainRegistry.issues),
      ...collectRegistryIssues('knowledge-types', knowledgeTypeRegistry.issues),
    ];
    const issues = [...readIssues, ...validationIssues];
    const parsedKnowledgeDomainRegistry = knowledgeDomainRegistry.registry;
    const parsedKnowledgeTypeRegistry = knowledgeTypeRegistry.registry;
    const isCompleteRegistryValid =
      workspaceRegistry.state === 'loaded' &&
      workspaceRegistry.valid &&
      knowledgeDomainRegistry.state === 'loaded' &&
      knowledgeDomainRegistry.valid &&
      Boolean(parsedKnowledgeDomainRegistry) &&
      knowledgeTypeRegistry.state === 'loaded' &&
      knowledgeTypeRegistry.valid &&
      Boolean(parsedKnowledgeTypeRegistry);

    if (
      isCompleteRegistryValid &&
      parsedKnowledgeDomainRegistry &&
      parsedKnowledgeTypeRegistry
    ) {
      const loadedAt = getNow();
      const runtime = createRuntimeSummary({
        mode: 'normal',
        source: 'registry',
        loadedAt,
        lastSuccessfulLoad: loadedAt,
        homeVaultId: homeVault.id,
        homeVaultPath: normalizeHomeVaultPath(homeVault.path),
        workspaceCount: workspaceRegistry.workspaces.length,
        knowledgeDomainCount: knowledgeDomainRegistry.domains.length,
        knowledgeTypeCount: knowledgeTypeRegistry.types.length,
        issues: [],
      });
      const fingerprints = await createFingerprints(homeVault.path);

      await writeCache(
        cachePath,
        createCache({
          homeVault,
          loadedAt,
          fingerprints,
          workspaceRegistry,
          knowledgeDomainRegistry: {
            ...knowledgeDomainRegistry,
            registry: parsedKnowledgeDomainRegistry,
          },
          knowledgeTypeRegistry: {
            ...knowledgeTypeRegistry,
            registry: parsedKnowledgeTypeRegistry,
          },
        }),
      );

      return {
        status: createStatus({
          homeVaultId: homeVault.id,
          homeVaultAvailable,
          files,
          runtime,
        }),
        workspaceRegistry: annotateWorkspaceRegistry(workspaceRegistry, runtime),
        knowledgeDomainRegistry: annotateKnowledgeDomainRegistry(
          knowledgeDomainRegistry,
          runtime,
        ),
        knowledgeTypeRegistry: annotateKnowledgeTypeRegistry(
          knowledgeTypeRegistry,
          runtime,
        ),
      };
    }

    const cache = await readCache(cachePath);

    if (cache && isMatchingCache(cache, homeVault)) {
      return createRuntimeFromCache({
        cache,
        homeVault,
        homeVaultAvailable,
        files,
        issues:
          issues.length > 0
            ? issues
            : [
                createRuntimeIssue(
                  'home',
                  'registry-validation-failed',
                  'Registry validation failed.',
                ),
              ],
      });
    }

    return createUnresolvedRuntime({
      homeVaultId: homeVault.id,
      homeVaultPath: normalizeHomeVaultPath(homeVault.path),
      homeVaultAvailable,
      files,
      issues,
      workspaceRegistry,
      knowledgeDomainRegistry,
      knowledgeTypeRegistry,
    });
  }

  return {
    getRegistryStatus: async (): Promise<RegistryStatus> =>
      (await loadRegistryRuntime()).status,

    loadWorkspaceRegistry: async (): Promise<WorkspaceRegistryParseResult> =>
      (await loadRegistryRuntime()).workspaceRegistry,

    loadKnowledgeDomainRegistry:
      async (): Promise<KnowledgeDomainRegistryParseResult> =>
        (await loadRegistryRuntime()).knowledgeDomainRegistry,

    loadKnowledgeTypeRegistry:
      async (): Promise<KnowledgeTypeRegistryParseResult> =>
        (await loadRegistryRuntime()).knowledgeTypeRegistry,

    loadRegistryRuntime,
  };
}
