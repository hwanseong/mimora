import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createVaultFilesService,
  isOfficialRegistryMarkdownPath,
} from '../electron/vaultFiles';
import type { MimoraSettings } from '../src/settings';

async function writeMarkdown(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(rootPath, ...relativePath.split('/'));
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(path.dirname(absolutePath), { recursive: true }),
  );
  await writeFile(absolutePath, content, 'utf8');
}

const rootPath = await mkdtemp(path.join(tmpdir(), 'mimora-doc-id-test-'));

try {
  await writeMarkdown(
    rootPath,
    'normal-valid.md',
    `---
document_id: DOC-2026-0001
---
# Normal valid
`,
  );
  await writeMarkdown(rootPath, 'normal-missing.md', '# Normal missing\n');
  await writeMarkdown(
    rootPath,
    '_mimora/workspaces.md',
    `---
registry_type: workspaces
registry_version: 1
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0001 | Core Banking | project | active | internal | 2026-01-01 | 2026-12-31 | Test |
`,
  );
  await writeMarkdown(
    rootPath,
    '_mimora/knowledge-domains.md',
    `---
registry_type: knowledge-domains
registry_version: 1
---
| canonical_name | aliases | description |
| --- | --- | --- |
| project-management | PM | Test |
`,
  );
  await writeMarkdown(
    rootPath,
    '_mimora/knowledge-types.md',
    `---
registry_type: knowledge-types
registry_version: 1
---
| canonical_name | description |
| --- | --- |
| meeting-note | Test |
`,
  );
  await writeMarkdown(
    rootPath,
    '_mimora/wiki/sample-valid.md',
    `---
document_id: DOC-2026-0002
---
# Wiki valid
`,
  );
  await writeMarkdown(
    rootPath,
    '_mimora/wiki/sample-missing.md',
    '# Wiki missing\n',
  );

  const settings = {
    vaults: [
      {
        id: 'vault-1',
        name: 'Test Vault',
        type: 'work',
        security: 'internal',
        path: rootPath,
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ],
    registry: { homeVaultId: null },
    search: { includeArchived: true, contentOriginScope: 'all' },
    localAI: {},
    externalAI: {},
    aiMode: 'auto',
    masking: {},
    secretDetection: {},
  } as unknown as MimoraSettings;

  const service = createVaultFilesService({
    getSettings: async () => settings,
  } as unknown as Parameters<typeof createVaultFilesService>[0]);

  assert.equal(
    isOfficialRegistryMarkdownPath('_mimora/workspaces.md'),
    true,
  );
  assert.equal(
    isOfficialRegistryMarkdownPath('_mimora\\knowledge-domains.md'),
    true,
  );
  assert.equal(
    isOfficialRegistryMarkdownPath('_mimora/wiki/sample-valid.md'),
    false,
  );

  const summary = await service.validateDocumentIds();
  const paths = summary.documents.map((document) => document.relativePath).sort();

  assert.deepEqual(paths, [
    '_mimora/wiki/sample-missing.md',
    '_mimora/wiki/sample-valid.md',
    'normal-missing.md',
    'normal-valid.md',
  ]);
  assert.equal(summary.documentCount, 4);
  assert.equal(summary.counts.valid, 2);
  assert.equal(summary.counts.missing, 2);
  assert.equal(summary.counts['invalid-format'], 0);
  assert.equal(summary.counts.duplicate, 0);
  assert.equal(
    summary.documents.find(
      (document) => document.relativePath === 'normal-valid.md',
    )?.status,
    'valid',
  );
  assert.equal(
    summary.documents.find(
      (document) => document.relativePath === 'normal-missing.md',
    )?.status,
    'missing',
  );
  assert.equal(
    summary.documents.find(
      (document) => document.relativePath === '_mimora/wiki/sample-valid.md',
    )?.status,
    'valid',
  );
  assert.equal(
    summary.documents.find(
      (document) => document.relativePath === '_mimora/wiki/sample-missing.md',
    )?.status,
    'missing',
  );
  assert.equal(
    summary.documents.some((document) =>
      document.relativePath.startsWith('_mimora/workspaces.md'),
    ),
    false,
  );
  assert.equal(
    summary.documents.some((document) =>
      document.relativePath.startsWith('_mimora/knowledge-domains.md'),
    ),
    false,
  );
  assert.equal(
    summary.documents.some((document) =>
      document.relativePath.startsWith('_mimora/knowledge-types.md'),
    ),
    false,
  );

  console.info('[document-id-validation-tests] Registry exclusions passed.');
} finally {
  await rm(rootPath, { recursive: true, force: true });
}
