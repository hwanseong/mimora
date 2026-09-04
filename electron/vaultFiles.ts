import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { createSettingsStore } from './settingsStore';
import type { VaultConfig } from '../src/settings';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from '../src/vaultFiles';

type SettingsStore = ReturnType<typeof createSettingsStore>;

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

  if (!query) {
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
): Promise<VaultSearchResult[]> {
  const rootPath = await resolveVaultRoot(vault);
  const files: VaultFile[] = [];
  const normalizedQuery = query.toLocaleLowerCase();
  const results: VaultSearchResult[] = [];

  await walkMarkdownFiles(rootPath, rootPath, [], files);

  for (const file of files) {
    const baseResult = {
      vaultId: vault.id,
      vaultName: vault.name,
      vaultType: vault.type,
      security: vault.security,
      relativePath: file.relativePath,
      fileName: file.name,
    };

    if (file.name.toLocaleLowerCase().includes(normalizedQuery)) {
      results.push({ ...baseResult, matchType: 'filename' });
      continue;
    }

    if (file.relativePath.toLocaleLowerCase().includes(normalizedQuery)) {
      results.push({ ...baseResult, matchType: 'path' });
      continue;
    }

    try {
      const { content } = await readMarkdownFile(rootPath, file.relativePath);
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

export function createVaultFilesService(settingsStore: SettingsStore) {
  return {
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

      if (settings.vaults.length === 0) {
        throw new Error('등록된 Vault가 없습니다. 설정에서 Vault를 추가하세요.');
      }

      if (searchInput.scope === 'current') {
        const vault = await getVault(settingsStore, searchInput.vaultId);
        return searchVault(vault, searchInput.query);
      }

      const vaultSearches = await Promise.all(
        settings.vaults.map(async (vault) => {
          try {
            return {
              searched: true,
              results: await searchVault(vault, searchInput.query),
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

      return vaultSearches.flatMap((result) => result.results);
    },
  };
}
