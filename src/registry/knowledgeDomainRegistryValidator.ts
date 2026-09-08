import type {
  KnowledgeDomain,
  KnowledgeDomainRegistryFrontmatter,
  KnowledgeDomainRegistryRow,
  KnowledgeRegistryValidationIssue,
} from './knowledgeDomainRegistryTypes';

function createIssue(
  issue: KnowledgeRegistryValidationIssue,
): KnowledgeRegistryValidationIssue {
  return issue;
}

export function normalizeKnowledgeDomainKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function splitAliases(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map(normalizeKnowledgeDomainKey)
        .filter(Boolean),
    ),
  ];
}

export function validateKnowledgeDomainRegistry({
  frontmatter,
  rows,
  validateFrontmatter = true,
}: {
  frontmatter: Partial<KnowledgeDomainRegistryFrontmatter>;
  rows: KnowledgeDomainRegistryRow[];
  validateFrontmatter?: boolean;
}): {
  registryVersion: number | null;
  domains: KnowledgeDomain[];
  issues: KnowledgeRegistryValidationIssue[];
} {
  const issues: KnowledgeRegistryValidationIssue[] = [];
  const domains: KnowledgeDomain[] = [];
  const seenCanonicalNames = new Map<string, KnowledgeDomainRegistryRow>();
  const canonicalNameKeys = new Map<string, string>();

  if (validateFrontmatter && frontmatter.registryType !== 'knowledge-domains') {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'invalid-registry-type',
        message: 'registry_type must be knowledge-domains.',
        field: 'registry_type',
      }),
    );
  }

  if (validateFrontmatter && frontmatter.registryVersion !== 1) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'unsupported-version',
        message: 'Unsupported Knowledge Domain Registry version.',
        field: 'registry_version',
      }),
    );
  }

  for (const row of rows) {
    const canonicalName = row.canonicalName.trim();
    const canonicalKey = normalizeKnowledgeDomainKey(canonicalName);

    if (canonicalName) {
      canonicalNameKeys.set(canonicalKey, canonicalName);
    }
  }

  for (const row of rows) {
    const rowIssues: KnowledgeRegistryValidationIssue[] = [];
    const canonicalName = row.canonicalName.trim();
    const canonicalKey = normalizeKnowledgeDomainKey(canonicalName);
    const rawAliases = row.aliases
      .split(',')
      .map(normalizeKnowledgeDomainKey)
      .filter(Boolean);
    const aliases = splitAliases(row.aliases);

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
        seenCanonicalNames.set(canonicalKey, row);
      }
    }

    if (rawAliases.length !== aliases.length) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'duplicate-alias',
          message: 'alias is duplicated.',
          row: row.rowNumber,
          canonicalName: canonicalName || undefined,
          field: 'aliases',
        }),
      );
    }

    for (const alias of aliases) {
      const conflictingCanonical = canonicalNameKeys.get(alias);

      if (
        conflictingCanonical &&
        normalizeKnowledgeDomainKey(conflictingCanonical) !== canonicalKey
      ) {
        rowIssues.push(
          createIssue({
            severity: 'error',
            code: 'alias-canonical-conflict',
            message: 'alias conflicts with another canonical_name.',
            row: row.rowNumber,
            canonicalName: canonicalName || undefined,
            field: 'aliases',
          }),
        );
      }
    }

    issues.push(...rowIssues);

    if (!rowIssues.some((issue) => issue.severity === 'error')) {
      domains.push({
        canonicalName,
        aliases,
        description: row.description.trim() || null,
      });
    }
  }

  if (rows.length === 0) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'knowledge-domain-table-not-found',
        message: 'Knowledge Domain Registry Markdown table was not found.',
      }),
    );
  }

  return {
    registryVersion:
      typeof frontmatter.registryVersion === 'number'
        ? frontmatter.registryVersion
        : null,
    domains,
    issues,
  };
}
