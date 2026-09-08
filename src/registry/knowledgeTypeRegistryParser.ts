import {
  normalizeKnowledgeTypeKey,
  validateKnowledgeTypeRegistry,
} from './knowledgeTypeRegistryValidator';
import type {
  KnowledgeTypeRegistry,
  KnowledgeTypeRegistryFrontmatter,
  KnowledgeTypeRegistryParseResult,
  KnowledgeTypeRegistryRow,
  KnowledgeTypeRegistryValidationIssue,
} from './knowledgeTypeRegistryTypes';

const requiredHeaders = ['canonical_name', 'description'] as const;
type KnowledgeTypeHeader = (typeof requiredHeaders)[number];

function normalizeMarkdownText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

function stripWrappingQuotes(value: string): string {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1).trim();
  }

  return trimmedValue;
}

function parseFrontmatter(markdown: string): {
  frontmatter: Partial<KnowledgeTypeRegistryFrontmatter>;
  bodyStartLine: number;
  issues: KnowledgeTypeRegistryValidationIssue[];
  valid: boolean;
} {
  const lines = normalizeMarkdownText(markdown).split('\n');
  const issues: KnowledgeTypeRegistryValidationIssue[] = [];
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentLineIndex === -1 || lines[firstContentLineIndex]?.trim() !== '---') {
    issues.push({
      severity: 'error',
      code: 'frontmatter-missing',
      message: 'Knowledge Type Registry frontmatter is missing.',
    });

    return {
      frontmatter: {},
      bodyStartLine: 0,
      issues,
      valid: false,
    };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > firstContentLineIndex && line.trim() === '---',
  );

  if (closingIndex === -1) {
    issues.push({
      severity: 'error',
      code: 'frontmatter-not-closed',
      message: 'Knowledge Type Registry frontmatter is not closed.',
    });

    return {
      frontmatter: {},
      bodyStartLine: firstContentLineIndex + 1,
      issues,
      valid: false,
    };
  }

  const rawFrontmatter: Record<string, string> = {};

  for (let index = firstContentLineIndex + 1; index < closingIndex; index += 1) {
    const line = lines[index];
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1));

    rawFrontmatter[key] = value;
  }

  const registryVersion = Number(rawFrontmatter.registry_version);

  return {
    frontmatter: {
      registryType:
        rawFrontmatter.registry_type === 'knowledge-types'
          ? 'knowledge-types'
          : (rawFrontmatter.registry_type as 'knowledge-types' | undefined),
      registryVersion: Number.isFinite(registryVersion)
        ? registryVersion
        : undefined,
    },
    bodyStartLine: closingIndex + 1,
    issues,
    valid: true,
  };
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmedLine = line.trim();
  const withoutOuterPipes = trimmedLine
    .replace(/^\|/u, '')
    .replace(/\|$/u, '');
  const cells: string[] = [];
  let currentCell = '';
  let escaped = false;

  for (const character of withoutOuterPipes) {
    if (escaped) {
      currentCell += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '|') {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  cells.push(currentCell.trim());

  return cells;
}

function normalizeHeader(value: string): string {
  const normalized = value.replace(/^\uFEFF/u, '').trim().toLowerCase();

  return normalized === '설명' ? 'description' : normalized;
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes('|')) {
    return false;
  }

  const cells = splitMarkdownTableRow(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
  );
}

function findKnowledgeTypeTable(lines: string[]): {
  headerIndex: number;
  headerMap: Map<KnowledgeTypeHeader, number>;
} | null {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !isSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headers = splitMarkdownTableRow(lines[index]).map(normalizeHeader);
    const headerMap = new Map<KnowledgeTypeHeader, number>();

    for (const requiredHeader of requiredHeaders) {
      const headerIndex = headers.indexOf(requiredHeader);

      if (headerIndex === -1) {
        break;
      }

      headerMap.set(requiredHeader, headerIndex);
    }

    if (headerMap.size === requiredHeaders.length) {
      return {
        headerIndex: index,
        headerMap,
      };
    }
  }

  return null;
}

function parseKnowledgeTypeRows(
  lines: string[],
  bodyStartLine: number,
): KnowledgeTypeRegistryRow[] {
  const table = findKnowledgeTypeTable(lines.slice(bodyStartLine));

  if (!table) {
    return [];
  }

  const headerIndex = table.headerIndex + bodyStartLine;
  const rows: KnowledgeTypeRegistryRow[] = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.includes('|')) {
      break;
    }

    const cells = splitMarkdownTableRow(line);
    const getCell = (header: KnowledgeTypeHeader): string => {
      const headerIndex = table.headerMap.get(header);
      return headerIndex === undefined ? '' : (cells[headerIndex] ?? '').trim();
    };

    rows.push({
      canonicalName: getCell('canonical_name'),
      description: getCell('description'),
      rowNumber: index + 1,
    });
  }

  return rows;
}

export function parseKnowledgeTypeRegistry(
  markdown: string,
): KnowledgeTypeRegistryParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const lines = normalizedMarkdown.split('\n');
  const frontmatterResult = parseFrontmatter(markdown);
  const rows = parseKnowledgeTypeRows(lines, frontmatterResult.bodyStartLine);
  const validationResult = validateKnowledgeTypeRegistry({
    frontmatter: frontmatterResult.frontmatter,
    rows,
    validateFrontmatter: frontmatterResult.valid,
  });
  const issues = [...frontmatterResult.issues, ...validationResult.issues];
  const valid = !issues.some((issue) => issue.severity === 'error');
  const registry =
    validationResult.registryVersion === null
      ? null
      : {
          version: validationResult.registryVersion,
          types: validationResult.types,
        };

  return {
    state: valid ? 'loaded' : 'loaded-with-errors',
    registryVersion: validationResult.registryVersion,
    registry,
    types: validationResult.types,
    issues,
    valid,
  };
}

export function resolveKnowledgeType(
  value: string,
  registry: KnowledgeTypeRegistry,
): string | null {
  const normalizedInput = normalizeKnowledgeTypeKey(value);
  const type = registry.types.find(
    (item) => normalizeKnowledgeTypeKey(item.canonicalName) === normalizedInput,
  );

  return type?.canonicalName ?? null;
}
