import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AUTO_CONTEXT_MIN_SCORE,
  EXACT_MATCH_MIN_SCORE,
  createVaultFilesService,
} from '../electron/vaultFiles';
import { createOpenAIResponsesRequest } from '../electron/llm/OpenAIProvider';
import { createSettingsStore } from '../electron/settingsStore';
import {
  isChatRequestBusy,
  tryBeginExternalAction,
  type ChatSessions,
} from '../src/chat';
import { ChatInput } from '../src/components/ChatInput';
import { ChatMessages } from '../src/components/ChatMessages';
import { ExternalPayloadPreviewModal } from '../src/components/ExternalPayloadPreviewModal';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';
import {
  createRecentChatItems,
  formatRecentChatTime,
  PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS,
  RecentChatsView,
  RECENT_CHAT_PREVIEW_MAX_CHARS,
} from '../src/components/RecentChatsView';
import { RoutingStatus } from '../src/components/RoutingStatus';
import { SecretDetectionSettingsSection } from '../src/components/SecretDetectionSettingsSection';
import { buildExternalPayloadText } from '../src/security/externalPayloadBuilder';
import { createExternalPayloadPreview } from '../src/security/externalPayloadPreview';
import type { MaskingEntry } from '../src/security/maskingEngine';
import {
  authorizeExternalSend,
  evaluateOutboundPayload,
} from '../src/security/outboundPayloadSafety';
import {
  applyResponseUnmasking,
  createResponseUnmaskingSnapshot,
  unmaskExternalResponse,
  unmaskExternalResponseFromSnapshot,
} from '../src/security/responseUnmasking';
import { routeAIRequest } from '../src/security/securityRouter';
import { defaultSettings } from '../src/settings';
import {
  REDACTED_SECRET,
  builtInSecretRules,
  detectSecrets,
  getSecretRules,
  normalizeMarkdownForSecretDetection,
  scanSecrets,
  validateCustomSecretRuleInput,
  type SecretRule,
} from '../src/security/secretDetector';
import {
  containsInternalNetworkAddress,
  createStructuralSensitiveDataMasker,
} from '../src/security/structuralMasking';

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownRenderer, { content, className: 'chat-markdown' }),
  );
}

const recentChatSessions: ChatSessions = {
  all: [
    {
      id: 'all-user',
      role: 'user',
      content: '셀트리온 프로젝트 현황을 알려줘.',
      createdAt: '2026-09-06T10:00:00.000Z',
    },
    {
      id: 'all-assistant',
      role: 'assistant',
      content: '프로젝트 현황입니다.',
      createdAt: '2026-09-06T10:00:01.000Z',
    },
  ],
  'pjt-a': [
    {
      id: 'project-user',
      role: 'user',
      content: '현재 주요 리스크를 분석해줘.',
      createdAt: '2026-09-06T12:00:00.000Z',
    },
  ],
  private: [
    {
      id: 'private-user',
      role: 'user',
      content:
        '개인 업무에 대한 매우 긴 질문입니다.\n한 줄로 표시하면서 상세 원문을 과도하게 노출하지 않도록 충분히 긴 내용을 계속 작성합니다. 추가 내용도 화면에 전부 나오면 안 됩니다.',
      createdAt: '2026-09-06T11:00:00.000Z',
    },
    {
      id: 'private-assistant',
      role: 'assistant',
      content: '개인 업무 답변입니다.',
      createdAt: '2026-09-06T11:00:01.000Z',
    },
  ],
};
const recentChatItems = createRecentChatItems(recentChatSessions);

assert.deepEqual(
  recentChatItems.map((item) => item.workspace.id),
  ['pjt-a', 'private', 'all'],
);
assert.equal(recentChatItems[0].preview, '현재 주요 리스크를 분석해줘.');
assert.ok(
  [...recentChatItems[0].preview].length <= RECENT_CHAT_PREVIEW_MAX_CHARS,
);
assert.equal(recentChatItems[2].messageCount, 2);
assert.ok(
  [...recentChatItems[1].preview].length <=
    PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS,
);
assert.match(recentChatItems[1].preview, /…$/u);
assert.doesNotMatch(recentChatItems[1].preview, /\n/u);
const relativeTimeNow = Date.parse('2026-09-06T12:30:00.000Z');
assert.equal(
  formatRecentChatTime('2026-09-06T12:29:40.000Z', relativeTimeNow),
  '방금 전',
);
assert.equal(
  formatRecentChatTime('2026-09-06T12:05:00.000Z', relativeTimeNow),
  '25분 전',
);
assert.equal(
  formatRecentChatTime('2026-09-06T10:30:00.000Z', relativeTimeNow),
  '2시간 전',
);

const emptyRecentChatsHtml = renderToStaticMarkup(
  createElement(RecentChatsView, {
    chatSessions: {},
    onOpenWorkspace: () => undefined,
  }),
);
assert.match(emptyRecentChatsHtml, /아직 대화 기록이 없습니다/u);
const populatedRecentChatsHtml = renderToStaticMarkup(
  createElement(RecentChatsView, {
    chatSessions: recentChatSessions,
    onOpenWorkspace: () => undefined,
  }),
);
assert.match(populatedRecentChatsHtml, /PJT-A/u);
assert.match(populatedRecentChatsHtml, /PM Private/u);
assert.match(populatedRecentChatsHtml, /2 messages/u);

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
    writeFile(
      path.join(vaultRoot, 'Notes', '담당자-기록.md'),
      '---\ntags:\n  - 이상익\nclient: 셀트리온\n---\n\n프로젝트 참여자 기록이다.',
      'utf8',
    ),
    writeFile(
      path.join(vaultRoot, 'Notes', '프로젝트-업무.md'),
      '# 담당 업무\n\n이상익이 셀트리온 프로젝트에서 담당하는 업무를 정리한다.',
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
      masking: {
        entries: [
          {
            id: 'person-sangik',
            type: 'person',
            value: '이상익',
            alias: 'PERSON_001',
            enabled: true,
            createdAt: '2026-09-06T00:00:00.000Z',
            updatedAt: '2026-09-06T00:00:00.000Z',
          },
        ],
      },
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
  const exactNameResults = await vaultFiles.retrieveAutoContext({
    query: '이상익',
    limit: 5,
  });
  const naturalNameResults = await vaultFiles.retrieveAutoContext({
    query: '이상익에 대해 알려줘',
    limit: 5,
  });
  const exactClientResults = await vaultFiles.retrieveAutoContext({
    query: '셀트리온',
    limit: 5,
  });
  const multiEntityResults = await vaultFiles.retrieveAutoContext({
    query: '이상익이 셀트리온 프로젝트에서 담당하는 업무가 뭐야?',
    limit: 5,
  });

  assert.equal(genericResults.length, 0);
  assert.ok(specificResults.length >= 1);
  assert.equal(specificResults[0].fileName, '셀트리온.md');
  assert.ok(specificResults[0].score >= AUTO_CONTEXT_MIN_SCORE);
  assert.equal(unrelatedResults.length, 0);
  assert.ok(exactNameResults.length >= 1);
  assert.ok(
    exactNameResults.some((result) => result.fileName === '담당자-기록.md'),
  );
  assert.ok(naturalNameResults.some((result) => result.content.includes('이상익')));
  assert.ok(exactClientResults.some((result) => result.content.includes('셀트리온')));
  assert.equal(multiEntityResults[0].fileName, '프로젝트-업무.md');
  assert.match(exactNameResults[0].content, /이상익/u);
  assert.doesNotMatch(exactNameResults[0].content, /PERSON_001/u);
  assert.ok(EXACT_MATCH_MIN_SCORE >= AUTO_CONTEXT_MIN_SCORE);

  console.info('[correctness-check] Retrieval', {
    threshold: AUTO_CONTEXT_MIN_SCORE,
    exactMatchThreshold: EXACT_MATCH_MIN_SCORE,
    regressionBaselineSingleOccurrenceScore: 34,
    genericCount: genericResults.length,
    specificCount: specificResults.length,
    specificScores: specificResults.map((result) => result.score),
    exactNameCount: exactNameResults.length,
    exactNameScores: exactNameResults.map((result) => result.score),
    naturalNameCount: naturalNameResults.length,
    exactClientCount: exactClientResults.length,
    multiEntityTop: multiEntityResults[0]?.fileName,
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

function findSecretRule(ruleId: string): SecretRule {
  const rule = builtInSecretRules.find((candidate) => candidate.id === ruleId);

  assert.ok(rule, `Missing Built-in Secret Rule: ${ruleId}`);
  return rule;
}

function assertQuestionIsHardBlocked(
  question: string,
  secretRules: SecretRule[] = [...builtInSecretRules],
): void {
  const preview = createExternalPayloadPreview({
    workspaceId: 'all',
    effectiveSecurity: 'internal',
    question,
    manualContexts: [],
    autoContexts: [],
    maskingEntries: [],
    secretRules,
  });

  assert.equal(preview.status, 'block');
  assert.equal(preview.externalText, '');
}

const passwordDetection = detectSecrets(
  'password: Abc1234!',
  [...builtInSecretRules],
);
assert.equal(passwordDetection.detected, true);
assert.ok(
  passwordDetection.detections.some(
    (detection) => detection.ruleId === 'builtin-password',
  ),
);
assert.doesNotMatch(JSON.stringify(passwordDetection), /Abc1234/u);
assertQuestionIsHardBlocked('password: Abc1234!');

const credentialPairDetection = detectSecrets(
  'username: admin\npassword: Abc1234!',
  [...builtInSecretRules],
);
assert.ok(
  credentialPairDetection.detections.some(
    (detection) => detection.ruleId === 'builtin-credential-pair',
  ),
);
assertQuestionIsHardBlocked('username: admin\npassword: Abc1234!');

const apiKeyDetection = detectSecrets(
  'API_KEY=some-secret-value',
  [...builtInSecretRules],
);
assert.ok(
  apiKeyDetection.detections.some(
    (detection) => detection.ruleId === 'builtin-api-key',
  ),
);
assertQuestionIsHardBlocked('API_KEY=some-secret-value');

const privateKeyText = [
  '-----BEGIN PRIVATE KEY-----',
  'top-secret-private-key-content',
  '-----END PRIVATE KEY-----',
].join('\n');
const privateKeyScan = scanSecrets(
  privateKeyText,
  [findSecretRule('builtin-private-key')],
);
assert.equal(privateKeyScan.detected, true);
assert.equal(privateKeyScan.redactedText, REDACTED_SECRET);
assertQuestionIsHardBlocked(privateKeyText);

const databaseDetection = detectSecrets(
  'postgres://user:password@host/db',
  [...builtInSecretRules],
);
assert.ok(
  databaseDetection.detections.some(
    (detection) => detection.ruleId === 'builtin-db-credential',
  ),
);
assertQuestionIsHardBlocked('postgres://user:password@host/db');

const personalWithoutSecretPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'personal',
  question: '개인 프로젝트 일정을 정리해줘.',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
  secretRules: [...builtInSecretRules],
});
assert.equal(personalWithoutSecretPreview.secretDetection.detected, false);
assert.equal(personalWithoutSecretPreview.status, 'review-required');

const customKeywordInput = validateCustomSecretRuleInput({
  name: '사내 DB Password',
  kind: 'keyword-value',
  keywords: ['internal_password'],
  enabled: true,
});
const customKeywordRule: SecretRule = {
  id: 'custom-internal-password',
  name: customKeywordInput.name,
  source: 'custom',
  kind: customKeywordInput.kind,
  enabled: true,
  severity: 'hard-block',
  category: 'custom-secret',
  keywords: customKeywordInput.keywords,
};
assert.equal(
  detectSecrets('internal_password=abc', [customKeywordRule]).detected,
  true,
);
assertQuestionIsHardBlocked('internal_password=abc', [customKeywordRule]);

const customRegexInput = validateCustomSecretRuleInput({
  name: '사내 운영계정 Secret',
  kind: 'regex',
  pattern: String.raw`INTERNAL-[A-Z0-9]{8}`,
  enabled: true,
});
const customRegexRule: SecretRule = {
  id: 'custom-internal-regex',
  name: customRegexInput.name,
  source: 'custom',
  kind: customRegexInput.kind,
  enabled: true,
  severity: 'hard-block',
  category: 'custom-secret',
  pattern: customRegexInput.pattern,
};
const regexSecretValue = 'INTERNAL-ABCD1234';
const customRegexPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: '운영 계정을 확인해줘.',
  manualContexts: [
    {
      vaultId: 'secret-vault',
      vaultName: 'Secret Vault',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'credential.md',
      fileName: 'credential.md',
      content: `운영 토큰: ${regexSecretValue}`,
    },
  ],
  autoContexts: [],
  maskingEntries: [],
  secretRules: getSecretRules([{
    ...customRegexRule,
    source: 'custom',
    kind: 'regex',
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  }]),
});
assert.equal(customRegexPreview.status, 'block');
assert.equal(customRegexPreview.externalText, '');
assert.match(customRegexPreview.documents[0].maskedContent, /\[REDACTED_SECRET\]/u);
assert.doesNotMatch(customRegexPreview.documents[0].maskedContent, /INTERNAL-ABCD1234/u);
assert.doesNotMatch(
  renderToStaticMarkup(
    createElement(ExternalPayloadPreviewModal, {
      preview: customRegexPreview,
      onClose: () => undefined,
      onUseLocalAI: async () => undefined,
    }),
  ),
  /INTERNAL-ABCD1234/u,
);
const secretSettingsHtml = renderToStaticMarkup(
  createElement(SecretDetectionSettingsSection, {
    settings: defaultSettings,
    onSettingsChange: () => undefined,
  }),
);
assert.match(secretSettingsHtml, /Secret Detection/u);
assert.match(secretSettingsHtml, /Built-in Rules/u);
assert.match(secretSettingsHtml, /Built-in · Protected/u);
assert.match(secretSettingsHtml, /Custom Rules/u);

assert.throws(
  () =>
    validateCustomSecretRuleInput({
      name: 'Invalid Regex',
      kind: 'regex',
      pattern: '([',
    }),
  /문법/u,
);

const secretSettingsRoot = await mkdtemp(
  path.join(os.tmpdir(), 'mimora-secret-settings-'),
);
const secretSettingsPath = path.join(secretSettingsRoot, 'mimora-settings.json');

try {
  const firstStore = createSettingsStore({
    getSettingsPath: () => secretSettingsPath,
    createId: () => 'persisted-custom-rule',
    getNow: () => '2026-09-06T00:00:00.000Z',
  });
  await firstStore.addSecretRule({
    name: 'Persisted Rule',
    kind: 'keyword-value',
    keywords: ['company_token'],
  });
  const persistedFile = await readFile(secretSettingsPath, 'utf8');

  assert.match(persistedFile, /"secretDetection"/u);
assert.doesNotMatch(persistedFile, /builtin-password/u);
  assert.doesNotMatch(persistedFile, /Abc1234|some-secret-value/u);

  const restartedStore = createSettingsStore({
    getSettingsPath: () => secretSettingsPath,
  });
  const restartedSettings = await restartedStore.getSettings();

  assert.equal(restartedSettings.secretDetection.customRules.length, 1);
  assert.equal(
    restartedSettings.secretDetection.customRules[0].name,
    'Persisted Rule',
  );
} finally {
  await rm(secretSettingsRoot, { recursive: true, force: true });
}

const markdownPasswordA = '**기본 로그인 패스워드**: `abc123!`';
assert.equal(
  normalizeMarkdownForSecretDetection(markdownPasswordA).text,
  '기본 로그인 패스워드: abc123!',
);
const markdownPasswordPreviewA = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: markdownPasswordA,
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(markdownPasswordPreviewA.status, 'block');
assert.match(markdownPasswordPreviewA.maskedQuestion, /\[REDACTED_SECRET\]/u);
assert.doesNotMatch(markdownPasswordPreviewA.maskedQuestion, /abc123/u);

const markdownPasswordPreviewB = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: '*변경 패스워드*: `xyz123!`',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(markdownPasswordPreviewB.status, 'block');
assert.doesNotMatch(markdownPasswordPreviewB.maskedQuestion, /xyz123/u);

function createCredentialTablePreview(content: string) {
  return createExternalPayloadPreview({
    workspaceId: 'all',
    effectiveSecurity: 'internal',
    question: '서버 계정 정보를 요약해줘.',
    manualContexts: [
      {
        vaultId: 'markdown-secret-vault',
        vaultName: 'Markdown Secret Vault',
        vaultType: 'work',
        security: 'internal',
        relativePath: 'credentials.md',
        fileName: 'credentials.md',
        content,
      },
    ],
    autoContexts: [],
    maskingEntries: [],
  });
}

const credentialTablePreviewC = createCredentialTablePreview(
  '| 사용자 ID | 패스워드(PW) |\n| --- | --- |\n| admin | abc123 |',
);
assert.equal(credentialTablePreviewC.status, 'block');
assert.ok(
  credentialTablePreviewC.secretDetection.detections.some(
    (detection) => detection.ruleId === 'builtin-credential-pair',
  ),
);
assert.doesNotMatch(
  credentialTablePreviewC.documents[0].maskedContent,
  /abc123/u,
);
assert.match(
  credentialTablePreviewC.documents[0].maskedContent,
  /\[REDACTED_SECRET\]/u,
);

const credentialTablePreviewD = createCredentialTablePreview(
  '| 사용자 ID | PW |\n| --- | --- |\n| user1 | p@ssword |',
);
assert.equal(credentialTablePreviewD.status, 'block');
assert.doesNotMatch(
  credentialTablePreviewD.documents[0].maskedContent,
  /p@ssword/u,
);

const idOnlyDetection = detectSecrets(
  '담당자 ID: TASK-123',
  [...builtInSecretRules],
);
assert.equal(idOnlyDetection.detected, false);

const internalNetworkMasker = createStructuralSensitiveDataMasker();
const internalNetworkResult = internalNetworkMasker.maskText(
  'primary 10.20.30.40:12400, backup 10.20.30.40',
);
assert.equal(internalNetworkResult.replacementCount, 2);
assert.equal(
  internalNetworkResult.maskedText,
  'primary [INTERNAL_IP_001], backup [INTERNAL_IP_001]',
);
assert.equal(containsInternalNetworkAddress(internalNetworkResult.maskedText), false);
const internalNetworkPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: '10.20.30.40:12400 상태를 확인해줘.',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(internalNetworkPreview.secretDetection.detected, false);
assert.equal(internalNetworkPreview.status, 'pass');
assert.match(internalNetworkPreview.maskedQuestion, /\[INTERNAL_IP_001\]/u);
assert.doesNotMatch(internalNetworkPreview.externalText, /10\.20\.30\.40|12400/u);

const passwordAndIpPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'personal',
  question: '**비밀번호**: `abc123!`\n서버: 10.20.30.40:12400',
  manualContexts: [],
  autoContexts: [],
  maskingEntries: [],
});
assert.equal(passwordAndIpPreview.status, 'block');
assert.ok(passwordAndIpPreview.blockers.includes('secret-detected'));
assert.match(passwordAndIpPreview.maskedQuestion, /\[INTERNAL_IP_001\]/u);
assert.doesNotMatch(passwordAndIpPreview.maskedQuestion, /10\.20\.30\.40|12400/u);

const consistentMaskingEntries = [
  {
    id: 'client-celltrion',
    type: 'client' as const,
    value: '셀트리온',
    alias: 'CLIENT_001',
    enabled: true,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  },
  {
    id: 'person-sangik',
    type: 'person' as const,
    value: '이상익',
    alias: 'PERSON_001',
    enabled: true,
    createdAt: '2026-09-06T00:00:01.000Z',
    updatedAt: '2026-09-06T00:00:01.000Z',
  },
];

function createConsistentMaskingPreview(
  content: string,
  options?: { secret?: boolean },
) {
  return createExternalPayloadPreview({
    workspaceId: 'all',
    effectiveSecurity: 'internal',
    question: '셀트리온 프로젝트를 설명해줘.',
    manualContexts: [
      {
        vaultId: 'consistent-vault',
        vaultName: 'Consistent Vault',
        vaultType: 'work',
        security: 'internal',
        relativePath: options?.secret ? 'secret.md' : 'note.md',
        fileName: options?.secret ? 'secret.md' : 'note.md',
        content,
      },
    ],
    autoContexts: [],
    maskingEntries: consistentMaskingEntries,
  });
}

const frontmatterMaskingPreview = createConsistentMaskingPreview(
  '---\nclient: 셀트리온\n---',
);
assert.match(
  frontmatterMaskingPreview.documents[0].maskedContent,
  /client: \[CLIENT_001\]/u,
);

const tagMaskingPreview = createConsistentMaskingPreview(
  'tags:\n- 셀트리온\n- 이상익',
);
assert.match(tagMaskingPreview.documents[0].maskedContent, /- \[CLIENT_001\]/u);
assert.match(tagMaskingPreview.documents[0].maskedContent, /- \[PERSON_001\]/u);

const bodyMaskingPreview = createConsistentMaskingPreview(
  '이상익이 셀트리온 프로젝트를 담당한다.',
);
assert.match(
  bodyMaskingPreview.documents[0].maskedContent,
  /\[PERSON_001\]이 \[CLIENT_001\] 프로젝트를 담당한다/u,
);
assert.equal(bodyMaskingPreview.maskedQuestion, '[CLIENT_001] 프로젝트를 설명해줘.');

const secretAndEntityPreview = createConsistentMaskingPreview(
  'password: abc123\nclient: 셀트리온',
  { secret: true },
);
assert.equal(secretAndEntityPreview.status, 'block');
assert.match(
  secretAndEntityPreview.documents[0].maskedContent,
  /password: \[REDACTED_SECRET\]/u,
);
assert.match(
  secretAndEntityPreview.documents[0].maskedContent,
  /client: \[CLIENT_001\]/u,
);
assert.doesNotMatch(secretAndEntityPreview.documents[0].maskedContent, /abc123|셀트리온/u);

const multiDocumentMaskingPreview = createExternalPayloadPreview({
  workspaceId: 'all',
  effectiveSecurity: 'internal',
  question: '셀트리온과 이상익 관련 문서를 정리해줘.',
  manualContexts: [
    {
      vaultId: 'manual-vault',
      vaultName: 'Manual Vault',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'frontmatter.md',
      fileName: 'frontmatter.md',
      content: '---\nclient: 셀트리온\nowner: 이상익\n---',
    },
  ],
  autoContexts: [
    {
      documentId: 'auto-source-1',
      vaultId: 'auto-vault',
      vaultName: 'Auto Vault',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'tags.md',
      fileName: 'tags.md',
      score: 90,
      snippet: '셀트리온 이상익',
      content: 'tags:\n- 셀트리온\n- 이상익',
    },
    {
      documentId: 'auto-source-2',
      vaultId: 'auto-vault',
      vaultName: 'Auto Vault',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'body.md',
      fileName: 'body.md',
      score: 85,
      snippet: '이상익 담당',
      content: '# 셀트리온\n\n이상익이 담당한다.\n[[셀트리온 프로젝트]] [이상익 담당자](person.md)',
    },
  ],
  maskingEntries: consistentMaskingEntries,
});
assert.equal(multiDocumentMaskingPreview.documents.length, 3);
for (const document of multiDocumentMaskingPreview.documents) {
  assert.doesNotMatch(document.maskedContent, /셀트리온|이상익/u);
}
assert.match(
  multiDocumentMaskingPreview.documents[2].maskedContent,
  /\[\[CLIENT_001 프로젝트\]\] \[PERSON_001 담당자\]\(person\.md\)/u,
);
assert.doesNotMatch(
  multiDocumentMaskingPreview.externalText,
  /셀트리온|이상익/u,
);
assert.equal(
  multiDocumentMaskingPreview.safety.checks.find(
    (check) => check.id === 'registered-entities',
  )?.status,
  'pass',
);

const responseUnmaskingEntries: MaskingEntry[] = [
  ...consistentMaskingEntries,
  {
    id: 'organization-example',
    type: 'organization',
    value: '미모라 연구소',
    alias: 'ORGANIZATION_001',
    enabled: true,
    createdAt: '2026-09-06T00:00:02.000Z',
    updatedAt: '2026-09-06T00:00:02.000Z',
  },
  {
    id: 'project-example',
    type: 'project',
    value: '통합 프로젝트',
    alias: 'PROJECT_001',
    enabled: true,
    createdAt: '2026-09-06T00:00:03.000Z',
    updatedAt: '2026-09-06T00:00:03.000Z',
  },
  {
    id: 'system-example',
    type: 'system',
    value: '코어 시스템',
    alias: 'SYSTEM_001',
    enabled: true,
    createdAt: '2026-09-06T00:00:04.000Z',
    updatedAt: '2026-09-06T00:00:04.000Z',
  },
  {
    id: 'disabled-client',
    type: 'client',
    value: '비활성 고객',
    alias: 'CLIENT_999',
    enabled: false,
    createdAt: '2026-09-06T00:00:05.000Z',
    updatedAt: '2026-09-06T00:00:05.000Z',
  },
];

const responseUnmaskingA = unmaskExternalResponse(
  '[CLIENT_001] 프로젝트입니다.',
  responseUnmaskingEntries,
);
assert.equal(responseUnmaskingA.displayText, '셀트리온 프로젝트입니다.');
assert.equal(responseUnmaskingA.replacementCount, 1);
assert.doesNotMatch(JSON.stringify(responseUnmaskingA.replacements), /셀트리온/u);

const responseUnmaskingB = unmaskExternalResponse(
  '[PERSON_001]이 [CLIENT_001]을 담당합니다.',
  responseUnmaskingEntries,
);
assert.equal(
  responseUnmaskingB.displayText,
  '이상익이 셀트리온을 담당합니다.',
);

const responseUnmaskingC = unmaskExternalResponse(
  '**[CLIENT_001]**\n- 담당자: [PERSON_001]\n- 링크: [CLIENT_001](client.md)\n- 위키: [[CLIENT_001]]',
  responseUnmaskingEntries,
);
assert.equal(
  responseUnmaskingC.displayText,
  '**셀트리온**\n- 담당자: 이상익\n- 링크: [셀트리온](client.md)\n- 위키: [[셀트리온]]',
);

const nonEntityAliases =
  '[FILE_PATH_001] [INTERNAL_IP_001] [REDACTED_SECRET] CLIENT_001 [CLIENT_001_EXTRA]';
const responseUnmaskingStructural = unmaskExternalResponse(
  nonEntityAliases,
  responseUnmaskingEntries,
);
assert.equal(responseUnmaskingStructural.displayText, nonEntityAliases);

const allEntityTypes = unmaskExternalResponse(
  '[ORGANIZATION_001] [PROJECT_001] [SYSTEM_001] [CLIENT_999]',
  responseUnmaskingEntries,
);
assert.equal(
  allEntityTypes.displayText,
  '미모라 연구소 통합 프로젝트 코어 시스템 [CLIENT_999]',
);

assert.match(multiDocumentMaskingPreview.maskedQuestion, /\[CLIENT_001\]/u);
assert.doesNotMatch(multiDocumentMaskingPreview.maskedQuestion, /셀트리온/u);

const responseSnapshot = createResponseUnmaskingSnapshot(
  responseUnmaskingEntries,
  ['CLIENT_001', 'PERSON_001', 'FILE_PATH_001'],
);
assert.deepEqual(
  responseSnapshot.map((mapping) => mapping.alias),
  ['CLIENT_001', 'PERSON_001'],
);
const localResponse = applyResponseUnmasking({
  provider: 'local',
  text: '[CLIENT_001] Local 응답',
  snapshot: responseSnapshot,
});
assert.equal(localResponse.displayText, '[CLIENT_001] Local 응답');
assert.equal(localResponse.replacementCount, 0);

const changedDictionary = responseUnmaskingEntries.map((entry) =>
  entry.alias === 'CLIENT_001'
    ? { ...entry, value: '변경된 고객명' }
    : entry,
);
assert.equal(
  unmaskExternalResponse('[CLIENT_001]', changedDictionary).displayText,
  '변경된 고객명',
);
assert.equal(
  unmaskExternalResponseFromSnapshot('[CLIENT_001]', responseSnapshot)
    .displayText,
  '셀트리온',
);
const unmaskedChatHtml = renderToStaticMarkup(
  createElement(ChatMessages, {
    messages: [
      {
        id: 'external-unmasked-response',
        role: 'assistant',
        content: responseUnmaskingA.displayText,
        rawExternalResponse: responseUnmaskingA.maskedText,
        responseUnmaskingSnapshot: responseSnapshot,
        responseUnmasking: {
          replacements: responseUnmaskingA.replacements,
          replacementCount: responseUnmaskingA.replacementCount,
        },
        createdAt: '2026-09-06T00:00:00.000Z',
        routingDecision: approvedRouting,
        generationStatus: 'complete',
      },
    ],
    workspaceId: 'all',
    onApproveExternal: async () => ({ ok: true as const }),
    onUseLocalAI: async () => undefined,
  }),
);
assert.match(unmaskedChatHtml, /셀트리온 프로젝트입니다/u);
assert.doesNotMatch(unmaskedChatHtml, /CLIENT_001/u);
assert.match(unmaskedChatHtml, /로컬에서 익명화 명칭 복원/u);

const deliberatelyUnmaskedPayload = buildExternalPayloadText({
  maskedQuestion: '셀트리온 프로젝트를 설명해줘.',
  maskedDocumentContents: ['이상익이 담당한다.'],
});
const remainingEntitySafety = evaluateOutboundPayload({
  externalText: deliberatelyUnmaskedPayload.text,
  documents: [
    {
      documentId: 'DOCUMENT_1',
      vaultName: 'Local Metadata Only',
      vaultType: 'work',
      security: 'internal',
      relativePath: 'local.md',
      fileName: 'local.md',
    },
  ],
  maskingEntries: consistentMaskingEntries,
  effectiveSecurity: 'internal',
});
assert.equal(remainingEntitySafety.status, 'block');
assert.match(
  remainingEntitySafety.checks.find(
    (check) => check.id === 'registered-entities',
  )?.message ?? '',
  /Registered entity remains in outbound payload/u,
);

console.info('[correctness-check] Markdown M1-M3 passed.');
console.info('[correctness-check] Path P1-P5 passed.');
console.info('[correctness-check] External review A-J state checks passed.');
console.info('[correctness-check] Secret Detection A-L checks passed.');
console.info('[correctness-check] Markdown Credential A-J checks passed.');
console.info('[correctness-check] Consistent Masking A-F checks passed.');
console.info('[correctness-check] Response Unmasking A-I checks passed.');
console.info('[correctness-check] Recent Chats checks passed.');
