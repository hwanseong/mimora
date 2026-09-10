import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  RagDeleteResult,
  RagDocument,
  RagIndexResult,
  RagImportResult,
  RagPythonStatus,
  RagReplaceResult,
  RagSearchResult,
} from '../src/rag';
import { defaultRagSettings } from '../src/rag';
import { createRagService } from '../electron/ragService';

const calls: Array<{ command: string; input: unknown }> = [];
const tempRoot = await mkdtemp(path.join(tmpdir(), 'mimora-rag-service-test-'));
const sourcePath = path.join(tempRoot, '프로젝트_실행_계획.md');
const replacementPath = path.join(tempRoot, 'replacement.txt');
const sampleDocument: RagDocument = {
  ragDocumentId: 'RAG-2026-000001',
  originalFilename: 'sample.md',
  managedFilePath: 'managed/sample.md',
  fileType: '.md',
  fileSize: 12,
  fileHash: 'hash',
  security: 'internal',
  status: 'imported',
  createdAt: '2026-09-10T00:00:00Z',
  indexedAt: null,
  embeddingProvider: null,
  embeddingModel: null,
  embeddingDimension: null,
  chunkCount: 0,
  workspaceIds: ['WS-2026-0001'],
};

const openAIRagSettings = {
  rag: {
    ...defaultRagSettings,
    embeddingProvider: 'openai' as const,
    similarityThreshold: 0.27,
    workspaceScoreBonus: 0.04,
    maxChunksPerDocument: 3,
    searchCandidateCount: 60,
    defaultTopK: 7,
    denseOnlyThreshold: 0.56,
  },
  ollamaBaseUrl: 'http://127.0.0.1:11434',
};

await writeFile(sourcePath, '# 프로젝트 실행 계획\n', 'utf8');
await writeFile(replacementPath, 'replacement\n', 'utf8');

try {
  const service = createRagService({
    getUserDataPath: () => path.join(tempRoot, 'userData'),
    getAppRoot: () => 'D:/mimora',
    getOpenAIApiKey: async () => 'sk-test',
    getRagSettings: async () => openAIRagSettings,
    runWorker: async <T>(command: string, input: unknown): Promise<T> => {
      calls.push({ command, input });

      if (command === 'runtime-check') {
        return {
          available: true,
          executable: 'python',
          version: '3.12.0',
        } as T;
      }

      if (command === 'rag-list') {
        return [sampleDocument] as T;
      }

      if (command === 'rag-import') {
        return {
          status: 'imported',
          document: sampleDocument,
        } satisfies RagImportResult as T;
      }

      if (command === 'rag-delete') {
        return {
          ragDocumentId: 'RAG-2026-000001',
          deleted: true,
        } satisfies RagDeleteResult as T;
      }

      if (command === 'rag-replace') {
        return {
          status: 'replaced',
          document: sampleDocument,
        } satisfies RagReplaceResult as T;
      }

      if (command === 'rag-index') {
        return {
          status: 'indexed',
          document: {
            ...sampleDocument,
            status: 'indexed',
            indexedAt: '2026-09-10T00:00:00Z',
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimension: 1536,
            chunkCount: 2,
          },
        } satisfies RagIndexResult as T;
      }

      if (command === 'rag-search') {
        return [
          {
            score: 0.91,
            ragDocumentId: 'RAG-2026-000001',
            filename: 'sample.md',
            workspaceIds: ['WS-2026-0001'],
            security: 'internal',
            chunkId: 'RAG-2026-000001-CH-000001',
            chunkIndex: 0,
            heading: 'Overview',
            page: null,
            text: 'sample chunk',
          },
        ] satisfies RagSearchResult[] as T;
      }

      throw new Error(`Unexpected command: ${command}`);
    },
  });

  const pythonStatus: RagPythonStatus = await service.getPythonStatus();
  assert.equal(pythonStatus.available, true);
  assert.equal(pythonStatus.version, '3.12.0');

  const documents = await service.listDocuments();
  assert.equal(documents.length, 1);
  assert.equal(calls.at(-1)?.command, 'rag-list');

  const importResult = await service.importDocument({
    sourcePath,
    workspaceIds: ['WS-2026-0001', 'WS-2026-0001'],
    security: 'internal',
  });
  assert.equal(importResult.status, 'imported');
  assert.deepEqual((calls.at(-1)?.input as { workspace_ids: string[] }).workspace_ids, [
    'WS-2026-0001',
  ]);
  assert.equal(
    (calls.at(-1)?.input as { source_path: string }).source_path,
    sourcePath,
  );

  await assert.rejects(
    () =>
      service.importDocument({
        sourcePath: path.basename(sourcePath),
        workspaceIds: ['WS-2026-0001'],
        security: 'internal',
      }),
    /absolute path/u,
  );

  await assert.rejects(
    () =>
      service.importDocument({
        sourcePath,
        workspaceIds: ['bad-workspace'],
        security: 'internal',
      }),
    /Workspace ID/u,
  );

  const deleteResult = await service.deleteDocument('RAG-2026-000001');
  assert.equal(deleteResult.deleted, true);
  assert.equal(calls.at(-1)?.command, 'rag-delete');

  const replaceResult = await service.replaceDocument({
    ragDocumentId: 'RAG-2026-000001',
    sourcePath: replacementPath,
  });
  assert.equal(replaceResult.status, 'replaced');
  assert.equal(calls.at(-1)?.command, 'rag-replace');

  const indexResult = await service.indexDocument({
    ragDocumentId: 'RAG-2026-000001',
  });
  assert.equal(indexResult.status, 'indexed');
  assert.equal(calls.at(-1)?.command, 'rag-index');
  assert.equal(
    (calls.at(-1)?.input as { openai_api_key: string }).openai_api_key,
    'sk-test',
  );
  assert.equal(
    (calls.at(-1)?.input as { embedding_provider: string }).embedding_provider,
    'openai',
  );
  assert.equal(
    (calls.at(-1)?.input as { similarity_threshold: number }).similarity_threshold,
    0.27,
  );
  assert.equal(
    (calls.at(-1)?.input as { workspace_score_bonus: number }).workspace_score_bonus,
    0.04,
  );
  assert.equal(
    (calls.at(-1)?.input as { max_chunks_per_document: number }).max_chunks_per_document,
    3,
  );
  assert.equal(
    (calls.at(-1)?.input as { search_candidate_count: number }).search_candidate_count,
    60,
  );
  assert.equal(
    (calls.at(-1)?.input as { dense_only_threshold: number }).dense_only_threshold,
    0.56,
  );
  assert.equal(
    (calls.at(-1)?.input as { embedding_model: string }).embedding_model,
    'text-embedding-3-small',
  );

  const searchResult = await service.search({
    query: 'risk',
    workspaceIds: ['WS-2026-0001'],
    includeGlobal: true,
    security: 'internal',
    topK: 5,
  });
  assert.equal(searchResult.length, 1);
  assert.equal(calls.at(-1)?.command, 'rag-search');
  assert.deepEqual(
    (calls.at(-1)?.input as { workspace_ids: string[] }).workspace_ids,
    ['WS-2026-0001'],
  );
  assert.equal(
    (calls.at(-1)?.input as { embedding_provider: string }).embedding_provider,
    'openai',
  );

  await assert.rejects(() => service.deleteDocument('DOC-2026-0001'), /RAG document ID/u);
  await assert.rejects(
    () =>
      service.search({
        query: 'private',
        workspaceIds: [],
        includeGlobal: true,
        security: 'private',
        topK: 5,
      }),
    /Private RAG search/u,
  );

  const localCalls: Array<{ command: string; input: unknown }> = [];
  const localService = createRagService({
    getUserDataPath: () => path.join(tempRoot, 'localUserData'),
    getAppRoot: () => 'D:/mimora',
    getRagSettings: async () => ({
      rag: defaultRagSettings,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
    }),
    runWorker: async <T>(command: string, input: unknown): Promise<T> => {
      localCalls.push({ command, input });

      if (command === 'rag-index') {
        return {
          status: 'indexed',
          document: {
            ...sampleDocument,
            status: 'indexed',
            indexedAt: '2026-09-10T00:00:00Z',
            embeddingProvider: 'local',
            embeddingModel: 'bge-m3',
            embeddingDimension: 1024,
            chunkCount: 2,
          },
        } satisfies RagIndexResult as T;
      }

      if (command === 'rag-search') {
        return [] satisfies RagSearchResult[] as T;
      }

      if (command === 'embedding-check') {
        return {
          available: true,
          provider: 'local',
          model: 'bge-m3',
          endpoint: 'http://127.0.0.1:11434',
          dimension: 1024,
          message: 'Local embedding model is available.',
        } as T;
      }

      throw new Error(`Unexpected local command: ${command}`);
    },
  });

  await localService.indexDocument({
    ragDocumentId: 'RAG-2026-000001',
  });
  assert.equal(
    (localCalls.at(-1)?.input as { embedding_provider: string }).embedding_provider,
    'local',
  );
  assert.equal(
    (localCalls.at(-1)?.input as { embedding_model: string }).embedding_model,
    'bge-m3',
  );
  assert.equal(
    (localCalls.at(-1)?.input as { ollama_base_url: string }).ollama_base_url,
    'http://127.0.0.1:11434',
  );
  assert.equal(
    (localCalls.at(-1)?.input as { openai_api_key?: string }).openai_api_key,
    undefined,
  );

  await localService.search({
    query: 'private',
    workspaceIds: [],
    includeGlobal: true,
    security: 'private',
    topK: 5,
  });
  assert.equal(
    (localCalls.at(-1)?.input as { security: string }).security,
    'private',
  );
  assert.equal(
    (localCalls.at(-1)?.input as { embedding_provider: string }).embedding_provider,
    'local',
  );

  const localStatus = await localService.checkEmbeddingStatus({});
  assert.equal(localStatus.available, true);
  assert.equal(localStatus.provider, 'local');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.info('[rag-service-tests] RAG Electron service boundary passed.');
