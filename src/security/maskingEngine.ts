export const maskingEntityTypes = [
  'person',
  'client',
  'organization',
  'project',
  'system',
] as const;

export type MaskingEntityType = (typeof maskingEntityTypes)[number];

export type MaskingEntry = {
  id: string;
  type: MaskingEntityType;
  value: string;
  alias: string;
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
};

export type UpdateMaskingEntryInput = AddMaskingEntryInput & {
  id: string;
  enabled: boolean;
};

export const maskingEntityTypeLabels: Record<MaskingEntityType, string> = {
  person: 'Person',
  client: 'Client',
  organization: 'Organization',
  project: 'Project',
  system: 'System',
};

export function createDefaultMaskingSettings(): MaskingSettings {
  return {
    entries: [],
    sequences: {
      person: 0,
      client: 0,
      organization: 0,
      project: 0,
      system: 0,
    },
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMatch(value: string): string {
  return value.toLocaleLowerCase('en-US');
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
  const maskedText = text.replace(matcher, (matchedValue) => {
    const entry = entriesByValue.get(normalizeMatch(matchedValue));

    if (!entry) {
      return matchedValue;
    }

    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    return `[${entry.alias}]`;
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
