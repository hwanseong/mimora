import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildDerivedKnowledgeMarkdown,
  createDerivedKnowledgeSuggestion,
  deriveSecurityFromSources,
  formatLocalIsoDateTime,
  isDerivedKnowledgeRequest,
  normalizeDerivedKnowledgeDraft,
  validateDerivedKnowledgeDraft,
  type DerivedKnowledgeDraft,
  type DerivedKnowledgeSource,
} from '../src/derivedKnowledge';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import { createDerivedKnowledgeService } from '../electron/derivedKnowledgeService';
import type { VaultConfig } from '../src/settings';

function createSource(
  overrides: Partial<DerivedKnowledgeSource> = {},
): DerivedKnowledgeSource {
  return {
    sourceType: 'vault',
    vaultId: 'work-vault',
    documentId: 'DOC-2026-1001',
    relativePath: 'issues/external-agency-delay.md',
    workspaceIds: ['WS-2026-0001'],
    originWorkspaceId: 'WS-2026-0001',
    knowledgeDomains: ['project-management'],
    knowledgeTypes: ['risk'],
    security: 'normal',
    ...overrides,
  };
}

function createDraft(
  overrides: Partial<DerivedKnowledgeDraft> = {},
): DerivedKnowledgeDraft {
  const sourceDocuments = overrides.sourceDocuments ?? [
    createSource(),
    createSource({
      sourceType: 'rag',
      vaultId: 'rag-library',
      documentId: undefined,
      ragDocumentId: 'RAG-2026-0001',
      relativePath: 'rag://RAG-2026-0001/chunk-1',
    }),
  ];

  return normalizeDerivedKnowledgeDraft({
    title: '외부기관 협조 일정 리스크 관리',
    content: [
      '## 발생 배경',
      '외부기관 확인 일정이 지연되면 통합테스트와 사용자 검증 일정이 함께 흔들릴 수 있다.',
      '',
      '## 핵심 교훈',
      '외부기관 의존 작업은 승인 SLA와 대체 경로를 착수 단계에서 합의해야 한다.',
      '',
      '## 재사용 체크포인트',
      '- 외부기관 담당자와 승인 기한을 일정표에 명시한다.',
      '- 지연 시 의사결정 기준과 에스컬레이션 라인을 사전에 정한다.',
    ].join('\n'),
    sourceDocuments,
    workspaceIds: ['WS-2026-0001'],
    originWorkspaceId: 'WS-2026-0001',
    knowledgeDomains: ['project-management'],
    knowledgeTypes: ['lesson-learned'],
    excludedKnowledgeSuggestions: [],
    security: deriveSecurityFromSources(sourceDocuments),
    contentOrigin: 'ai-derived',
    targetVaultId: 'work-vault',
    documentId: 'DOC-2026-9001',
    filename: 'external-agency-delay-lessons.md',
    generatedAt: '2026-09-11 10:02:03',
    ...overrides,
  });
}

function assertMarkdownFrontmatter(): void {
  const draft = createDraft();
  const markdown = buildDerivedKnowledgeMarkdown(draft);

  assert.ok(markdown.startsWith('---\n'));
  assert.equal(markdown.includes('## Mimora Metadata'), false);
  assert.match(markdown, /document_id: "DOC-2026-9001"/u);
  assert.match(markdown, /security: "internal"/u);
  assert.match(markdown, /knowledge_type: "lesson-learned"/u);
  assert.match(markdown, /content_origin: "ai-derived"/u);
  assert.match(markdown, /source_document_ids:\n  - "DOC-2026-1001"/u);
  assert.match(markdown, /source_rag_ids:\n  - "RAG-2026-0001"/u);
  assert.match(markdown, /source_workspace_ids:\n  - "WS-2026-0001"/u);
  assert.match(markdown, /generated_by: "mimora"/u);
  assert.match(markdown, /generated_at: "2026-09-11 10:02:03"/u);

  const parsed = parseMimoraDocumentMetadata(markdown);

  assert.equal(parsed.metadata.source, 'frontmatter');
  assert.equal(parsed.metadata.documentId, 'DOC-2026-9001');
  assert.deepEqual(parsed.metadata.workspaceIds, ['WS-2026-0001']);
  assert.deepEqual(parsed.metadata.knowledgeDomains, ['project-management']);
  assert.deepEqual(parsed.metadata.knowledgeTypes, ['lesson-learned']);
  assert.equal(parsed.metadata.security, 'internal');
  assert.equal(parsed.metadata.contentOrigin, 'ai-derived');
}

function assertLocalIsoDateTimeFormatter(): void {
  const formatted = formatLocalIsoDateTime(new Date(2026, 8, 11, 9, 22, 38, 124));

  assert.match(formatted, /^2026-09-11 09:22:38$/u);
  assert.equal(formatted.includes('T'), false);
  assert.equal(formatted.includes('.124'), false);
  assert.equal(formatted.endsWith('Z'), false);
  assert.equal(/[+-]\d{2}:\d{2}$/u.test(formatted), false);
}

function assertSecurityAndValidation(): void {
  const privateSource = createSource({
    vaultId: 'private-vault',
    security: 'private',
  });
  const draft = createDraft({
    sourceDocuments: [createSource(), privateSource],
    targetVaultId: 'private-vault',
  });

  assert.equal(draft.security, 'private');
  assert.deepEqual(validateDerivedKnowledgeDraft(draft), []);
  assert.ok(
    validateDerivedKnowledgeDraft(createDraft({ documentId: '' })).some(
      (message) => message.includes('Document ID'),
    ),
  );
}

function assertChatTriggerDetection(): void {
  assert.equal(
    isDerivedKnowledgeRequest(
      '외부기관 일정 지연에서 얻은 교훈을 AI Wiki로 정리해줘.',
    ),
    true,
  );
  assert.equal(
    isDerivedKnowledgeRequest('이번 프로젝트에서 재사용 가능한 교훈을 정리해줘.'),
    true,
  );
  assert.equal(isDerivedKnowledgeRequest('취업규칙상 휴게시간은?'), false);
}

function assertRegistrySuggestionDoesNotInventValues(): void {
  const sourceDocuments = [
    createSource({
      knowledgeDomains: ['project-management', 'unregistered-domain'],
      knowledgeTypes: ['lesson-learned', 'unregistered-type'],
    }),
  ];
  const draft = createDerivedKnowledgeSuggestion({
    question: '이번 프로젝트에서 재사용 가능한 교훈을 정리해줘.',
    content: '외부기관 일정 지연 대응 교훈',
    sourceDocuments,
    sourceMetadata: [],
    knowledgeDomainRegistry: {
      version: 1,
      domains: [
        {
          canonicalName: 'project-management',
          aliases: [],
          description: '',
          status: 'active',
          parent: null,
        },
      ],
    },
    knowledgeTypeRegistry: {
      version: 1,
      types: [
        {
          canonicalName: 'lesson-learned',
          aliases: [],
          description: '',
          status: 'active',
        },
      ],
    },
    fallbackWorkspaceId: 'WS-2026-0001',
    fallbackKnowledgeDomain: null,
    fallbackKnowledgeType: null,
    targetVaultId: 'work-vault',
  });

  assert.deepEqual(draft.knowledgeDomains, ['project-management']);
  assert.deepEqual(draft.knowledgeTypes, ['lesson-learned']);
  assert.equal(draft.excludedKnowledgeSuggestions.length, 2);
}

async function assertSaveServiceWritesWikiFile(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mimora-ai-wiki-'));
  const workVault = path.join(tempRoot, 'Project Work');
  const privateVault = path.join(tempRoot, 'Project Private');
  const vaults: VaultConfig[] = [
    {
      id: 'work-vault',
      name: 'Project Work',
      type: 'work',
      security: 'internal',
      path: workVault,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
      id: 'private-vault',
      name: 'Project Private',
      type: 'private',
      security: 'sensitive',
      path: privateVault,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    },
  ];

  await import('node:fs/promises').then(({ mkdir }) =>
    Promise.all(vaults.map((vault) => mkdir(vault.path, { recursive: true }))),
  );

  const settingsStore = {
    getSettings: async () => ({
      vaults,
    }),
  };
  const service = createDerivedKnowledgeService(settingsStore as never);
  const result = await service.saveDerivedKnowledgeDraft(createDraft());

  assert.equal(
    result.relativePath,
    '_mimora/wiki/external-agency-delay-lessons.md',
  );
  const savedMarkdown = await readFile(
    path.join(workVault, result.relativePath),
    'utf8',
  );
  assert.match(savedMarkdown, /source_rag_ids:\n  - "RAG-2026-0001"/u);
  assert.match(
    savedMarkdown,
    /generated_at: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/u,
  );
  assert.equal(/generated_at: ".*T/u.test(savedMarkdown), false);
  assert.equal(/generated_at: ".*\.\d{3}/u.test(savedMarkdown), false);
  assert.equal(/generated_at: ".*Z"/u.test(savedMarkdown), false);
  assert.equal(/generated_at: ".*[+-]\d{2}:\d{2}"/u.test(savedMarkdown), false);

  await assert.rejects(
    () => service.saveDerivedKnowledgeDraft(createDraft({ documentId: 'DOC-2026-9002' })),
    /파일명이 이미 존재/u,
  );

  await assert.rejects(
    () =>
      service.saveDerivedKnowledgeDraft(
        createDraft({
          sourceDocuments: [createSource({ security: 'private' })],
          targetVaultId: 'work-vault',
          documentId: 'DOC-2026-9003',
          filename: 'private-wiki.md',
        }),
      ),
    /Private/u,
  );

  const privateResult = await service.saveDerivedKnowledgeDraft(
    createDraft({
      sourceDocuments: [createSource({ security: 'private' })],
      targetVaultId: 'private-vault',
      documentId: 'DOC-2026-9004',
      filename: 'private-wiki.md',
    }),
  );

  assert.equal(privateResult.relativePath, '_mimora/wiki/private-wiki.md');

  await rm(tempRoot, { force: true, recursive: true });
}

async function writeMarkdown(
  rootPath: string,
  relativePath: string,
  markdown: string,
): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, markdown, 'utf8');
}

async function assertDocumentIdSuggestion(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mimora-ai-wiki-id-'));
  const workVault = path.join(tempRoot, 'Project Work');
  const privateVault = path.join(tempRoot, 'Project Private');
  const personalVault = path.join(tempRoot, 'Personal');
  const vaults: VaultConfig[] = [
    {
      id: 'work-vault',
      name: 'Project Work',
      type: 'work',
      security: 'internal',
      path: workVault,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
      id: 'private-vault',
      name: 'Project Private',
      type: 'private',
      security: 'sensitive',
      path: privateVault,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    },
    {
      id: 'personal-vault',
      name: 'Personal',
      type: 'knowledge',
      security: 'personal',
      path: personalVault,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    },
  ];

  await Promise.all(vaults.map((vault) => mkdir(vault.path, { recursive: true })));
  await writeMarkdown(
    workVault,
    'docs/max.md',
    [
      '---',
      'document_id: DOC-2026-0600',
      'workspace_ids: [WS-2026-0001]',
      'knowledge_domains: [project-management]',
      'knowledge_type: lesson-learned',
      'security: internal',
      '---',
      '# Max',
    ].join('\n'),
  );
  await writeMarkdown(
    privateVault,
    'docs/gap.md',
    [
      '---',
      'document_id: DOC-2026-0003',
      'workspace_ids: [WS-2026-0001]',
      'knowledge_domains: [project-management]',
      'knowledge_type: lesson-learned',
      'security: private',
      '---',
      '# Gap',
    ].join('\n'),
  );
  await writeMarkdown(
    personalVault,
    'docs/invalid.md',
    [
      '---',
      'document_id: DOC-2026-X',
      'workspace_ids: [WS-2026-0001]',
      'knowledge_domains: [project-management]',
      'knowledge_type: lesson-learned',
      'security: private',
      '---',
      '# Invalid',
    ].join('\n'),
  );
  await writeMarkdown(
    workVault,
    '_mimora/workspaces.md',
    [
      '---',
      'registry_type: workspaces',
      'registry_version: 1',
      'document_id: DOC-2026-9999',
      '---',
      '# Registry',
    ].join('\n'),
  );

  const settingsStore = {
    getSettings: async () => ({
      vaults,
    }),
  };
  const service = createDerivedKnowledgeService(settingsStore as never);
  const suggestion = await service.suggestDocumentId(
    '2026-09-11T01:02:03.000Z',
  );

  assert.equal(suggestion.documentId, 'DOC-2026-0601');
  assert.equal(suggestion.sequence, 601);

  await assert.rejects(
    () =>
      service.saveDerivedKnowledgeDraft(
        createDraft({
          documentId: 'DOC-2026-0600',
          filename: 'unique-filename.md',
        }),
      ),
    /duplicate_document_id/u,
  );

  await service.saveDerivedKnowledgeDraft(
    createDraft({
      documentId: 'DOC-2026-0601',
      filename: 'manual-unique-id.md',
    }),
  );

  await rm(tempRoot, { force: true, recursive: true });
}

async function main(): Promise<void> {
  assertMarkdownFrontmatter();
  assertLocalIsoDateTimeFormatter();
  assertSecurityAndValidation();
  assertChatTriggerDetection();
  assertRegistrySuggestionDoesNotInventValues();
  await assertSaveServiceWritesWikiFile();
  await assertDocumentIdSuggestion();
  console.info('derived-knowledge-tests: ok');
}

await main();
