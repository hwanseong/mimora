import type { DocumentSecurity } from '../metadata/types';
import type { ExternalChatProviderId } from '../externalAI';
import type { VaultSecurity, VaultType } from '../settings';
import type { WorkspaceSecurity, WorkspaceType } from '../workspaces';
import type { PayloadSafetyStatus } from './outboundPayloadSafety';

export const aiModeOptions = ['auto', 'local', 'external'] as const;

export type AIMode = (typeof aiModeOptions)[number];
export type EffectiveSecurity = 'internal' | 'personal' | 'sensitive' | 'private';
export type RoutingProvider = 'local' | ExternalChatProviderId;
export type ProviderType = 'local' | 'external';
export type QuerySecurity = 'internal' | 'sensitive';
export type RoutingSafetyStatus = PayloadSafetyStatus | 'not-evaluated';
export type RoutingReason =
  | 'forced-local'
  | 'forced-external'
  | 'external-review-required'
  | 'external-safety-block'
  | 'external-private-content-block'
  | 'auto-external-pass'
  | 'safety-gate-not-pass'
  | 'user-approved'
  | 'user-selected-local-fallback'
  | 'private-document'
  | 'private-workspace'
  | 'private-vault'
  | 'sensitive-context'
  | 'personal-context'
  | 'external-provider-unavailable'
  | 'default-local';

export type RoutingDecision = {
  mode: AIMode;
  provider: RoutingProvider;
  providerType: ProviderType;
  security: EffectiveSecurity;
  reason: RoutingReason;
  sensitiveContextCount: number;
  personalContextCount: number;
  privateDocumentContextCount: number;
  privateVaultContextCount: number;
  manualContextCount: number;
  autoContextCount: number;
  safetyStatus: RoutingSafetyStatus;
  approved: boolean;
};

export type SecurityContextMetadata = {
  vaultId: string;
  relativePath: string;
  security: VaultSecurity;
  vaultType: VaultType;
  documentSecurity?: DocumentSecurity;
};

export type ContextSecuritySummary = {
  security: EffectiveSecurity;
  sensitiveContextCount: number;
  personalContextCount: number;
  privateDocumentContextCount: number;
  privateVaultContextCount: number;
};

export const effectiveSecurityLabels: Record<EffectiveSecurity, string> = {
  internal: 'Internal',
  personal: 'Personal',
  sensitive: 'Sensitive',
  private: 'Private',
};

export const routingReasonLabels: Record<RoutingReason, string> = {
  'forced-local': 'Forced Local',
  'forced-external': 'Explicit External',
  'external-review-required': 'Review required',
  'external-safety-block': 'Safety BLOCK',
  'external-private-content-block': 'Private content BLOCK',
  'auto-external-pass': 'Safety PASS',
  'safety-gate-not-pass': 'Safety policy fallback',
  'user-approved': 'User Approved',
  'user-selected-local-fallback': 'User selected Local fallback',
  'private-document': 'Private document context · Local-only policy',
  'private-workspace': 'Private Workspace · Local-only policy',
  'private-vault': 'Private Vault context · Local-only policy',
  'sensitive-context': 'Sensitive context · Local-only policy',
  'personal-context': 'Personal context · Local-only policy',
  'external-provider-unavailable': 'External provider unavailable',
  'default-local': 'Default Local',
};

export function getRoutingProviderType(provider: RoutingProvider): ProviderType {
  return provider === 'local' ? 'local' : 'external';
}

export function evaluateQuerySecurity(query: string | undefined): QuerySecurity {
  const normalizedQuery = query?.trim().replace(/\s+/gu, ' ') ?? '';

  if (!normalizedQuery) {
    return 'internal';
  }

  const sensitiveSignals = [
    /1:1/u,
    /개인\s*정보/u,
    /인사\s*(평가|이슈|문제|상담)/u,
    /연봉|징계|퇴사|채용/u,
    /고민.*멘토링|멘토링.*고민/u,
    /내부\s*(문제|갈등|고민)/u,
    /외부\s*업체.*갈등/u,
    /외부.*PM.*갈등/iu,
    /민감|비밀|confidential|secret/iu,
  ];

  return sensitiveSignals.some((pattern) => pattern.test(normalizedQuery))
    ? 'sensitive'
    : 'internal';
}

export function isExternalLocalOnlyRoutingReason(
  reason: RoutingReason,
): boolean {
  return (
    reason === 'private-document' ||
    reason === 'private-workspace' ||
    reason === 'private-vault' ||
    reason === 'sensitive-context'
  );
}

function deduplicateContexts(
  contexts: SecurityContextMetadata[],
): SecurityContextMetadata[] {
  const seenContexts = new Set<string>();

  return contexts.filter((context) => {
    const contextKey = JSON.stringify([context.vaultId, context.relativePath]);

    if (seenContexts.has(contextKey)) {
      return false;
    }

    seenContexts.add(contextKey);
    return true;
  });
}

export function inspectContextSecurity(
  contexts: SecurityContextMetadata[],
): ContextSecuritySummary {
  const distinctContexts = deduplicateContexts(contexts);
  const privateDocumentContextCount = distinctContexts.filter(
    (context) => context.documentSecurity === 'private',
  ).length;
  const sensitiveContextCount = distinctContexts.filter(
    (context) => context.security === 'sensitive',
  ).length;
  const personalContextCount = distinctContexts.filter(
    (context) => context.security === 'personal',
  ).length;
  const privateVaultContextCount = distinctContexts.filter(
    (context) => context.vaultType === 'private',
  ).length;
  const security: EffectiveSecurity =
    privateDocumentContextCount > 0
      ? 'sensitive'
      : privateVaultContextCount > 0 || sensitiveContextCount > 0
        ? 'sensitive'
        : personalContextCount > 0
          ? 'personal'
          : 'internal';

  return {
    security,
    sensitiveContextCount,
    personalContextCount,
    privateDocumentContextCount,
    privateVaultContextCount,
  };
}

export function evaluateEffectiveSecurity(input: {
  documentSecurity?: DocumentSecurity;
  vaultSecurity?: VaultSecurity;
  workspaceType?: WorkspaceType;
  workspaceSecurity?: WorkspaceSecurity;
  query?: string;
  contextDocuments?: SecurityContextMetadata[];
}): ContextSecuritySummary {
  const summary = inspectContextSecurity(input.contextDocuments ?? []);
  const hasPrivateDocument =
    input.documentSecurity === 'private' ||
    summary.privateDocumentContextCount > 0;
  const hasSensitiveVault = input.vaultSecurity === 'sensitive';
  const hasPersonalVault = input.vaultSecurity === 'personal';
  const hasPrivateWorkspace =
    input.workspaceSecurity === 'private' || input.workspaceType === 'private';
  const hasSensitiveQuery = evaluateQuerySecurity(input.query) === 'sensitive';
  const security: EffectiveSecurity = hasPrivateDocument
    ? 'sensitive'
    : hasPrivateWorkspace ||
        hasSensitiveQuery ||
        summary.privateVaultContextCount > 0 ||
        summary.sensitiveContextCount > 0 ||
        hasSensitiveVault
      ? 'sensitive'
      : summary.personalContextCount > 0 || hasPersonalVault
        ? 'personal'
        : 'internal';

  return {
    ...summary,
    security,
  };
}

export function evaluateSecurity(
  workspaceType: WorkspaceType,
  contexts: SecurityContextMetadata[],
  workspaceSecurity?: WorkspaceSecurity,
  query?: string,
): ContextSecuritySummary {
  return evaluateEffectiveSecurity({
    workspaceType,
    workspaceSecurity,
    query,
    contextDocuments: contexts,
  });
}

function getExternalLocalOnlyRoutingReason(
  workspaceType: WorkspaceType,
  workspaceSecurity: WorkspaceSecurity | undefined,
  security: ContextSecuritySummary,
): RoutingReason | null {
  if (security.privateDocumentContextCount > 0) {
    return 'private-document';
  }

  if (workspaceSecurity === 'private' || workspaceType === 'private') {
    return 'private-workspace';
  }

  if (security.privateVaultContextCount > 0) {
    return 'private-vault';
  }

  if (security.sensitiveContextCount > 0 || security.security === 'sensitive') {
    return 'sensitive-context';
  }

  return null;
}

export function routeAIRequest(input: {
  mode: AIMode;
  workspaceType: WorkspaceType;
  workspaceSecurity?: WorkspaceSecurity;
  query?: string;
  manualContexts: SecurityContextMetadata[];
  autoContexts: SecurityContextMetadata[];
  safetyStatus?: PayloadSafetyStatus;
  externalAvailable?: boolean;
  externalProvider?: ExternalChatProviderId;
}): RoutingDecision {
  const contexts = [...input.manualContexts, ...input.autoContexts];
  const security = evaluateSecurity(
    input.workspaceType,
    contexts,
    input.workspaceSecurity,
    input.query,
  );
  const safetyStatus = input.safetyStatus ?? 'not-evaluated';
  let provider: RoutingProvider = 'local';
  let reason: RoutingReason;
  const externalLocalOnlyReason = getExternalLocalOnlyRoutingReason(
    input.workspaceType,
    input.workspaceSecurity,
    security,
  );
  const externalProvider = input.externalProvider ?? 'openai';

  if (input.mode === 'local') {
    reason = 'forced-local';
  } else if (externalLocalOnlyReason) {
    reason = externalLocalOnlyReason;
  } else if (input.mode === 'external') {
    provider = externalProvider;
    reason =
      safetyStatus === 'review-required'
        ? 'external-review-required'
        : safetyStatus === 'block'
          ? 'external-safety-block'
          : 'forced-external';
  } else if (
    input.workspaceSecurity === 'private' ||
    input.workspaceType === 'private'
  ) {
    reason = 'private-workspace';
  } else if (security.privateVaultContextCount > 0) {
    reason = 'private-vault';
  } else if (security.sensitiveContextCount > 0) {
    reason = 'sensitive-context';
  } else if (security.personalContextCount > 0) {
    reason = 'personal-context';
  } else if (safetyStatus !== 'pass') {
    reason = 'safety-gate-not-pass';
  } else if (!input.externalAvailable) {
    reason = 'external-provider-unavailable';
  } else {
    provider = externalProvider;
    reason = 'auto-external-pass';
  }

  return {
    mode: input.mode,
    provider,
    providerType: getRoutingProviderType(provider),
    security: security.security,
    reason,
    sensitiveContextCount: security.sensitiveContextCount,
    personalContextCount: security.personalContextCount,
    privateDocumentContextCount: security.privateDocumentContextCount,
    privateVaultContextCount: security.privateVaultContextCount,
    manualContextCount: input.manualContexts.length,
    autoContextCount: input.autoContexts.length,
    safetyStatus,
    approved: false,
  };
}
