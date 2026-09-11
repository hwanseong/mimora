import assert from 'node:assert/strict';
import { buildExternalPayloadText } from '../src/security/externalPayloadBuilder';
import {
  authorizeExternalSend,
  evaluateOutboundPayload,
  type OutboundPayloadDocumentMetadata,
} from '../src/security/outboundPayloadSafety';
import {
  evaluateQuerySecurity,
  getRoutingProviderType,
  routeAIRequest,
  type SecurityContextMetadata,
} from '../src/security/securityRouter';
import type { WorkspaceSecurity } from '../src/workspaces';

function context(
  overrides: Partial<SecurityContextMetadata> = {},
): SecurityContextMetadata {
  return {
    vaultId: 'work-vault',
    relativePath: 'docs/sample.md',
    security: 'internal',
    vaultType: 'work',
    ...overrides,
  };
}

function document(
  overrides: Partial<OutboundPayloadDocumentMetadata> = {},
): OutboundPayloadDocumentMetadata {
  return {
    documentId: 'DOCUMENT_1',
    vaultName: 'Project Work',
    vaultType: 'work',
    security: 'internal',
    relativePath: 'docs/sample.md',
    fileName: 'sample.md',
    ...overrides,
  };
}

function payloadFor(documents: OutboundPayloadDocumentMetadata[]): string {
  return buildExternalPayloadText({
    maskedQuestion: '현재 상태를 요약해줘',
    maskedDocumentContents: documents.map((_, index) => `본문 ${index + 1}`),
  }).text;
}

function assertExternalBlocked(
  name: string,
  contexts: SecurityContextMetadata[],
  documents: OutboundPayloadDocumentMetadata[],
  workspaceType = 'project',
  workspaceSecurity: WorkspaceSecurity = 'internal',
): void {
  const route = routeAIRequest({
    mode: 'external',
    workspaceType,
    workspaceSecurity,
    manualContexts: contexts,
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
  });

  assert.equal(route.provider, 'local', name);
  assert.equal(route.providerType, 'local', name);

  const safety = evaluateOutboundPayload({
    externalText: payloadFor(documents),
    documents,
    maskingEntries: [],
    effectiveSecurity: route.security,
  });

  assert.equal(safety.status, 'block', name);

  const authorization = authorizeExternalSend({
    status: safety.status,
    mode: 'external',
    approved: true,
    providerId: 'openai',
    providerType: 'external',
    hasExternalLocalOnlyContext: true,
  });

  assert.equal(authorization.allowed, false, name);
}

assertExternalBlocked(
  'private vault + openai is blocked',
  [context({ vaultId: 'private-vault', vaultType: 'private' })],
  [document({ vaultName: 'Project Private', vaultType: 'private' })],
);

assertExternalBlocked(
  'legacy private workspace type + openai is blocked',
  [context()],
  [document()],
  'private',
);

assertExternalBlocked(
  'private workspace security + openai is blocked',
  [context()],
  [document()],
  'project',
  'private',
);

assertExternalBlocked(
  'private rag + openai is blocked',
  [
    context({
      vaultId: 'rag-library',
      relativePath: 'rag://RAG-2026-000001/RAG-2026-000001-CH-000001',
      security: 'sensitive',
      vaultType: 'knowledge',
      documentSecurity: 'private',
    }),
  ],
  [
    document({
      vaultName: 'RAG Library',
      vaultType: 'knowledge',
      security: 'sensitive',
      documentSecurity: 'private',
      relativePath: 'rag://RAG-2026-000001/RAG-2026-000001-CH-000001',
      fileName: 'private.pdf',
    }),
  ],
);

assertExternalBlocked(
  'private ai wiki + openai is blocked',
  [
    context({
      relativePath: '_mimora/wiki/private-wiki.md',
      documentSecurity: 'private',
    }),
  ],
  [
    document({
      relativePath: '_mimora/wiki/private-wiki.md',
      fileName: 'private-wiki.md',
      documentSecurity: 'private',
    }),
  ],
);

assertExternalBlocked(
  'mixed private/internal + openai is blocked',
  [
    context({ relativePath: 'docs/internal.md' }),
    context({
      vaultId: 'private-vault',
      relativePath: 'docs/private.md',
      vaultType: 'private',
    }),
  ],
  [
    document({ relativePath: 'docs/internal.md', fileName: 'internal.md' }),
    document({
      documentId: 'DOCUMENT_2',
      vaultName: 'Project Private',
      vaultType: 'private',
      relativePath: 'docs/private.md',
      fileName: 'private.md',
    }),
  ],
);

assertExternalBlocked(
  'schedule + private vault + openai is blocked',
  [
    context({
      vaultId: 'schedule-intelligence',
      relativePath: 'schedule://WS-2026-0001/schedule.xlsm',
      security: 'sensitive',
      vaultType: 'knowledge',
    }),
    context({
      vaultId: 'private-vault',
      relativePath: 'docs/private.md',
      vaultType: 'private',
    }),
  ],
  [
    document({
      vaultName: 'Schedule Intelligence',
      security: 'sensitive',
      relativePath: 'schedule://WS-2026-0001/schedule.xlsm',
      fileName: 'schedule.xlsm',
    }),
    document({
      documentId: 'DOCUMENT_2',
      vaultName: 'Project Private',
      vaultType: 'private',
      relativePath: 'docs/private.md',
      fileName: 'private.md',
    }),
  ],
);

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    manualContexts: [context()],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
  });

  assert.equal(route.provider, 'openai');
  assert.equal(route.providerType, 'external');
  assert.equal(route.reason, 'forced-external');

  const safety = evaluateOutboundPayload({
    externalText: payloadFor([document()]),
    documents: [document()],
    maskingEntries: [],
    effectiveSecurity: route.security,
  });

  assert.equal(safety.status, 'review-required');

  const authorization = authorizeExternalSend({
    status: safety.status,
    mode: 'external',
    approved: true,
    providerId: 'openai',
    providerType: 'external',
  });

  assert.equal(authorization.allowed, true);
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    manualContexts: [context({ documentSecurity: 'private' })],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.reason, 'private-document');
}

{
  const authorization = authorizeExternalSend({
    status: 'block',
    mode: 'external',
    approved: true,
    providerId: 'openai',
    providerType: 'external',
    hasExternalLocalOnlyContext: true,
  });

  assert.equal(authorization.allowed, false);
}

{
  const authorization = authorizeExternalSend({
    status: 'pass',
    mode: 'external',
    approved: true,
    providerId: 'gemini',
    providerType: 'external',
    hasExternalLocalOnlyContext: true,
  });

  assert.equal(authorization.allowed, false);
}

{
  assert.equal(getRoutingProviderType('openai'), 'external');
  assert.equal(getRoutingProviderType('gemini'), 'external');
  assert.equal(getRoutingProviderType('local'), 'local');
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    manualContexts: [context()],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
    externalProvider: 'gemini',
  });

  assert.equal(route.provider, 'gemini');
  assert.equal(route.providerType, 'external');
  assert.equal(route.reason, 'forced-external');
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    manualContexts: [context({ documentSecurity: 'private' })],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
    externalProvider: 'gemini',
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.providerType, 'local');
  assert.equal(route.reason, 'private-document');
}

{
  const route = routeAIRequest({
    mode: 'local',
    workspaceType: 'project',
    workspaceSecurity: 'private',
    manualContexts: [context({ documentSecurity: 'private' })],
    autoContexts: [],
    safetyStatus: 'not-evaluated',
    externalAvailable: true,
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.providerType, 'local');
  assert.equal(route.reason, 'forced-local');
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'private',
    manualContexts: [],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
    externalProvider: 'gemini',
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.providerType, 'local');
  assert.equal(route.security, 'sensitive');
  assert.equal(route.reason, 'private-workspace');
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    manualContexts: [],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
    externalProvider: 'gemini',
  });

  assert.equal(route.provider, 'gemini');
  assert.equal(route.providerType, 'external');
  assert.equal(route.security, 'internal');
  assert.equal(route.reason, 'forced-external');
}

{
  assert.equal(evaluateQuerySecurity('박대리 담당 작업은?'), 'internal');
  assert.equal(
    evaluateQuerySecurity('박대리가 이런 고민이 있는데 어떻게 멘토링할까?'),
    'sensitive',
  );
  assert.equal(
    evaluateQuerySecurity('박대리의 1:1 기록을 참고해서 멘토링 방법 알려줘'),
    'sensitive',
  );
  assert.equal(
    evaluateQuerySecurity('외부업체 PM과 갈등 중인데 어떻게 대응할까?'),
    'sensitive',
  );
  assert.equal(evaluateQuerySecurity('멘토링의 일반적인 절차가 뭐야?'), 'internal');
}

{
  const route = routeAIRequest({
    mode: 'external',
    workspaceType: 'project',
    workspaceSecurity: 'internal',
    query: '우리 프로젝트 내부 문제를 어떻게 해결할까?',
    manualContexts: [],
    autoContexts: [],
    safetyStatus: 'pass',
    externalAvailable: true,
    externalProvider: 'gemini',
  });

  assert.equal(route.provider, 'local');
  assert.equal(route.providerType, 'local');
  assert.equal(route.security, 'sensitive');
  assert.equal(route.reason, 'sensitive-context');
}

console.log('security-boundary-tests passed');
