import {
  type DocumentMetadataValidationIssue,
  type MimoraMetadataFieldName,
} from './types';
import {
  isMimoraMetadataField,
  normalizeMarkdownText,
  normalizeMetadataFieldName,
} from './metadataUtils';

export type FrontmatterParseResult = {
  values: Map<MimoraMetadataFieldName, unknown>;
  hasFrontmatter: boolean;
  hasMetadata: boolean;
  body: string;
  issues: DocumentMetadataValidationIssue[];
};

type ParsedYamlValues = Map<string, unknown>;

function stripYamlComment(value: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\' && inDoubleQuote) {
      escaped = true;
      continue;
    }

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function parseQuotedScalar(value: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    return trimmedValue
      .slice(1, -1)
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, '\\');
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1).replace(/''/gu, "'");
  }

  return trimmedValue;
}

function splitInlineArray(value: string): string[] {
  const content = value.slice(1, -1);
  const items: string[] = [];
  let currentItem = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const character of content) {
    if (escaped) {
      currentItem += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && inDoubleQuote) {
      currentItem += character;
      escaped = true;
      continue;
    }

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentItem += character;
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentItem += character;
      continue;
    }

    if (character === ',' && !inSingleQuote && !inDoubleQuote) {
      items.push(currentItem);
      currentItem = '';
      continue;
    }

    currentItem += character;
  }

  items.push(currentItem);

  return items.map((item) => parseYamlScalar(item)).flat();
}

function parseYamlScalar(value: string): string | string[] {
  const trimmedValue = stripYamlComment(value).trim();

  if (!trimmedValue || trimmedValue === 'null' || trimmedValue === '~') {
    return '';
  }

  if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
    return splitInlineArray(trimmedValue);
  }

  return parseQuotedScalar(trimmedValue);
}

function parseYamlFrontmatterLines(lines: string[]): {
  values: ParsedYamlValues;
  error?: string;
} {
  const values: ParsedYamlValues = new Map();
  let currentListKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/gu, '  ');
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    if (/^\s+-\s*/u.test(line)) {
      if (!currentListKey) {
        return {
          values,
          error: 'Frontmatter list item does not belong to a property.',
        };
      }

      const existingValue = values.get(currentListKey);
      const listValue = Array.isArray(existingValue) ? existingValue : [];
      const itemValue = parseYamlScalar(trimmedLine.replace(/^-\s*/u, ''));

      values.set(
        currentListKey,
        Array.isArray(itemValue)
          ? [...listValue, ...itemValue]
          : [...listValue, itemValue],
      );
      continue;
    }

    if (/^\s+/u.test(line)) {
      return {
        values,
        error: 'Nested frontmatter values are not supported for Mimora metadata.',
      };
    }

    const keyValueMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u.exec(line);

    if (!keyValueMatch) {
      return {
        values,
        error: `Invalid frontmatter line: ${trimmedLine}`,
      };
    }

    const key = normalizeMetadataFieldName(keyValueMatch[1]);
    const rawValue = keyValueMatch[2] ?? '';
    const value = parseYamlScalar(rawValue);

    values.set(key, value);
    currentListKey = key;
  }

  return { values };
}

function extractMimoraMetadataFields(
  values: ParsedYamlValues,
): Map<MimoraMetadataFieldName, unknown> {
  const mimoraValues = new Map<MimoraMetadataFieldName, unknown>();

  for (const [field, value] of values.entries()) {
    if (isMimoraMetadataField(field)) {
      mimoraValues.set(field, value);
    }
  }

  return mimoraValues;
}

export function parseFrontmatterMetadata(markdown: string): FrontmatterParseResult {
  const normalizedMarkdown = normalizeMarkdownText(markdown);
  const leadingWhitespaceLength =
    normalizedMarkdown.length - normalizedMarkdown.trimStart().length;
  const markdownAfterLeadingWhitespace =
    normalizedMarkdown.slice(leadingWhitespaceLength);

  if (!markdownAfterLeadingWhitespace.startsWith('---\n')) {
    return {
      values: new Map(),
      hasFrontmatter: false,
      hasMetadata: false,
      body: normalizedMarkdown,
      issues: [],
    };
  }

  const lines = markdownAfterLeadingWhitespace.split('\n');
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );

  if (closingIndex === -1) {
    return {
      values: new Map(),
      hasFrontmatter: true,
      hasMetadata: false,
      body: normalizedMarkdown,
      issues: [
        {
          severity: 'warning',
          code: 'invalid_frontmatter',
          message: 'YAML frontmatter closing fence was not found.',
        },
      ],
    };
  }

  const parsedYaml = parseYamlFrontmatterLines(lines.slice(1, closingIndex));
  const body = lines.slice(closingIndex + 1).join('\n');

  if (parsedYaml.error) {
    return {
      values: new Map(),
      hasFrontmatter: true,
      hasMetadata: false,
      body,
      issues: [
        {
          severity: 'warning',
          code: 'invalid_frontmatter',
          message: parsedYaml.error,
        },
      ],
    };
  }

  const values = extractMimoraMetadataFields(parsedYaml.values);

  return {
    values,
    hasFrontmatter: true,
    hasMetadata: values.size > 0,
    body,
    issues: [],
  };
}
