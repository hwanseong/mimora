import {
  maskingEntityTypes,
  type MaskingEntityType,
  type MaskingEntry,
} from './maskingEngine';

export type UnmaskingReplacement = {
  alias: string;
  entityType: MaskingEntityType;
  count: number;
};

export type UnmaskingResult = {
  maskedText: string;
  displayText: string;
  replacements: UnmaskingReplacement[];
  replacementCount: number;
};

export type ResponseUnmaskingSnapshotEntry = {
  alias: string;
  original: string;
  entityType: MaskingEntityType;
};

export type ResponseUnmaskingProvider = 'local' | 'openai';

function createUnchangedResult(text: string): UnmaskingResult {
  return {
    maskedText: text,
    displayText: text,
    replacements: [],
    replacementCount: 0,
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRestorableAlias(
  alias: string,
  entityType: MaskingEntityType,
): boolean {
  const expectedPrefix = entityType.toUpperCase();
  return new RegExp(`^${expectedPrefix}_\\d+$`, 'u').test(alias);
}

function isMarkdownLinkLabel(
  text: string,
  matchStart: number,
  matchLength: number,
): boolean {
  const matchEnd = matchStart + matchLength;

  return (
    text[matchEnd] === '(' ||
    (text[matchStart - 1] === '[' && text[matchEnd] === ']')
  );
}

export function createResponseUnmaskingSnapshot(
  maskingEntries: MaskingEntry[],
  usedAliases?: Iterable<string>,
): ResponseUnmaskingSnapshotEntry[] {
  const usedAliasSet = usedAliases ? new Set(usedAliases) : null;
  const seenAliases = new Set<string>();

  return maskingEntries.flatMap((entry) => {
    if (
      !entry.enabled ||
      !entry.value.trim() ||
      !isRestorableAlias(entry.alias, entry.type) ||
      (usedAliasSet && !usedAliasSet.has(entry.alias)) ||
      seenAliases.has(entry.alias)
    ) {
      return [];
    }

    seenAliases.add(entry.alias);
    return [
      {
        alias: entry.alias,
        original: entry.value,
        entityType: entry.type,
      },
    ];
  });
}

export function unmaskExternalResponseFromSnapshot(
  text: string,
  snapshot: ResponseUnmaskingSnapshotEntry[],
): UnmaskingResult {
  const mappingsByAlias = new Map<string, ResponseUnmaskingSnapshotEntry>();

  for (const mapping of snapshot) {
    if (
      maskingEntityTypes.includes(mapping.entityType) &&
      mapping.original.trim() &&
      isRestorableAlias(mapping.alias, mapping.entityType) &&
      !mappingsByAlias.has(mapping.alias)
    ) {
      mappingsByAlias.set(mapping.alias, mapping);
    }
  }

  if (!text || mappingsByAlias.size === 0) {
    return createUnchangedResult(text);
  }

  const mappings = [...mappingsByAlias.values()].sort(
    (left, right) => right.alias.length - left.alias.length,
  );
  const matcher = new RegExp(
    `\\[(${mappings
      .map((mapping) => escapeRegularExpression(mapping.alias))
      .join('|')})\\]`,
    'gu',
  );
  const counts = new Map<string, number>();
  const displayText = text.replace(
    matcher,
    (matchedText, alias: string, offset: number) => {
      const mapping = mappingsByAlias.get(alias);

      if (!mapping) {
        return matchedText;
      }

      counts.set(alias, (counts.get(alias) ?? 0) + 1);
      return isMarkdownLinkLabel(text, offset, matchedText.length)
        ? `[${mapping.original}]`
        : mapping.original;
    },
  );
  const replacements = mappings.flatMap((mapping) => {
    const count = counts.get(mapping.alias) ?? 0;

    return count > 0
      ? [
          {
            alias: mapping.alias,
            entityType: mapping.entityType,
            count,
          },
        ]
      : [];
  });

  return {
    maskedText: text,
    displayText,
    replacements,
    replacementCount: replacements.reduce(
      (total, replacement) => total + replacement.count,
      0,
    ),
  };
}

export function unmaskExternalResponse(
  text: string,
  maskingEntries: MaskingEntry[],
): UnmaskingResult {
  return unmaskExternalResponseFromSnapshot(
    text,
    createResponseUnmaskingSnapshot(maskingEntries),
  );
}

export function applyResponseUnmasking(input: {
  provider: ResponseUnmaskingProvider;
  text: string;
  snapshot: ResponseUnmaskingSnapshotEntry[];
}): UnmaskingResult {
  return input.provider === 'openai'
    ? unmaskExternalResponseFromSnapshot(input.text, input.snapshot)
    : createUnchangedResult(input.text);
}
