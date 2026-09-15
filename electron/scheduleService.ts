import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  CanonicalSchedule,
  ScheduleFileSelection,
  ScheduleParseResult,
  ScheduleQueryInput,
  ScheduleQueryResult,
  ScheduleRemoveResult,
  ScheduleRefreshOptions,
  ScheduleSource,
  ScheduleSummary,
} from '../src/schedule';
import { scheduleSupportedExtensions } from '../src/schedule';
import { workspaceIdPattern } from '../src/workspace/types';
import { runPythonWorker } from './pythonRuntime';

type ScheduleServiceOptions = {
  getUserDataPath: () => string;
  getAppRoot?: () => string;
  runWorker?: <T>(command: string, input: unknown) => Promise<T>;
};

type CachedSchedulePayload = {
  cacheVersion?: number;
  source: ScheduleSource;
  schedule: CanonicalSchedule;
};

export const scheduleFileDialogFilters = [
  {
    name: 'Schedule Excel',
    extensions: ['xlsx', 'xlsm'],
  },
];

const scheduleCacheVersion = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getScheduleRoot(userDataPath: string): string {
  return path.join(userDataPath, 'schedule');
}

function getSourcesPath(scheduleRoot: string): string {
  return path.join(scheduleRoot, 'sources.json');
}

function getManagedDocumentsRoot(scheduleRoot: string): string {
  return path.join(scheduleRoot, 'documents');
}

function getCachePath(scheduleRoot: string, workspaceId: string): string {
  return path.join(scheduleRoot, 'cache', `${workspaceId}.json`);
}

function validateWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !workspaceIdPattern.test(value)) {
    throw new Error('Workspace ID must use WS-YYYY-NNNN format.');
  }

  return value;
}

async function validateScheduleSourcePath(sourcePath: unknown): Promise<string> {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('Schedule source path is required.');
  }

  if (!path.isAbsolute(sourcePath)) {
    throw new Error('Schedule source path must be absolute.');
  }

  const normalizedPath = path.resolve(sourcePath);
  const extension = path.extname(normalizedPath).toLocaleLowerCase();

  if (
    !scheduleSupportedExtensions.includes(
      extension as (typeof scheduleSupportedExtensions)[number],
    )
  ) {
    throw new Error('Unsupported schedule file. Use .xlsx or .xlsm.');
  }

  const stats = await stat(normalizedPath);
  if (!stats.isFile()) {
    throw new Error('Schedule source path is not a file.');
  }

  return normalizedPath;
}

async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_') || 'schedule.xlsx';
}

function getFileModifiedAt(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

async function createScheduleSource(
  workspaceId: string,
  sourcePath: string,
  scheduleRoot: string,
): Promise<ScheduleSource> {
  const stats = await stat(sourcePath);
  const sourceHash = await sha256File(sourcePath);
  const originalFileName = path.basename(sourcePath);
  const managedDirectory = path.join(
    getManagedDocumentsRoot(scheduleRoot),
    workspaceId,
  );
  const managedFilePath = path.join(
    managedDirectory,
    `${sourceHash.slice(0, 12)}-${sanitizeFilename(originalFileName)}`,
  );
  const now = new Date().toISOString();

  await mkdir(managedDirectory, { recursive: true });
  await copyFile(sourcePath, managedFilePath);

  return {
    id: `schedule-${workspaceId}-${randomUUID()}`,
    workspaceId,
    sourcePath: managedFilePath,
    originalFileName,
    managedFilePath,
    sourceHash,
    registeredAt: now,
    registeredBy: 'local-user',
    status: 'active',
    disconnectedAt: null,
    parserType: 'schedule_excel',
    security: 'internal',
    notes: null,
    filename: originalFileName,
    fileSize: stats.size,
    modifiedAt: getFileModifiedAt((await stat(managedFilePath)).mtimeMs),
    lastParsedAt: null,
    parseStatus: 'registered',
  };
}

function validateRegisterInput(input: unknown): {
  workspaceId: string;
  sourcePath: string;
} {
  if (!isRecord(input)) {
    throw new Error('Schedule register input is invalid.');
  }

  return {
    workspaceId: validateWorkspaceId(input.workspaceId),
    sourcePath: String(input.sourcePath ?? ''),
  };
}

function validateQueryInput(input: unknown): ScheduleQueryInput & {
  workspaceId: string;
  query: string;
} {
  if (
    !isRecord(input) ||
    typeof input.query !== 'string' ||
    !input.query.trim()
  ) {
    throw new Error('Schedule query is required.');
  }

  return {
    workspaceId: validateWorkspaceId(input.workspaceId),
    query: input.query.trim(),
    ...(typeof input.asOfDate === 'string' && input.asOfDate.trim()
      ? { asOfDate: input.asOfDate.trim() }
      : {}),
  };
}

function validateRefreshOptions(input: unknown): ScheduleRefreshOptions {
  if (!isRecord(input)) {
    return {};
  }

  return {
    force: input.force === true,
  };
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

export function createScheduleFileSelection(
  selectionId: string,
  filePath: string,
): ScheduleFileSelection {
  return {
    selectionId,
    name: path.basename(filePath),
  };
}

export function createScheduleService(options: ScheduleServiceOptions) {
  const scheduleRoot = getScheduleRoot(options.getUserDataPath());

  async function runWorker<T>(command: string, input: unknown): Promise<T> {
    if (options.runWorker) {
      return options.runWorker<T>(command, input);
    }

    return runPythonWorker<T>({
      command,
      input,
      getAppRoot: options.getAppRoot,
      serviceName: 'Schedule',
    });
  }

  async function loadAllSources(): Promise<ScheduleSource[]> {
    return readJsonFile<ScheduleSource[]>(
      getSourcesPath(scheduleRoot),
      [],
    );
  }

  async function loadSources(): Promise<ScheduleSource[]> {
    const sources = await loadAllSources();

    return sources.filter(
      (source) => source.status === undefined || source.status === 'active',
    );
  }

  async function saveSources(sources: ScheduleSource[]): Promise<void> {
    await writeJsonFile(getSourcesPath(scheduleRoot), sources);
  }

  async function upsertSource(source: ScheduleSource): Promise<ScheduleSource> {
    const sources = await loadAllSources();
    const now = new Date().toISOString();
    const archivedSources = sources
      .filter(
        (item) =>
          item.workspaceId === source.workspaceId &&
          (item.status === undefined || item.status === 'active') &&
          item.id !== source.id,
      )
      .map((item) => ({
        ...item,
        status: 'archived' as const,
        disconnectedAt: item.disconnectedAt ?? now,
      }));
    const nextSources = [
      ...sources.filter(
        (item) =>
          item.workspaceId !== source.workspaceId ||
          (item.status !== undefined && item.status !== 'active'),
      ),
      ...archivedSources,
      source,
    ];

    await saveSources(nextSources);
    return source;
  }

  async function readCache(
    workspaceId: string,
  ): Promise<CachedSchedulePayload | null> {
    const payload = await readJsonFile<CachedSchedulePayload | null>(
      getCachePath(scheduleRoot, workspaceId),
      null,
    );

    return payload &&
      payload.cacheVersion === scheduleCacheVersion &&
      payload.source?.workspaceId === workspaceId &&
      payload.schedule?.workspaceId === workspaceId
      ? payload
      : null;
  }

  async function writeCache(payload: CachedSchedulePayload): Promise<void> {
    await writeJsonFile(
      getCachePath(scheduleRoot, payload.source.workspaceId),
      payload,
    );
  }

  async function deleteCache(workspaceId: string): Promise<void> {
    try {
      await unlink(getCachePath(scheduleRoot, workspaceId));
    } catch (error) {
      if (
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
  }

  async function getSource(workspaceId: string): Promise<ScheduleSource | null> {
    const normalizedWorkspaceId = validateWorkspaceId(workspaceId);
    const sources = await loadSources();

    return (
      sources.find((source) => source.workspaceId === normalizedWorkspaceId) ??
      null
    );
  }

  async function parseFresh(source: ScheduleSource): Promise<ScheduleParseResult> {
    try {
      const parsed = await runWorker<ScheduleParseResult>('schedule-parse', {
        workspace_id: source.workspaceId,
        source_path: source.managedFilePath ?? source.sourcePath,
      });
      const nextSource = await upsertSource({
        ...source,
        ...parsed.source,
        id: source.id,
        sourcePath: source.managedFilePath ?? source.sourcePath,
        originalFileName: source.originalFileName ?? parsed.source.filename,
        managedFilePath: source.managedFilePath ?? source.sourcePath,
        sourceHash: source.sourceHash,
        registeredAt: source.registeredAt,
        registeredBy: source.registeredBy,
        status: 'active',
        disconnectedAt: null,
        parserType: 'schedule_excel',
        security: source.security ?? 'internal',
        notes: source.notes ?? null,
        filename: source.originalFileName ?? parsed.source.filename,
        parseStatus: 'parsed',
        parseError: undefined,
      });
      const nextSchedule: CanonicalSchedule = {
        ...parsed.schedule,
        sourceFile: source.managedFilePath ?? source.sourcePath,
        filename: source.originalFileName ?? parsed.schedule.filename,
      };
      const nextSummary: ScheduleSummary = {
        ...parsed.summary,
        filename: source.originalFileName ?? parsed.summary.filename,
        source: nextSource,
      };
      const payload = {
        cacheVersion: scheduleCacheVersion,
        source: nextSource,
        schedule: nextSchedule,
      };

      await writeCache(payload);

      return {
        ...parsed,
        source: nextSource,
        schedule: nextSchedule,
        summary: nextSummary,
        fromCache: false,
      };
    } catch (error) {
      const failedSource = await upsertSource({
        ...source,
        parseStatus: 'failed',
        parseError:
          error instanceof Error ? error.message : 'Schedule parse failed.',
      });

      throw Object.assign(
        new Error(failedSource.parseError ?? 'Schedule parse failed.'),
        { source: failedSource },
      );
    }
  }

  async function ensureFreshSchedule(
    workspaceId: string,
    options: ScheduleRefreshOptions = {},
  ): Promise<ScheduleParseResult> {
    const source = await getSource(workspaceId);

    if (!source) {
      throw new Error('No schedule source is registered for this Workspace.');
    }

    let stats;
    const managedPath = source.managedFilePath ?? source.sourcePath;
    try {
      stats = await stat(managedPath);
    } catch {
      await upsertSource({
        ...source,
        parseStatus: 'missing',
        parseError: 'Schedule source file was not found.',
      });
      throw new Error('Schedule source file was not found.');
    }

    const modifiedAt = getFileModifiedAt(stats.mtimeMs);
    const cache = await readCache(source.workspaceId);

    if (
      !options.force &&
      cache &&
      source.parseStatus === 'parsed' &&
      cache.source.modifiedAt === modifiedAt
    ) {
      const summary = await runWorker<ScheduleSummary>('schedule-summary', {
        source: cache.source,
        schedule: cache.schedule,
      });

      return {
        source: cache.source,
        schedule: cache.schedule,
        summary,
        fromCache: true,
      };
    }

    return parseFresh({
      ...source,
      sourcePath: managedPath,
      fileSize: stats.size,
      modifiedAt,
    });
  }

  return {
    getScheduleRoot: async (): Promise<string> => scheduleRoot,

    registerSource: async (input: unknown): Promise<ScheduleSource> => {
      const registerInput = validateRegisterInput(input);
      const sourcePath = await validateScheduleSourcePath(registerInput.sourcePath);
      const source = await createScheduleSource(
        registerInput.workspaceId,
        sourcePath,
        scheduleRoot,
      );

      await deleteCache(registerInput.workspaceId);
      return upsertSource(source);
    },

    removeSource: async (workspaceId: unknown): Promise<ScheduleRemoveResult> => {
      const normalizedWorkspaceId = validateWorkspaceId(workspaceId);
      const sources = await loadAllSources();
      const removedSource =
        sources.find(
          (source) =>
            source.workspaceId === normalizedWorkspaceId &&
            (source.status === undefined || source.status === 'active'),
        ) ??
        null;
      const now = new Date().toISOString();

      await saveSources(
        sources.map((source) =>
          source.workspaceId === normalizedWorkspaceId &&
          (source.status === undefined || source.status === 'active')
            ? {
                ...source,
                status: 'disconnected',
                disconnectedAt: source.disconnectedAt ?? now,
              }
            : source,
        ),
      );
      await deleteCache(normalizedWorkspaceId);

      return {
        removed: Boolean(removedSource),
        source: removedSource,
      };
    },

    getSource,

    refresh: async (
      workspaceId: unknown,
      options?: unknown,
    ): Promise<ScheduleParseResult> =>
      ensureFreshSchedule(
        validateWorkspaceId(workspaceId),
        validateRefreshOptions(options),
      ),

    getSummary: async (workspaceId: unknown): Promise<ScheduleSummary> => {
      const parsed = await ensureFreshSchedule(validateWorkspaceId(workspaceId));

      return parsed.summary;
    },

    query: async (input: unknown): Promise<ScheduleQueryResult> => {
      const queryInput = validateQueryInput(input);
      const parsed = await ensureFreshSchedule(queryInput.workspaceId);

      return runWorker<ScheduleQueryResult>('schedule-query', {
        source: parsed.source,
        schedule: parsed.schedule,
        query: queryInput.query,
        ...(queryInput.asOfDate ? { as_of_date: queryInput.asOfDate } : {}),
      });
    },
  };
}
