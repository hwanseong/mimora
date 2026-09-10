import {
  type DocumentMetadataValidationIssue,
  type MimoraMetadataFieldName,
} from './types';
import {
  isMimoraMetadataField,
  normalizeCell,
  normalizeMarkdownText,
  normalizeMetadataFieldName,
} from './metadataUtils';

const metadataHeading = '## Mimora Metadata';

export type LegacyMetadataParseResult = {
  values: Map<MimoraMetadataFieldName, string>;
  hasMetadataHeading: boolean;
  hasMetadata: boolean;
  body: string;
  issues: DocumentMetadataValidationIssue[];
};

function splitMarkdownTableRow(line: string): string[] {
  const withoutOuterPipes = line
    .trim()
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
      cells.push(normalizeCell(currentCell));
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  cells.push(normalizeCell(currentCell));
  return cells;
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

function parseMetadataRows(lines: string[], headingIndex: number): {
  values: Map<MimoraMetadataFieldName, string>;
  tableEndIndex: number;
} | null {
  for (let index = headingIndex + 1; index < lines.length - 1; index += 1) {
    const line = lines[index];

    if (index > headingIndex + 1 && /^#{1,6}\s+/u.test(line.trim())) {
      return null;
    }

    if (!line.includes('|') || !isSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headers = splitMarkdownTableRow(line).map(normalizeMetadataFieldName);
    const fieldColumn = headers.indexOf('field');
    const valueColumn = headers.indexOf('value');

    if (fieldColumn === -1 || valueColumn === -1) {
      continue;
    }

    const values = new Map<MimoraMetadataFieldName, string>();
    let tableEndIndex = index + 1;

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex];

      if (!row.includes('|')) {
        break;
      }

      const cells = splitMarkdownTableRow(row);
      const field = normalizeMetadataFieldName(cells[fieldColumn] ?? '');
      const value = normalizeCell(cells[valueColumn] ?? '');

      if (isMimoraMetadataField(field)) {
        values.set(field, value);
      }

      tableEndIndex = rowIndex;
    }

    return {
      values,
      tableEndIndex,
    };
  }

  return null;
}

function findMetadataTables(
  lines: string[],
): Array<{
  headingIndex: number;
  values: Map<MimoraMetadataFieldName, string>;
  tableEndIndex: number;
}> {
  return lines.flatMap((line, index) => {
    if (line.trim() !== metadataHeading) {
      return [];
    }

    const table = parseMetadataRows(lines, index);

    return table ? [{ headingIndex: index, ...table }] : [];
  });
}

function createBodyWithoutMetadata(
  lines: string[],
  headingIndex: number,
  tableEndIndex: number,
): string {
  return [
    ...lines.slice(0, headingIndex),
    ...lines.slice(tableEndIndex + 1),
  ].join('\n');
}

export function parseLegacyMetadataTable(
  markdown: string,
): LegacyMetadataParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const lines = normalizedMarkdown.split('\n');
  const hasMetadataHeading = lines.some(
    (line) => line.trim() === metadataHeading,
  );

  if (!hasMetadataHeading) {
    return {
      values: new Map(),
      hasMetadataHeading: false,
      hasMetadata: false,
      body: normalizedMarkdown,
      issues: [],
    };
  }

  const metadataTables = findMetadataTables(lines);
  const table = metadataTables.at(-1) ?? null;

  if (!table) {
    return {
      values: new Map(),
      hasMetadataHeading: true,
      hasMetadata: true,
      body: normalizedMarkdown,
      issues: [
        {
          severity: 'error',
          code: 'metadata_table_not_found',
          message: 'Mimora Metadata Markdown table was not found.',
        },
      ],
    };
  }

  return {
    values: table.values,
    hasMetadataHeading: true,
    hasMetadata: true,
    body: createBodyWithoutMetadata(
      lines,
      table.headingIndex,
      table.tableEndIndex,
    ),
    issues: [],
  };
}
