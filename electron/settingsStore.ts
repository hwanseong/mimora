import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultLocalAISettings,
  type LocalAISettings,
} from '../src/localAI';
import {
  defaultExternalAISettings,
  isExternalChatProviderId,
  type ExternalAISettings,
} from '../src/externalAI';
import {
  defaultSettings,
  vaultSecurityOptions,
  vaultTypeOptions,
  type AddVaultInput,
  type MimoraSettings,
  type SearchScopeSettings,
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
  type MaskingEntryScope,
  type MaskingEntityType,
  type MaskingEntry,
  type MaskingSettings,
  type UpdateMaskingEntryInput,
} from '../src/security/maskingEngine';
import {
  createDefaultSecretDetectionSettings,
  validateCustomSecretRuleInput,
  type AddSecretRuleInput,
  type CustomSecretRule,
  type SecretDetectionSettings,
  type UpdateSecretRuleInput,
} from '../src/security/secretDetector';
import {
  defaultRegistrySettings,
  type RegistrySettings,
} from '../src/registry/types';
import { isContentOriginSearchScope } from '../src/contentOrigin';
import {
  defaultRagSettings,
  ragEmbeddingProviderOptions,
  type RagEmbeddingProvider,
  type RagSettings,
} from '../src/rag';

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
    registry: { ...settings.registry },
    search: { ...settings.search },
    localAI: { ...settings.localAI },
    externalAI: { ...settings.externalAI },
    rag: { ...settings.rag },
    aiMode: settings.aiMode,
    masking: {
      entries: settings.masking.entries.map((entry) => ({ ...entry })),
      sequences: { ...settings.masking.sequences },
    },
    secretDetection: {
      customRules: settings.secretDetection.customRules.map((rule) => ({
        ...rule,
        ...(rule.keywords ? { keywords: [...rule.keywords] } : {}),
      })),
    },
  };
}

function parseSearchScopeSettings(value: unknown): {
  search: SearchScopeSettings;
  migrated: boolean;
} {
  if (typeof value !== 'object' || value === null) {
    return {
      search: { ...defaultSettings.search },
      migrated: true,
    };
  }

  const includeArchived = (value as Partial<SearchScopeSettings>)
    .includeArchived;
  const contentOriginScope = (value as Partial<SearchScopeSettings>)
    .contentOriginScope;

  return {
    search: {
      includeArchived:
        typeof includeArchived === 'boolean'
          ? includeArchived
          : defaultSettings.search.includeArchived,
      contentOriginScope: isContentOriginSearchScope(contentOriginScope)
        ? contentOriginScope
        : defaultSettings.search.contentOriginScope,
    },
    migrated:
      typeof includeArchived !== 'boolean' ||
      !isContentOriginSearchScope(contentOriginScope),
  };
}

function parseRegistrySettings(
  value: unknown,
  vaults: VaultConfig[],
): {
  registry: RegistrySettings;
  migrated: boolean;
} {
  if (typeof value !== 'object' || value === null) {
    return {
      registry: { ...defaultRegistrySettings },
      migrated: true,
    };
  }

  const homeVaultId = (value as Partial<RegistrySettings>).homeVaultId;

  if (homeVaultId === null || homeVaultId === undefined) {
    return {
      registry: { homeVaultId: null },
      migrated: homeVaultId === undefined,
    };
  }

  if (typeof homeVaultId !== 'string') {
    return {
      registry: { homeVaultId: null },
      migrated: true,
    };
  }

  const homeVaultExists = vaults.some((vault) => vault.id === homeVaultId);

  return {
    registry: {
      homeVaultId: homeVaultExists ? homeVaultId : null,
    },
    migrated: !homeVaultExists,
  };
}

function parseSecretDetectionSettings(value: unknown): {
  secretDetection: SecretDetectionSettings;
  migrated: boolean;
} {
  if (typeof value !== 'object' || value === null) {
    return {
      secretDetection: createDefaultSecretDetectionSettings(),
      migrated: true,
    };
  }

  const rawRules = Array.isArray(
    (value as { customRules?: unknown }).customRules,
  )
    ? ((value as { customRules: unknown[] }).customRules)
    : [];
  const customRules: CustomSecretRule[] = [];
  const seenIds = new Set<string>();
  let migrated = !Array.isArray(
    (value as { customRules?: unknown }).customRules,
  );

  for (const rawRule of rawRules) {
    try {
      if (
        typeof rawRule !== 'object' ||
        rawRule === null ||
        (rawRule as Partial<CustomSecretRule>).source !== 'custom' ||
        typeof (rawRule as Partial<CustomSecretRule>).id !== 'string' ||
        typeof (rawRule as Partial<CustomSecretRule>).createdAt !== 'string' ||
        typeof (rawRule as Partial<CustomSecretRule>).updatedAt !== 'string'
      ) {
        migrated = true;
        continue;
      }

      const candidate = rawRule as CustomSecretRule;

      if (seenIds.has(candidate.id)) {
        migrated = true;
        continue;
      }

      const validated = validateCustomSecretRuleInput({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        enabled: candidate.enabled,
        keywords: candidate.keywords,
        pattern: candidate.pattern,
      }) as UpdateSecretRuleInput;

      seenIds.add(candidate.id);
      customRules.push({
        id: candidate.id,
        name: validated.name,
        source: 'custom',
        kind: validated.kind,
        enabled: validated.enabled ?? true,
        severity: 'hard-block',
        category: 'custom-secret',
        ...(validated.kind === 'keyword-value'
          ? { keywords: validated.keywords }
          : { pattern: validated.pattern }),
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      });
    } catch {
      migrated = true;
    }
  }

  return {
    secretDetection: { customRules },
    migrated: migrated || customRules.length !== rawRules.length,
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

function isMaskingEntryScope(value: unknown): value is MaskingEntryScope {
  return value === 'global' || value === 'workspace';
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
  let entriesMigrated = !Array.isArray(rawMasking.entries);
  const entries = rawEntries.filter((entry): entry is MaskingEntry => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const candidate = entry as Partial<MaskingEntry>;
    const hasStoredScope = isMaskingEntryScope(candidate.scope);
    const scope = hasStoredScope ? candidate.scope : 'global';
    const workspaceId =
      typeof candidate.workspaceId === 'string' &&
      candidate.workspaceId.trim()
        ? candidate.workspaceId.trim()
        : undefined;

    if (
      typeof candidate.id !== 'string' ||
      !isMaskingEntityType(candidate.type) ||
      typeof candidate.value !== 'string' ||
      !candidate.value.trim() ||
      typeof candidate.alias !== 'string' ||
      !candidate.alias.trim() ||
      typeof candidate.enabled !== 'boolean' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string' ||
      (scope === 'workspace' && !workspaceId)
    ) {
      entriesMigrated = true;
      return false;
    }

    const entryKey = JSON.stringify([
      scope,
      scope === 'workspace' ? workspaceId : '',
      candidate.type,
      normalizeMaskingValue(candidate.value),
    ]);

    if (seenEntries.has(entryKey)) {
      entriesMigrated = true;
      return false;
    }

    if (!hasStoredScope || candidate.source !== 'user') {
      entriesMigrated = true;
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
        scope: isMaskingEntryScope(entry.scope) ? entry.scope : 'global',
        workspaceId:
          entry.scope === 'workspace' && entry.workspaceId?.trim()
            ? entry.workspaceId.trim()
            : undefined,
        source: 'user',
      })),
      sequences,
    },
    migrated:
      !Array.isArray(rawMasking.entries) ||
      rawEntries.length !== entries.length ||
      entriesMigrated ||
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
  const scope = isMaskingEntryScope(candidate.scope)
    ? candidate.scope
    : 'global';
  const workspaceId =
    typeof candidate.workspaceId === 'string' && candidate.workspaceId.trim()
      ? candidate.workspaceId.trim()
      : undefined;

  if (!isMaskingEntityType(candidate.type)) {
    throw new Error('지원하지 않는 Masking Entity Type입니다.');
  }

  if (typeof candidate.value !== 'string' || !candidate.value.trim()) {
    throw new Error('Masking 원본 값을 입력하세요.');
  }

  if (
    ('id' in candidate && typeof candidate.id !== 'string') ||
    ('enabled' in candidate && typeof candidate.enabled !== 'boolean') ||
    (scope === 'workspace' && !workspaceId)
  ) {
    throw new Error('Masking Entity 입력값이 올바르지 않습니다.');
  }

  return {
    ...candidate,
    type: candidate.type,
    value: candidate.value.trim(),
    scope,
    workspaceId: scope === 'workspace' ? workspaceId : undefined,
  } as AddMaskingEntryInput | UpdateMaskingEntryInput;
}

function ensureUniqueMaskingEntry(
  entries: MaskingEntry[],
  type: MaskingEntityType,
  value: string,
  scope: MaskingEntryScope,
  workspaceId?: string,
  ignoredEntryId?: string,
): void {
  const normalizedValue = normalizeMaskingValue(value);
  const duplicated = entries.some(
    (entry) =>
      entry.id !== ignoredEntryId &&
      (entry.scope ?? 'global') === scope &&
      ((entry.scope ?? 'global') === 'global' ||
        entry.workspaceId === workspaceId) &&
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

function parseExternalAISettings(value: unknown): ExternalAISettings | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isExternalChatProviderId((value as Partial<ExternalAISettings>).provider) ||
    !(
      (value as ExternalAISettings).model === null ||
      typeof (value as ExternalAISettings).model === 'string'
    )
  ) {
    return null;
  }

  const model = (value as ExternalAISettings).model;

  return {
    provider: (value as ExternalAISettings).provider,
    model: typeof model === 'string' && model.trim() ? model.trim() : null,
  };
}

function validateExternalAISettings(value: unknown): ExternalAISettings {
  const parsedSettings = parseExternalAISettings(value);

  if (!parsedSettings) {
    throw new Error('지원하지 않는 External AI Provider 설정입니다.');
  }

  return parsedSettings;
}

function isRagEmbeddingProvider(value: unknown): value is RagEmbeddingProvider {
  return (
    typeof value === 'string' &&
    ragEmbeddingProviderOptions.includes(value as RagEmbeddingProvider)
  );
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeFiniteNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function parseRagSettings(value: unknown): {
  rag: RagSettings;
  migrated: boolean;
} {
  if (typeof value !== 'object' || value === null) {
    return {
      rag: { ...defaultRagSettings },
      migrated: true,
    };
  }

  const rawSettings = value as Partial<RagSettings>;
  const embeddingProvider = isRagEmbeddingProvider(rawSettings.embeddingProvider)
    ? rawSettings.embeddingProvider
    : defaultRagSettings.embeddingProvider;
  const localEmbeddingModel =
    typeof rawSettings.localEmbeddingModel === 'string' &&
    rawSettings.localEmbeddingModel.trim()
      ? rawSettings.localEmbeddingModel.trim()
      : defaultRagSettings.localEmbeddingModel;
  const openAIEmbeddingModel =
    typeof rawSettings.openAIEmbeddingModel === 'string' &&
    rawSettings.openAIEmbeddingModel.trim()
      ? rawSettings.openAIEmbeddingModel.trim()
      : defaultRagSettings.openAIEmbeddingModel;
  const chunkSize = normalizePositiveInteger(
    rawSettings.chunkSize,
    defaultRagSettings.chunkSize,
    1000,
    12000,
  );
  const chunkOverlap = Math.min(
    normalizePositiveInteger(
      rawSettings.chunkOverlap,
      defaultRagSettings.chunkOverlap,
      0,
      3000,
    ),
    Math.max(0, chunkSize - 1),
  );
  const similarityThreshold = normalizeFiniteNumber(
    rawSettings.similarityThreshold,
    defaultRagSettings.similarityThreshold,
    -1,
    1,
  );
  const workspaceScoreBonus = normalizeFiniteNumber(
    rawSettings.workspaceScoreBonus,
    defaultRagSettings.workspaceScoreBonus,
    0,
    0.2,
  );
  const maxChunksPerDocument = normalizePositiveInteger(
    rawSettings.maxChunksPerDocument,
    defaultRagSettings.maxChunksPerDocument,
    1,
    10,
  );
  const searchCandidateCount = normalizePositiveInteger(
    rawSettings.searchCandidateCount,
    defaultRagSettings.searchCandidateCount,
    10,
    200,
  );
  const defaultTopK = normalizePositiveInteger(
    rawSettings.defaultTopK,
    defaultRagSettings.defaultTopK,
    1,
    20,
  );
  const denseOnlyThreshold = normalizeFiniteNumber(
    rawSettings.denseOnlyThreshold,
    defaultRagSettings.denseOnlyThreshold,
    -1,
    1,
  );

  return {
    rag: {
      embeddingProvider,
      localEmbeddingModel,
      openAIEmbeddingModel,
      chunkSize,
      chunkOverlap,
      similarityThreshold,
      workspaceScoreBonus,
      maxChunksPerDocument,
      searchCandidateCount,
      defaultTopK,
      denseOnlyThreshold,
    },
    migrated:
      rawSettings.embeddingProvider !== embeddingProvider ||
      rawSettings.localEmbeddingModel !== localEmbeddingModel ||
      rawSettings.openAIEmbeddingModel !== openAIEmbeddingModel ||
      rawSettings.chunkSize !== chunkSize ||
      rawSettings.chunkOverlap !== chunkOverlap ||
      rawSettings.similarityThreshold !== similarityThreshold ||
      rawSettings.workspaceScoreBonus !== workspaceScoreBonus ||
      rawSettings.maxChunksPerDocument !== maxChunksPerDocument ||
      rawSettings.searchCandidateCount !== searchCandidateCount ||
      rawSettings.defaultTopK !== defaultTopK ||
      rawSettings.denseOnlyThreshold !== denseOnlyThreshold,
  };
}

function validateRagSettings(value: unknown): RagSettings {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isRagEmbeddingProvider((value as Partial<RagSettings>).embeddingProvider)
  ) {
    throw new Error('지원하지 않는 RAG Embedding Provider입니다.');
  }

  return parseRagSettings(value).rag;
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
    registry: { ...defaultRegistrySettings },
    search: { ...defaultSettings.search },
    localAI: { ...defaultLocalAISettings },
    externalAI: { ...defaultExternalAISettings },
    rag: { ...defaultRagSettings },
    aiMode: 'auto',
    masking: createDefaultMaskingSettings(),
    secretDetection: createDefaultSecretDetectionSettings(),
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
    const vaults = parsedSettings.vaults.filter(
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
    );
    const parsedRegistry = parseRegistrySettings(
      (parsedSettings as Partial<MimoraSettings>).registry,
      vaults,
    );
    const parsedSearch = parseSearchScopeSettings(
      (parsedSettings as Partial<MimoraSettings>).search,
    );
    const localAI = parseLocalAISettings(
      (parsedSettings as Partial<MimoraSettings>).localAI,
    );
    const externalAI = parseExternalAISettings(
      (parsedSettings as Partial<MimoraSettings>).externalAI,
    );
    const parsedRag = parseRagSettings(
      (parsedSettings as Partial<MimoraSettings>).rag,
    );
    const aiMode = isAIMode(
      (parsedSettings as Partial<MimoraSettings>).aiMode,
    )
      ? (parsedSettings as MimoraSettings).aiMode
      : 'auto';
    const parsedMasking = parseMaskingSettings(
      (parsedSettings as Partial<MimoraSettings>).masking,
    );
    const parsedSecretDetection = parseSecretDetectionSettings(
      (parsedSettings as Partial<MimoraSettings>).secretDetection,
    );

    return {
      settings: {
        vaults,
        registry: parsedRegistry.registry,
        search: parsedSearch.search,
        localAI: localAI ?? { ...defaultLocalAISettings },
        externalAI: externalAI ?? { ...defaultExternalAISettings },
        rag: parsedRag.rag,
        aiMode,
        masking: parsedMasking.masking,
        secretDetection: parsedSecretDetection.secretDetection,
      },
      migrated:
        localAI === null ||
        externalAI === null ||
        parsedRag.migrated ||
        parsedRegistry.migrated ||
        parsedSearch.migrated ||
        !isAIMode((parsedSettings as Partial<MimoraSettings>).aiMode) ||
        parsedMasking.migrated ||
        parsedSecretDetection.migrated,
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
          ...settings,
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
          ...settings,
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
          ...settings,
          registry:
            settings.registry.homeVaultId === id
              ? { homeVaultId: null }
              : settings.registry,
          vaults: settings.vaults.filter((vault) => vault.id !== id),
        };

        return persistSettings(nextSettings);
      }),

    updateLocalAISettings: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const localAI = validateLocalAISettings(input);

        return persistSettings({
          ...settings,
          localAI,
        });
      }),

    updateRegistryHomeVault: (homeVaultId: unknown) =>
      runExclusive(async () => {
        if (homeVaultId !== null && typeof homeVaultId !== 'string') {
          throw new Error('Registry Home Vault 설정값이 올바르지 않습니다.');
        }

        const settings = await loadSettings();

        if (
          homeVaultId &&
          !settings.vaults.some((vault) => vault.id === homeVaultId)
        ) {
          throw new Error('Registry Home Vault를 찾을 수 없습니다.');
        }

        return persistSettings({
          ...settings,
          registry: { homeVaultId },
        });
      }),

    updateExternalAISettings: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const externalAI = validateExternalAISettings(input);

        return persistSettings({
          ...settings,
          externalAI,
        });
      }),

    updateRagSettings: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const rag = validateRagSettings(input);

        return persistSettings({
          ...settings,
          rag,
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

    updateSearchScopeSettings: (input: unknown) =>
      runExclusive(async () => {
        const parsedSearch = parseSearchScopeSettings(input);
        const settings = await loadSettings();

        return persistSettings({
          ...settings,
          search: parsedSearch.search,
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
          entryInput.scope ?? 'global',
          entryInput.workspaceId,
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
                scope: entryInput.scope ?? 'global',
                workspaceId: entryInput.workspaceId,
                source: 'user',
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
          entryInput.scope ?? 'global',
          entryInput.workspaceId,
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
                    scope: entryInput.scope ?? 'global',
                    workspaceId: entryInput.workspaceId,
                    source: 'user',
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

    addSecretRule: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const ruleInput = validateCustomSecretRuleInput(
          input,
        ) as AddSecretRuleInput;

        if (
          settings.secretDetection.customRules.some(
            (rule) =>
              rule.name.toLocaleLowerCase('en-US') ===
              ruleInput.name.toLocaleLowerCase('en-US'),
          )
        ) {
          throw new Error('동일한 이름의 Custom Secret Rule이 이미 있습니다.');
        }

        const now = getNow();
        const rule: CustomSecretRule = {
          id: createId(),
          name: ruleInput.name,
          source: 'custom',
          kind: ruleInput.kind,
          enabled: ruleInput.enabled ?? true,
          severity: 'hard-block',
          category: 'custom-secret',
          ...(ruleInput.kind === 'keyword-value'
            ? { keywords: ruleInput.keywords }
            : { pattern: ruleInput.pattern }),
          createdAt: now,
          updatedAt: now,
        };

        return persistSettings({
          ...settings,
          secretDetection: {
            customRules: [...settings.secretDetection.customRules, rule],
          },
        });
      }),

    updateSecretRule: (input: unknown) =>
      runExclusive(async () => {
        const settings = await loadSettings();
        const ruleInput = validateCustomSecretRuleInput(
          input,
        ) as UpdateSecretRuleInput;
        const existingRule = settings.secretDetection.customRules.find(
          (rule) => rule.id === ruleInput.id,
        );

        if (!existingRule) {
          throw new Error('수정할 Custom Secret Rule을 찾을 수 없습니다.');
        }

        if (
          settings.secretDetection.customRules.some(
            (rule) =>
              rule.id !== ruleInput.id &&
              rule.name.toLocaleLowerCase('en-US') ===
                ruleInput.name.toLocaleLowerCase('en-US'),
          )
        ) {
          throw new Error('동일한 이름의 Custom Secret Rule이 이미 있습니다.');
        }

        return persistSettings({
          ...settings,
          secretDetection: {
            customRules: settings.secretDetection.customRules.map((rule) =>
              rule.id === ruleInput.id
                ? {
                    ...rule,
                    name: ruleInput.name,
                    kind: ruleInput.kind,
                    enabled: ruleInput.enabled ?? true,
                    keywords:
                      ruleInput.kind === 'keyword-value'
                        ? ruleInput.keywords
                        : undefined,
                    pattern:
                      ruleInput.kind === 'regex'
                        ? ruleInput.pattern
                        : undefined,
                    updatedAt: getNow(),
                  }
                : rule,
            ),
          },
        });
      }),

    deleteSecretRule: (id: unknown) =>
      runExclusive(async () => {
        if (typeof id !== 'string') {
          throw new Error('삭제할 Custom Secret Rule 정보가 올바르지 않습니다.');
        }

        const settings = await loadSettings();

        if (
          !settings.secretDetection.customRules.some((rule) => rule.id === id)
        ) {
          throw new Error('삭제할 Custom Secret Rule을 찾을 수 없습니다.');
        }

        return persistSettings({
          ...settings,
          secretDetection: {
            customRules: settings.secretDetection.customRules.filter(
              (rule) => rule.id !== id,
            ),
          },
        });
      }),
  };
}
