export const maskingEntityTypes = [
  'person',
  'company',
  'client',
  'vendor',
  'organization',
  'project',
  'operation',
  'system',
  'workspace',
  'other',
] as const;

export type MaskingEntityType = (typeof maskingEntityTypes)[number];
export type MaskingEntryScope = 'global' | 'workspace';
export type MaskingEntrySource = 'user' | 'registry';

export type MaskingEntry = {
  id: string;
  type: MaskingEntityType;
  value: string;
  alias: string;
  scope: MaskingEntryScope;
  workspaceId?: string;
  source?: MaskingEntrySource;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MaskingReplacement = {
  entryId: string;
  type: MaskingEntityType;
  original: string;
  alias: string;
  count: number;
  scope?: MaskingEntryScope;
  workspaceId?: string;
  source?: MaskingEntrySource;
};

export type MaskingResult = {
  originalText: string;
  maskedText: string;
  replacements: MaskingReplacement[];
  totalReplacementCount: number;
};

export type MaskingSequences = Record<MaskingEntityType, number>;

export type MaskingSettings = {
  entries: MaskingEntry[];
  sequences: MaskingSequences;
};

export type AddMaskingEntryInput = {
  type: MaskingEntityType;
  value: string;
  scope?: MaskingEntryScope;
  workspaceId?: string;
};

export type UpdateMaskingEntryInput = AddMaskingEntryInput & {
  id: string;
  enabled: boolean;
};

export const maskingEntityTypeLabels: Record<MaskingEntityType, string> = {
  person: 'Person',
  company: 'Company',
  client: 'Client',
  vendor: 'Vendor',
  organization: 'Organization',
  project: 'Project',
  operation: 'Operation',
  system: 'System',
  workspace: 'Workspace',
  other: 'Other',
};

export function createDefaultMaskingSettings(): MaskingSettings {
  return {
    entries: [],
    sequences: {
      person: 0,
      client: 0,
      company: 0,
      vendor: 0,
      organization: 0,
      project: 0,
      operation: 0,
      system: 0,
      workspace: 0,
      other: 0,
    },
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMatch(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

function isInsideMarkdownLinkLabel(
  text: string,
  start: number,
  end: number,
): boolean {
  const lastOpeningBracket = text.lastIndexOf('[', start);
  const lastClosingBracket = text.lastIndexOf(']', start);
  const nextClosingBracket = text.indexOf(']', end);
  const nextLineBreak = text.indexOf('\n', end);

  return (
    lastOpeningBracket > lastClosingBracket &&
    nextClosingBracket >= end &&
    (nextLineBreak < 0 || nextClosingBracket < nextLineBreak)
  );
}

export function maskText(
  text: string,
  entries: MaskingEntry[],
): MaskingResult {
  const entriesByValue = new Map<string, MaskingEntry>();
  const enabledEntries = entries
    .filter((entry) => entry.enabled && Boolean(entry.value.trim()))
    .sort(
      (left, right) =>
        right.value.length - left.value.length ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .filter((entry) => {
      const normalizedValue = normalizeMatch(entry.value);

      if (entriesByValue.has(normalizedValue)) {
        return false;
      }

      entriesByValue.set(normalizedValue, entry);
      return true;
    });

  if (!text || enabledEntries.length === 0) {
    return {
      originalText: text,
      maskedText: text,
      replacements: [],
      totalReplacementCount: 0,
    };
  }

  const counts = new Map<string, number>();
  const matcher = new RegExp(
    enabledEntries.map((entry) => escapeRegularExpression(entry.value)).join('|'),
    'giu',
  );
  const maskedText = text.replace(matcher, (matchedValue, offset: number) => {
    const entry = entriesByValue.get(normalizeMatch(matchedValue));

    if (!entry) {
      return matchedValue;
    }

    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    const isInsideMarkdownLinkText = isInsideMarkdownLinkLabel(
      text,
      offset,
      offset + matchedValue.length,
    );

    return isInsideMarkdownLinkText ? entry.alias : `[${entry.alias}]`;
  });
  const replacements = enabledEntries.flatMap((entry) => {
    const count = counts.get(entry.id) ?? 0;

    return count > 0
      ? [
          {
            entryId: entry.id,
            type: entry.type,
            original: entry.value,
            alias: entry.alias,
            count,
            scope: entry.scope,
            workspaceId: entry.workspaceId,
            source: entry.source ?? 'user',
          },
        ]
      : [];
  });

  return {
    originalText: text,
    maskedText,
    replacements,
    totalReplacementCount: replacements.reduce(
      (total, replacement) => total + replacement.count,
      0,
    ),
  };
}

export function findRemainingRegisteredEntityIds(
  texts: string[],
  entries: MaskingEntry[],
): string[] {
  return entries
    .filter((entry) => entry.enabled && Boolean(entry.value.trim()))
    .filter((entry) => {
      const matcher = new RegExp(escapeRegularExpression(entry.value), 'iu');
      return texts.some((text) => matcher.test(text));
    })
    .map((entry) => entry.id);
}
