import {
  mimoraMetadataFieldNames,
  type MimoraDocumentMetadata,
  type MimoraMetadataFieldName,
  type MimoraMetadataSource,
} from './types';

export function createEmptyMetadata(
  source: MimoraMetadataSource = 'none',
): MimoraDocumentMetadata {
  return {
    workspaceIds: [],
    knowledgeDomains: [],
    knowledgeTypes: [],
    source,
  };
}

export function normalizeMarkdownText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

export function normalizeCell(value: string): string {
  return value.replace(/^\uFEFF/u, '').trim();
}

export function normalizeMetadataFieldName(value: string): string {
  return normalizeCell(value).toLowerCase();
}

export function isMimoraMetadataField(
  value: string,
): value is MimoraMetadataFieldName {
  return mimoraMetadataFieldNames.includes(value as MimoraMetadataFieldName);
}

export function splitListValue(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function metadataValueToStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueValues(
      value.flatMap((item) => metadataValueToStringList(item)),
    );
  }

  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return splitListValue(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  return [];
}

export function metadataValueToSingleString(value: unknown): string | undefined {
  return metadataValueToStringList(value)[0];
}
