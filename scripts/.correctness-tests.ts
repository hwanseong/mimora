import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AUTO_CONTEXT_MIN_SCORE,
  createVaultFilesService,
} from '../electron/vaultFiles';
import { createOpenAIResponsesRequest } from '../electron/llm/OpenAIProvider';
import {
  isChatRequestBusy,
  tryBeginExternalAction,
} from '../src/chat';
import { ChatInput } from '../src/components/ChatInput';
import { ExternalPayloadPreviewModal } from '../src/components/ExternalPayloadPreviewModal';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';
import { RoutingStatus } from '../src/components/RoutingStatus';
import { buildExternalPayloadText } from '../src/security/externalPayloadBuilder';
import { createExternalPayloadPreview } from '../src/security/externalPayloadPreview';
import {
  authorizeExternalSend,
  evaluateOutboundPayload,
} from '../src/security/outboundPayloadSafety';
import { routeAIRequest } from '../src/security/securityRouter';

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownRenderer, { content, className: 'chat-markdown' }),
  );
}

const boldHtml = renderMarkdown('**리스크**와 **이슈**');
assert.match(boldHtml, /<strong>리스크<\/strong>/u);
assert.match(boldHtml, /<strong>이슈<\/strong>/u);

const tableHtml = renderMarkdown('| 구분 | 상태 |\n| --- | --- |\n| 리스크 | Open |');
assert.match(tableHtml, /<table>/u);
assert.match(tableHtml, /<th>구분<\/th>/u);
assert.match(tableHtml, /markdown-table-scroll/u);

const structureHtml = renderMarkdown(
  '### 점검\n\n- 목록\n- [x] 완료\n\n```ts\nconst ok = true\n```',
);
assert.match(structureHtml, /<h3>점검<\/h3>/u);
assert.match(structureHtml, /<ul/u);
assert.match(structureHtml, /type="checkbox"/u);
assert.match(structureHtml, /<pre><code class="language-ts">/u);

const rawHtml = renderMarkdown('<script>globalThis.compromised = true</script>');
assert.doesNotMatch(rawHtml, /<script>/u);

const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'mimora-retrieval-'));

try {
  await mkdir(path.join(vaultRoot, 'Notes'));
  await Promise.all([
    writeFile(
      path.join(vaultRoot, 'Notes', '임원-워크샵.md'),
      '# 임원 워크샵\n\n연간 프로젝트 관리 워크샵과 발표 일정을 준비한다.',
      'utf8',
    ),
    writeFile(
      path.join(vaultRoot, 'Notes', '한화비전.md'),
      '# 한화비전\n\nClaude API 도입 일정과 테스트 환경을 검토한다.',
      'utf8',
    ),
    writeFile(
      path.join(vaultRoot, '셀트리온.md'),
      '# 셀트리온 프로젝트\n\n셀트리온 담당자와 프로젝트 범위를 정리한다.',
      'utf8',
    ),
  ]);

  const settingsStore = {
    getSettings: async () => ({
      vaults: [
        {
          id: 'test-vault',
          name: 'Test Vault',
          type: 'work',
          security: 'internal',
          path: vaultRoot,
          createdAt: '2026-09-06T00:00:00.000Z',
          updatedAt: '2026-09-06T00:00:00.000Z',
        },
      ],
    }),
  } as unknown as Parameters<typeof createVaultFilesService>[0];
  const vaultFiles = createVaultFilesService(settingsStore);
  const genericResults = await vaultFiles.retrieveAutoContext({
    query: '프로젝트 관리에서 리스크와 이슈의 차이는 뭐야?',
    limit: 5,
  });
  const specificResults = await vaultFiles.retrieveAutoContext({
    query: '셀트리온 프로젝트가 뭐야?',
    limit: 5,
  });
  const unrelatedResults = await vaultFiles.retrieveAutoContext({
    query: '양자역학과 초전도체의 상관관계는?',
    limit: 5,
  });

  assert.equal(genericResults.length, 0);
  assert.equal(specificResults.length, 1);
  assert.equal(specificResults[0].fileName, '셀트리온.md');
  assert.ok(specificResults[0].score >= AUTO_CONTEXT_MIN_SCORE);
  assert.equal(unrelatedResults.length, 0);

  console.info('[correctness-check] Retrieval', {
    threshold: AUTO_CONTEXT_MIN_SCORE,
    genericCount: genericResults.length,
    specificCount: specificResults.length,
    specificScores: specificResults.map((result) => result.score),
    unrelatedCount: unrelatedResults.length,
  });
} finally {
  await rm(vaultRoot, { recursive: true, force: true });
}

const windowsPath = String.raw`C:\Users\test\Documents\a.md`;
const repeatedWindowsPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: `${windowsPath} and ${windowsPath}`,
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(
  repeatedWindowsPreview.maskedQuestion,
  '[FILE_PATH_001] and [FILE_PATH_001]',
);
assert.equal(repeatedWindowsPreview.replacements.length, 1);
assert.equal(repeatedWindowsPreview.replacements[0].count, 2);
assert.doesNotMatch(repeatedWindowsPreview.externalText, /C:\\Users/u);
assert.doesNotMatch(
  repeatedWindowsPreview.externalText,
  /FILE_PATH_001\s*(?:=|:|->|→)/u,
);

const unixPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: '/Users/test/Documents/a',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(unixPreview.maskedQuestion, '[FILE_PATH_001]');

const contentPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: windowsPath,
  manualContexts: [
    {
      vaultId: 'test-vault',
      vaultName: 'Test Vault',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'note.md',
      fileName: 'note.md',
      content: `문서 위치: ${windowsPath}`,
    },
  ],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(contentPreview.maskedQuestion, '[FILE_PATH_001]');
assert.match(contentPreview.documents[0].maskedContent, /\[FILE_PATH_001\]/u);
assert.equal(
  contentPreview.safety.checks.find(
    (check) => check.id === 'absolute-filesystem-path',
  )?.status,
  'pass',
);

const dictionaryPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: `김철수의 파일은 ${windowsPath}에 있다.`,
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [
    {
      id: 'person-1',
      type: 'person',
      value: '김철수',
      alias: 'PERSON_001',
      enabled: true,
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
    },
  ],
});
assert.match(dictionaryPreview.maskedQuestion, /\[PERSON_001\]/u);
assert.match(dictionaryPreview.maskedQuestion, /\[FILE_PATH_001\]/u);

const unmaskedPayload = buildExternalPayloadText({
  maskedQuestion: windowsPath,
  maskedDocumentContents: [],
});
const unmaskedSafety = evaluateOutboundPayload({
  externalText: unmaskedPayload.text,
  documents: [],
  maskingEntries: [],
  effectiveSecurity: 'internal',
});
assert.equal(unmaskedSafety.status, 'block');
assert.ok(unmaskedSafety.blockers.includes('absolute-filesystem-path'));

const passAuthorization = authorizeExternalSend({
  status: 'pass',
  mode: 'external',
  approved: false,
});
assert.equal(passAuthorization.allowed, true);
const responsesRequest = createOpenAIResponsesRequest(
  'gpt-test',
  'masked payload only',
);
assert.equal(responsesRequest.model, 'gpt-test');
assert.equal(responsesRequest.input, 'masked payload only');
assert.equal(responsesRequest.store, false);

const reviewPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'personal',
  question: 'Review question',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(reviewPreview.status, 'review-required');
const reviewWithoutApproval = authorizeExternalSend({
  status: reviewPreview.status,
  mode: 'external',
  approved: false,
});
assert.equal(reviewWithoutApproval.allowed, false);

const reviewComposerHtml = renderToStaticMarkup(
  createElement(ChatInput, {
    requestStatus: 'review-required',
    value: '',
    onChange: () => undefined,
    onSubmit: () => undefined,
  }),
);
assert.doesNotMatch(reviewComposerHtml, /<textarea[^>]+disabled/u);
assert.match(reviewComposerHtml, /외부 전송 검토가 필요합니다/u);
assert.doesNotMatch(reviewComposerHtml, /분석 중/u);
assert.equal(isChatRequestBusy('review-required'), false);
assert.equal(isChatRequestBusy('calling-external'), true);

let previewCloseCount = 0;
const reviewModalHtml = renderToStaticMarkup(
  createElement(ExternalPayloadPreviewModal, {
    preview: reviewPreview,
    onClose: () => {
      previewCloseCount += 1;
    },
    onApprove: async () => undefined,
    onUseLocalAI: async () => undefined,
  }),
);
assert.match(reviewModalHtml, /Masked Question/u);
assert.match(reviewModalHtml, /External Payload Safety/u);
assert.match(reviewModalHtml, /승인 후 OpenAI 전송/u);
assert.match(reviewModalHtml, /Local AI로 처리/u);
assert.equal(previewCloseCount, 0);

const reviewWithApproval = authorizeExternalSend({
  status: reviewPreview.status,
  mode: 'external',
  approved: true,
});
assert.equal(reviewWithApproval.allowed, true);

const pendingAction = { inFlight: false };
assert.equal(tryBeginExternalAction(pendingAction), true);
assert.equal(tryBeginExternalAction(pendingAction), false);

const blockedPreview = {
  ...reviewPreview,
  status: 'block' as const,
  safeToSend: false,
  blockers: ['absolute-filesystem-path'],
  safety: {
    status: 'block' as const,
    checks: reviewPreview.safety.checks,
    blockers: ['absolute-filesystem-path'],
    warnings: reviewPreview.safety.warnings,
  },
};
const blockedModalHtml = renderToStaticMarkup(
  createElement(ExternalPayloadPreviewModal, {
    preview: blockedPreview,
    onClose: () => undefined,
    onUseLocalAI: async () => undefined,
  }),
);
assert.doesNotMatch(blockedModalHtml, /승인 후 OpenAI 전송/u);
assert.match(blockedModalHtml, /Local AI로 처리/u);
const blockedApproval = authorizeExternalSend({
  status: 'block',
  mode: 'external',
  approved: true,
});
assert.deepEqual(blockedApproval, {
  allowed: false,
  message: '보안 검사에 실패한 요청은 승인할 수 없습니다.',
});

const questionAApproval = authorizeExternalSend({
  status: 'review-required',
  mode: 'external',
  approved: true,
});
const questionBApproval = authorizeExternalSend({
  status: 'review-required',
  mode: 'external',
  approved: false,
});
assert.equal(questionAApproval.allowed, true);
assert.equal(questionBApproval.allowed, false);

const approvedRouting = {
  ...routeAIRequest({
    mode: 'external',
    workspaceType: 'work',
    manualContexts: [],
    autoContexts: [],
    safetyStatus: 'review-required',
    externalAvailable: true,
  }),
  reason: 'user-approved' as const,
  approved: true,
};
const approvedFooterHtml = renderToStaticMarkup(
  createElement(RoutingStatus, {
    decision: approvedRouting,
    externalApproval: {
      required: true,
      approved: true,
      approvedAt: '2026-09-06T00:00:00.000Z',
    },
    model: 'gpt-test',
  }),
);
assert.match(approvedFooterHtml, /OpenAI · External · User Approved/u);
assert.match(approvedFooterHtml, /Safety REVIEW REQUIRED/u);
assert.match(approvedFooterHtml, /Model: gpt-test/u);

const localFallbackFooterHtml = renderToStaticMarkup(
  createElement(RoutingStatus, {
    decision: {
      ...approvedRouting,
      provider: 'local',
      reason: 'user-selected-local-fallback',
      approved: false,
    },
    externalApproval: {
      required: true,
      approved: false,
    },
    model: 'qwen-local',
  }),
);
assert.match(localFallbackFooterHtml, /Local AI · External · Local fallback/u);
assert.match(localFallbackFooterHtml, /User selected Local fallback/u);

console.info('[correctness-check] Markdown M1-M3 passed.');
console.info('[correctness-check] Path P1-P5 passed.');
console.info('[correctness-check] External review A-J state checks passed.');
