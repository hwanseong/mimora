import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from '../src/autoContext';
import {
  hasActiveKnowledgeSearchFilters,
  normalizeKnowledgeSearchFilters,
  type KnowledgeSearchFilters,
} from '../src/knowledgeSearch';
import {
  documentMatchesContentOriginScope,
  getEffectiveContentOrigin,
  isContentOriginSearchScope,
  type ContentOriginSearchScope,
} from '../src/contentOrigin';
import type { createSettingsStore } from './settingsStore';
import type { VaultConfig } from '../src/settings';
import { createRegistryStatusService } from './registryStatus';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import { registryFileRelativePaths } from '../src/registry/types';
import { resolveKnowledgeDomain } from '../src/registry/knowledgeDomainRegistryParser';
import type {
  DocumentMetadataValidationIssue,
  MimoraDocumentMetadata,
} from '../src/metadata/types';
import {
  createEmptyDocumentIdCounts,
  getDocumentIdFormatStatus,
  type DocumentIdValidationDocument,
  type DocumentIdValidationSummary,
} from '../src/documentIdValidation';
import type { KnowledgeDomainRegistry } from '../src/registry/knowledgeDomainRegistryTypes';
import { resolveKnowledgeType } from '../src/registry/knowledgeTypeRegistryParser';
import type { KnowledgeTypeRegistry } from '../src/registry/knowledgeTypeRegistryTypes';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from '../src/vaultFiles';
import { allWorkspaceId, isAllWorkspaceScope } from '../src/workspaces';
import type { WorkspaceStatus } from '../src/workspace/types';

type SettingsStore = ReturnType<typeof createSettingsStore>;

function createVaultDocumentId(vaultId: string, relativePath: string): string {
  return JSON.stringify([vaultId, relativePath]);
}

function normalizeVaultRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/gu, '/').replace(/^\/+/u, '');
}

const officialRegistryMarkdownPaths = new Set(
  Object.values(registryFileRelativePaths).map((relativePath) =>
    normalizeVaultRelativePath(relativePath),
  ),
);

export function isOfficialRegistryMarkdownPath(relativePath: string): boolean {
  return officialRegistryMarkdownPaths.has(
    normalizeVaultRelativePath(relativePath),
  );
}

function createDocumentValidationKey(
  vaultId: string,
  relativePath: string,
): string {
  return JSON.stringify([vaultId, normalizeVaultRelativePath(relativePath)]);
}

function getFsErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function getVaultRootError(error: unknown): Error {
  const errorCode = getFsErrorCode(error);

  if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
    return new Error(
      'Vault 폴더를 찾을 수 없습니다. 설정에서 경로를 확인하세요.',
    );
  }

  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return new Error('Vault 폴더에 접근할 권한이 없습니다.');
  }

  return new Error('Vault 폴더를 읽지 못했습니다. 잠시 후 다시 시도하세요.');
}

function getVaultFileError(error: unknown): Error {
  const errorCode = getFsErrorCode(error);

  if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
    return new Error(
      '파일을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도하세요.',
    );
  }

  if (errorCode === 'EACCES' || errorCode === 'EPERM') {
    return new Error('파일을 읽을 권한이 없습니다.');
  }

  return new Error('파일을 읽지 못했습니다. 잠시 후 다시 시도하세요.');
}

async function getVault(
  settingsStore: SettingsStore,
  vaultId: unknown,
): Promise<VaultConfig> {
  if (typeof vaultId !== 'string' || !vaultId) {
    throw new Error('선택한 Vault 정보가 올바르지 않습니다.');
  }

  const settings = await settingsStore.getSettings();
  const vault = settings.vaults.find((item) => item.id === vaultId);

  if (!vault) {
    throw new Error('등록된 Vault를 찾을 수 없습니다. 설정을 확인하세요.');
  }

  return vault;
}

async function resolveVaultRoot(vault: VaultConfig): Promise<string> {
  try {
    const rootPath = await realpath(path.resolve(vault.path));
    const rootStats = await stat(rootPath);

    if (!rootStats.isDirectory()) {
      throw Object.assign(new Error('Vault root is not a directory.'), {
        code: 'ENOTDIR',
      });
    }

    return rootPath;
  } catch (error) {
    throw getVaultRootError(error);
  }
}

async function walkMarkdownFiles(
  rootPath: string,
  directoryPath: string,
  relativeFolderParts: string[],
  files: VaultFile[],
): Promise<void> {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (directoryPath === rootPath) {
      throw getVaultRootError(error);
    }

    console.warn('Skipped an unreadable Vault directory.', error);
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    let entryStats;

    try {
      entryStats = await lstat(entryPath);
    } catch (error) {
      console.warn('Skipped an unavailable Vault entry.', error);
      continue;
    }

    // Re-check with lstat so a symlink substituted after readdir is also skipped.
    if (entryStats.isSymbolicLink()) {
      continue;
    }

    if (entryStats.isDirectory()) {
      try {
        const canonicalDirectoryPath = await realpath(entryPath);

        if (isWithinRoot(rootPath, canonicalDirectoryPath)) {
          await walkMarkdownFiles(
            rootPath,
            canonicalDirectoryPath,
            [...relativeFolderParts, entry.name],
            files,
          );
        }
      } catch (error) {
        console.warn('Skipped an unavailable Vault directory.', error);
      }
      continue;
    }

    if (!entryStats.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
      continue;
    }

    try {
      const canonicalEntryPath = await realpath(entryPath);

      if (!isWithinRoot(rootPath, canonicalEntryPath)) {
        continue;
      }
    } catch (error) {
      console.warn('Skipped an unavailable Vault file.', error);
      continue;
    }

    const folder = relativeFolderParts.join('/');
    files.push({
      relativePath: [...relativeFolderParts, entry.name].join('/'),
      name: entry.name,
      folder,
      modifiedAt: entryStats.mtime.toISOString(),
    });
  }
}

async function ensurePathContainsNoSymlink(
  rootPath: string,
  relativePath: string,
): Promise<void> {
  const pathParts = relativePath.split(path.sep).filter(Boolean);
  let currentPath = rootPath;

  for (const pathPart of pathParts) {
    currentPath = path.join(currentPath, pathPart);
    const currentStats = await lstat(currentPath);

    if (currentStats.isSymbolicLink()) {
      throw new Error('SYMLINK_NOT_ALLOWED');
    }
  }
}

async function readMarkdownFile(
  rootPath: string,
  requestedRelativePath: unknown,
): Promise<VaultFileContent> {
  if (
    typeof requestedRelativePath !== 'string' ||
    !requestedRelativePath ||
    path.isAbsolute(requestedRelativePath) ||
    requestedRelativePath.includes('\0')
  ) {
    throw new Error('요청한 파일 경로가 올바르지 않습니다.');
  }

  const targetPath = path.resolve(rootPath, requestedRelativePath);

  if (!isWithinRoot(rootPath, targetPath)) {
    throw new Error('Vault 밖의 파일에는 접근할 수 없습니다.');
  }

  if (path.extname(targetPath).toLowerCase() !== '.md') {
    throw new Error('Markdown 파일만 미리볼 수 있습니다.');
  }

  const normalizedRelativePath = path.relative(rootPath, targetPath);

  try {
    await ensurePathContainsNoSymlink(rootPath, normalizedRelativePath);

    const canonicalTargetPath = await realpath(targetPath);

    if (!isWithinRoot(rootPath, canonicalTargetPath)) {
      throw new Error('PATH_OUTSIDE_ROOT');
    }

    const targetStats = await lstat(canonicalTargetPath);

    if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
      throw new Error('NOT_A_REGULAR_FILE');
    }

    const fileHandle = await open(canonicalTargetPath, 'r');

    try {
      const openedStats = await fileHandle.stat();

      if (
        !openedStats.isFile() ||
        openedStats.dev !== targetStats.dev ||
        openedStats.ino !== targetStats.ino
      ) {
        throw new Error('FILE_CHANGED_DURING_READ');
      }

      return {
        relativePath: normalizedRelativePath.split(path.sep).join('/'),
        content: await fileHandle.readFile({ encoding: 'utf8' }),
      };
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'SYMLINK_NOT_ALLOWED') {
        throw new Error('연결된 파일이나 폴더는 미리볼 수 없습니다.');
      }

      if (error.message === 'PATH_OUTSIDE_ROOT') {
        throw new Error('Vault 밖의 파일에는 접근할 수 없습니다.');
      }

      if (
        error.message === 'NOT_A_REGULAR_FILE' ||
        error.message === 'FILE_CHANGED_DURING_READ'
      ) {
        throw new Error(
          '파일 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도하세요.',
        );
      }
    }

    throw getVaultFileError(error);
  }
}

function validateSearchInput(input: unknown): VaultSearchInput {
  if (!input || typeof input !== 'object') {
    throw new Error('검색 요청이 올바르지 않습니다.');
  }

  const candidate = input as Partial<VaultSearchInput>;
  const query = typeof candidate.query === 'string' ? candidate.query.trim() : '';
  const knowledgeFilters = normalizeKnowledgeSearchFilters(
    candidate.knowledgeFilters,
  );
  const contentOriginScope = isContentOriginSearchScope(
    candidate.contentOriginScope,
  )
    ? candidate.contentOriginScope
    : 'all';

  if (
    !query &&
    !hasActiveKnowledgeSearchFilters(knowledgeFilters) &&
    contentOriginScope === 'all'
  ) {
    throw new Error('검색어를 입력하세요.');
  }

  if (candidate.scope !== 'current' && candidate.scope !== 'all') {
    throw new Error('검색 범위가 올바르지 않습니다.');
  }

  if (
    candidate.scope === 'current' &&
    (typeof candidate.vaultId !== 'string' || !candidate.vaultId)
  ) {
    throw new Error('검색할 Vault를 선택하세요.');
  }

  return {
    query,
    scope: candidate.scope,
    knowledgeFilters,
    contentOriginScope,
    ...(candidate.scope === 'current' ? { vaultId: candidate.vaultId } : {}),
  };
}

function createSearchSnippet(content: string, matchIndex: number, query: string): string {
  const contextBefore = 70;
  const contextAfter = 90;
  const startIndex = Math.max(0, matchIndex - contextBefore);
  const endIndex = Math.min(
    content.length,
    matchIndex + query.length + contextAfter,
  );
  const excerpt = content
    .slice(startIndex, endIndex)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-+*]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${startIndex > 0 ? '…' : ''}${excerpt}${
    endIndex < content.length ? '…' : ''
  }`;
}

async function searchVault(
  vault: VaultConfig,
  query: string,
  metadataRegistryOptions: MetadataRegistryOptions = {},
  knowledgeFilters: KnowledgeSearchFilters = normalizeKnowledgeSearchFilters(),
  contentOriginScope: ContentOriginSearchScope = 'all',
): Promise<VaultSearchResult[]> {
  const rootPath = await resolveVaultRoot(vault);
  const files: VaultFile[] = [];
  const normalizedQuery = query.toLocaleLowerCase();
  const results: VaultSearchResult[] = [];

  await walkMarkdownFiles(rootPath, rootPath, [], files);

  for (const file of files) {
    try {
      const { content } = await readMarkdownFile(rootPath, file.relativePath);
      const metadataResult = parseMimoraDocumentMetadata(
        content,
        metadataRegistryOptions,
      );
      const baseResult = {
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type,
        security: vault.security,
        documentId: metadataResult.metadata.documentId,
        relativePath: file.relativePath,
        fileName: file.name,
        ...createMetadataResultFields(metadataResult),
      };
      const matchesKnowledgeFilters = documentMatchesKnowledgeFilters(
        metadataResult.metadata,
        knowledgeFilters,
      );
      const matchesContentOriginScope = documentMatchesContentOriginScope(
        metadataResult.metadata,
        contentOriginScope,
      );

      if (!matchesContentOriginScope) {
        continue;
      }

      if (!matchesKnowledgeFilters) {
        continue;
      }

      if (!query) {
        results.push({ ...baseResult, matchType: 'metadata' });
        continue;
      }

      if (file.name.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push({ ...baseResult, matchType: 'filename' });
        continue;
      }

      if (file.relativePath.toLocaleLowerCase().includes(normalizedQuery)) {
        results.push({ ...baseResult, matchType: 'path' });
        continue;
      }

      const matchIndex = content.toLocaleLowerCase().indexOf(normalizedQuery);

      if (matchIndex >= 0) {
        results.push({
          ...baseResult,
          matchType: 'content',
          snippet: createSearchSnippet(content, matchIndex, query),
        });
      }
    } catch (error) {
      console.warn('Skipped an unreadable Vault file during search.', error);
    }
  }

  return results;
}

const retrievalStopWords = new Set([
  '프로젝트',
  '관리',
  '관련',
  '관련된',
  '관련한',
  '내용',
  '내용을',
  '대해',
  '대한',
  '무엇',
  '어떤',
  '최근',
  '정리',
  '정리해줘',
  '알려줘',
  '보여줘',
  '설명',
  '설명해줘',
  '질문',
  '뭐야',
  '무슨',
  '차이',
]);

export const AUTO_CONTEXT_MIN_SCORE = 40;
export const EXACT_MATCH_MIN_SCORE = AUTO_CONTEXT_MIN_SCORE;

type ScoredAutoContext = AutoRetrievedContext & {
  matchedTokenCount: number;
  phraseMatched: boolean;
  exactMeaningfulTokenMatch: boolean;
  exactSubstringMatch: boolean;
  exactMatchedTokenCount: number;
  scoreBeforeExactBoost: number;
  exactMatchBonus: number;
  originalContentOriginBoost: number;
};

type VaultRetrieval = {
  candidateCount: number;
  results: ScoredAutoContext[];
  pipeline: RetrievalPipelineCounts;
};

type WorkspaceStatusMap = Map<string, WorkspaceStatus>;

type RetrievalPipelineCounts = {
  allMarkdownCandidates: number;
  metadataParsedCandidates: number;
  lifecycleEligibleCandidates: number;
  contentOriginEligibleCandidates: number;
  knowledgeEligibleCandidates: number;
  queryMatchedCandidates: number;
  aboveThresholdCandidates: number;
};

type ParsedDocumentMetadata = {
  metadata: MimoraDocumentMetadata;
  issues: DocumentMetadataValidationIssue[];
};

type MetadataRegistryOptions = {
  knownWorkspaceIds?: Iterable<string>;
  knowledgeDomainRegistry?: KnowledgeDomainRegistry | null;
  knowledgeTypeRegistry?: KnowledgeTypeRegistry | null;
  knowledgeDomainRegistryUnavailable?: boolean;
  knowledgeTypeRegistryUnavailable?: boolean;
};

function documentMatchesKnowledgeFilters(
  metadata: MimoraDocumentMetadata,
  filters: KnowledgeSearchFilters,
): boolean {
  if (!hasActiveKnowledgeSearchFilters(filters)) {
    return true;
  }

  const normalizedMetadataDomains = new Set(
    metadata.knowledgeDomains.map((domain) => domain.trim().toLocaleLowerCase()),
  );
  const normalizedMetadataTypes = new Set(
    metadata.knowledgeTypes.map((type) => type.trim().toLocaleLowerCase()),
  );
  const matchesDomains =
    filters.domains.length === 0 ||
    filters.domains.every((domain) =>
      normalizedMetadataDomains.has(domain.trim().toLocaleLowerCase()),
    );
  const matchesTypes =
    filters.types.length === 0 ||
    filters.types.every((type) =>
      normalizedMetadataTypes.has(type.trim().toLocaleLowerCase()),
    );

  return matchesDomains && matchesTypes;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeKnowledgeFiltersForMetadataRegistry(
  filters: Partial<KnowledgeSearchFilters> | null | undefined,
  metadataRegistryOptions: MetadataRegistryOptions,
): KnowledgeSearchFilters {
  const normalizedFilters = normalizeKnowledgeSearchFilters(filters);

  return {
    domains: uniqueValues(
      normalizedFilters.domains.map((domain) => {
        if (!metadataRegistryOptions.knowledgeDomainRegistry) {
          return domain;
        }

        return (
          resolveKnowledgeDomain(
            domain,
            metadataRegistryOptions.knowledgeDomainRegistry,
          ).canonicalName ?? domain
        );
      }),
    ),
    types: uniqueValues(
      normalizedFilters.types.map((type) => {
        if (!metadataRegistryOptions.knowledgeTypeRegistry) {
          return type;
        }

        return (
          resolveKnowledgeType(
            type,
            metadataRegistryOptions.knowledgeTypeRegistry,
          ) ?? type
        );
      }),
    ),
  };
}

type DocumentEligibilityResult = {
  eligible: boolean;
  reason:
    | 'selected-workspace-match'
    | 'selected-workspace-mismatch'
    | 'workspace-less'
    | 'active-workspace-linked'
    | 'archived-only-included'
    | 'archived-only-excluded'
    | 'workspace-status-unavailable'
    | 'unknown-workspace-only';
  workspaceLookups: Array<{
    workspaceId: string;
    workspaceFound: boolean;
    workspaceStatus?: WorkspaceStatus;
  }>;
};

function isDevelopmentEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    Boolean(process.env.VITE_DEV_SERVER_URL)
  );
}

function shouldApplyWorkspaceFilter(workspaceId: string): boolean {
  return !isAllWorkspaceScope(workspaceId);
}

function createEmptyRetrievalPipelineCounts(): RetrievalPipelineCounts {
  return {
    allMarkdownCandidates: 0,
    metadataParsedCandidates: 0,
    lifecycleEligibleCandidates: 0,
    contentOriginEligibleCandidates: 0,
    knowledgeEligibleCandidates: 0,
    queryMatchedCandidates: 0,
    aboveThresholdCandidates: 0,
  };
}

function mergeRetrievalPipelineCounts(
  items: RetrievalPipelineCounts[],
): RetrievalPipelineCounts {
  return items.reduce<RetrievalPipelineCounts>(
    (total, item) => ({
      allMarkdownCandidates:
        total.allMarkdownCandidates + item.allMarkdownCandidates,
      metadataParsedCandidates:
        total.metadataParsedCandidates + item.metadataParsedCandidates,
      lifecycleEligibleCandidates:
        total.lifecycleEligibleCandidates + item.lifecycleEligibleCandidates,
      contentOriginEligibleCandidates:
        total.contentOriginEligibleCandidates +
        item.contentOriginEligibleCandidates,
      knowledgeEligibleCandidates:
        total.knowledgeEligibleCandidates + item.knowledgeEligibleCandidates,
      queryMatchedCandidates:
        total.queryMatchedCandidates + item.queryMatchedCandidates,
      aboveThresholdCandidates:
        total.aboveThresholdCandidates + item.aboveThresholdCandidates,
    }),
    createEmptyRetrievalPipelineCounts(),
  );
}

function isArchivedDebugQuery(query: string): boolean {
  return query.includes('ARCHIVED-ONLY-777');
}

export function createWorkspaceStatusMap(
  workspaces: Array<{ id: string; status: WorkspaceStatus }>,
): WorkspaceStatusMap {
  return new Map(
    workspaces.map((workspace) => [workspace.id, workspace.status]),
  );
}

export function isDocumentEligibleForSearch(input: {
  selectedWorkspaceId: string;
  workspaceIds: string[];
  workspaceStatusMap: WorkspaceStatusMap;
  includeArchived: boolean;
  workspaceStatusLookupAvailable: boolean;
}): DocumentEligibilityResult {
  const workspaceLookups = input.workspaceIds.map((workspaceId) => {
    const workspaceStatus = input.workspaceStatusMap.get(workspaceId);

    return {
      workspaceId,
      workspaceFound: Boolean(workspaceStatus),
      ...(workspaceStatus ? { workspaceStatus } : {}),
    };
  });

  if (shouldApplyWorkspaceFilter(input.selectedWorkspaceId)) {
    const eligible = input.workspaceIds.includes(input.selectedWorkspaceId);

    return {
      eligible,
      reason: eligible
        ? 'selected-workspace-match'
        : 'selected-workspace-mismatch',
      workspaceLookups,
    };
  }

  if (input.workspaceIds.length === 0) {
    return {
      eligible: true,
      reason: 'workspace-less',
      workspaceLookups,
    };
  }

  const statuses = workspaceLookups.map((lookup) => lookup.workspaceStatus);

  if (statuses.some((status) => status && status !== 'archived')) {
    return {
      eligible: true,
      reason: 'active-workspace-linked',
      workspaceLookups,
    };
  }

  if (
    statuses.length > 0 &&
    statuses.every((status) => status === 'archived')
  ) {
    return {
      eligible: input.includeArchived,
      reason: input.includeArchived
        ? 'archived-only-included'
        : 'archived-only-excluded',
      workspaceLookups,
    };
  }

  if (!input.workspaceStatusLookupAvailable) {
    return {
      eligible: true,
      reason: 'workspace-status-unavailable',
      workspaceLookups,
    };
  }

  return {
    eligible: false,
    reason: 'unknown-workspace-only',
    workspaceLookups,
  };
}

function isArchivedScopeDiagnosticDocument(input: {
  metadata: MimoraDocumentMetadata;
  content: string;
}): boolean {
  return (
    input.metadata.documentId === 'DOC-2026-0201' ||
    input.content.includes('ARCHIVED-ONLY-777') ||
    input.content.includes('ACTIVE-ARCHIVED-WORKSPACE-TEST') ||
    input.content.includes('NO-WORKSPACE-SEARCH-TEST')
  );
}

function logArchivedScopeDocumentMetadata(input: {
  metadata: MimoraDocumentMetadata;
  content: string;
  file: VaultFile;
}): void {
  if (!isDevelopmentEnvironment()) {
    return;
  }

  if (
    !isArchivedScopeDiagnosticDocument({
      metadata: input.metadata,
      content: input.content,
    })
  ) {
    return;
  }

  console.info('[Archived Debug]', {
    stage: 'document-metadata',
    documentId: input.metadata.documentId ?? null,
    relativePath: input.file.relativePath,
    workspaceIdsCount: input.metadata.workspaceIds.length,
    workspaceIds: input.metadata.workspaceIds,
    containsMarker: input.content.includes('ARCHIVED-ONLY-777'),
    containsActiveArchivedTestMarker: input.content.includes(
      'ACTIVE-ARCHIVED-WORKSPACE-TEST',
    ),
    containsWorkspaceLessTestMarker: input.content.includes(
      'NO-WORKSPACE-SEARCH-TEST',
    ),
  });
}

function logArchivedScopeEligibility(input: {
  metadata: MimoraDocumentMetadata;
  content: string;
  file: VaultFile;
  selectedWorkspaceId: string;
  includeArchived: boolean;
  eligibility: DocumentEligibilityResult;
}): void {
  if (!isDevelopmentEnvironment()) {
    return;
  }

  if (
    !isArchivedScopeDiagnosticDocument({
      metadata: input.metadata,
      content: input.content,
    })
  ) {
    return;
  }

  console.info('[Archived Debug]', {
    stage: 'eligibility',
    documentId: input.metadata.documentId ?? null,
    relativePath: input.file.relativePath,
    selectedWorkspaceId: input.selectedWorkspaceId,
    includeArchived: input.includeArchived,
    workspaceStatuses: input.eligibility.workspaceLookups.map(
      (lookup) => lookup.workspaceStatus ?? 'unknown',
    ),
    eligibleByLifecycle: input.eligibility.eligible,
    reason: input.eligibility.reason,
    workspaceLookups: input.eligibility.workspaceLookups,
  });
}

function logArchivedScopeScore(input: {
  metadata: MimoraDocumentMetadata;
  content: string;
  file: VaultFile;
  eligibility: DocumentEligibilityResult;
  score: number;
  exactMeaningfulTokenMatch: boolean;
  exactSubstringMatch: boolean;
  includedAfterThreshold: boolean;
}): void {
  if (!isDevelopmentEnvironment()) {
    return;
  }

  if (
    !isArchivedScopeDiagnosticDocument({
      metadata: input.metadata,
      content: input.content,
    })
  ) {
    return;
  }

  console.info('[Archived Debug]', {
    stage: 'scoring',
    documentId: input.metadata.documentId ?? null,
    relativePath: input.file.relativePath,
    eligibleByLifecycle: input.eligibility.eligible,
    exactMatch:
      input.exactMeaningfulTokenMatch || input.exactSubstringMatch,
    score: input.score,
    threshold: AUTO_CONTEXT_MIN_SCORE,
    includedAfterThreshold: input.includedAfterThreshold,
  });
}

function createMetadataResultFields(metadataResult: ParsedDocumentMetadata): {
  mimoraDocumentId?: string;
  workspaceIds: string[];
  originWorkspaceId?: string | null;
  documentSecurity?: MimoraDocumentMetadata['security'];
  contentOrigin?: MimoraDocumentMetadata['contentOrigin'];
  metadata: MimoraDocumentMetadata;
  metadataIssues?: DocumentMetadataValidationIssue[];
} {
  return {
    ...(metadataResult.metadata.documentId
      ? {
          mimoraDocumentId: metadataResult.metadata.documentId,
        }
      : {}),
    workspaceIds: metadataResult.metadata.workspaceIds,
    originWorkspaceId: metadataResult.metadata.originWorkspaceId ?? null,
    documentSecurity: metadataResult.metadata.security,
    contentOrigin: metadataResult.metadata.contentOrigin,
    metadata: metadataResult.metadata,
    ...(metadataResult.issues.length > 0
      ? { metadataIssues: metadataResult.issues }
      : {}),
  };
}

const koreanParticles = [
  '에게서',
  '으로',
  '에서',
  '에게',
  '부터',
  '까지',
  '처럼',
  '보다',
  '이나',
  '거나',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '과',
  '와',
  '의',
  '에',
  '로',
  '도',
  '만',
];

function normalizeRetrievalText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripKoreanParticle(token: string): string {
  for (const particle of koreanParticles) {
    if (token.endsWith(particle) && token.length - particle.length >= 2) {
      return token.slice(0, -particle.length);
    }
  }

  return token;
}

function preprocessRetrievalQuery(query: string): {
  phrase: string;
  tokens: string[];
} {
  const phrase = normalizeRetrievalText(query);
  const rawTokens = phrase.split(' ').filter((token) => token.length >= 2);
  const meaningfulTokens = rawTokens
    .map(stripKoreanParticle)
    .filter((token) => token.length >= 2 && !retrievalStopWords.has(token));

  return {
    phrase,
    tokens: [...new Set(meaningfulTokens)],
  };
}

function countOccurrences(content: string, term: string): number {
  let count = 0;
  let searchIndex = 0;

  while (searchIndex < content.length) {
    const matchIndex = content.indexOf(term, searchIndex);

    if (matchIndex < 0) {
      break;
    }

    count += 1;
    searchIndex = matchIndex + Math.max(term.length, 1);
  }

  return count;
}

function getMarkdownHeadings(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^\s*#{1,6}\s+/, ''))
    .join(' ');
}

function getMarkdownFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(
    content,
  );

  if (!match) {
    return { frontmatter: '', body: content };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function getMarkdownTagValues(frontmatter: string): string {
  const tagValues: string[] = [];
  const lines = frontmatter.split(/\r?\n/u);
  let collectingTags = false;

  for (const line of lines) {
    const tagsField = /^\s*tags?\s*:\s*(.*)$/iu.exec(line);

    if (tagsField) {
      collectingTags = true;
      if (tagsField[1]) {
        tagValues.push(tagsField[1]);
      }
      continue;
    }

    if (!collectingTags) {
      continue;
    }

    const listItem = /^\s*-\s+(.+)$/u.exec(line);

    if (listItem) {
      tagValues.push(listItem[1]);
      continue;
    }

    if (/^\s*[\p{L}\p{N}_-]+\s*:/u.test(line) || line.trim()) {
      collectingTags = false;
    }
  }

  return tagValues.join(' ');
}

function getExactTokens(value: string): Set<string> {
  return new Set(
    normalizeRetrievalText(value)
      .split(' ')
      .map(stripKoreanParticle)
      .filter((token) => token.length >= 2),
  );
}

function isStrongLookupToken(token: string): boolean {
  return token.length >= 4 && /[\p{Script=Latin}\p{N}_-]/u.test(token);
}

function calculateRetrievalScore(
  file: VaultFile,
  content: string,
  phrase: string,
  tokens: string[],
): {
  matchedTokenCount: number;
  phraseMatched: boolean;
  score: number;
  exactMeaningfulTokenMatch: boolean;
  exactSubstringMatch: boolean;
  exactMatchedTokenCount: number;
  scoreBeforeExactBoost: number;
  exactMatchBonus: number;
} {
  const fileName = normalizeRetrievalText(file.name);
  const folderPath = normalizeRetrievalText(file.folder);
  const headings = normalizeRetrievalText(getMarkdownHeadings(content));
  const body = normalizeRetrievalText(content);
  const markdownSections = getMarkdownFrontmatter(content);
  const tagValues = getMarkdownTagValues(markdownSections.frontmatter);
  const exactTokens = {
    tags: getExactTokens(tagValues),
    frontmatter: getExactTokens(markdownSections.frontmatter),
    headings: getExactTokens(headings),
    fileName: getExactTokens(fileName),
    folderPath: getExactTokens(folderPath),
    body: getExactTokens(markdownSections.body),
  };
  let score = 0;
  let phraseMatched = false;

  if (phrase.length >= 2) {
    if (fileName.includes(phrase)) {
      score += 50;
      phraseMatched = true;
    }
    if (folderPath.includes(phrase)) {
      score += 30;
      phraseMatched = true;
    }
    if (headings.includes(phrase)) {
      score += 45;
      phraseMatched = true;
    }
    if (body.includes(phrase)) {
      score += 20;
      phraseMatched = true;
    }
  }

  let matchedTokenCount = 0;
  let exactMatchedTokenCount = 0;
  let exactMatchBonusTotal = 0;
  let exactSubstringMatchedTokenCount = 0;

  for (const token of tokens) {
    let tokenMatched = false;

    if (fileName.includes(token)) {
      score += 14;
      tokenMatched = true;
    }

    if (folderPath.includes(token)) {
      score += 8;
      tokenMatched = true;
    }

    if (headings.includes(token)) {
      score += 12;
      tokenMatched = true;
    }

    const bodyOccurrences = countOccurrences(body, token);

    if (bodyOccurrences > 0) {
      score += Math.min(bodyOccurrences, 3) * 2;
      tokenMatched = true;
    }

    if (tokenMatched) {
      matchedTokenCount += 1;
    }

    const exactMatchBonuses = [
      exactTokens.tags.has(token) ? 36 : 0,
      exactTokens.frontmatter.has(token) ? 30 : 0,
      exactTokens.headings.has(token) ? 26 : 0,
      exactTokens.fileName.has(token) ? 24 : 0,
      exactTokens.folderPath.has(token) ? 20 : 0,
      exactTokens.body.has(token) ||
      (isStrongLookupToken(token) && body.includes(token))
        ? 16
        : 0,
    ];
    const exactMatchBonus = Math.max(...exactMatchBonuses);

    if (exactMatchBonus > 0) {
      score += exactMatchBonus;
      exactMatchBonusTotal += exactMatchBonus;
      exactMatchedTokenCount += 1;

      if (!exactTokens.body.has(token) && body.includes(token)) {
        exactSubstringMatchedTokenCount += 1;
      }
    }
  }

  if (matchedTokenCount >= 2) {
    score += matchedTokenCount * (matchedTokenCount - 1) * 3;
  }

  if (tokens.length > 0 && matchedTokenCount === tokens.length) {
    score += 12;
  }

  const exactMeaningfulTokenMatch = exactMatchedTokenCount > 0;
  const exactSubstringMatch = exactSubstringMatchedTokenCount > 0;
  const scoreBeforeExactBoost = score - exactMatchBonusTotal;

  if (exactMeaningfulTokenMatch) {
    score = Math.max(score, EXACT_MATCH_MIN_SCORE);
  }

  return {
    matchedTokenCount,
    phraseMatched,
    score,
    exactMeaningfulTokenMatch,
    exactSubstringMatch,
    exactMatchedTokenCount,
    scoreBeforeExactBoost,
    exactMatchBonus: exactMatchBonusTotal,
  };
}

function createAutoContextSnippet(
  content: string,
  originalQuery: string,
  tokens: string[],
): string {
  const normalizedContent = content.toLocaleLowerCase();
  const query = originalQuery.trim().toLocaleLowerCase();
  let matchIndex = query ? normalizedContent.indexOf(query) : -1;
  let matchedTerm = query;

  if (matchIndex < 0) {
    for (const token of [...tokens].sort((left, right) => right.length - left.length)) {
      matchIndex = normalizedContent.indexOf(token);

      if (matchIndex >= 0) {
        matchedTerm = token;
        break;
      }
    }
  }

  if (matchIndex < 0) {
    matchIndex = 0;
    matchedTerm = '';
  }

  return createSearchSnippet(content, matchIndex, matchedTerm);
}

async function retrieveFromVault(
  vault: VaultConfig,
  query: string,
  phrase: string,
  tokens: string[],
  workspaceId: string,
  workspaceStatusMap: WorkspaceStatusMap,
  workspaceStatusLookupAvailable: boolean,
  includeArchived: boolean,
  metadataRegistryOptions: MetadataRegistryOptions = {},
  knowledgeFilters: KnowledgeSearchFilters = normalizeKnowledgeSearchFilters(),
  contentOriginScope: ContentOriginSearchScope = 'all',
): Promise<VaultRetrieval> {
  const rootPath = await resolveVaultRoot(vault);
  const files: VaultFile[] = [];
  const results: ScoredAutoContext[] = [];
  const pipeline = createEmptyRetrievalPipelineCounts();

  await walkMarkdownFiles(rootPath, rootPath, [], files);
  pipeline.allMarkdownCandidates = files.length;

  for (const file of files) {
    try {
      const { content } = await readMarkdownFile(rootPath, file.relativePath);
      const metadataResult = parseMimoraDocumentMetadata(
        content,
        metadataRegistryOptions,
      );
      pipeline.metadataParsedCandidates += 1;
      const eligibility = isDocumentEligibleForSearch({
        selectedWorkspaceId: workspaceId,
        workspaceIds: metadataResult.metadata.workspaceIds,
        workspaceStatusMap,
        workspaceStatusLookupAvailable,
        includeArchived,
      });

      logArchivedScopeDocumentMetadata({
        metadata: metadataResult.metadata,
        content,
        file,
      });

      logArchivedScopeEligibility({
        metadata: metadataResult.metadata,
        content,
        file,
        selectedWorkspaceId: workspaceId,
        includeArchived,
        eligibility,
      });

      if (!eligibility.eligible) {
        continue;
      }

      pipeline.lifecycleEligibleCandidates += 1;

      if (
        !documentMatchesContentOriginScope(
          metadataResult.metadata,
          contentOriginScope,
        )
      ) {
        continue;
      }

      pipeline.contentOriginEligibleCandidates += 1;

      if (!documentMatchesKnowledgeFilters(metadataResult.metadata, knowledgeFilters)) {
        continue;
      }

      pipeline.knowledgeEligibleCandidates += 1;

      const {
        matchedTokenCount,
        phraseMatched,
        score,
        exactMeaningfulTokenMatch,
        exactSubstringMatch,
        exactMatchedTokenCount,
        scoreBeforeExactBoost,
        exactMatchBonus,
      } =
        calculateRetrievalScore(file, content, phrase, tokens);
      const effectiveContentOrigin = getEffectiveContentOrigin(
        metadataResult.metadata,
      );
      const originalContentOriginBoost =
        contentOriginScope === 'all' && effectiveContentOrigin === 'human'
          ? 2
          : 0;
      const boostedScore = score + originalContentOriginBoost;
      const scoreMeetsCandidateThreshold = score > 0;
      const scoredContext: ScoredAutoContext = {
        documentId: createVaultDocumentId(vault.id, file.relativePath),
        ...createMetadataResultFields(metadataResult),
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type,
        security: vault.security,
        relativePath: file.relativePath,
        fileName: file.name,
        score: boostedScore,
        matchedTokenCount,
        phraseMatched,
        exactMeaningfulTokenMatch,
        exactSubstringMatch,
        exactMatchedTokenCount,
        scoreBeforeExactBoost,
        exactMatchBonus,
        originalContentOriginBoost,
        snippet: createAutoContextSnippet(content, query, tokens),
        content,
      };
      const includedAfterThreshold =
        scoreMeetsCandidateThreshold &&
        meetsAutoContextThreshold(scoredContext, tokens.length);

      if (scoreMeetsCandidateThreshold) {
        pipeline.queryMatchedCandidates += 1;
      }

      if (includedAfterThreshold) {
        pipeline.aboveThresholdCandidates += 1;
      }

      logArchivedScopeScore({
        metadata: metadataResult.metadata,
        content,
        file,
        eligibility,
        score,
        exactMeaningfulTokenMatch,
        exactSubstringMatch,
        includedAfterThreshold,
      });

      if (!scoreMeetsCandidateThreshold) {
        continue;
      }

      results.push(scoredContext);
    } catch (error) {
      console.warn('Skipped an unreadable Vault file during retrieval.', error);
    }
  }

  return { candidateCount: files.length, results, pipeline };
}

function meetsAutoContextThreshold(
  result: ScoredAutoContext,
  queryTokenCount: number,
): boolean {
  const hasEnoughTokenCoverage =
    queryTokenCount < 3 ||
    result.matchedTokenCount >= 2 ||
    result.phraseMatched;

  const meetsScoreThreshold =
    result.score >= AUTO_CONTEXT_MIN_SCORE ||
    ((result.exactMeaningfulTokenMatch || result.exactSubstringMatch) &&
      result.score >= EXACT_MATCH_MIN_SCORE);

  return meetsScoreThreshold && hasEnoughTokenCoverage;
}

function logRetrievalDiagnostics(input: {
  queryChars: number;
  candidateCount: number;
  results: ScoredAutoContext[];
  queryTokenCount: number;
  queryTokens: string[];
  knowledgeFilters: KnowledgeSearchFilters;
  contentOriginScope: ContentOriginSearchScope;
  pipeline: RetrievalPipelineCounts;
}): void {
  if (
    process.env.NODE_ENV !== 'development' &&
    !process.env.VITE_DEV_SERVER_URL
  ) {
    return;
  }

  const topResults = input.results.slice(0, 5).map((result, index) => ({
    rank: index + 1,
    scoreBeforeExactBoost: result.scoreBeforeExactBoost,
    exactMatchBonus: result.exactMatchBonus,
    originalContentOriginBoost: result.originalContentOriginBoost,
    score: result.score,
    matchedTokens: result.matchedTokenCount,
    exactMatchedTokens: result.exactMatchedTokenCount,
    exactMeaningfulTokenMatch: result.exactMeaningfulTokenMatch,
    exactSubstringMatch: result.exactSubstringMatch,
    previouslyBelowScoreThreshold:
      result.scoreBeforeExactBoost < AUTO_CONTEXT_MIN_SCORE,
    status: meetsAutoContextThreshold(result, input.queryTokenCount)
      ? 'accepted'
      : 'rejected',
  }));

  console.info('[Mimora Retrieval]', {
    queryChars: input.queryChars,
    queryTokens: input.queryTokens,
    knowledgeFilters: input.knowledgeFilters,
    contentOriginScope: input.contentOriginScope,
    scannedCandidates: input.candidateCount,
    pipeline: input.pipeline,
    matchedCandidates: input.results.length,
    exactMatchCandidates: input.results.filter(
      (result) => result.exactMeaningfulTokenMatch,
    ).length,
    autoContextMinScore: AUTO_CONTEXT_MIN_SCORE,
    exactMatchMinScore: EXACT_MATCH_MIN_SCORE,
    source: 'raw-markdown',
    aboveThreshold: input.results.filter((result) =>
      meetsAutoContextThreshold(result, input.queryTokenCount),
    ).length,
    rejectedByThreshold: input.results.filter(
      (result) => !meetsAutoContextThreshold(result, input.queryTokenCount),
    ).length,
    topResults,
  });
}

function logDuplicateDocumentIdWarning(
  results: Array<{
    mimoraDocumentId?: string;
    vaultId: string;
    vaultName: string;
    relativePath: string;
  }>,
  source: 'vault-search' | 'auto-context',
): void {
  if (
    process.env.NODE_ENV !== 'development' &&
    !process.env.VITE_DEV_SERVER_URL
  ) {
    return;
  }

  const documentsById = new Map<
    string,
    Array<{ vaultId: string; vaultName: string; relativePath: string }>
  >();

  for (const result of results) {
    if (!result.mimoraDocumentId) {
      continue;
    }

    const documents = documentsById.get(result.mimoraDocumentId) ?? [];

    documents.push({
      vaultId: result.vaultId,
      vaultName: result.vaultName,
      relativePath: result.relativePath,
    });
    documentsById.set(result.mimoraDocumentId, documents);
  }

  const duplicates = [...documentsById.entries()]
    .filter(([, documents]) => documents.length > 1)
    .map(([documentId, documents]) => ({
      documentId,
      count: documents.length,
      documents,
    }));

  if (duplicates.length === 0) {
    return;
  }

  console.warn('[Mimora Metadata] Duplicate document_id detected.', {
    source,
    duplicateCount: duplicates.length,
    duplicates,
  });
}

function validateAutoContextInput(input: unknown): Required<AutoContextRetrievalInput> {
  if (!input || typeof input !== 'object') {
    throw new Error('자동 문서 검색 요청이 올바르지 않습니다.');
  }

  const candidate = input as Partial<AutoContextRetrievalInput>;
  const query = typeof candidate.query === 'string' ? candidate.query.trim() : '';
  const workspaceId =
    typeof candidate.workspaceId === 'string' && candidate.workspaceId.trim()
      ? candidate.workspaceId.trim()
      : allWorkspaceId;

  if (!query) {
    throw new Error('자동 문서 검색을 위한 질문이 비어 있습니다.');
  }

  const requestedLimit =
    typeof candidate.limit === 'number' && Number.isFinite(candidate.limit)
      ? Math.floor(candidate.limit)
      : 5;
  const knowledgeFilters = normalizeKnowledgeSearchFilters(
    candidate.knowledgeFilters,
  );
  const contentOriginScope = isContentOriginSearchScope(
    candidate.contentOriginScope,
  )
    ? candidate.contentOriginScope
    : 'all';

  return {
    query,
    workspaceId,
    limit: Math.min(Math.max(requestedLimit, 1), 10),
    includeArchived: candidate.includeArchived === true,
    knowledgeFilters,
    contentOriginScope,
  };
}

export function createVaultFilesService(
  settingsStore: SettingsStore,
  options: { getRegistryCachePath?: () => string } = {},
) {
  const registryStatusService = createRegistryStatusService(settingsStore, {
    getCachePath: options.getRegistryCachePath,
  });

  async function loadMetadataRegistryOptions(): Promise<MetadataRegistryOptions> {
    const [workspaceRegistry, domainRegistry, typeRegistry] = await Promise.all([
      registryStatusService
        .loadWorkspaceRegistry()
        .catch(() => null),
      registryStatusService
        .loadKnowledgeDomainRegistry()
        .catch(() => null),
      registryStatusService
        .loadKnowledgeTypeRegistry()
        .catch(() => null),
    ]);

    return {
      knownWorkspaceIds: workspaceRegistry?.workspaces.map(
        (workspace) => workspace.id,
      ),
      knowledgeDomainRegistry: domainRegistry?.registry ?? null,
      knowledgeTypeRegistry: typeRegistry?.registry ?? null,
      knowledgeDomainRegistryUnavailable: !domainRegistry?.registry,
      knowledgeTypeRegistryUnavailable: !typeRegistry?.registry,
    };
  }

  return {
    async validateDocumentIds(): Promise<DocumentIdValidationSummary> {
      const settings = await settingsStore.getSettings();
      const documents: DocumentIdValidationDocument[] = [];
      const documentsByKey = new Map<string, DocumentIdValidationDocument>();
      const errors: DocumentIdValidationSummary['errors'] = [];

      for (const vault of settings.vaults) {
        try {
          const rootPath = await resolveVaultRoot(vault);
          const files: VaultFile[] = [];

          await walkMarkdownFiles(rootPath, rootPath, [], files);

          for (const file of files) {
            if (isOfficialRegistryMarkdownPath(file.relativePath)) {
              continue;
            }

            try {
              const content = await readMarkdownFile(rootPath, file.relativePath);
              const metadataResult = parseMimoraDocumentMetadata(
                content.content,
                {},
              );
              const documentId =
                metadataResult.metadata.documentId?.trim() || null;
              const documentKey = createDocumentValidationKey(
                vault.id,
                file.relativePath,
              );

              if (documentsByKey.has(documentKey)) {
                continue;
              }

              const validationDocument: DocumentIdValidationDocument = {
                documentKey,
                vaultId: vault.id,
                vaultName: vault.name,
                vaultType: vault.type,
                vaultSecurity: vault.security,
                relativePath: file.relativePath,
                fileName: file.name,
                documentId,
                status: getDocumentIdFormatStatus(documentId),
              };

              documentsByKey.set(documentKey, validationDocument);
              documents.push(validationDocument);
            } catch (error) {
              errors.push({
                vaultId: vault.id,
                vaultName: vault.name,
                message:
                  error instanceof Error
                    ? `${file.relativePath}: ${error.message}`
                    : `${file.relativePath}: Markdown file could not be read.`,
              });
            }
          }
        } catch (error) {
          errors.push({
            vaultId: vault.id,
            vaultName: vault.name,
            message:
              error instanceof Error
                ? error.message
                : 'Vault could not be scanned.',
          });
        }
      }

      const documentsByValidId = new Map<
        string,
        Map<string, DocumentIdValidationDocument>
      >();

      for (const document of documents) {
        if (!document.documentId || document.status !== 'valid') {
          continue;
        }

        const documentsForId =
          documentsByValidId.get(document.documentId) ??
          new Map<string, DocumentIdValidationDocument>();

        documentsForId.set(document.documentKey, document);
        documentsByValidId.set(document.documentId, documentsForId);
      }

      for (const [documentId, documentsForId] of documentsByValidId) {
        const uniqueDocuments = [...documentsForId.values()];

        if (uniqueDocuments.length < 2) {
          continue;
        }

        for (const document of uniqueDocuments) {
          document.status = 'duplicate';
          document.duplicateGroupId = documentId;
        }
      }

      const counts = createEmptyDocumentIdCounts();

      for (const document of documents) {
        counts[document.status] += 1;
      }

      return {
        scannedAt: new Date().toISOString(),
        vaultCount: settings.vaults.length,
        documentCount: documents.length,
        counts,
        documents,
        duplicateGroups: [...documentsByValidId.entries()]
          .map(([documentId, documentsForId]) => ({
            documentId,
            documents: [...documentsForId.values()],
          }))
          .filter((group) => group.documents.length > 1),
        errors,
      };
    },

    async listVaultFiles(vaultId: unknown): Promise<VaultFile[]> {
      const vault = await getVault(settingsStore, vaultId);
      const rootPath = await resolveVaultRoot(vault);
      const files: VaultFile[] = [];

      await walkMarkdownFiles(rootPath, rootPath, [], files);
      return files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );
    },

    async readVaultFile(
      vaultId: unknown,
      relativePath: unknown,
    ): Promise<VaultFileContent> {
      const vault = await getVault(settingsStore, vaultId);
      const rootPath = await resolveVaultRoot(vault);

      return readMarkdownFile(rootPath, relativePath);
    },

    async searchVaultFiles(input: unknown): Promise<VaultSearchResult[]> {
      const searchInput = validateSearchInput(input);
      const settings = await settingsStore.getSettings();
      const metadataRegistryOptions = await loadMetadataRegistryOptions();
      const requestedKnowledgeFilters = normalizeKnowledgeSearchFilters(
        searchInput.knowledgeFilters,
      );
      const effectiveKnowledgeFilters =
        normalizeKnowledgeFiltersForMetadataRegistry(
          requestedKnowledgeFilters,
          metadataRegistryOptions,
        );

      if (isDevelopmentEnvironment()) {
        console.info('[Mimora Knowledge Filter]', {
          stage: 'searchVaultFiles',
          selectedDomain: effectiveKnowledgeFilters.domains[0] ?? '',
          selectedType: effectiveKnowledgeFilters.types[0] ?? '',
          requestDomains: requestedKnowledgeFilters.domains,
          requestTypes: requestedKnowledgeFilters.types,
          effectiveDomains: effectiveKnowledgeFilters.domains,
          effectiveTypes: effectiveKnowledgeFilters.types,
        });
      }

      if (settings.vaults.length === 0) {
        throw new Error('등록된 Vault가 없습니다. 설정에서 Vault를 추가하세요.');
      }

      if (searchInput.scope === 'current') {
        const vault = await getVault(settingsStore, searchInput.vaultId);
        return searchVault(
          vault,
          searchInput.query,
          metadataRegistryOptions,
          effectiveKnowledgeFilters,
          searchInput.contentOriginScope,
        );
      }

      const vaultSearches = await Promise.all(
        settings.vaults.map(async (vault) => {
          try {
            return {
              searched: true,
              results: await searchVault(
                vault,
                searchInput.query,
                metadataRegistryOptions,
                effectiveKnowledgeFilters,
                searchInput.contentOriginScope,
              ),
            };
          } catch (error) {
            console.warn('Skipped an unavailable Vault during search.', error);
            return { searched: false, results: [] as VaultSearchResult[] };
          }
        }),
      );

      if (!vaultSearches.some((result) => result.searched)) {
        throw new Error(
          '검색할 수 있는 Vault가 없습니다. 설정에서 Vault 경로와 권한을 확인하세요.',
        );
      }

      const searchResults = vaultSearches.flatMap((result) => result.results);

      logDuplicateDocumentIdWarning(searchResults, 'vault-search');

      return searchResults;
    },

    async retrieveAutoContext(input: unknown): Promise<AutoRetrievedContext[]> {
      const retrievalInput = validateAutoContextInput(input);
      const settings = await settingsStore.getSettings();

      if (settings.vaults.length === 0) {
        return [];
      }

      const { phrase, tokens } = preprocessRetrievalQuery(retrievalInput.query);
      const metadataRegistryOptions = await loadMetadataRegistryOptions();
      const normalizedKnowledgeFilters =
        normalizeKnowledgeFiltersForMetadataRegistry(
          retrievalInput.knowledgeFilters,
          metadataRegistryOptions,
        );
      const effectiveKnowledgeFilters = isAllWorkspaceScope(
        retrievalInput.workspaceId,
      )
        ? normalizedKnowledgeFilters
        : normalizeKnowledgeSearchFilters();
      const workspaceRegistry =
        isAllWorkspaceScope(retrievalInput.workspaceId)
          ? await registryStatusService.loadWorkspaceRegistry()
          : null;
      const workspaceStatusMap = createWorkspaceStatusMap(
        workspaceRegistry?.workspaces ?? [],
      );
      const workspaceStatusLookupAvailable =
        !isAllWorkspaceScope(retrievalInput.workspaceId) ||
        (workspaceRegistry?.workspaces.length ?? 0) > 0;

      if (isDevelopmentEnvironment()) {
        const archivedTestWorkspaceStatus =
          workspaceStatusMap.get('WS-2025-0001');

        console.info('[Archived Debug]', {
          stage: 'retrieveAutoContext:main',
          workspaceId: retrievalInput.workspaceId,
          requestIncludeArchived: retrievalInput.includeArchived,
          retrievalIncludeArchived: retrievalInput.includeArchived,
          isAllWorkspace: isAllWorkspaceScope(retrievalInput.workspaceId),
          workspaceRegistryState: workspaceRegistry?.state ?? null,
          queryTokens: tokens,
          requestKnowledgeFilters: retrievalInput.knowledgeFilters,
          effectiveKnowledgeFilters,
          contentOriginScope: retrievalInput.contentOriginScope,
        });
        console.info('[Archived Debug]', {
          stage: 'workspace-lookup',
          workspaceId: 'WS-2025-0001',
          found: Boolean(archivedTestWorkspaceStatus),
          status: archivedTestWorkspaceStatus ?? null,
        });
      }

      const vaultRetrievals = await Promise.all(
        settings.vaults.map(async (vault) => {
          try {
            return {
              searched: true,
              retrieval: await retrieveFromVault(
                vault,
                retrievalInput.query,
                phrase,
                tokens,
                retrievalInput.workspaceId,
                workspaceStatusMap,
                workspaceStatusLookupAvailable,
                retrievalInput.includeArchived,
                metadataRegistryOptions,
                effectiveKnowledgeFilters,
                retrievalInput.contentOriginScope,
              ),
            };
          } catch (error) {
            console.warn('Skipped an unavailable Vault during retrieval.', error);
            return {
              searched: false,
              retrieval: {
                candidateCount: 0,
                results: [] as ScoredAutoContext[],
                pipeline: createEmptyRetrievalPipelineCounts(),
              },
            };
          }
        }),
      );

      if (!vaultRetrievals.some((result) => result.searched)) {
        throw new Error(
          '자동 검색에 사용할 수 있는 Vault가 없습니다. Vault 경로와 권한을 확인하세요.',
        );
      }

      const scoredResults = vaultRetrievals
        .flatMap((result) => result.retrieval.results)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.vaultName.localeCompare(right.vaultName) ||
            left.relativePath.localeCompare(right.relativePath),
        );

      logDuplicateDocumentIdWarning(scoredResults, 'auto-context');

      logRetrievalDiagnostics({
        queryChars: retrievalInput.query.length,
        candidateCount: vaultRetrievals.reduce(
          (total, result) => total + result.retrieval.candidateCount,
          0,
        ),
        results: scoredResults,
        queryTokenCount: tokens.length,
        queryTokens: tokens,
        knowledgeFilters: effectiveKnowledgeFilters,
        contentOriginScope: retrievalInput.contentOriginScope,
        pipeline: mergeRetrievalPipelineCounts(
          vaultRetrievals.map((result) => result.retrieval.pipeline),
        ),
      });

      const acceptedResults = scoredResults
        .filter((result) => meetsAutoContextThreshold(result, tokens.length))
        .slice(0, retrievalInput.limit);

      if (isDevelopmentEnvironment() && isArchivedDebugQuery(retrievalInput.query)) {
        const pipeline = mergeRetrievalPipelineCounts(
          vaultRetrievals.map((result) => result.retrieval.pipeline),
        );

        console.info('[Archived Debug]', {
          stage: 'pipeline-counts',
          workspaceId: retrievalInput.workspaceId,
          retrievalIncludeArchived: retrievalInput.includeArchived,
          ...pipeline,
          finalAutoContextCount: acceptedResults.length,
          finalDocumentIds: acceptedResults.map(
            (result) => result.mimoraDocumentId ?? null,
          ),
          finalRelativePaths: acceptedResults.map(
            (result) => result.relativePath,
          ),
        });
      }

      return acceptedResults
        .map(
          ({
            matchedTokenCount: _matchedTokenCount,
            phraseMatched: _phraseMatched,
            exactMeaningfulTokenMatch: _exactMeaningfulTokenMatch,
            exactSubstringMatch: _exactSubstringMatch,
            exactMatchedTokenCount: _exactMatchedTokenCount,
            scoreBeforeExactBoost: _scoreBeforeExactBoost,
            exactMatchBonus: _exactMatchBonus,
            originalContentOriginBoost: _originalContentOriginBoost,
            ...result
          }) =>
            result,
        );
    },
  };
}
