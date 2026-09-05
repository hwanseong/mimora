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
  };
}

function isAIMode(value: unknown): value is AIMode {
  return (
    typeof value === 'string' &&
    aiModeOptions.includes(value as AIMode)
  );
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
      },
      migrated:
        localAI === null ||
        !isAIMode((parsedSettings as Partial<MimoraSettings>).aiMode),
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
  };
}
