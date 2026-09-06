import type { VaultSecurity, VaultType } from '../settings';
import type { MaskingEntry } from './maskingEngine';
import type { EffectiveSecurity } from './securityRouter';
import { containsAbsoluteFilesystemPath } from './structuralMasking';

export type PayloadSafetyStatus = 'pass' | 'review-required' | 'block';
export type PayloadSafetyCheckStatus = 'pass' | 'warn' | 'fail';

export type PayloadSafetyCheck = {
  id: string;
  label: string;
  status: PayloadSafetyCheckStatus;
  message: string;
};

export type PayloadSafetyResult = {
  status: PayloadSafetyStatus;
  checks: PayloadSafetyCheck[];
  blockers: string[];
  warnings: string[];
};

export type ExternalSendAuthorization =
  | { allowed: true }
  | { allowed: false; message: string };

export function authorizeExternalSend(input: {
  status: PayloadSafetyStatus;
  mode: 'auto' | 'external';
  approved: boolean;
}): ExternalSendAuthorization {
  if (input.status === 'block') {
    return {
      allowed: false,
      message: '보안 검사에 실패하여 외부 AI로 전송할 수 없습니다.',
    };
  }

  if (
    input.status === 'review-required' &&
    (input.mode !== 'external' || !input.approved)
  ) {
    return {
      allowed: false,
      message: '외부 AI 전송 전 검토와 승인이 필요합니다.',
    };
  }

  return { allowed: true };
}

export type OutboundPayloadDocumentMetadata = {
  documentId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
};

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsValue(text: string, value: string): boolean {
  return new RegExp(escapeRegularExpression(value), 'iu').test(text);
}

function containsMappingTable(
  text: string,
  entries: MaskingEntry[],
): boolean {
  const separator = String.raw`(?:=|:|->|→|←)`;

  return entries.some((entry) => {
    const alias = String.raw`\[?${escapeRegularExpression(entry.alias)}\]?`;
    const original = escapeRegularExpression(entry.value);
    const aliasFirst = new RegExp(
      `${alias}\\s*${separator}\\s*${original}`,
      'iu',
    );
    const originalFirst = new RegExp(
      `${original}\\s*${separator}\\s*${alias}`,
      'iu',
    );

    return aliasFirst.test(text) || originalFirst.test(text);
  });
}

function check(
  id: string,
  label: string,
  status: PayloadSafetyCheckStatus,
  message: string,
): PayloadSafetyCheck {
  return { id, label, status, message };
}

export function evaluateOutboundPayload(input: {
  externalText: string;
  documents: OutboundPayloadDocumentMetadata[];
  maskingEntries: MaskingEntry[];
  effectiveSecurity?: EffectiveSecurity;
}): PayloadSafetyResult {
  const { externalText, documents, maskingEntries, effectiveSecurity } = input;
  const enabledEntries = maskingEntries.filter((entry) => entry.enabled);
  const hasAbsolutePath = containsAbsoluteFilesystemPath(externalText);
  const leakedMetadata = documents.some((document) =>
    [document.vaultName, document.relativePath, document.fileName]
      .filter(Boolean)
      .some((metadataValue) => containsValue(externalText, metadataValue)),
  );
  const hasMappingTable = containsMappingTable(externalText, enabledEntries);
  const remainingEntities = enabledEntries.filter((entry) =>
    containsValue(externalText, entry.value),
  );
  const expectedDocumentIds = documents.map((document) => document.documentId);
  const openingDocumentIds = [
    ...externalText.matchAll(/\[(DOCUMENT_\d+)\]/gu),
  ].map((match) => match[1]);
  const closingDocumentIds = [
    ...externalText.matchAll(/\[\/(DOCUMENT_\d+)\]/gu),
  ].map((match) => match[1]);
  const documentBoundariesValid =
    JSON.stringify(openingDocumentIds) ===
      JSON.stringify(expectedDocumentIds) &&
    JSON.stringify(closingDocumentIds) ===
      JSON.stringify(expectedDocumentIds);
  const emptyContextMarkerValid =
    documents.length > 0 ||
    externalText.includes(
      '<Project Context>\nNo project context was provided.\n</Project Context>',
    );
  const payloadStructureValid =
    externalText.includes('<Project Context>') &&
    externalText.includes('</Project Context>') &&
    externalText.includes('<User Question>') &&
    externalText.includes('</User Question>') &&
    documentBoundariesValid &&
    emptyContextMarkerValid;
  const hasPrivateContext = documents.some(
    (document) => document.vaultType === 'private',
  );
  const hasSensitiveContext = documents.some(
    (document) => document.security === 'sensitive',
  ) || effectiveSecurity === 'sensitive';
  const hasPersonalContext = documents.some(
    (document) => document.security === 'personal',
  ) || effectiveSecurity === 'personal';
  const hasContextWithoutDictionary =
    documents.length > 0 && enabledEntries.length === 0;
  const checks: PayloadSafetyCheck[] = [
    check(
      'payload-structure',
      'Payload structure',
      payloadStructureValid ? 'pass' : 'fail',
      payloadStructureValid
        ? '익명 문서 경계와 Question/Context 구분이 정상입니다.'
        : 'External Payload 구조가 올바르지 않습니다.',
    ),
    check(
      'absolute-filesystem-path',
      'Filesystem paths removed',
      hasAbsolutePath ? 'fail' : 'pass',
      hasAbsolutePath
        ? '명백한 absolute filesystem path가 남아 있습니다.'
        : 'Windows 및 사용자 홈 absolute path가 없습니다.',
    ),
    check(
      'vault-metadata',
      'Vault metadata excluded',
      leakedMetadata ? 'fail' : 'pass',
      leakedMetadata
        ? 'Vault 이름, fileName 또는 relativePath가 Payload에 남아 있습니다.'
        : '로컬 Vault metadata가 Payload에서 제외되었습니다.',
    ),
    check(
      'mapping-table',
      'Mapping table excluded',
      hasMappingTable ? 'fail' : 'pass',
      hasMappingTable
        ? '원본 Entity와 Alias의 Mapping 관계가 노출되었습니다.'
        : '원본–Alias Mapping Table이 없습니다.',
    ),
    check(
      'registered-entities',
      'Registered entities masked',
      remainingEntities.length > 0 ? 'fail' : 'pass',
      remainingEntities.length > 0
        ? `등록된 원본 Entity ${remainingEntities.length}개가 남아 있습니다.`
        : '활성화된 등록 Entity의 원문이 남아 있지 않습니다.',
    ),
    check(
      'private-vault-context',
      'Private Vault context',
      hasPrivateContext ? 'warn' : 'pass',
      hasPrivateContext
        ? 'Private Vault Context는 수동 검토가 필요합니다.'
        : 'Private Vault Context가 없습니다.',
    ),
    check(
      'sensitive-context',
      'Sensitive context',
      hasSensitiveContext ? 'warn' : 'pass',
      hasSensitiveContext
        ? 'Sensitive Context는 수동 검토가 필요합니다.'
        : 'Sensitive Context가 없습니다.',
    ),
    check(
      'personal-context',
      'Personal context',
      hasPersonalContext ? 'warn' : 'pass',
      hasPersonalContext
        ? 'Personal Context는 수동 검토가 필요합니다.'
        : 'Personal Context가 없습니다.',
    ),
    check(
      'masking-dictionary',
      'Masking Dictionary available',
      hasContextWithoutDictionary ? 'warn' : 'pass',
      hasContextWithoutDictionary
        ? 'Context가 있지만 활성화된 Masking Entity가 없습니다.'
        : 'Masking Dictionary 조건이 확인되었습니다.',
    ),
  ];
  const blockers = checks
    .filter((safetyCheck) => safetyCheck.status === 'fail')
    .map((safetyCheck) => safetyCheck.id);
  const warnings = checks
    .filter((safetyCheck) => safetyCheck.status === 'warn')
    .map((safetyCheck) => safetyCheck.id);
  const status: PayloadSafetyStatus =
    blockers.length > 0
      ? 'block'
      : warnings.length > 0
        ? 'review-required'
        : 'pass';

  return { status, checks, blockers, warnings };
}
