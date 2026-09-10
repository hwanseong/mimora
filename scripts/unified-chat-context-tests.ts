import assert from 'node:assert/strict';
import {
  buildLocalAIChatRequest,
  mimoraSystemPrompt,
} from '../electron/llm/promptBuilder';
import type { LocalAIChatInput } from '../src/llmChat';

const input: LocalAIChatInput = {
  workspaceId: 'WS-2026-0001',
  question: 'Why is Program B delayed?',
  history: [],
  manualContexts: [],
  autoContexts: [
    {
      sourceType: 'schedule',
      vaultId: 'schedule-intelligence',
      vaultName: 'Schedule Intelligence',
      vaultType: 'knowledge',
      security: 'sensitive',
      documentSecurity: 'internal',
      relativePath: 'schedule://WS-2026-0001/WS-2026-0001_Schedule.xlsm',
      fileName: 'WS-2026-0001_Schedule.xlsm',
      heading: 'As of 2026-09-10 / Schedule Performance',
      relevanceScore: 1,
      content: [
        '[SCHEDULE SOURCE OF TRUTH]',
        'Primary Schedule Entity:',
        'Entity Type: task',
        'Entity: 프로그램B',
        'Answer Priority: Start the answer with this entity-specific schedule status before project-level summary.',
        'Do Not Replace Entity Progress With Project Progress.',
        '- Task: 프로그램B',
        '  WBS: 2.3.1.2.1.2',
        '  Planned Start: 2026-05-21',
        '  Planned Finish: 2026-06-11',
        '  Actual Start: 2026-05-21',
        '  Actual Finish: unavailable',
        '  Actual Progress: 55.00%',
        '  Status: delayed',
        'Project Schedule Summary:',
        'Planned Progress: 100.00%',
        'Actual Progress: 23.44%',
        'SV(t): -103 working days',
        'SPI(t): 0.21',
        '[/SCHEDULE SOURCE OF TRUTH]',
      ].join('\n'),
    },
    {
      vaultId: 'project-vault',
      vaultName: 'Project Work',
      vaultType: 'work',
      security: 'internal',
      documentSecurity: 'internal',
      relativePath: 'Issues/program-b-delay.md',
      fileName: 'program-b-delay.md',
      heading: 'Program B delay issue',
      relevanceScore: 0.82,
      content: 'Program B was affected by external review delay.',
    },
    {
      sourceType: 'rag',
      vaultId: 'rag-library',
      vaultName: 'RAG Library',
      vaultType: 'knowledge',
      security: 'sensitive',
      documentSecurity: 'internal',
      relativePath: 'rag://RAG-2026-000001/chunk-1',
      fileName: 'external-review-lesson.md',
      ragDocumentId: 'RAG-2026-000001',
      heading: 'External review lesson',
      relevanceScore: 0.79,
      content: 'External review risk needs an early escalation path.',
    },
  ],
};

const result = buildLocalAIChatRequest(input, { model: 'qwen3:4b-instruct' });
const userMessage = result.request.messages.at(-1)?.content ?? '';

assert.match(mimoraSystemPrompt, /SCHEDULE SOURCE OF TRUTH/u);
assert.match(mimoraSystemPrompt, /conflicting schedule progress/u);
assert.match(mimoraSystemPrompt, /Primary Schedule Entity/u);
assert.match(mimoraSystemPrompt, /project-level values are secondary/u);
assert.match(mimoraSystemPrompt, /Schedule what-if answers/u);
assert.match(mimoraSystemPrompt, /modified the source workbook/u);
assert.match(userMessage, /\[CURRENT SCHEDULE - AUTHORITATIVE\]/u);
assert.match(userMessage, /\[VAULT DOCUMENT CONTEXT\]/u);
assert.match(userMessage, /\[RAG DOCUMENT CONTEXT\]/u);
assert.ok(
  userMessage.indexOf('[CURRENT SCHEDULE - AUTHORITATIVE]') <
    userMessage.indexOf('[VAULT DOCUMENT CONTEXT]'),
);
assert.ok(
  userMessage.indexOf('[VAULT DOCUMENT CONTEXT]') <
    userMessage.indexOf('[RAG DOCUMENT CONTEXT]'),
);
assert.match(userMessage, /Planned Progress: 100\.00%/u);
assert.match(userMessage, /Actual Progress: 23\.44%/u);
assert.match(userMessage, /Primary Schedule Entity:/u);
assert.match(userMessage, /WBS: 2\.3\.1\.2\.1\.2/u);
assert.match(userMessage, /Planned Start: 2026-05-21/u);
assert.match(userMessage, /Planned Finish: 2026-06-11/u);
assert.match(userMessage, /Actual Progress: 55\.00%/u);
assert.equal(result.sources.length, 3);
assert.equal(result.sources[0].sourceType, 'schedule');
assert.equal(result.sources[1].sourceType, undefined);
assert.equal(result.sources[2].sourceType, 'rag');

console.log('unified-chat-context-tests passed');
