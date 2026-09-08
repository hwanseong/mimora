import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AutoContextRetrievalInput,
  AutoRetrievedContext,
} from '../src/autoContext';
import type { createSettingsStore } from './settingsStore';
import type { VaultConfig } from '../src/settings';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchInput,
  VaultSearchResult,
} from '../src/vaultFiles';
import { allWorkspaceId } from '../src/workspaces';

type SettingsStore = ReturnType<typeof createSettingsStore>;

function createVaultDocumentId(vaultId: string, relativePath: string): string {
  return JSON.stringify([vaultId, relativePath]);
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
      const metadataResult = parseMimoraDocumentMetadata(content);
      const matchIndex = content.toLocaleLowerCase().indexOf(normalizedQuery);

      if (matchIndex >= 0) {
        results.push({
          ...baseResult,
          matchType: 'content',
          metadata: metadataResult.metadata,
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
  exactMatchedTokenCount: number;
  scoreBeforeExactBoost: number;
  exactMatchBonus: number;
};

type VaultRetrieval = {
  candidateCount: number;
  results: ScoredAutoContext[];
};

function shouldApplyWorkspaceFilter(workspaceId: string): boolean {
  return workspaceId !== allWorkspaceId;
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
      exactTokens.body.has(token) ? 16 : 0,
    ];
    const exactMatchBonus = Math.max(...exactMatchBonuses);

    if (exactMatchBonus > 0) {
      score += exactMatchBonus;
      exactMatchBonusTotal += exactMatchBonus;
      exactMatchedTokenCount += 1;
    }
  }

  if (matchedTokenCount >= 2) {
    score += matchedTokenCount * (matchedTokenCount - 1) * 3;
  }

  if (tokens.length > 0 && matchedTokenCount === tokens.length) {
    score += 12;
  }

  const exactMeaningfulTokenMatch = exactMatchedTokenCount > 0;
  const scoreBeforeExactBoost = score - exactMatchBonusTotal;

  if (exactMeaningfulTokenMatch) {
    score = Math.max(score, EXACT_MATCH_MIN_SCORE);
  }

  return {
    matchedTokenCount,
    phraseMatched,
    score,
    exactMeaningfulTokenMatch,
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
): Promise<VaultRetrieval> {
  const rootPath = await resolveVaultRoot(vault);
  const files: VaultFile[] = [];
  const results: ScoredAutoContext[] = [];

  await walkMarkdownFiles(rootPath, rootPath, [], files);

  for (const file of files) {
    try {
      const { content } = await readMarkdownFile(rootPath, file.relativePath);
      const metadataResult = parseMimoraDocumentMetadata(content);

      if (
        shouldApplyWorkspaceFilter(workspaceId) &&
        !metadataResult.metadata.workspaceIds.includes(workspaceId)
      ) {
        continue;
      }

      const {
        matchedTokenCount,
        phraseMatched,
        score,
        exactMeaningfulTokenMatch,
        exactMatchedTokenCount,
        scoreBeforeExactBoost,
        exactMatchBonus,
      } =
        calculateRetrievalScore(file, content, phrase, tokens);

      if (score <= 0) {
        continue;
      }

      results.push({
        documentId: createVaultDocumentId(vault.id, file.relativePath),
        metadata: metadataResult.metadata,
        vaultId: vault.id,
        vaultName: vault.name,
        vaultType: vault.type,
        security: vault.security,
        relativePath: file.relativePath,
        fileName: file.name,
        score,
        matchedTokenCount,
        phraseMatched,
        exactMeaningfulTokenMatch,
        exactMatchedTokenCount,
        scoreBeforeExactBoost,
        exactMatchBonus,
        snippet: createAutoContextSnippet(content, query, tokens),
        content,
      });
    } catch (error) {
      console.warn('Skipped an unreadable Vault file during retrieval.', error);
    }
  }

  return { candidateCount: files.length, results };
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
    (result.exactMeaningfulTokenMatch &&
      result.score >= EXACT_MATCH_MIN_SCORE);

  return meetsScoreThreshold && hasEnoughTokenCoverage;
}

function logRetrievalDiagnostics(input: {
  queryChars: number;
  candidateCount: number;
  results: ScoredAutoContext[];
  queryTokenCount: number;
  queryTokens: string[];
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
    score: result.score,
    matchedTokens: result.matchedTokenCount,
    exactMatchedTokens: result.exactMatchedTokenCount,
    exactMeaningfulTokenMatch: result.exactMeaningfulTokenMatch,
    previouslyBelowScoreThreshold:
      result.scoreBeforeExactBoost < AUTO_CONTEXT_MIN_SCORE,
    status: meetsAutoContextThreshold(result, input.queryTokenCount)
      ? 'accepted'
      : 'rejected',
  }));

  console.info('[Mimora Retrieval]', {
    queryChars: input.queryChars,
    queryTokens: input.queryTokens,
    scannedCandidates: input.candidateCount,
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

  return {
    query,
    workspaceId,
    limit: Math.min(Math.max(requestedLimit, 1), 10),
  };
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

    async retrieveAutoContext(input: unknown): Promise<AutoRetrievedContext[]> {
      const retrievalInput = validateAutoContextInput(input);
      const settings = await settingsStore.getSettings();

      if (settings.vaults.length === 0) {
        return [];
      }

      const { phrase, tokens } = preprocessRetrievalQuery(retrievalInput.query);
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
              ),
            };
          } catch (error) {
            console.warn('Skipped an unavailable Vault during retrieval.', error);
            return {
              searched: false,
              retrieval: {
                candidateCount: 0,
                results: [] as ScoredAutoContext[],
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

      logRetrievalDiagnostics({
        queryChars: retrievalInput.query.length,
        candidateCount: vaultRetrievals.reduce(
          (total, result) => total + result.retrieval.candidateCount,
          0,
        ),
        results: scoredResults,
        queryTokenCount: tokens.length,
        queryTokens: tokens,
      });

      return scoredResults
        .filter((result) => meetsAutoContextThreshold(result, tokens.length))
        .slice(0, retrievalInput.limit)
        .map(
          ({
            matchedTokenCount: _matchedTokenCount,
            phraseMatched: _phraseMatched,
            exactMeaningfulTokenMatch: _exactMeaningfulTokenMatch,
            exactMatchedTokenCount: _exactMatchedTokenCount,
            scoreBeforeExactBoost: _scoreBeforeExactBoost,
            exactMatchBonus: _exactMatchBonus,
            ...result
          }) =>
            result,
        );
    },
  };
}
