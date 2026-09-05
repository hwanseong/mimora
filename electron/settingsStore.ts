import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultLocalAISettings,
  type LocalAISettings,
} from '../src/localAI';
import {
  defaultSettings,
  vaultSecurityOptions,
  vaultTypeOptions,
  type AddVaultInput,
  type MimoraSettings,
  type UpdateVaultInput,
  type VaultConfig,
  type VaultSecurity,
  type VaultType,
} from '../src/settings';
import {
  aiModeOptions,
  type AIMode,
} from '../src/security/securityRouter';
import {
  createDefaultMaskingSettings,
  maskingEntityTypes,
  type AddMaskingEntryInput,
  type MaskingEntityType,
  type MaskingEntry,
  type MaskingSettings,
  type UpdateMaskingEntryInput,
} from '../src/security/maskingEngine';

type LegacyVaultSettings = {
  workVaultPath?: unknown;
  privateVaultPath?: unknown;
};

type SettingsStoreOptions = {
  getSettingsPath: () => string;
  createId?: () => string;
  getNow?: () => string;
  platform?: NodeJS.Platform;
};

function cloneSettings(settings: MimoraSettings): MimoraSettings {
  return {
    vaults: settings.vaults.map((vault) => ({ ...vault })),
    localAI: { ...settings.localAI },
    aiMode: settings.aiMode,
    masking: {
      entries: settings.masking.entries.map((entry) => ({ ...entry })),
      sequences: { ...settings.masking.sequences },
    },
  };
}

function isAIMode(value: unknown): value is AIMode {
  return (
    typeof value === 'string' &&
    aiModeOptions.includes(value as AIMode)
  );
}

function isMaskingEntityType(value: unknown): value is MaskingEntityType {
  return (
    typeof value === 'string' &&
    maskingEntityTypes.includes(value as MaskingEntityType)
  );
}

function normalizeMaskingValue(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function parseMaskingSettings(value: unknown): {
  masking: MaskingSettings;
  migrated: boolean;
} {
  if (typeof value !== 'object' || value === null) {
    return { masking: createDefaultMaskingSettings(), migrated: true };
  }

  const rawMasking = value as {
    entries?: unknown;
    sequences?: unknown;
  };
  const rawEntries = Array.isArray(rawMasking.entries)
    ? rawMasking.entries
    : [];
  const seenEntries = new Set<string>();
  const entries = rawEntries.filter((entry): entry is MaskingEntry => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const candidate = entry as Partial<MaskingEntry>;

    if (
      typeof candidate.id !== 'string' ||
      !isMaskingEntityType(candidate.type) ||
      typeof candidate.value !== 'string' ||
      !candidate.value.trim() ||
      typeof candidate.alias !== 'string' ||
      !candidate.alias.trim() ||
      typeof candidate.enabled !== 'boolean' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string'
    ) {
      return false;
    }

    const entryKey = JSON.stringify([
      candidate.type,
      normalizeMaskingValue(candidate.value),
    ]);

    if (seenEntries.has(entryKey)) {
      return false;
    }

    seenEntries.add(entryKey);
    return true;
  });
  const sequences = createDefaultMaskingSettings().sequences;
  let sequencesMigrated =
    typeof rawMasking.sequences !== 'object' ||
    rawMasking.sequences === null;

  for (const type of maskingEntityTypes) {
    const storedSequence =
      typeof rawMasking.sequences === 'object' &&
      rawMasking.sequences !== null
        ? (rawMasking.sequences as Record<string, unknown>)[type]
        : undefined;

    if (
      typeof storedSequence === 'number' &&
      Number.isInteger(storedSequence) &&
      storedSequence >= 0
    ) {
      sequences[type] = storedSequence;
    } else {
      sequencesMigrated = true;
    }
  }

  for (const entry of entries) {
    const aliasMatch = new RegExp(`^${entry.type.toUpperCase()}_(\\d+)$`).exec(
      entry.alias,
    );
    const aliasSequence = aliasMatch ? Number(aliasMatch[1]) : 0;

    if (Number.isSafeInteger(aliasSequence)) {
      sequences[entry.type] = Math.max(sequences[entry.type], aliasSequence);
    }
  }

  return {
    masking: {
      entries: entries.map((entry) => ({
        ...entry,
        value: entry.value.trim(),
        alias: entry.alias.trim(),
      })),
      sequences,
    },
    migrated:
      !Array.isArray(rawMasking.entries) ||
      rawEntries.length !== entries.length ||
      sequencesMigrated,
  };
}

function validateMaskingEntryInput(
  input: unknown,
): AddMaskingEntryInput | UpdateMaskingEntryInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Masking Entity 입력값이 올바르지 않습니다.');
  }

  const candidate = input as Partial<UpdateMaskingEntryInput>;

  if (!isMaskingEntityType(candidate.type)) {
    throw new Error('지원하지 않는 Masking Entity Type입니다.');
  }

  if (typeof candidate.value !== 'string' || !candidate.value.trim()) {
    throw new Error('Masking 원본 값을 입력하세요.');
  }

  if (
    ('id' in candidate && typeof candidate.id !== 'string') ||
    ('enabled' in candidate && typeof candidate.enabled !== 'boolean')
  ) {
    throw new Error('Masking Entity 입력값이 올바르지 않습니다.');
  }

  return {
    ...candidate,
    type: candidate.type,
    value: candidate.value.trim(),
  } as AddMaskingEntryInput | UpdateMaskingEntryInput;
}

function ensureUniqueMaskingEntry(
  entries: MaskingEntry[],
  type: MaskingEntityType,
  value: string,
  ignoredEntryId?: string,
): void {
  const normalizedValue = normalizeMaskingValue(value);
  const duplicated = entries.some(
    (entry) =>
      entry.id !== ignoredEntryId &&
      entry.type === type &&
      normalizeMaskingValue(entry.value) === normalizedValue,
  );

  if (duplicated) {
    throw new Error('동일한 Type과 원본 값이 이미 등록되어 있습니다.');
  }
}

function createMaskingAlias(
  type: MaskingEntityType,
  sequence: number,
): string {
  return `${type.toUpperCase()}_${String(sequence).padStart(3, '0')}`;
}

function parseLocalAISettings(value: unknown): LocalAISettings | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as LocalAISettings).provider !== 'ollama' ||
    typeof (value as LocalAISettings).endpoint !== 'string' ||
    !((value as LocalAISettings).endpoint.trim()) ||
    !(
      (value as LocalAISettings).model === null ||
      typeof (value as LocalAISettings).model === 'string'
    )
  ) {
    return null;
  }

  const localAI = value as LocalAISettings;

  return {
    provider: 'ollama',
    endpoint: localAI.endpoint.trim(),
    model:
      typeof localAI.model === 'string' && localAI.model.trim()
        ? localAI.model.trim()
        : null,
  };
}

function validateLocalAISettings(value: unknown): LocalAISettings {
  const parsedSettings = parseLocalAISettings(value);

  if (!parsedSettings) {
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as Partial<LocalAISettings>).provider !== 'ollama'
    ) {
      throw new Error('지원하지 않는 Local AI Provider입니다.');
    }

    throw new Error('Ollama Endpoint를 입력하세요.');
  }

  return parsedSettings;
}

function isVaultType(value: unknown): value is VaultType {
  return (
    typeof value === 'string' &&
    vaultTypeOptions.includes(value as VaultType)
  );
}

function isVaultSecurity(value: unknown): value is VaultSecurity {
  return (
    typeof value === 'string' &&
    vaultSecurityOptions.includes(value as VaultSecurity)
  );
}

function normalizeComparablePath(
  vaultPath: string,
  platform: NodeJS.Platform,
): string {
  const normalizedPath = vaultPath.trim().replace(/[\\/]+$/, '');
  return platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function validateVaultInput(input: AddVaultInput | UpdateVaultInput): AddVaultInput {
  const name = input.name.trim();
  const vaultPath = input.path.trim();

  if (!name) {
    throw new Error('Vault 이름을 입력하세요.');
  }

  if (!vaultPath) {
    throw new Error('Vault 경로를 선택하세요.');
  }

  if (!isVaultType(input.type)) {
    throw new Error('허용되지 않는 Vault 유형입니다.');
  }

  if (!isVaultSecurity(input.security)) {
    throw new Error('허용되지 않는 보안등급입니다.');
  }

  return {
    name,
    type: input.type,
    security: input.security,
    path: vaultPath,
  };
}

function ensureUniqueVaultPath(
  settings: MimoraSettings,
  vaultPath: string,
  platform: NodeJS.Platform,
  ignoredVaultId?: string,
): void {
  const comparablePath = normalizeComparablePath(vaultPath, platform);
  const duplicated = settings.vaults.some(
    (vault) =>
      vault.id !== ignoredVaultId &&
      normalizeComparablePath(vault.path, platform) === comparablePath,
  );

  if (duplicated) {
    throw new Error('이미 등록된 Vault 경로입니다.');
  }
}

function createLegacyVault(
  name: string,
  type: VaultType,
  security: VaultSecurity,
  vaultPath: string,
  createId: () => string,
  getNow: () => string,
): VaultConfig {
  const now = getNow();

  return {
    id: createId(),
    name,
    type,
    security,
    path: vaultPath.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function migrateLegacySettings(
  rawSettings: LegacyVaultSettings,
  createId: () => string,
  getNow: () => string,
  platform: NodeJS.Platform,
): MimoraSettings {
  const vaults: VaultConfig[] = [];

  if (typeof rawSettings.workVaultPath === 'string' && rawSettings.workVaultPath.trim()) {
    vaults.push(
      createLegacyVault(
        'PM Work',
        'work',
        'internal',
        rawSettings.workVaultPath,
        createId,
        getNow,
      ),
    );
  }

  if (
    typeof rawSettings.privateVaultPath === 'string' &&
    rawSettings.privateVaultPath.trim()
  ) {
    const privatePath = rawSettings.privateVaultPath;
    const isDuplicate = vaults.some(
      (vault) =>
        normalizeComparablePath(vault.path, platform) ===
        normalizeComparablePath(privatePath, platform),
    );

    if (!isDuplicate) {
      vaults.push(
        createLegacyVault(
          'PM Private',
          'private',
          'sensitive',
          privatePath,
          createId,
          getNow,
        ),
      );
    }
  }

  return {
    vaults,
    localAI: { ...defaultLocalAISettings },
    aiMode: 'auto',
    masking: createDefaultMaskingSettings(),
  };
}

function isMimoraSettings(value: unknown): value is MimoraSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as MimoraSettings).vaults)
  );
}

function parseSettings(
  rawContent: string,
  createId: () => string,
  getNow: () => string,
  platform: NodeJS.Platform,
): {
  settings: MimoraSettings;
  migrated: boolean;
} {
  const parsedSettings = JSON.parse(rawContent) as unknown;

  if (isMimoraSettings(parsedSettings)) {
    const localAI = parseLocalAISettings(
      (parsedSettings as Partial<MimoraSettings>).localAI,
    );
    const aiMode = isAIMode(
      (parsedSettings as Partial<MimoraSettings>).aiMode,
    )
      ? (parsedSettings as MimoraSettings).aiMode
      : 'auto';
    const parsedMasking = parseMaskingSettings(
      (parsedSettings as Partial<MimoraSettings>).masking,
    );

    return {
      settings: {
        vaults: parsedSettings.vaults.filter(
          (vault): vault is VaultConfig =>
            typeof vault === 'object' &&
            vault !== null &&
            typeof vault.id === 'string' &&
            typeof vault.name === 'string' &&
            isVaultType(vault.type) &&
            isVaultSecurity(vault.security) &&
            typeof vault.path === 'string' &&
            typeof vault.createdAt === 'string' &&
            typeof vault.updatedAt === 'string',
        ),
        localAI: localAI ?? { ...defaultLocalAISettings },
        aiMode,
        masking: parsedMasking.masking,
      },
      migrated:
        localAI === null ||
        !isAIMode((parsedSettings as Partial<MimoraSettings>).aiMode) ||
        parsedMasking.migrated,
    };
  }

  if (
    typeof parsedSettings === 'object' &&
    parsedSettings !== null &&
    ('workVaultPath' in parsedSettings || 'privateVaultPath' in parsedSettings)
  ) {
    return {
      settings: migrateLegacySettings(
        parsedSettings as LegacyVaultSettings,
        createId,
        getNow,
        platform,
      ),
      migrated: true,
    };
  }

  return { settings: defaultSettings, migrated: false };
}

export function createSettingsStore({
  getSettingsPath,
  createId = randomUUID,
  getNow = () => new Date().toISOString(),
  platform = process.platform,
}: SettingsStoreOptions) {
  let settingsState: MimoraSettings | null = null;
  let settingsOperationQueue = Promise.resolve();

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const operationResult = settingsOperationQueue.then(operation, operation);

    settingsOperationQueue = operationResult.then(
      () => undefined,
      () => undefined,
    );

    return operationResult;
  }

  async function persistSettings(settings: MimoraSettings): Promise<MimoraSettings> {
    const settingsPath = getSettingsPath();
    const settingsToWrite = cloneSettings(settings);

    settingsState = settingsToWrite;
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify(settingsToWrite, null, 2)}\n`,
      'utf8',
    );

    const rawContent = await readFile(settingsPath, 'utf8');
    const { settings: verifiedSettings } = parseSettings(
      rawContent,
      createId,
      getNow,
      platform,
    );

    settingsState = cloneSettings(verifiedSettings);
    return cloneSettings(settingsState);
  }

  async function loadSettings(): Promise<MimoraSettings> {
    if (settingsState) {
      return cloneSettings(settingsState);
    }

    try {
      const rawContent = await readFile(getSettingsPath(), 'utf8');
      const { settings, migrated } = parseSettings(
        rawContent,
        createId,
        getNow,
        platform,
      );

      settingsState = cloneSettings(settings);

      if (migrated) {
        return persistSettings(settings);
      }

      return cloneSettings(settingsState);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        console.warn('Failed to read Mimora settings.', error);
      }

      settingsState = cloneSettings(defaultSettings);
      return cloneSettings(settingsState);
    }
  }

  return {
    getSettings: () => runExclusive(loadSettings),

    addVault: (input: AddVaultInput) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const vaultInput = validateVaultInput(input);
        ensureUniqueVaultPath(settings, vaultInput.path, platform);

        const now = getNow();
        const nextSettings: MimoraSettings = {
          localAI: settings.localAI,
          aiMode: settings.aiMode,
          masking: settings.masking,
          vaults: [
            ...settings.vaults,
            {
              id: createId(),
              ...vaultInput,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };

        return persistSettings(nextSettings);
      }),

    updateVault: (input: UpdateVaultInput) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const existingVault = settings.vaults.find(
          (vault) => vault.id === input.id,
        );

        if (!existingVault) {
          throw new Error('수정할 Vault를 찾을 수 없습니다.');
        }

        const vaultInput = validateVaultInput(input);
        ensureUniqueVaultPath(settings, vaultInput.path, platform, input.id);

        const nextSettings: MimoraSettings = {
          localAI: settings.localAI,
          aiMode: settings.aiMode,
          masking: settings.masking,
          vaults: settings.vaults.map((vault) =>
            vault.id === input.id
              ? {
                  ...vault,
                  ...vaultInput,
                  createdAt: existingVault.createdAt,
                  updatedAt: getNow(),
                }
              : vault,
          ),
        };

        return persistSettings(nextSettings);
      }),

    deleteVault: (id: string) =>
      runExclusive(async () => {
        const settings = await loadSettings();

        if (!settings.vaults.some((vault) => vault.id === id)) {
          throw new Error('삭제할 Vault를 찾을 수 없습니다.');
        }

        const nextSettings: MimoraSettings = {
          localAI: settings.localAI,
          aiMode: settings.aiMode,
          masking: settings.masking,
          vaults: settings.vaults.filter((vault) => vault.id !== id),
        };

        return persistSettings(nextSettings);
      }),

    updateLocalAISettings: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const localAI = validateLocalAISettings(input);

        return persistSettings({
          vaults: settings.vaults,
          localAI,
          aiMode: settings.aiMode,
          masking: settings.masking,
        });
      }),

    updateAIMode: (input: unknown) =>
      runExclusive(async () => {
        if (!isAIMode(input)) {
          throw new Error('지원하지 않는 AI Mode입니다.');
        }

        const settings = await loadSettings();

        return persistSettings({
          ...settings,
          aiMode: input,
        });
      }),

    addMaskingEntry: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const entryInput = validateMaskingEntryInput(
          input,
        ) as AddMaskingEntryInput;

        ensureUniqueMaskingEntry(
          settings.masking.entries,
          entryInput.type,
          entryInput.value,
        );

        const sequence = settings.masking.sequences[entryInput.type] + 1;
        const now = getNow();

        return persistSettings({
          ...settings,
          masking: {
            entries: [
              ...settings.masking.entries,
              {
                id: createId(),
                type: entryInput.type,
                value: entryInput.value,
                alias: createMaskingAlias(entryInput.type, sequence),
                enabled: true,
                createdAt: now,
                updatedAt: now,
              },
            ],
            sequences: {
              ...settings.masking.sequences,
              [entryInput.type]: sequence,
            },
          },
        });
      }),

    updateMaskingEntry: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const entryInput = validateMaskingEntryInput(
          input,
        ) as UpdateMaskingEntryInput;
        const existingEntry = settings.masking.entries.find(
          (entry) => entry.id === entryInput.id,
        );

        if (!existingEntry) {
          throw new Error('수정할 Masking Entity를 찾을 수 없습니다.');
        }

        ensureUniqueMaskingEntry(
          settings.masking.entries,
          entryInput.type,
          entryInput.value,
          entryInput.id,
        );

        const typeChanged = existingEntry.type !== entryInput.type;
        const sequence = typeChanged
          ? settings.masking.sequences[entryInput.type] + 1
          : settings.masking.sequences[entryInput.type];
        const alias = typeChanged
          ? createMaskingAlias(entryInput.type, sequence)
          : existingEntry.alias;

        return persistSettings({
          ...settings,
          masking: {
            entries: settings.masking.entries.map((entry) =>
              entry.id === entryInput.id
                ? {
                    ...entry,
                    type: entryInput.type,
                    value: entryInput.value,
                    alias,
                    enabled: entryInput.enabled,
                    updatedAt: getNow(),
                  }
                : entry,
            ),
            sequences: typeChanged
              ? {
                  ...settings.masking.sequences,
                  [entryInput.type]: sequence,
                }
              : settings.masking.sequences,
          },
        });
      }),

    deleteMaskingEntry: (id: unknown) =>
      runExclusive(async () => {
        if (typeof id !== 'string') {
          throw new Error('삭제할 Masking Entity 정보가 올바르지 않습니다.');
        }

        const settings = await loadSettings();

        if (!settings.masking.entries.some((entry) => entry.id === id)) {
          throw new Error('삭제할 Masking Entity를 찾을 수 없습니다.');
        }

        return persistSettings({
          ...settings,
          masking: {
            entries: settings.masking.entries.filter(
              (entry) => entry.id !== id,
            ),
            sequences: settings.masking.sequences,
          },
        });
      }),
  };
}
