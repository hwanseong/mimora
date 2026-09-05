import type { EffectiveSecurity } from './securityRouter';
import type { VaultSecurity, VaultType } from '../settings';
import {
  maskText,
  type MaskingEntry,
  type MaskingReplacement,
} from './maskingEngine';

export type ExternalPayloadBlocker =
  | 'manual-review-required'
  | 'private-vault-context'
  | 'sensitive-context'
  | 'unmasked-data-possible';

export type ExternalPreviewDocument = {
  documentId: string;
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
  originalChars: number;
  maskedContent: string;
  replacementCount: number;
};

export type ExternalPayloadPreview = {
  workspaceId: string;
  effectiveSecurity: EffectiveSecurity;
  originalQuestion: string;
  maskedQuestion: string;
  originalContextChars: number;
  maskedContextChars: number;
  documentCount: number;
  documents: ExternalPreviewDocument[];
  replacements: MaskingReplacement[];
  totalReplacementCount: number;
  externalText: string;
  safeToSend: false;
  status: 'review-required';
  blockers: ExternalPayloadBlocker[];
};

export type ExternalPreviewContextInput = {
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  relativePath: string;
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
  replacementGroups: MaskingReplacement[][],
): MaskingReplacement[] {
  const replacements = new Map<string, MaskingReplacement>();

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
  const questionResult = maskText(input.question, input.maskingEntries);
  const documentResults = contextDocuments.map((document, index) => {
    const maskingResult = maskText(document.content, input.maskingEntries);

    return {
      document: {
        documentId: `DOCUMENT_${index + 1}`,
        vaultId: document.vaultId,
        vaultName: document.vaultName,
        vaultType: document.vaultType,
        security: document.security,
        relativePath: document.relativePath,
        originalChars: document.content.length,
        maskedContent: maskingResult.maskedText,
        replacementCount: maskingResult.totalReplacementCount,
      },
      replacements: maskingResult.replacements,
    };
  });
  const documents = documentResults.map((result) => result.document);
  const replacements = mergeReplacements([
    questionResult.replacements,
    ...documentResults.map((result) => result.replacements),
  ]);
  const externalContext = documents
    .map(
      (document) =>
        `[${document.documentId}]\n${document.maskedContent}\n[/${document.documentId}]`,
    )
    .join('\n\n');
  const externalText = `<Project Context>\n${
    externalContext || 'No project context was provided.'
  }\n</Project Context>\n\n<User Question>\n${
    questionResult.maskedText
  }\n</User Question>`;
  const blockers: ExternalPayloadBlocker[] = [
    'manual-review-required',
    'unmasked-data-possible',
  ];

  if (documents.some((document) => document.vaultType === 'private')) {
    blockers.push('private-vault-context');
  }

  if (documents.some((document) => document.security === 'sensitive')) {
    blockers.push('sensitive-context');
  }

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
    externalText,
    safeToSend: false,
    status: 'review-required',
    blockers,
  };
}
