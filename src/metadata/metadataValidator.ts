import { workspaceIdPattern } from '../workspace/types';
import {
  resolveKnowledgeDomain,
} from '../registry/knowledgeDomainRegistryParser';
import type { KnowledgeDomainRegistry } from '../registry/knowledgeDomainRegistryTypes';
import {
  resolveKnowledgeType,
} from '../registry/knowledgeTypeRegistryParser';
import type { KnowledgeTypeRegistry } from '../registry/knowledgeTypeRegistryTypes';
import {
  documentIdPattern,
  type ContentOrigin,
  type DocumentMetadataValidationIssue,
  type DocumentSecurity,
  type MimoraDocumentMetadata,
  type MimoraMetadataSource,
} from './types';
import type { RawMetadataValues } from './metadataResolver';
import {
  createEmptyMetadata,
  metadataValueToSingleString,
  metadataValueToStringList,
  uniqueValues,
} from './metadataUtils';

const documentSecurityOptions = ['normal', 'private', 'internal'] as const;
const contentOriginOptions = ['human', 'ai-derived'] as const;

export type MetadataValidationOptions = {
  knownWorkspaceIds?: Iterable<string>;
  knowledgeDomainRegistry?: KnowledgeDomainRegistry | null;
  knowledgeTypeRegistry?: KnowledgeTypeRegistry | null;
  knowledgeDomainRegistryUnavailable?: boolean;
  knowledgeTypeRegistryUnavailable?: boolean;
};

export type MetadataValidationInput = MetadataValidationOptions & {
  values: RawMetadataValues;
  source: MimoraMetadataSource;
  hasMetadata: boolean;
};

export type MetadataValidationResult = {
  metadata: MimoraDocumentMetadata;
  issues: DocumentMetadataValidationIssue[];
};

function getKnownWorkspaceIdSet(
  knownWorkspaceIds?: Iterable<string>,
): Set<string> | null {
  return knownWorkspaceIds ? new Set(knownWorkspaceIds) : null;
}

function isDocumentSecurity(value: string): value is DocumentSecurity {
  return documentSecurityOptions.includes(value as DocumentSecurity);
}

function isContentOrigin(value: string): value is ContentOrigin {
  return contentOriginOptions.includes(value as ContentOrigin);
}

function validateWorkspaceReference(input: {
  workspaceId: string;
  field: string;
  knownWorkspaceIds: Set<string> | null;
  documentId?: string;
  issues: DocumentMetadataValidationIssue[];
}): void {
  if (!workspaceIdPattern.test(input.workspaceId)) {
    input.issues.push({
      severity: 'error',
      code: 'invalid_workspace_id',
      message: 'Workspace ID must use WS-YYYY-NNNN format.',
      field: input.field,
      documentId: input.documentId,
    });
    return;
  }

  if (input.knownWorkspaceIds && !input.knownWorkspaceIds.has(input.workspaceId)) {
    input.issues.push({
      severity: 'warning',
      code: 'unknown_workspace_id',
      message: 'Workspace ID was not found in the Workspace Registry.',
      field: input.field,
      documentId: input.documentId,
    });
  }
}

export function validateResolvedMetadata(
  input: MetadataValidationInput,
): MetadataValidationResult {
  const metadata = createEmptyMetadata(input.source);
  const issues: DocumentMetadataValidationIssue[] = [];
  const knownWorkspaceIds = getKnownWorkspaceIdSet(input.knownWorkspaceIds);
  const documentId = metadataValueToSingleString(
    input.values.get('document_id'),
  )?.trim();

  if (documentId) {
    metadata.documentId = documentId;

    if (!documentIdPattern.test(documentId)) {
      issues.push({
        severity: 'error',
        code: 'invalid_document_id',
        message: 'document_id must use DOC-YYYY-NNNN format.',
        field: 'document_id',
        documentId,
      });
    }
  } else if (input.hasMetadata) {
    issues.push({
      severity: 'warning',
      code: 'missing_document_id',
      message: 'document_id is missing.',
      field: 'document_id',
    });
  }

  const rawWorkspaceIds = metadataValueToStringList(
    input.values.get('workspace_ids'),
  );
  metadata.workspaceIds = uniqueValues(rawWorkspaceIds);

  if (rawWorkspaceIds.length !== metadata.workspaceIds.length) {
    issues.push({
      severity: 'warning',
      code: 'duplicate_workspace_id',
      message: 'workspace_ids contains duplicate Workspace IDs.',
      field: 'workspace_ids',
      documentId,
    });
  }

  for (const workspaceId of metadata.workspaceIds) {
    validateWorkspaceReference({
      workspaceId,
      field: 'workspace_ids',
      knownWorkspaceIds,
      documentId,
      issues,
    });
  }

  const originWorkspaceId = metadataValueToSingleString(
    input.values.get('origin_workspace_id'),
  )?.trim();

  if (originWorkspaceId) {
    metadata.originWorkspaceId = originWorkspaceId;
    validateWorkspaceReference({
      workspaceId: originWorkspaceId,
      field: 'origin_workspace_id',
      knownWorkspaceIds,
      documentId,
      issues,
    });

    if (!metadata.workspaceIds.includes(originWorkspaceId)) {
      issues.push({
        severity: 'warning',
        code: 'origin_not_in_workspace_ids',
        message: 'origin_workspace_id is not included in workspace_ids.',
        field: 'origin_workspace_id',
        documentId,
      });
    }
  }

  const rawKnowledgeDomains = metadataValueToStringList(
    input.values.get('knowledge_domains'),
  );
  metadata.rawKnowledgeDomains = rawKnowledgeDomains;

  if (input.knowledgeDomainRegistry) {
    const normalizedDomains: string[] = [];

    for (const rawKnowledgeDomain of rawKnowledgeDomains) {
      const resolvedDomain = resolveKnowledgeDomain(
        rawKnowledgeDomain,
        input.knowledgeDomainRegistry,
      );

      if (resolvedDomain.canonicalName) {
        normalizedDomains.push(resolvedDomain.canonicalName);
      } else {
        issues.push({
          severity: 'warning',
          code: 'unknown_knowledge_domain',
          message: `Unknown Knowledge Domain: ${rawKnowledgeDomain}`,
          field: 'knowledge_domains',
          documentId,
        });
      }
    }

    metadata.knowledgeDomains = uniqueValues(normalizedDomains);

    if (metadata.knowledgeDomains.length !== normalizedDomains.length) {
      issues.push({
        severity: 'warning',
        code: 'duplicate_normalized_domain',
        message: 'Multiple knowledge_domains values resolved to the same canonical domain.',
        field: 'knowledge_domains',
        documentId,
      });
    }
  } else {
    metadata.knowledgeDomains = rawKnowledgeDomains;

    if (
      input.knowledgeDomainRegistryUnavailable &&
      rawKnowledgeDomains.length > 0
    ) {
      issues.push({
        severity: 'warning',
        code: 'knowledge_domain_registry_unavailable',
        message: 'Knowledge Domain Registry is unavailable; raw domain values are used.',
        field: 'knowledge_domains',
        documentId,
      });
    }
  }

  const rawKnowledgeTypes = metadataValueToStringList(
    input.values.get('knowledge_type'),
  );
  metadata.rawKnowledgeTypes = rawKnowledgeTypes;

  if (input.knowledgeTypeRegistry) {
    const normalizedTypes: string[] = [];

    for (const rawKnowledgeType of rawKnowledgeTypes) {
      const resolvedType = resolveKnowledgeType(
        rawKnowledgeType,
        input.knowledgeTypeRegistry,
      );

      if (resolvedType) {
        normalizedTypes.push(resolvedType);
      } else {
        issues.push({
          severity: 'warning',
          code: 'unknown_knowledge_type',
          message: `Unknown Knowledge Type: ${rawKnowledgeType}`,
          field: 'knowledge_type',
          documentId,
        });
      }
    }

    metadata.knowledgeTypes = uniqueValues(normalizedTypes);
  } else {
    metadata.knowledgeTypes = rawKnowledgeTypes;

    if (
      input.knowledgeTypeRegistryUnavailable &&
      rawKnowledgeTypes.length > 0
    ) {
      issues.push({
        severity: 'warning',
        code: 'knowledge_type_registry_unavailable',
        message: 'Knowledge Type Registry is unavailable; raw type values are used.',
        field: 'knowledge_type',
        documentId,
      });
    }
  }

  const security = metadataValueToSingleString(input.values.get('security'));

  if (security) {
    if (isDocumentSecurity(security)) {
      metadata.security = security;
    } else {
      issues.push({
        severity: 'error',
        code: 'invalid_security',
        message: 'security must be normal, private, or internal.',
        field: 'security',
        documentId,
      });
    }
  }

  const contentOrigin = metadataValueToSingleString(
    input.values.get('content_origin'),
  );

  if (contentOrigin) {
    if (isContentOrigin(contentOrigin)) {
      metadata.contentOrigin = contentOrigin;
    } else {
      issues.push({
        severity: 'error',
        code: 'invalid_content_origin',
        message: 'content_origin must be human or ai-derived.',
        field: 'content_origin',
        documentId,
      });
    }
  }

  return { metadata, issues };
}
