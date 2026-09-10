import assert from 'node:assert/strict';
import { buildLocalAIChatRequest } from '../electron/llm/promptBuilder';
import type { LocalAIChatInput } from '../src/llmChat';

const input: LocalAIChatInput = {
  workspaceId: 'WS-2026-0001',
  question: '계획 변경 리스크를 요약해줘.',
  history: [],
  manualContexts: [],
  autoContexts: [
    {
      sourceType: 'rag',
      vaultId: 'rag-library',
      vaultName: 'RAG Library',
      vaultType: 'knowledge',
      security: 'sensitive',
      documentSecurity: 'internal',
      relativePath: 'rag://RAG-2026-0001/chunk-1',
      fileName: '프로젝트_실행_계획.md',
      ragDocumentId: 'RAG-2026-0001',
      page: 3,
      heading: '일정 리스크',
      relevanceScore: 0.91,
      content:
        '코어뱅킹 채널 통합 프로젝트의 일정 리스크는 외부 심사 일정과 연동되어 있다.',
    },
  ],
};

const result = buildLocalAIChatRequest(input, { model: 'llama3.1' });
const userMessage = result.request.messages.at(-1)?.content ?? '';

assert.match(userMessage, /Source Type: RAG/u);
assert.match(userMessage, /RAG ID: RAG-2026-0001/u);
assert.match(userMessage, /Page: 3/u);
assert.match(userMessage, /Section: 일정 리스크/u);
assert.match(userMessage, /Content:/u);
assert.equal(result.sources.length, 1);
assert.equal(result.sources[0].sourceType, 'rag');
assert.equal(result.sources[0].ragDocumentId, 'RAG-2026-0001');
assert.equal(result.sources[0].page, 3);
assert.equal(result.sources[0].heading, '일정 리스크');
assert.equal(result.diagnostics.ragDocumentCount, 1);

console.log('rag-chat-context-tests passed');
