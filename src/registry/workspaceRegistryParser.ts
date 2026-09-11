import { validateWorkspaceRegistry } from './workspaceRegistryValidator';
import type {
  WorkspaceRegistryFrontmatter,
  WorkspaceRegistryParseResult,
  WorkspaceRegistryRow,
  WorkspaceRegistryValidationIssue,
} from './workspaceRegistryTypes';

const requiredHeaders = [
  'id',
  'name',
  'type',
  'status',
  'description',
] as const;
const optionalHeaders = ['security', 'start_date', 'end_date'] as const;

type WorkspaceRegistryHeader =
  | (typeof requiredHeaders)[number]
  | (typeof optionalHeaders)[number];

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
  frontmatter: Partial<WorkspaceRegistryFrontmatter>;
  bodyStartLine: number;
  issues: WorkspaceRegistryValidationIssue[];
  valid: boolean;
} {
  const lines = normalizeMarkdownText(markdown).split('\n');
  const issues: WorkspaceRegistryValidationIssue[] = [];
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentLineIndex === -1 || lines[firstContentLineIndex]?.trim() !== '---') {
    issues.push({
      severity: 'error',
      code: 'frontmatter-missing',
      message: 'Workspace Registry frontmatter가 없습니다.',
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
      message: 'Workspace Registry frontmatter가 닫히지 않았습니다.',
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
        rawFrontmatter.registry_type === 'workspaces'
          ? 'workspaces'
          : (rawFrontmatter.registry_type as 'workspaces' | undefined),
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
  return value.replace(/^\uFEFF/u, '').trim().toLowerCase();
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

function findWorkspaceTable(lines: string[]): {
  headerIndex: number;
  headerMap: Map<WorkspaceRegistryHeader, number>;
} | null {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !isSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headers = splitMarkdownTableRow(lines[index]).map(normalizeHeader);
    const headerMap = new Map<WorkspaceRegistryHeader, number>();

    for (const requiredHeader of requiredHeaders) {
      const headerIndex = headers.indexOf(requiredHeader);

      if (headerIndex === -1) {
        break;
      }

      headerMap.set(requiredHeader, headerIndex);
    }

    for (const optionalHeader of optionalHeaders) {
      const headerIndex = headers.indexOf(optionalHeader);

      if (headerIndex !== -1) {
        headerMap.set(optionalHeader, headerIndex);
      }
    }

    if (requiredHeaders.every((requiredHeader) => headerMap.has(requiredHeader))) {
      return {
        headerIndex: index,
        headerMap,
      };
    }
  }

  return null;
}

function parseWorkspaceRows(
  lines: string[],
  bodyStartLine: number,
): WorkspaceRegistryRow[] {
  const table = findWorkspaceTable(lines.slice(bodyStartLine));

  if (!table) {
    return [];
  }

  const headerIndex = table.headerIndex + bodyStartLine;
  const rows: WorkspaceRegistryRow[] = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.includes('|')) {
      break;
    }

    const cells = splitMarkdownTableRow(line);
    const getCell = (header: WorkspaceRegistryHeader): string => {
      const headerIndex = table.headerMap.get(header);
      return headerIndex === undefined ? '' : (cells[headerIndex] ?? '').trim();
    };

    rows.push({
      id: getCell('id'),
      name: getCell('name'),
      type: getCell('type'),
      status: getCell('status'),
      security: getCell('security'),
      startDate: getCell('start_date'),
      endDate: getCell('end_date'),
      description: getCell('description'),
      rowNumber: index + 1,
    });
  }

  return rows;
}

export function parseWorkspaceRegistry(
  markdown: string,
): WorkspaceRegistryParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const lines = normalizedMarkdown.split('\n');
  const frontmatterResult = parseFrontmatter(markdown);
  const rows = parseWorkspaceRows(lines, frontmatterResult.bodyStartLine);
  const validationResult = validateWorkspaceRegistry({
    frontmatter: frontmatterResult.frontmatter,
    rows,
    validateFrontmatter: frontmatterResult.valid,
  });
  const issues = [...frontmatterResult.issues, ...validationResult.issues];
  const valid = !issues.some((issue) => issue.severity === 'error');

  return {
    state: valid ? 'loaded' : 'loaded-with-errors',
    registryVersion: validationResult.registryVersion,
    workspaces: validationResult.workspaces,
    issues,
    valid,
  };
}
