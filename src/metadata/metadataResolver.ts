import {
  type DocumentMetadataValidationIssue,
  type MimoraMetadataFieldName,
  type MimoraMetadataSource,
} from './types';
import { metadataValueToStringList } from './metadataUtils';

export type RawMetadataValues = Map<MimoraMetadataFieldName, unknown>;

export type MetadataResolverInput = {
  frontmatterValues: RawMetadataValues;
  legacyValues: RawMetadataValues;
  hasFrontmatterMetadata: boolean;
  hasLegacyMetadata: boolean;
};

export type MetadataResolverResult = {
  values: RawMetadataValues;
  source: MimoraMetadataSource;
  hasMetadata: boolean;
  issues: DocumentMetadataValidationIssue[];
};

const unorderedArrayFields = new Set<MimoraMetadataFieldName>([
  'workspace_ids',
  'knowledge_domains',
  'knowledge_type',
]);

function canonicalizeValue(
  field: MimoraMetadataFieldName,
  value: unknown,
): string {
  const values = metadataValueToStringList(value);
  const canonicalValues = unorderedArrayFields.has(field)
    ? [...values].sort()
    : values;

  return JSON.stringify(canonicalValues);
}

function valuesConflict(
  field: MimoraMetadataFieldName,
  frontmatterValue: unknown,
  legacyValue: unknown,
): boolean {
  return (
    canonicalizeValue(field, frontmatterValue) !==
    canonicalizeValue(field, legacyValue)
  );
}

function createConflictIssue(
  field: MimoraMetadataFieldName,
  yamlValue: unknown,
  legacyValue: unknown,
): DocumentMetadataValidationIssue {
  return {
    severity: 'warning',
    code: 'metadata_conflict',
    message: `Metadata conflict on ${field}. YAML frontmatter value was selected.`,
    field,
    details: {
      field,
      yamlValue,
      legacyValue,
      selectedValue: yamlValue,
    },
  };
}

export function resolveMetadataSources(
  input: MetadataResolverInput,
): MetadataResolverResult {
  const values: RawMetadataValues = new Map();
  const issues: DocumentMetadataValidationIssue[] = [];
  const fields = new Set<MimoraMetadataFieldName>([
    ...input.frontmatterValues.keys(),
    ...input.legacyValues.keys(),
  ]);

  for (const field of fields) {
    const hasFrontmatterValue = input.frontmatterValues.has(field);
    const hasLegacyValue = input.legacyValues.has(field);

    if (hasFrontmatterValue) {
      const frontmatterValue = input.frontmatterValues.get(field);

      values.set(field, frontmatterValue);

      if (
        hasLegacyValue &&
        valuesConflict(field, frontmatterValue, input.legacyValues.get(field))
      ) {
        issues.push(
          createConflictIssue(
            field,
            frontmatterValue,
            input.legacyValues.get(field),
          ),
        );
      }

      continue;
    }

    if (hasLegacyValue) {
      values.set(field, input.legacyValues.get(field));
    }
  }

  const hasFrontmatterMetadata = input.hasFrontmatterMetadata;
  const hasLegacyMetadata = input.hasLegacyMetadata;
  const source: MimoraMetadataSource =
    hasFrontmatterMetadata && hasLegacyMetadata
      ? 'mixed'
      : hasFrontmatterMetadata
        ? 'frontmatter'
        : hasLegacyMetadata
          ? 'legacy'
          : 'none';

  return {
    values,
    source,
    hasMetadata: hasFrontmatterMetadata || hasLegacyMetadata,
    issues,
  };
}
