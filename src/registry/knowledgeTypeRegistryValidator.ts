import type {
  KnowledgeType,
  KnowledgeTypeRegistryFrontmatter,
  KnowledgeTypeRegistryRow,
  KnowledgeTypeRegistryValidationIssue,
} from './knowledgeTypeRegistryTypes';

function createIssue(
  issue: KnowledgeTypeRegistryValidationIssue,
): KnowledgeTypeRegistryValidationIssue {
  return issue;
}

export function normalizeKnowledgeTypeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function validateKnowledgeTypeRegistry({
  frontmatter,
  rows,
  validateFrontmatter = true,
}: {
  frontmatter: Partial<KnowledgeTypeRegistryFrontmatter>;
  rows: KnowledgeTypeRegistryRow[];
  validateFrontmatter?: boolean;
}): {
  registryVersion: number | null;
  types: KnowledgeType[];
  issues: KnowledgeTypeRegistryValidationIssue[];
} {
  const issues: KnowledgeTypeRegistryValidationIssue[] = [];
  const types: KnowledgeType[] = [];
  const seenCanonicalNames = new Set<string>();

  if (validateFrontmatter && frontmatter.registryType !== 'knowledge-types') {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'invalid-registry-type',
        message: 'registry_type must be knowledge-types.',
        field: 'registry_type',
      }),
    );
  }

  if (validateFrontmatter && frontmatter.registryVersion !== 1) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'unsupported-version',
        message: 'Unsupported Knowledge Type Registry version.',
        field: 'registry_version',
      }),
    );
  }

  for (const row of rows) {
    const rowIssues: KnowledgeTypeRegistryValidationIssue[] = [];
    const canonicalName = row.canonicalName.trim();
    const canonicalKey = normalizeKnowledgeTypeKey(canonicalName);

    if (!canonicalName) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'required-field-missing',
          message: 'canonical_name is required.',
          row: row.rowNumber,
          field: 'canonical_name',
        }),
      );
    }

    if (canonicalName) {
      if (seenCanonicalNames.has(canonicalKey)) {
        rowIssues.push(
          createIssue({
            severity: 'error',
            code: 'duplicate-canonical-name',
            message: 'canonical_name is duplicated.',
            row: row.rowNumber,
            canonicalName,
            field: 'canonical_name',
          }),
        );
      } else {
        seenCanonicalNames.add(canonicalKey);
      }
    }

    issues.push(...rowIssues);

    if (!rowIssues.some((issue) => issue.severity === 'error')) {
      types.push({
        canonicalName,
        description: row.description.trim() || null,
      });
    }
  }

  if (rows.length === 0) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'knowledge-type-table-not-found',
        message: 'Knowledge Type Registry Markdown table was not found.',
      }),
    );
  }

  return {
    registryVersion:
      typeof frontmatter.registryVersion === 'number'
        ? frontmatter.registryVersion
        : null,
    types,
    issues,
  };
}
