import type { VaultSecurity, VaultType } from '../settings';
import type { WorkspaceType } from '../workspaces';
import type { PayloadSafetyStatus } from './outboundPayloadSafety';

export const aiModeOptions = ['auto', 'local', 'external'] as const;

export type AIMode = (typeof aiModeOptions)[number];
export type EffectiveSecurity = 'internal' | 'personal' | 'sensitive';
export type RoutingProvider = 'local' | 'openai';
export type RoutingSafetyStatus = PayloadSafetyStatus | 'not-evaluated';
export type RoutingReason =
  | 'forced-local'
  | 'forced-external'
  | 'external-review-required'
  | 'external-safety-block'
  | 'auto-external-pass'
  | 'safety-gate-not-pass'
  | 'user-approved'
  | 'user-selected-local'
  | 'private-workspace'
  | 'private-vault'
  | 'sensitive-context'
  | 'personal-context'
  | 'external-provider-unavailable'
  | 'default-local';

export type RoutingDecision = {
  mode: AIMode;
  provider: RoutingProvider;
  security: EffectiveSecurity;
  reason: RoutingReason;
  sensitiveContextCount: number;
  personalContextCount: number;
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
};

export type ContextSecuritySummary = {
  security: EffectiveSecurity;
  sensitiveContextCount: number;
  personalContextCount: number;
  privateVaultContextCount: number;
};

export const effectiveSecurityLabels: Record<EffectiveSecurity, string> = {
  internal: 'Internal',
  personal: 'Personal',
  sensitive: 'Sensitive',
};

export const routingReasonLabels: Record<RoutingReason, string> = {
  'forced-local': 'Forced Local',
  'forced-external': 'Explicit External',
  'external-review-required': 'Review required',
  'external-safety-block': 'Safety BLOCK',
  'auto-external-pass': 'Safety PASS',
  'safety-gate-not-pass': 'Safety policy fallback',
  'user-approved': 'User Approved',
  'user-selected-local': 'User selected Local',
  'private-workspace': 'Private Workspace · Local-only policy',
  'private-vault': 'Private Vault context · Local-only policy',
  'sensitive-context': 'Sensitive context · Local-only policy',
  'personal-context': 'Personal context · Local-only policy',
  'external-provider-unavailable': 'External provider unavailable',
  'default-local': 'Default Local',
};

export function inspectContextSecurity(
  contexts: SecurityContextMetadata[],
): ContextSecuritySummary {
  const seenContexts = new Set<string>();
  const distinctContexts = contexts.filter((context) => {
    const contextKey = JSON.stringify([context.vaultId, context.relativePath]);

    if (seenContexts.has(contextKey)) {
      return false;
    }

    seenContexts.add(contextKey);
    return true;
  });
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
    privateVaultContextCount > 0 || sensitiveContextCount > 0
      ? 'sensitive'
      : personalContextCount > 0
        ? 'personal'
        : 'internal';

  return {
    security,
    sensitiveContextCount,
    personalContextCount,
    privateVaultContextCount,
  };
}

export function evaluateSecurity(
  workspaceType: WorkspaceType,
  contexts: SecurityContextMetadata[],
): ContextSecuritySummary {
  const summary = inspectContextSecurity(contexts);

  return workspaceType === 'private'
    ? { ...summary, security: 'sensitive' }
    : summary;
}

export function routeAIRequest(input: {
  mode: AIMode;
  workspaceType: WorkspaceType;
  manualContexts: SecurityContextMetadata[];
  autoContexts: SecurityContextMetadata[];
  safetyStatus?: PayloadSafetyStatus;
  externalAvailable?: boolean;
}): RoutingDecision {
  const contexts = [...input.manualContexts, ...input.autoContexts];
  const security = evaluateSecurity(input.workspaceType, contexts);
  const safetyStatus = input.safetyStatus ?? 'not-evaluated';
  let provider: RoutingProvider = 'local';
  let reason: RoutingReason;

  if (input.mode === 'local') {
    reason = 'forced-local';
  } else if (input.mode === 'external') {
    provider = 'openai';
    reason =
      safetyStatus === 'review-required'
        ? 'external-review-required'
        : safetyStatus === 'block'
          ? 'external-safety-block'
          : 'forced-external';
  } else if (input.workspaceType === 'private') {
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
    provider = 'openai';
    reason = 'auto-external-pass';
  }

  return {
    mode: input.mode,
    provider,
    security: security.security,
    reason,
    sensitiveContextCount: security.sensitiveContextCount,
    personalContextCount: security.personalContextCount,
    privateVaultContextCount: security.privateVaultContextCount,
    manualContextCount: input.manualContexts.length,
    autoContextCount: input.autoContexts.length,
    safetyStatus,
    approved: false,
  };
}
