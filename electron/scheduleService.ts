import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CanonicalSchedule,
  ScheduleFileSelection,
  ScheduleParseResult,
  ScheduleQueryInput,
  ScheduleQueryResult,
  ScheduleRegisterInput,
  ScheduleRemoveResult,
  ScheduleRefreshOptions,
  ScheduleSource,
  ScheduleSummary,
} from '../src/schedule';
import { scheduleSupportedExtensions } from '../src/schedule';
import { workspaceIdPattern } from '../src/workspace/types';

type ScheduleWorkerSuccess<T> = {
  ok: true;
  data: T;
};

type ScheduleWorkerFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type ScheduleWorkerResult<T> = ScheduleWorkerSuccess<T> | ScheduleWorkerFailure;

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

const pythonExecutableCandidates =
  process.platform === 'win32'
    ? [
        { executable: 'python', args: [] as string[] },
        { executable: 'py', args: ['-3'] },
      ]
    : [{ executable: 'python3', args: [] as string[] }];

const scheduleCacheVersion = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWorkerPath(getAppRoot?: () => string): string {
  return path.resolve(getAppRoot?.() ?? process.cwd(), 'python', 'mimora_worker.py');
}

function getScheduleRoot(userDataPath: string): string {
  return path.join(userDataPath, 'schedule');
}

function getSourcesPath(scheduleRoot: string): string {
  return path.join(scheduleRoot, 'sources.json');
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

function getFileModifiedAt(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

async function createScheduleSource(
  workspaceId: string,
  sourcePath: string,
): Promise<ScheduleSource> {
  const stats = await stat(sourcePath);

  return {
    workspaceId,
    sourcePath,
    filename: path.basename(sourcePath),
    fileSize: stats.size,
    modifiedAt: getFileModifiedAt(stats.mtimeMs),
    lastParsedAt: null,
    parseStatus: 'registered',
  };
}

function validateRegisterInput(input: unknown): ScheduleRegisterInput & {
  workspaceId: string;
  sourcePath: string;
} {
  if (!isRecord(input)) {
    throw new Error('Schedule register input is invalid.');
  }

  return {
    workspaceId: validateWorkspaceId(input.workspaceId),
    sourcePath: String(input.sourcePath ?? ''),
    ...(typeof input.selectionId === 'string'
      ? { selectionId: input.selectionId }
      : {}),
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

    const workerPath = getWorkerPath(options.getAppRoot);
    let lastError: unknown;

    for (const candidate of pythonExecutableCandidates) {
      try {
        return await new Promise<T>((resolve, reject) => {
          const child = spawn(
            candidate.executable,
            [...candidate.args, workerPath, command],
            {
              shell: false,
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
            },
          );
          let stdout = '';
          let stderr = '';

          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code !== 0 && !stdout.trim()) {
              reject(new Error(stderr.trim() || 'Schedule worker failed.'));
              return;
            }

            try {
              const parsed = JSON.parse(stdout.trim()) as ScheduleWorkerResult<T>;
              if (parsed.ok) {
                resolve(parsed.data);
              } else {
                reject(new Error(parsed.error.message));
              }
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(JSON.stringify(input));
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Schedule Python worker is unavailable.');
  }

  async function loadSources(): Promise<ScheduleSource[]> {
    return readJsonFile<ScheduleSource[]>(getSourcesPath(scheduleRoot), []);
  }

  async function saveSources(sources: ScheduleSource[]): Promise<void> {
    await writeJsonFile(getSourcesPath(scheduleRoot), sources);
  }

  async function upsertSource(source: ScheduleSource): Promise<ScheduleSource> {
    const sources = await loadSources();
    const nextSources = [
      ...sources.filter((item) => item.workspaceId !== source.workspaceId),
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
        source_path: source.sourcePath,
      });
      const nextSource = await upsertSource({
        ...parsed.source,
        parseStatus: 'parsed',
        parseError: undefined,
      });
      const payload = {
        cacheVersion: scheduleCacheVersion,
        source: nextSource,
        schedule: parsed.schedule,
      };

      await writeCache(payload);

      return {
        ...parsed,
        source: nextSource,
        summary: {
          ...parsed.summary,
          source: nextSource,
        },
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
    try {
      stats = await stat(source.sourcePath);
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
      );

      await deleteCache(registerInput.workspaceId);
      return upsertSource(source);
    },

    removeSource: async (workspaceId: unknown): Promise<ScheduleRemoveResult> => {
      const normalizedWorkspaceId = validateWorkspaceId(workspaceId);
      const sources = await loadSources();
      const removedSource =
        sources.find((source) => source.workspaceId === normalizedWorkspaceId) ??
        null;

      await saveSources(
        sources.filter((source) => source.workspaceId !== normalizedWorkspaceId),
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
