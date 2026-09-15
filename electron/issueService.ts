import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  IssueDocument,
  IssueFileSelection,
  IssueParseResult,
  IssueQueryInput,
  IssueQueryResult,
  IssueRefreshOptions,
  IssueRemoveResult,
  IssueSummary,
  ProjectDocumentSecurity,
} from '../src/issue';
import { issueSupportedExtensions } from '../src/issue';
import { workspaceIdPattern } from '../src/workspace/types';
import { runPythonWorker } from './pythonRuntime';

type IssueServiceOptions = {
  getUserDataPath: () => string;
  getAppRoot?: () => string;
  runWorker?: <T>(command: string, input: unknown) => Promise<T>;
};

type CachedIssuePayload = {
  cacheVersion?: number;
  document: IssueDocument;
  issueBook: IssueParseResult['issueBook'];
};

const issueCacheVersion = 1;

export const issueFileDialogFilters = [
  {
    name: 'Issue Excel',
    extensions: ['xlsx', 'xlsm'],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getIssueRoot(userDataPath: string): string {
  return path.join(userDataPath, 'issue');
}

function getDocumentsPath(issueRoot: string): string {
  return path.join(issueRoot, 'documents.json');
}

function getManagedDocumentsRoot(issueRoot: string): string {
  return path.join(issueRoot, 'documents');
}

function getCachePath(issueRoot: string, workspaceId: string): string {
  return path.join(issueRoot, 'cache', `${workspaceId}.json`);
}

function validateWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !workspaceIdPattern.test(value)) {
    throw new Error('Workspace ID must use WS-YYYY-NNNN format.');
  }

  return value;
}

function validateSecurity(value: unknown): ProjectDocumentSecurity {
  return value === 'private' ? 'private' : 'internal';
}

function getFileModifiedAt(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_') || 'issue.xlsx';
}

async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function validateIssueSourcePath(sourcePath: unknown): Promise<string> {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('Issue source path is required.');
  }

  if (!path.isAbsolute(sourcePath)) {
    throw new Error('Issue source path must be absolute.');
  }

  const normalizedPath = path.resolve(sourcePath);
  const extension = path.extname(normalizedPath).toLocaleLowerCase();

  if (!issueSupportedExtensions.includes(extension as (typeof issueSupportedExtensions)[number])) {
    throw new Error('Unsupported issue file. Use .xlsx or .xlsm.');
  }

  const stats = await stat(normalizedPath);
  if (!stats.isFile()) {
    throw new Error('Issue source path is not a file.');
  }

  return normalizedPath;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function validateRegisterInput(input: unknown): {
  workspaceId: string;
  sourcePath: string;
  security: ProjectDocumentSecurity;
  notes: string | null;
} {
  if (!isRecord(input)) {
    throw new Error('Issue register input is invalid.');
  }

  return {
    workspaceId: validateWorkspaceId(input.workspaceId),
    sourcePath: String(input.sourcePath ?? ''),
    security: validateSecurity(input.security),
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null,
  };
}

function validateRefreshOptions(input: unknown): IssueRefreshOptions {
  if (!isRecord(input)) {
    return {};
  }

  return {
    force: input.force === true,
  };
}

function validateQueryInput(input: unknown): IssueQueryInput & {
  workspaceId: string;
  query: string;
} {
  if (!isRecord(input) || typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('Issue query is required.');
  }

  return {
    workspaceId: validateWorkspaceId(input.workspaceId),
    query: input.query.trim(),
    ...(typeof input.asOfDate === 'string' && input.asOfDate.trim()
      ? { asOfDate: input.asOfDate.trim() }
      : {}),
  };
}

async function createIssueDocument(input: {
  workspaceId: string;
  sourcePath: string;
  issueRoot: string;
  security: ProjectDocumentSecurity;
  notes: string | null;
}): Promise<IssueDocument> {
  const stats = await stat(input.sourcePath);
  const sourceHash = await sha256File(input.sourcePath);
  const originalFileName = path.basename(input.sourcePath);
  const managedDirectory = path.join(
    getManagedDocumentsRoot(input.issueRoot),
    input.workspaceId,
  );
  const managedFilePath = path.join(
    managedDirectory,
    `${sourceHash.slice(0, 12)}-${sanitizeFilename(originalFileName)}`,
  );
  const now = new Date().toISOString();

  await mkdir(managedDirectory, { recursive: true });
  await copyFile(input.sourcePath, managedFilePath);

  return {
    id: `issue-${input.workspaceId}-${randomUUID()}`,
    workspaceId: input.workspaceId,
    originalFileName,
    managedFilePath,
    sourceHash,
    registeredAt: now,
    registeredBy: 'local-user',
    status: 'active',
    disconnectedAt: null,
    lastAnalyzedAt: null,
    parserType: 'issue_excel',
    security: input.security,
    notes: input.notes,
    fileSize: stats.size,
    modifiedAt: getFileModifiedAt((await stat(managedFilePath)).mtimeMs),
    parseStatus: 'registered',
  };
}

export function createIssueFileSelection(
  selectionId: string,
  filePath: string,
): IssueFileSelection {
  return {
    selectionId,
    name: path.basename(filePath),
  };
}

export function createIssueService(options: IssueServiceOptions) {
  const issueRoot = getIssueRoot(options.getUserDataPath());

  async function runWorker<T>(command: string, input: unknown): Promise<T> {
    if (options.runWorker) {
      return options.runWorker<T>(command, input);
    }

    return runPythonWorker<T>({
      command,
      input,
      getAppRoot: options.getAppRoot,
      serviceName: 'Issue',
    });
  }

  async function loadAllDocuments(): Promise<IssueDocument[]> {
    return readJsonFile<IssueDocument[]>(getDocumentsPath(issueRoot), []);
  }

  async function loadDocuments(): Promise<IssueDocument[]> {
    const documents = await loadAllDocuments();

    return documents.filter((document) => document.status === 'active');
  }

  async function saveDocuments(documents: IssueDocument[]): Promise<void> {
    await writeJsonFile(getDocumentsPath(issueRoot), documents);
  }

  async function upsertDocument(document: IssueDocument): Promise<IssueDocument> {
    const documents = await loadAllDocuments();
    const now = new Date().toISOString();
    const archivedDocuments = documents
      .filter(
        (item) =>
          item.workspaceId === document.workspaceId && item.status === 'active',
      )
      .filter(
        (item) =>
          item.id !== document.id,
      )
      .map((item) => ({
        ...item,
        status: 'archived' as const,
        disconnectedAt: item.disconnectedAt ?? now,
      }));
    const nextDocuments = [
      ...documents.filter(
        (item) => item.workspaceId !== document.workspaceId || item.status !== 'active',
      ),
      ...archivedDocuments,
      document,
    ];

    await saveDocuments(nextDocuments);
    return document;
  }

  async function readCache(workspaceId: string): Promise<CachedIssuePayload | null> {
    const payload = await readJsonFile<CachedIssuePayload | null>(
      getCachePath(issueRoot, workspaceId),
      null,
    );

    return payload &&
      payload.cacheVersion === issueCacheVersion &&
      payload.document?.workspaceId === workspaceId &&
      payload.issueBook?.workspaceId === workspaceId
      ? payload
      : null;
  }

  async function writeCache(payload: CachedIssuePayload): Promise<void> {
    await writeJsonFile(
      getCachePath(issueRoot, payload.document.workspaceId),
      payload,
    );
  }

  async function deleteCache(workspaceId: string): Promise<void> {
    try {
      await unlink(getCachePath(issueRoot, workspaceId));
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }

  async function getDocument(workspaceId: string): Promise<IssueDocument | null> {
    const normalizedWorkspaceId = validateWorkspaceId(workspaceId);
    const documents = await loadDocuments();

    return (
      documents.find((document) => document.workspaceId === normalizedWorkspaceId) ??
      null
    );
  }

  async function parseFresh(document: IssueDocument): Promise<IssueParseResult> {
    try {
      const parsed = await runWorker<IssueParseResult>('issue-parse', {
        workspace_id: document.workspaceId,
        source_path: document.managedFilePath,
        source_document_id: document.id,
        source_hash: document.sourceHash,
      });
      const nextDocument = await upsertDocument({
        ...document,
        ...parsed.document,
        id: document.id,
        workspaceId: document.workspaceId,
        originalFileName: document.originalFileName,
        managedFilePath: document.managedFilePath,
        sourceHash: document.sourceHash,
        registeredAt: document.registeredAt,
        registeredBy: document.registeredBy,
        status: 'active',
        disconnectedAt: null,
        parserType: 'issue_excel',
        security: document.security,
        notes: document.notes,
        parseStatus: 'parsed',
        parseError: undefined,
      });
      const nextIssueBook = {
        ...parsed.issueBook,
        sourceFile: document.managedFilePath,
        filename: document.originalFileName,
      };
      const nextSummary: IssueSummary = {
        ...parsed.summary,
        filename: document.originalFileName,
        source: nextDocument,
      };
      const payload = {
        cacheVersion: issueCacheVersion,
        document: nextDocument,
        issueBook: nextIssueBook,
      };

      await writeCache(payload);

      return {
        ...parsed,
        document: nextDocument,
        issueBook: nextIssueBook,
        summary: nextSummary,
        fromCache: false,
      };
    } catch (error) {
      const failedDocument = await upsertDocument({
        ...document,
        parseStatus: 'failed',
        parseError:
          error instanceof Error ? error.message : 'Issue parse failed.',
      });

      throw Object.assign(
        new Error(failedDocument.parseError ?? 'Issue parse failed.'),
        { document: failedDocument },
      );
    }
  }

  async function ensureFreshIssueBook(
    workspaceId: string,
    options: IssueRefreshOptions = {},
  ): Promise<IssueParseResult> {
    const document = await getDocument(workspaceId);

    if (!document) {
      throw new Error('No issue source is registered for this Workspace.');
    }

    let stats;
    try {
      stats = await stat(document.managedFilePath);
    } catch {
      await upsertDocument({
        ...document,
        parseStatus: 'missing',
        parseError: 'Issue source file was not found.',
      });
      throw new Error('Issue source file was not found.');
    }

    const modifiedAt = getFileModifiedAt(stats.mtimeMs);
    const cache = await readCache(document.workspaceId);

    if (
      !options.force &&
      cache &&
      document.parseStatus === 'parsed' &&
      cache.document.modifiedAt === modifiedAt
    ) {
      const summary = await runWorker<IssueSummary>('issue-summary', {
        document: cache.document,
        issue_book: cache.issueBook,
      });

      return {
        document: cache.document,
        issueBook: cache.issueBook,
        summary,
        fromCache: true,
      };
    }

    return parseFresh({
      ...document,
      fileSize: stats.size,
      modifiedAt,
    });
  }

  return {
    getIssueRoot: async (): Promise<string> => issueRoot,

    registerDocument: async (input: unknown): Promise<IssueDocument> => {
      const registerInput = validateRegisterInput(input);
      const sourcePath = await validateIssueSourcePath(registerInput.sourcePath);
      const document = await createIssueDocument({
        workspaceId: registerInput.workspaceId,
        sourcePath,
        issueRoot,
        security: registerInput.security,
        notes: registerInput.notes,
      });

      await deleteCache(registerInput.workspaceId);
      return upsertDocument(document);
    },

    removeDocument: async (workspaceId: unknown): Promise<IssueRemoveResult> => {
      const normalizedWorkspaceId = validateWorkspaceId(workspaceId);
      const documents = await loadAllDocuments();
      const removedDocument =
        documents.find(
          (document) =>
            document.workspaceId === normalizedWorkspaceId &&
            document.status === 'active',
        ) ?? null;
      const now = new Date().toISOString();

      await saveDocuments(
        documents.map((document) =>
          document.workspaceId === normalizedWorkspaceId &&
          document.status === 'active'
            ? {
                ...document,
                status: 'disconnected',
                disconnectedAt: document.disconnectedAt ?? now,
              }
            : document,
        ),
      );
      await deleteCache(normalizedWorkspaceId);

      return {
        removed: Boolean(removedDocument),
        document: removedDocument,
      };
    },

    getDocument,

    refresh: async (
      workspaceId: unknown,
      options?: unknown,
    ): Promise<IssueParseResult> =>
      ensureFreshIssueBook(
        validateWorkspaceId(workspaceId),
        validateRefreshOptions(options),
      ),

    getSummary: async (workspaceId: unknown): Promise<IssueSummary> => {
      const parsed = await ensureFreshIssueBook(validateWorkspaceId(workspaceId));

      return parsed.summary;
    },

    query: async (input: unknown): Promise<IssueQueryResult> => {
      const queryInput = validateQueryInput(input);
      const parsed = await ensureFreshIssueBook(queryInput.workspaceId);

      return runWorker<IssueQueryResult>('issue-query', {
        document: parsed.document,
        issue_book: parsed.issueBook,
        query: queryInput.query,
        ...(queryInput.asOfDate ? { as_of_date: queryInput.asOfDate } : {}),
      });
    },
  };
}
