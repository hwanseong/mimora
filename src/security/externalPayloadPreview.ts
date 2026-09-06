import type { EffectiveSecurity } from './securityRouter';
import type { VaultSecurity, VaultType } from '../settings';
import {
  maskText,
  type MaskingEntry,
  type MaskingReplacement,
} from './maskingEngine';
import {
  createStructuralSensitiveDataMasker,
  type FilePathMaskingReplacement,
} from './structuralMasking';
import { buildExternalPayloadText } from './externalPayloadBuilder';
import {
  evaluateOutboundPayload,
  type PayloadSafetyResult,
  type PayloadSafetyStatus,
} from './outboundPayloadSafety';

export type ExternalPreviewDocument = {
  documentId: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
  originalChars: number;
  maskedContent: string;
  replacementCount: number;
};

export type ExternalMaskingReplacement =
  | MaskingReplacement
  | FilePathMaskingReplacement;

export type ExternalPayloadPreview = {
  workspaceId: string;
  effectiveSecurity: EffectiveSecurity;
  originalQuestion: string;
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
};

export type ExternalPreviewContextInput = {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  fileName: string;
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

export function createExternalPayloadPreview(input: {
  workspaceId: string;
  effectiveSecurity: EffectiveSecurity;
  question: string;
  manualContexts: ExternalPreviewContextInput[];
  autoContexts: ExternalPreviewContextInput[];
  maskingEntries: MaskingEntry[];
}): ExternalPayloadPreview {
  const contextDocuments = deduplicateContextDocuments(
    input.manualContexts,
    input.autoContexts,
  );
  const structuralMasker = createStructuralSensitiveDataMasker();
  const dictionaryQuestionResult = maskText(
    input.question,
    input.maskingEntries,
  );
  const questionResult = structuralMasker.maskText(
    dictionaryQuestionResult.maskedText,
  );
  const documentResults = contextDocuments.map((document) => {
    const dictionaryMaskingResult = maskText(
      document.content,
      input.maskingEntries,
    );
    const structuralMaskingResult = structuralMasker.maskText(
      dictionaryMaskingResult.maskedText,
    );

    return {
      document: {
        vaultId: document.vaultId,
        vaultName: document.vaultName,
        vaultType: document.vaultType,
        security: document.security,
        relativePath: document.relativePath,
        fileName: document.fileName,
        originalChars: document.content.length,
        maskedContent: structuralMaskingResult.maskedText,
        replacementCount:
          dictionaryMaskingResult.totalReplacementCount +
          structuralMaskingResult.replacementCount,
      },
      replacements: dictionaryMaskingResult.replacements,
    };
  });
  const builtPayload = buildExternalPayloadText({
    maskedQuestion: questionResult.maskedText,
    maskedDocumentContents: documentResults.map(
      (result) => result.document.maskedContent,
    ),
  });
  const documents = documentResults.map((result, index) => ({
    ...result.document,
    documentId: builtPayload.documents[index].documentId,
  }));
  const replacements = mergeReplacements([
    dictionaryQuestionResult.replacements,
    ...documentResults.map((result) => result.replacements),
    structuralMasker.getReplacements(),
  ]);
  const safety = evaluateOutboundPayload({
    externalText: builtPayload.text,
    documents,
    maskingEntries: input.maskingEntries,
    effectiveSecurity: input.effectiveSecurity,
  });

  return {
    workspaceId: input.workspaceId,
    effectiveSecurity: input.effectiveSecurity,
    originalQuestion: input.question,
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
    externalText: builtPayload.text,
    safeToSend: safety.status === 'pass',
    status: safety.status,
    blockers: safety.blockers,
    safety,
  };
}
