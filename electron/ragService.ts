import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  RagDeleteResult,
  RagDocument,
  RagDocumentSecurity,
  RagEmbeddingProvider,
  RagEmbeddingStatus,
  RagEmbeddingStatusInput,
  RagFileSelection,
  RagIndexInput,
  RagIndexResult,
  RagImportInput,
  RagImportResult,
  RagPythonStatus,
  RagReplaceInput,
  RagReplaceResult,
  RagSearchInput,
  RagSearchResult,
  RagSettings,
} from '../src/rag';
import {
  defaultLocalRagEmbeddingModel,
  defaultOpenAIRagEmbeddingModel,
  defaultRagEmbeddingModel,
  defaultRagEmbeddingProvider,
  ragSupportedExtensions,
} from '../src/rag';
import { workspaceIdPattern } from '../src/workspace/types';

type RagWorkerSuccess<T> = {
  ok: true;
  data: T;
};

type RagWorkerFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type RagWorkerResult<T> = RagWorkerSuccess<T> | RagWorkerFailure;

type RagServiceOptions = {
  getUserDataPath: () => string;
  getAppRoot?: () => string;
  getOpenAIApiKey?: () => Promise<string>;
  getRagSettings?: () => Promise<{
    rag: RagSettings;
    ollamaBaseUrl: string;
  }>;
  runWorker?: <T>(command: string, input: unknown) => Promise<T>;
};

const pythonExecutableCandidates =
  process.platform === 'win32'
    ? [
        { executable: 'python', args: [] as string[] },
        { executable: 'py', args: ['-3'] },
      ]
    : [{ executable: 'python3', args: [] as string[] }];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getWorkerPath(getAppRoot?: () => string): string {
  const appRoot = getAppRoot?.() ?? process.cwd();
  const sourceWorkerPath = path.resolve(appRoot, 'python', 'mimora_worker.py');

  return sourceWorkerPath;
}

function getRagStorageRoot(userDataPath: string): string {
  return path.join(userDataPath, 'rag');
}

function validateWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const workspaceIds = value
    .filter((workspaceId): workspaceId is string => typeof workspaceId === 'string')
    .map((workspaceId) => workspaceId.trim())
    .filter(Boolean);

  for (const workspaceId of workspaceIds) {
    if (!workspaceIdPattern.test(workspaceId)) {
      throw new Error('Workspace ID must use WS-YYYY-NNNN format.');
    }
  }

  return [...new Set(workspaceIds)];
}

function validateSecurity(value: unknown): RagDocumentSecurity {
  if (
    value === 'internal' ||
    value === 'sensitive' ||
    value === 'personal' ||
    value === 'private'
  ) {
    return value;
  }

  throw new Error('RAG document security is invalid.');
}

function normalizeEmbeddingProvider(value: unknown): RagEmbeddingProvider {
  if (typeof value !== 'string' || !value.trim()) {
    return defaultRagEmbeddingProvider;
  }

  const normalized = value.trim().toLocaleLowerCase('en-US');

  if (normalized === 'local' || normalized === 'openai') {
    return normalized;
  }

  throw new Error('Unsupported RAG embedding provider.');
}

function normalizeEmbeddingModel(value: unknown, fallback = defaultRagEmbeddingModel): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  return value.trim();
}

function validateIndexInput(input: unknown): RagIndexInput & {
  ragDocumentId: string;
} {
  if (!isRecord(input) || typeof input.ragDocumentId !== 'string') {
    throw new Error('RAG index input is invalid.');
  }

  return {
    ragDocumentId: validateRagDocumentId(input.ragDocumentId),
    ...(typeof input.embeddingProvider === 'string'
      ? { embeddingProvider: normalizeEmbeddingProvider(input.embeddingProvider) }
      : {}),
    ...(typeof input.embeddingModel === 'string'
      ? { embeddingModel: normalizeEmbeddingModel(input.embeddingModel) }
      : {}),
  };
}

function validateTopK(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5;
  }

  return Math.max(1, Math.min(20, Math.floor(value)));
}

function validateSimilarityThreshold(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(-1, Math.min(1, value));
}

function validateSearchInput(input: unknown): RagSearchInput & {
  query: string;
  workspaceIds: string[];
  includeGlobal: boolean;
  security: RagDocumentSecurity;
  topK: number;
} {
  if (!isRecord(input) || typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('RAG search query is required.');
  }

  return {
    query: input.query.trim(),
    workspaceIds: validateWorkspaceIds(input.workspaceIds),
    includeGlobal: input.includeGlobal !== false,
    security: validateSecurity(input.security),
    topK: validateTopK(input.topK),
    ...(typeof input.embeddingProvider === 'string'
      ? { embeddingProvider: normalizeEmbeddingProvider(input.embeddingProvider) }
      : {}),
    ...(typeof input.embeddingModel === 'string'
      ? { embeddingModel: normalizeEmbeddingModel(input.embeddingModel) }
      : {}),
    ...(typeof input.similarityThreshold === 'number'
      ? { similarityThreshold: validateSimilarityThreshold(input.similarityThreshold) }
      : {}),
  };
}

async function validateSourcePath(sourcePath: unknown): Promise<string> {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('RAG source file path is required.');
  }

  const normalizedSourcePath = path.resolve(sourcePath);

  if (!path.isAbsolute(sourcePath)) {
    throw new Error('RAG source file path must be an absolute path.');
  }

  const extension = path.extname(normalizedSourcePath).toLocaleLowerCase();

  if (
    !ragSupportedExtensions.includes(
      extension as (typeof ragSupportedExtensions)[number],
    )
  ) {
    throw new Error('Unsupported RAG file type.');
  }

  try {
    const sourceStats = await stat(normalizedSourcePath);

    if (!sourceStats.isFile()) {
      throw new Error('RAG source path is not a file.');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'RAG source path is not a file.') {
      throw error;
    }

    throw new Error('RAG source file was not found.');
  }

  return normalizedSourcePath;
}

async function validateImportInput(input: unknown): Promise<RagImportInput & {
  sourcePath: string;
}> {
  if (!isRecord(input)) {
    throw new Error('RAG import input is invalid.');
  }

  return {
    sourcePath: await validateSourcePath(input.sourcePath),
    workspaceIds: validateWorkspaceIds(input.workspaceIds),
    security: validateSecurity(input.security),
  };
}

async function validateReplaceInput(input: unknown): Promise<RagReplaceInput & {
  ragDocumentId: string;
  sourcePath: string;
}> {
  if (!isRecord(input) || typeof input.ragDocumentId !== 'string') {
    throw new Error('RAG replace input is invalid.');
  }

  return {
    ragDocumentId: validateRagDocumentId(input.ragDocumentId),
    sourcePath: await validateSourcePath(input.sourcePath),
  };
}

function validateRagDocumentId(input: unknown): string {
  if (typeof input !== 'string' || !/^RAG-\d{4}-\d{6}$/u.test(input)) {
    throw new Error('RAG document ID is invalid.');
  }

  return input;
}

async function runPythonProcess<T>(
  workerPath: string,
  command: string,
  input: unknown,
): Promise<T> {
  const payload = JSON.stringify(input);
  let lastError: unknown = null;

  for (const candidate of pythonExecutableCandidates) {
    try {
      return await new Promise<T>((resolve, reject) => {
        const child = spawn(
          candidate.executable,
          [...candidate.args, workerPath, command],
          {
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
        child.on('error', (error) => {
          reject(error);
        });
        child.on('close', (code) => {
          let result: RagWorkerResult<T> | null = null;

          try {
            result = JSON.parse(stdout) as RagWorkerResult<T>;
          } catch {
            reject(
              new Error(
                stderr.trim() ||
                  `Python worker returned invalid JSON with exit code ${code ?? 'unknown'}.`,
              ),
            );
            return;
          }

          if (result.ok) {
            resolve(result.data);
            return;
          }

          reject(new Error(result.error.message || result.error.code));
        });
        child.stdin.end(Buffer.from(payload, 'utf8'));
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Python worker is unavailable.');
}

export function createRagService(options: RagServiceOptions) {
  const workerPath = getWorkerPath(options.getAppRoot);
  const storageRoot = getRagStorageRoot(options.getUserDataPath());
  const runWorker =
    options.runWorker ??
    (<T>(command: string, input: unknown) =>
      runPythonProcess<T>(workerPath, command, input));

  async function resolveEmbeddingConfig(input: {
    embeddingProvider?: string;
    embeddingModel?: string;
  }): Promise<{
    embeddingProvider: RagEmbeddingProvider;
    embeddingModel: string;
    ollamaBaseUrl?: string;
    openAIApiKey?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    similarityThreshold?: number;
    workspaceScoreBonus?: number;
    maxChunksPerDocument?: number;
    searchCandidateCount?: number;
    denseOnlyThreshold?: number;
  }> {
    const settings = await options.getRagSettings?.();
    const configuredProvider =
      input.embeddingProvider ?? settings?.rag.embeddingProvider ?? defaultRagEmbeddingProvider;
    const embeddingProvider = normalizeEmbeddingProvider(configuredProvider);
    const embeddingModel = normalizeEmbeddingModel(
      input.embeddingModel,
      embeddingProvider === 'openai'
        ? settings?.rag.openAIEmbeddingModel ?? defaultOpenAIRagEmbeddingModel
        : settings?.rag.localEmbeddingModel ?? defaultLocalRagEmbeddingModel,
    );

    if (embeddingProvider === 'openai') {
      if (!options.getOpenAIApiKey) {
        throw new Error('OpenAI API Key reader is unavailable.');
      }

      return {
        embeddingProvider,
        embeddingModel,
        openAIApiKey: await options.getOpenAIApiKey(),
        chunkSize: settings?.rag.chunkSize,
        chunkOverlap: settings?.rag.chunkOverlap,
        similarityThreshold: settings?.rag.similarityThreshold,
        workspaceScoreBonus: settings?.rag.workspaceScoreBonus,
        maxChunksPerDocument: settings?.rag.maxChunksPerDocument,
        searchCandidateCount: settings?.rag.searchCandidateCount,
        denseOnlyThreshold: settings?.rag.denseOnlyThreshold,
      };
    }

    if (embeddingProvider === 'local') {
      return {
        embeddingProvider,
        embeddingModel,
        ollamaBaseUrl: settings?.ollamaBaseUrl,
        chunkSize: settings?.rag.chunkSize,
        chunkOverlap: settings?.rag.chunkOverlap,
        similarityThreshold: settings?.rag.similarityThreshold,
        workspaceScoreBonus: settings?.rag.workspaceScoreBonus,
        maxChunksPerDocument: settings?.rag.maxChunksPerDocument,
        searchCandidateCount: settings?.rag.searchCandidateCount,
        denseOnlyThreshold: settings?.rag.denseOnlyThreshold,
      };
    }

    throw new Error('Unsupported RAG embedding provider.');
  }

  function toWorkerEmbeddingInput(config: {
    embeddingProvider: string;
    embeddingModel: string;
    ollamaBaseUrl?: string;
    openAIApiKey?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    similarityThreshold?: number;
    workspaceScoreBonus?: number;
    maxChunksPerDocument?: number;
    searchCandidateCount?: number;
    denseOnlyThreshold?: number;
  }): Record<string, unknown> {
    return {
      embedding_provider: config.embeddingProvider,
      embedding_model: config.embeddingModel,
      ...(config.ollamaBaseUrl ? { ollama_base_url: config.ollamaBaseUrl } : {}),
      ...(config.openAIApiKey ? { openai_api_key: config.openAIApiKey } : {}),
      ...(typeof config.chunkSize === 'number' ? { chunk_size: config.chunkSize } : {}),
      ...(typeof config.chunkOverlap === 'number' ? { chunk_overlap: config.chunkOverlap } : {}),
      ...(typeof config.similarityThreshold === 'number'
        ? { similarity_threshold: config.similarityThreshold }
        : {}),
      ...(typeof config.workspaceScoreBonus === 'number'
        ? { workspace_score_bonus: config.workspaceScoreBonus }
        : {}),
      ...(typeof config.maxChunksPerDocument === 'number'
        ? { max_chunks_per_document: config.maxChunksPerDocument }
        : {}),
      ...(typeof config.searchCandidateCount === 'number'
        ? { search_candidate_count: config.searchCandidateCount }
        : {}),
      ...(typeof config.denseOnlyThreshold === 'number'
        ? { dense_only_threshold: config.denseOnlyThreshold }
        : {}),
    };
  }

  return {
    getStorageRoot: () => storageRoot,

    getPythonStatus: async (): Promise<RagPythonStatus> => {
      try {
        return await runWorker<RagPythonStatus>('runtime-check', {});
      } catch (error) {
        return {
          available: false,
          error:
            error instanceof Error
              ? error.message
              : 'Python runtime is unavailable.',
        };
      }
    },

    listDocuments: async (): Promise<RagDocument[]> =>
      runWorker<RagDocument[]>('rag-list', { storage_root: storageRoot }),

    importDocument: async (input: unknown): Promise<RagImportResult> => {
      const importInput = await validateImportInput(input);

      return runWorker<RagImportResult>('rag-import', {
        storage_root: storageRoot,
        source_path: importInput.sourcePath,
        workspace_ids: importInput.workspaceIds,
        security: importInput.security,
      });
    },

    deleteDocument: async (input: unknown): Promise<RagDeleteResult> =>
      runWorker<RagDeleteResult>('rag-delete', {
        storage_root: storageRoot,
        rag_document_id: validateRagDocumentId(input),
      }),

    replaceDocument: async (input: unknown): Promise<RagReplaceResult> => {
      const replaceInput = await validateReplaceInput(input);

      return runWorker<RagReplaceResult>('rag-replace', {
        storage_root: storageRoot,
        rag_document_id: replaceInput.ragDocumentId,
        source_path: replaceInput.sourcePath,
      });
    },

    indexDocument: async (input: unknown): Promise<RagIndexResult> => {
      const indexInput = validateIndexInput(input);
      const embeddingConfig = await resolveEmbeddingConfig(indexInput);

      return runWorker<RagIndexResult>('rag-index', {
        storage_root: storageRoot,
        rag_document_id: indexInput.ragDocumentId,
        ...toWorkerEmbeddingInput(embeddingConfig),
      });
    },

    search: async (input: unknown): Promise<RagSearchResult[]> => {
      const searchInput = validateSearchInput(input);
      const embeddingConfig = await resolveEmbeddingConfig(searchInput);

      if (
        searchInput.security === 'private' &&
        embeddingConfig.embeddingProvider !== 'local'
      ) {
        throw new Error('Private RAG search requires local embedding.');
      }

      return runWorker<RagSearchResult[]>('rag-search', {
        storage_root: storageRoot,
        query: searchInput.query,
        workspace_ids: searchInput.workspaceIds,
        include_global: searchInput.includeGlobal,
        security: searchInput.security,
        top_k: searchInput.topK,
        ...toWorkerEmbeddingInput(embeddingConfig),
        ...(typeof searchInput.similarityThreshold === 'number'
          ? { similarity_threshold: searchInput.similarityThreshold }
          : {}),
      });
    },

    checkEmbeddingStatus: async (
      input: unknown,
    ): Promise<RagEmbeddingStatus> => {
      const statusInput = isRecord(input) ? (input as RagEmbeddingStatusInput) : {};
      const embeddingConfig = await resolveEmbeddingConfig(statusInput);

      return runWorker<RagEmbeddingStatus>('embedding-check', {
        storage_root: storageRoot,
        ...toWorkerEmbeddingInput(embeddingConfig),
      });
    },
  };
}

export function createRagFileSelection(
  selectionId: string,
  filePath: string,
): RagFileSelection {
  return {
    selectionId,
    name: path.basename(filePath),
  };
}

export const ragFileDialogFilters = [
  {
    name: 'RAG Documents',
    extensions: ragSupportedExtensions.map((extension) => extension.slice(1)),
  },
];
