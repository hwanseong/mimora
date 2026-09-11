import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createRegistryStatusService,
} from '../electron/registryStatus';
import {
  createWorkspaceStatusMap,
  isDocumentEligibleForSearch,
} from '../electron/vaultFiles';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import { parseWorkspaceRegistry } from '../src/registry/workspaceRegistryParser';
import type { MimoraSettings } from '../src/settings';
import {
  canAskWorkspaceQuestion,
  canCreateWorkspaceSession,
  createWorkspaceSections,
  createSelectableWorkspaces,
  toSelectableWorkspace,
  type Workspace,
} from '../src/workspaces';
import type { ChatSessions } from '../src/chat';

const validWorkspaceRegistryMarkdown = `---
registry_type: workspaces
registry_version: 1
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0001 | Card Renewal | project | active | internal | 2026-01-01 | 2026-06-30 | Active project |
| WS-2026-0002 | Daily Settlement | operation | closed | internal | 2026-01-01 | 2026-03-31 | Closed operation |
| WS-2026-0003 | Legacy Migration | project | archived | private | 2025-01-01 | 2025-12-31 | Archived project |
`;

function hasIssue(
  result: ReturnType<typeof parseWorkspaceRegistry>,
  code: string,
): boolean {
  return result.issues.some((issue) => issue.code === code);
}

function createRegistryWithRow(row: string): ReturnType<typeof parseWorkspaceRegistry> {
  return parseWorkspaceRegistry(`---
registry_type: workspaces
registry_version: 1
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
${row}
`);
}

const validWorkspaceRegistry = parseWorkspaceRegistry(
  validWorkspaceRegistryMarkdown,
);
assert.equal(validWorkspaceRegistry.valid, true);
assert.equal(validWorkspaceRegistry.workspaces.length, 3);
assert.deepEqual(
  validWorkspaceRegistry.workspaces.map((workspace) => workspace.status),
  ['active', 'closed', 'archived'],
);
assert.deepEqual(
  validWorkspaceRegistry.workspaces.map((workspace) => workspace.security),
  ['internal', 'internal', 'private'],
);

const duplicateWorkspaceRegistry = parseWorkspaceRegistry(`---
registry_type: workspaces
registry_version: 1
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0001 | A | project | active | internal | | | |
| WS-2026-0001 | B | operation | active | internal | | | |
`);
assert.equal(hasIssue(duplicateWorkspaceRegistry, 'duplicate-workspace-id'), true);

assert.equal(
  hasIssue(
    createRegistryWithRow('| WS-26-1 | Bad ID | project | active | internal | | | |'),
    'invalid-workspace-id',
  ),
  true,
);
assert.equal(
  hasIssue(
    createRegistryWithRow('| WS-2026-0004 | Bad Type | product | active | internal | | | |'),
    'invalid-workspace-type',
  ),
  true,
);
assert.equal(
  hasIssue(
    createRegistryWithRow('| WS-2026-0005 | Bad Status | project | paused | internal | | | |'),
    'invalid-workspace-status',
  ),
  true,
);
assert.equal(
  hasIssue(
    createRegistryWithRow('| WS-2026-0006 | Bad Security | project | active | secret | | | |'),
    'invalid-workspace-security',
  ),
  true,
);

const missingWorkspaceSecurityRegistry = parseWorkspaceRegistry(`---
registry_type: workspaces
registry_version: 1
---
| id | name | type | status | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0007 | Legacy Registry | project | active | 2026-01-01 | 2026-12-31 | Security column missing |
`);

assert.equal(missingWorkspaceSecurityRegistry.valid, true);
assert.equal(
  missingWorkspaceSecurityRegistry.workspaces[0]?.security,
  'internal',
);
assert.equal(
  hasIssue(missingWorkspaceSecurityRegistry, 'workspace-security-missing'),
  true,
);
assert.equal(
  hasIssue(
    parseWorkspaceRegistry(`---
registry_type: knowledge-domains
registry_version: 1
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0001 | A | project | active | internal | | | |
`),
    'invalid-registry-type',
  ),
  true,
);
assert.equal(
  hasIssue(
    parseWorkspaceRegistry(`---
registry_type: workspaces
registry_version: 2
---
| id | name | type | status | security | start_date | end_date | description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WS-2026-0001 | A | project | active | internal | | | |
`),
    'unsupported-version',
  ),
  true,
);

const selectableWorkspaces = validWorkspaceRegistry.workspaces.map(
  toSelectableWorkspace,
);
const sections = createWorkspaceSections({
  registryWorkspaces: selectableWorkspaces,
  registryUnavailable: false,
});
const visibleWorkspaces = createSelectableWorkspaces(sections);

assert.equal(
  visibleWorkspaces.some((workspace) => workspace.id === 'WS-2026-0001'),
  true,
);
assert.equal(
  visibleWorkspaces.some((workspace) => workspace.id === 'WS-2026-0002'),
  true,
);
assert.equal(
  visibleWorkspaces.some((workspace) => workspace.id === 'WS-2026-0003'),
  false,
);

const activeWorkspace = selectableWorkspaces.find(
  (workspace) => workspace.id === 'WS-2026-0001',
) as Workspace;
const closedWorkspace = selectableWorkspaces.find(
  (workspace) => workspace.id === 'WS-2026-0002',
) as Workspace;
const archivedWorkspace = selectableWorkspaces.find(
  (workspace) => workspace.id === 'WS-2026-0003',
) as Workspace;

assert.equal(canCreateWorkspaceSession(activeWorkspace), true);
assert.equal(canAskWorkspaceQuestion(activeWorkspace), true);
assert.equal(canCreateWorkspaceSession(closedWorkspace), false);
assert.equal(canAskWorkspaceQuestion(closedWorkspace), false);
assert.equal(canCreateWorkspaceSession(archivedWorkspace), false);
assert.equal(canAskWorkspaceQuestion(archivedWorkspace), false);

const chatSessions: ChatSessions = {
  'WS-2026-0001': [
    {
      sessionId: 'active-session',
      workspaceId: 'WS-2026-0001',
      title: 'Active session',
      sortOrder: 0,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Active question',
          createdAt: '2026-09-10T00:00:00.000Z',
        },
      ],
    },
  ],
  'WS-2026-0002': [
    {
      sessionId: 'closed-session',
      workspaceId: 'WS-2026-0002',
      title: 'Closed session',
      sortOrder: 0,
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
      messages: [
        {
          id: 'msg-2',
          role: 'user',
          content: 'Closed question',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
    },
  ],
  'WS-2026-0003': [
    {
      sessionId: 'archived-session',
      workspaceId: 'WS-2026-0003',
      title: 'Archived session',
      sortOrder: 0,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      messages: [
        {
          id: 'msg-3',
          role: 'user',
          content: 'Archived question',
          createdAt: '2026-09-08T00:00:00.000Z',
        },
      ],
    },
  ],
};
const visibleWorkspaceIds = new Set(
  visibleWorkspaces
    .filter((workspace) => !workspace.isSystem)
    .map((workspace) => workspace.id),
);
const visibleRecentSessionIds = Object.entries(chatSessions).flatMap(
  ([workspaceId, sessions]) =>
    visibleWorkspaceIds.has(workspaceId)
      ? sessions.map((session) => session.sessionId)
      : [],
);

assert.deepEqual(visibleRecentSessionIds, [
  'active-session',
  'closed-session',
]);

const workspaceStatusMap = createWorkspaceStatusMap(
  validWorkspaceRegistry.workspaces,
);
assert.equal(
  isDocumentEligibleForSearch({
    selectedWorkspaceId: '__all__',
    workspaceIds: ['WS-2026-0003'],
    workspaceStatusMap,
    includeArchived: false,
    workspaceStatusLookupAvailable: true,
  }).eligible,
  false,
);
assert.equal(
  isDocumentEligibleForSearch({
    selectedWorkspaceId: '__all__',
    workspaceIds: ['WS-2026-0003'],
    workspaceStatusMap,
    includeArchived: true,
    workspaceStatusLookupAvailable: true,
  }).eligible,
  true,
);

const metadataWithKnownRegistryValues = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0001
workspace_ids:
  - WS-2026-0001
origin_workspace_id: WS-2026-0001
knowledge_domains:
  - project-management
knowledge_type: lesson-learned
---`, {
  knownWorkspaceIds: validWorkspaceRegistry.workspaces.map(
    (workspace) => workspace.id,
  ),
  knowledgeDomainRegistry: {
    version: 1,
    domains: [
      {
        canonicalName: 'project-management',
        aliases: ['pm'],
        description: null,
      },
    ],
  },
  knowledgeTypeRegistry: {
    version: 1,
    types: [{ canonicalName: 'lesson-learned', description: null }],
  },
});
assert.equal(
  metadataWithKnownRegistryValues.issues.some((issue) =>
    [
      'unknown_workspace_id',
      'unknown_knowledge_domain',
      'unknown_knowledge_type',
    ].includes(issue.code),
  ),
  false,
);

const metadataWithUnknownRegistryValues = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0002
workspace_ids:
  - WS-2026-9999
origin_workspace_id: WS-2026-9999
knowledge_domains:
  - missing-domain
knowledge_type: missing-type
---`, {
  knownWorkspaceIds: validWorkspaceRegistry.workspaces.map(
    (workspace) => workspace.id,
  ),
  knowledgeDomainRegistry: { version: 1, domains: [] },
  knowledgeTypeRegistry: { version: 1, types: [] },
});
assert.equal(
  metadataWithUnknownRegistryValues.issues.some(
    (issue) => issue.code === 'unknown_workspace_id',
  ),
  true,
);
assert.equal(
  metadataWithUnknownRegistryValues.issues.some(
    (issue) => issue.code === 'unknown_knowledge_domain',
  ),
  true,
);
assert.equal(
  metadataWithUnknownRegistryValues.issues.some(
    (issue) => issue.code === 'unknown_knowledge_type',
  ),
  true,
);

assert.equal(
  parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0003
workspace_ids:
  - WS-2026-0003
---`, {
    knownWorkspaceIds: validWorkspaceRegistry.workspaces.map(
      (workspace) => workspace.id,
    ),
  }).issues.some((issue) => issue.code === 'unknown_workspace_id'),
  false,
);

async function writeRegistryFile(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(rootPath, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

function createKnowledgeDomainsMarkdown(): string {
  return `---
registry_type: knowledge-domains
registry_version: 1
---
| canonical_name | aliases | description |
| --- | --- | --- |
| project-management | pm | Project management |
`;
}

function createKnowledgeTypesMarkdown(): string {
  return `---
registry_type: knowledge-types
registry_version: 1
---
| canonical_name | description |
| --- | --- |
| lesson-learned | Lesson learned |
`;
}

const registryRoot = await mkdtemp(path.join(tmpdir(), 'mimora-registry-test-'));
const cacheRoot = await mkdtemp(path.join(tmpdir(), 'mimora-registry-cache-'));
const cachePath = path.join(cacheRoot, 'registry-cache.json');

try {
  await writeRegistryFile(
    registryRoot,
    '_mimora/workspaces.md',
    validWorkspaceRegistryMarkdown,
  );
  await writeRegistryFile(
    registryRoot,
    '_mimora/knowledge-domains.md',
    createKnowledgeDomainsMarkdown(),
  );
  await writeRegistryFile(
    registryRoot,
    '_mimora/knowledge-types.md',
    createKnowledgeTypesMarkdown(),
  );

  const settings = {
    vaults: [
      {
        id: 'home-vault',
        name: 'Registry Home',
        type: 'work',
        security: 'internal',
        path: registryRoot,
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ],
    registry: { homeVaultId: 'home-vault' },
    search: { includeArchived: false, contentOriginScope: 'all' },
    localAI: {},
    externalAI: {},
    aiMode: 'auto',
    masking: {},
    secretDetection: {},
  } as unknown as MimoraSettings;
  const settingsReader = {
    getSettings: async () => settings,
  };
  const service = createRegistryStatusService(settingsReader, {
    getCachePath: () => cachePath,
    getNow: () => '2026-09-10T00:00:00.000Z',
  });

  const normalStatus = await service.getRegistryStatus();
  assert.equal(normalStatus.runtime.mode, 'normal');
  assert.equal(normalStatus.runtime.source, 'registry');
  assert.equal(normalStatus.runtime.workspaceCount, 3);

  await writeRegistryFile(
    registryRoot,
    '_mimora/workspaces.md',
    validWorkspaceRegistryMarkdown.replace(
      'registry_type: workspaces',
      'registry_type: broken',
    ),
  );

  const degradedStatus = await service.getRegistryStatus();
  assert.equal(degradedStatus.runtime.mode, 'degraded');
  assert.equal(degradedStatus.runtime.source, 'cache');
  assert.equal(degradedStatus.runtime.workspaceCount, 3);

  await writeRegistryFile(
    registryRoot,
    '_mimora/workspaces.md',
    validWorkspaceRegistryMarkdown,
  );

  const restoredStatus = await service.getRegistryStatus();
  assert.equal(restoredStatus.runtime.mode, 'normal');
  assert.equal(restoredStatus.runtime.source, 'registry');
} finally {
  await rm(registryRoot, { recursive: true, force: true });
  await rm(cacheRoot, { recursive: true, force: true });
}

const unresolvedRoot = await mkdtemp(
  path.join(tmpdir(), 'mimora-registry-unresolved-'),
);

try {
  const settings = {
    vaults: [
      {
        id: 'home-vault',
        name: 'Registry Home',
        type: 'work',
        security: 'internal',
        path: unresolvedRoot,
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ],
    registry: { homeVaultId: 'home-vault' },
    search: { includeArchived: false, contentOriginScope: 'all' },
    localAI: {},
    externalAI: {},
    aiMode: 'auto',
    masking: {},
    secretDetection: {},
  } as unknown as MimoraSettings;
  const service = createRegistryStatusService(
    { getSettings: async () => settings },
    { getCachePath: () => path.join(unresolvedRoot, 'missing-cache.json') },
  );
  const unresolvedStatus = await service.getRegistryStatus();

  assert.equal(unresolvedStatus.runtime.mode, 'unresolved');
  assert.equal(unresolvedStatus.runtime.source, 'none');
} finally {
  await rm(unresolvedRoot, { recursive: true, force: true });
}

console.info('[workspace-registry-tests] P0-2 workspace registry cases passed.');
