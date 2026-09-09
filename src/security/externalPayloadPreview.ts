import type { EffectiveSecurity } from './securityRouter';
import type { Workspace } from '../workspace/types';
import type { VaultSecurity, VaultType } from '../settings';
import type { MimoraDocumentMetadata } from '../metadata/types';
import {
  buildContextBudget,
  createContextBudgetSummary,
  createContextProfile,
} from '../context/contextBudgetManager';
import {
  findRemainingRegisteredEntityIds,
  maskingEntityTypes,
  maskText,
  type MaskingEntry,
  type MaskingReplacement,
} from './maskingEngine';
import {
  createEffectiveMaskingEntries,
  type EffectiveMaskingSummary,
} from './maskingScope';
import {
  createStructuralSensitiveDataMasker,
  type StructuralMaskingReplacement,
} from './structuralMasking';
import { buildExternalPayloadText } from './externalPayloadBuilder';
import {
  evaluateOutboundPayload,
  type PayloadSafetyResult,
  type PayloadSafetyStatus,
} from './outboundPayloadSafety';
import {
  builtInSecretRules,
  scanSecrets,
  type SecretDetectionResult,
  type SecretRule,
} from './secretDetector';

export type ExternalPreviewDocument = {
  documentId: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  documentSecurity?: MimoraDocumentMetadata['security'];
  relativePath: string;
  fileName: string;
  metadata?: MimoraDocumentMetadata;
  originalChars: number;
  maskedContent: string;
  replacementCount: number;
};

export type ExternalMaskingReplacement =
  | MaskingReplacement
  | StructuralMaskingReplacement;

export type ExternalPayloadPreview = {
  workspaceId: string;
  effectiveSecurity: EffectiveSecurity;
  maskingSummary: EffectiveMaskingSummary & {
    secretDetections: number;
  };
  responseUnmaskingSnapshot: {
    alias: string;
    original: string;
    entityType: MaskingEntry['type'];
  }[];
  maskedQuestion: string;
  originalContextChars: number;
  maskedContextChars: number;
  documentCount: number;
  documents: ExternalPreviewDocument[];
  replacements: ExternalMaskingReplacement[];
  totalReplacementCount: number;
  externalText: string;
  safeToSend: boolean;
  status: PayloadSafetyStatus;
  blockers: string[];
  safety: PayloadSafetyResult;
  secretDetection: SecretDetectionResult;
};

export type ExternalPreviewContextInput = {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  documentSecurity?: MimoraDocumentMetadata['security'];
  relativePath: string;
  fileName: string;
  metadata?: MimoraDocumentMetadata;
  relevanceScore?: number;
  score?: number;
  content: string;
};

function deduplicateContextDocuments(
  manualContexts: ExternalPreviewContextInput[],
  autoContexts: ExternalPreviewContextInput[],
): ExternalPreviewContextInput[] {
  const seenDocuments = new Set<string>();

  return [...manualContexts, ...autoContexts].filter((document) => {
    const documentKey = JSON.stringify([
      document.vaultId,
      document.relativePath,
    ]);

    if (seenDocuments.has(documentKey)) {
      return false;
    }

    seenDocuments.add(documentKey);
    return true;
  });
}

function createContextDocumentKey(document: ExternalPreviewContextInput): string {
  return JSON.stringify([document.vaultId, document.relativePath]);
}

function mergeReplacements(
  replacementGroups: ExternalMaskingReplacement[][],
): ExternalMaskingReplacement[] {
  const replacements = new Map<string, ExternalMaskingReplacement>();

  for (const replacement of replacementGroups.flat()) {
    const existingReplacement = replacements.get(replacement.entryId);

    replacements.set(replacement.entryId, {
      ...replacement,
      count: (existingReplacement?.count ?? 0) + replacement.count,
    });
  }

  return [...replacements.values()];
}

function isDictionaryMaskingReplacement(
  replacement: ExternalMaskingReplacement,
): replacement is MaskingReplacement {
  return maskingEntityTypes.includes(
    replacement.type as MaskingReplacement['type'],
  );
}

export function applyExternalSafeTextPipeline(input: {
  text: string;
  documentId?: string;
  secretRules: SecretRule[];
  maskingEntries: MaskingEntry[];
  structuralMasker: ReturnType<typeof createStructuralSensitiveDataMasker>;
}): {
  maskedText: string;
  secretScan: ReturnType<typeof scanSecrets>;
  dictionaryReplacements: MaskingReplacement[];
  replacementCount: number;
} {
  const secretScan = scanSecrets(
    input.text,
    input.secretRules,
    input.documentId,
  );
  const dictionaryResult = maskText(
    secretScan.redactedText,
    input.maskingEntries,
  );
  const structuralResult = input.structuralMasker.maskText(
    dictionaryResult.maskedText,
  );

  return {
    maskedText: structuralResult.maskedText,
    secretScan,
    dictionaryReplacements: dictionaryResult.replacements,
    replacementCount:
      dictionaryResult.totalReplacementCount +
      structuralResult.replacementCount,
  };
}

export function createExternalPayloadPreview(input: {
  workspaceId: string;
  effectiveSecurity: EffectiveSecurity;
  model?: string | null;
  question: string;
  manualContexts: ExternalPreviewContextInput[];
  autoContexts: ExternalPreviewContextInput[];
  maskingEntries: MaskingEntry[];
  registryWorkspaces?: Workspace[];
  secretRules?: SecretRule[];
}): ExternalPayloadPreview {
  const documentsByKey = new Map<string, ExternalPreviewContextInput>();
  const toBudgetDocument = (
    document: ExternalPreviewContextInput,
    source: 'manual' | 'auto',
  ) => {
    const documentKey = createContextDocumentKey(document);

    documentsByKey.set(documentKey, document);

    return {
      documentKey,
      source,
      content: document.content,
      relevanceScore: document.relevanceScore ?? document.score,
    };
  };
  const contextBudget = buildContextBudget({
    profile: createContextProfile('openai', input.model ?? null),
    systemPrompt: '',
    question: input.question,
    manualDocuments: input.manualContexts.map((document) =>
      toBudgetDocument(document, 'manual'),
    ),
    autoDocuments: input.autoContexts.map((document) =>
      toBudgetDocument(document, 'auto'),
    ),
  });
  const contextDocuments = deduplicateContextDocuments(
    contextBudget.documents.flatMap((budgetedDocument) => {
      const document = documentsByKey.get(budgetedDocument.documentKey);

      return document
        ? [{ ...document, content: budgetedDocument.includedText }]
        : [];
    }),
    [],
  );

  if (
    process.env.NODE_ENV === 'development' ||
    import.meta.env.DEV
  ) {
    console.info('[Mimora Context Budget]', createContextBudgetSummary(contextBudget));
  }

  const effectiveMasking = createEffectiveMaskingEntries({
    entries: input.maskingEntries,
    currentWorkspaceId: input.workspaceId,
    question: input.question,
    documents: contextDocuments,
    registryWorkspaces: input.registryWorkspaces,
  });
  const secretRules = input.secretRules ?? [...builtInSecretRules];
  const structuralMasker = createStructuralSensitiveDataMasker();
  const questionResult = applyExternalSafeTextPipeline({
    text: input.question,
    secretRules,
    maskingEntries: effectiveMasking.entries,
    structuralMasker,
  });
  const documentResults = contextDocuments.map((document, index) => {
    const documentId = `DOCUMENT_${index + 1}`;
    const pipelineResult = applyExternalSafeTextPipeline({
      text: document.content,
      documentId,
      secretRules,
      maskingEntries: effectiveMasking.entries,
      structuralMasker,
    });

    return {
      document: {
        documentId,
        vaultId: document.vaultId,
        vaultName: document.vaultName,
        vaultType: document.vaultType,
        security: document.security,
        documentSecurity:
          document.documentSecurity ?? document.metadata?.security,
        relativePath: document.relativePath,
        fileName: document.fileName,
        metadata: document.metadata,
        originalChars: document.content.length,
        maskedContent: pipelineResult.maskedText,
        replacementCount: pipelineResult.replacementCount,
      },
      pipelineResult,
    };
  });
  const secretDetections = [
    ...questionResult.secretScan.detections,
    ...documentResults.flatMap(
      ({ pipelineResult }) => pipelineResult.secretScan.detections,
    ),
  ];
  const secretDetection: SecretDetectionResult = {
    detected: secretDetections.length > 0,
    detections: secretDetections,
    totalCount: secretDetections.reduce(
      (total, detection) => total + detection.count,
      0,
    ),
  };
  const documents = documentResults.map(({ document }) => document);
  const replacements = mergeReplacements([
    questionResult.dictionaryReplacements,
    ...documentResults.map(
      ({ pipelineResult }) => pipelineResult.dictionaryReplacements,
    ),
    structuralMasker.getReplacements(),
  ]);
  const responseUnmaskingSnapshot = replacements.flatMap((replacement) =>
    isDictionaryMaskingReplacement(replacement) &&
    (replacement.source === 'registry' || replacement.source === 'user')
      ? [
          {
            alias: replacement.alias,
            original: replacement.original,
            entityType: replacement.type,
          },
        ]
      : [],
  );
  const commonPreview = {
    workspaceId: input.workspaceId,
    effectiveSecurity: input.effectiveSecurity,
    maskingSummary: {
      ...effectiveMasking.summary,
      secretDetections: secretDetection.totalCount,
    },
    responseUnmaskingSnapshot,
    maskedQuestion: questionResult.maskedText,
    originalContextChars: contextDocuments.reduce(
      (total, document) => total + document.content.length,
      0,
    ),
    maskedContextChars: documents.reduce(
      (total, document) => total + document.maskedContent.length,
      0,
    ),
    documentCount: documents.length,
    documents,
    replacements,
    totalReplacementCount: replacements.reduce(
      (total, replacement) => total + replacement.count,
      0,
    ),
    secretDetection,
  };

  if (secretDetection.detected) {
    const remainingEntityIds = findRemainingRegisteredEntityIds(
      [questionResult.maskedText, ...documents.map((document) => document.maskedContent)],
      effectiveMasking.entries,
    );
    const registeredEntityCheck = {
      id: 'registered-entities',
      label: 'Registered entities masked',
      status: remainingEntityIds.length > 0 ? 'fail' as const : 'pass' as const,
      message:
        remainingEntityIds.length > 0
          ? `Registered entity remains in outbound payload (${remainingEntityIds.length}).`
          : '활성화된 등록 Entity의 원문이 남아 있지 않습니다.',
    };
    const safety: PayloadSafetyResult = {
      status: 'block',
      checks: [
        {
          id: 'secret-detected',
          label: 'Secret / Credential Detection',
          status: 'fail',
          message: 'Secret 또는 Credential 정보가 감지되어 외부 전송을 차단했습니다.',
        },
        registeredEntityCheck,
      ],
      blockers: [
        'secret-detected',
        ...(remainingEntityIds.length > 0 ? ['registered-entities'] : []),
      ],
      warnings: [],
    };

    return {
      ...commonPreview,
      externalText: '',
      safeToSend: false,
      status: 'block',
      blockers: safety.blockers,
      safety,
      secretDetection,
    };
  }

  const builtPayload = buildExternalPayloadText({
    maskedQuestion: questionResult.maskedText,
    maskedDocumentContents: documents.map((document) => document.maskedContent),
  });
  const safety = evaluateOutboundPayload({
    externalText: builtPayload.text,
    documents,
    maskingEntries: effectiveMasking.entries,
    effectiveSecurity: input.effectiveSecurity,
  });

  return {
    ...commonPreview,
    externalText: builtPayload.text,
    safeToSend: safety.status === 'pass',
    status: safety.status,
    blockers: safety.blockers,
    safety,
    secretDetection,
  };
}
