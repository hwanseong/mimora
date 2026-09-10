import assert from 'node:assert/strict';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';

function hasIssue(
  result: ReturnType<typeof parseMimoraDocumentMetadata>,
  code: string,
): boolean {
  return result.issues.some((issue) => issue.code === code);
}

const yamlOnlyMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0001
workspace_ids:
  - WS-2026-0001
origin_workspace_id: WS-2026-0001
security: internal
knowledge_domains:
  - project-management
knowledge_type: lesson-learned
---
# YAML only
`);

assert.equal(yamlOnlyMetadata.metadata.source, 'frontmatter');
assert.equal(yamlOnlyMetadata.metadata.documentId, 'DOC-2026-0001');
assert.deepEqual(yamlOnlyMetadata.metadata.workspaceIds, ['WS-2026-0001']);
assert.equal(yamlOnlyMetadata.metadata.security, 'internal');
assert.deepEqual(yamlOnlyMetadata.metadata.knowledgeDomains, [
  'project-management',
]);
assert.deepEqual(yamlOnlyMetadata.metadata.knowledgeTypes, ['lesson-learned']);

const legacyOnlyMetadata = parseMimoraDocumentMetadata(`
## Mimora Metadata

| Field | Value |
| --- | --- |
| document_id | DOC-2026-0002 |
| workspace_ids | WS-2026-0002 |
| origin_workspace_id | WS-2026-0002 |
| security | private |
| knowledge_domains | operations |
| knowledge_type | incident-review |

# Legacy only
`);

assert.equal(legacyOnlyMetadata.metadata.source, 'legacy');
assert.equal(legacyOnlyMetadata.metadata.documentId, 'DOC-2026-0002');
assert.deepEqual(legacyOnlyMetadata.metadata.workspaceIds, ['WS-2026-0002']);
assert.equal(legacyOnlyMetadata.metadata.security, 'private');

const mixedSameMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0003
workspace_ids:
  - WS-2026-0003
knowledge_domains:
  - risk-management
knowledge_type: decision-log
---
## Mimora Metadata

| Field | Value |
| --- | --- |
| document_id | DOC-2026-0003 |
| workspace_ids | WS-2026-0003 |
| knowledge_domains | risk-management |
| knowledge_type | decision-log |

# Mixed same
`);

assert.equal(mixedSameMetadata.metadata.source, 'mixed');
assert.equal(hasIssue(mixedSameMetadata, 'metadata_conflict'), false);

const mixedConflictMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0004
workspace_ids:
  - WS-2026-0004
knowledge_domains:
  - project-management
knowledge_type: risk
---
## Mimora Metadata

| Field | Value |
| --- | --- |
| document_id | DOC-2026-9999 |
| workspace_ids | WS-2026-0004 |
| knowledge_domains | operations |
| knowledge_type | risk |

# Mixed conflict
`);

const conflict = mixedConflictMetadata.issues.find(
  (issue) => issue.code === 'metadata_conflict' && issue.field === 'document_id',
);

assert.equal(mixedConflictMetadata.metadata.documentId, 'DOC-2026-0004');
assert.ok(conflict);
assert.equal(conflict.details?.yamlValue, 'DOC-2026-0004');
assert.equal(conflict.details?.legacyValue, 'DOC-2026-9999');
assert.equal(conflict.details?.selectedValue, 'DOC-2026-0004');

const missingDocumentIdMetadata = parseMimoraDocumentMetadata(`---
workspace_ids:
  - WS-2026-0005
knowledge_domains:
  - project-management
---
# Missing document id
`);

assert.equal(hasIssue(missingDocumentIdMetadata, 'missing_document_id'), true);

const invalidDocumentIdMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-26-5
workspace_ids:
  - WS-2026-0006
---
# Invalid document id
`);

assert.equal(hasIssue(invalidDocumentIdMetadata, 'invalid_document_id'), true);
assert.equal(invalidDocumentIdMetadata.valid, false);

const multipleWorkspaceIdsMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0007
workspace_ids: [WS-2026-0007, WS-2026-0008]
---
# Multiple workspace IDs
`);

assert.deepEqual(multipleWorkspaceIdsMetadata.metadata.workspaceIds, [
  'WS-2026-0007',
  'WS-2026-0008',
]);

const invalidWorkspaceIdMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0008
workspace_ids:
  - WS-26-8
---
# Invalid workspace id
`);

assert.equal(hasIssue(invalidWorkspaceIdMetadata, 'invalid_workspace_id'), true);

const knowledgeDomainsArrayMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0009
workspace_ids:
  - WS-2026-0009
knowledge_domains:
  - project-management
  - operations
knowledge_type: decision-log
---
# Knowledge domains array
`);

assert.deepEqual(knowledgeDomainsArrayMetadata.metadata.knowledgeDomains, [
  'project-management',
  'operations',
]);

const emptyKnowledgeTypeMetadata = parseMimoraDocumentMetadata(`---
document_id: DOC-2026-0010
workspace_ids:
  - WS-2026-0010
knowledge_type:
---
# Empty knowledge type
`);

assert.deepEqual(emptyKnowledgeTypeMetadata.metadata.knowledgeTypes, []);

const plainMarkdownMetadata = parseMimoraDocumentMetadata('# Plain Markdown');

assert.equal(plainMarkdownMetadata.hasMetadata, false);
assert.equal(plainMarkdownMetadata.metadata.source, 'none');
assert.deepEqual(plainMarkdownMetadata.issues, []);

let invalidYamlMetadata:
  | ReturnType<typeof parseMimoraDocumentMetadata>
  | undefined;

assert.doesNotThrow(() => {
  invalidYamlMetadata = parseMimoraDocumentMetadata(`---
document_id DOC-2026-0011
---
# Invalid YAML
`);
});
assert.ok(invalidYamlMetadata);
assert.equal(hasIssue(invalidYamlMetadata, 'invalid_frontmatter'), true);

console.info('[metadata-parser-tests] P0-1 metadata parser cases passed.');
