import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExternalChatProviderId } from '../src/externalAI';
import type { SafeStorageAdapter } from './openAICredentialStore';

export type ExternalCredentialStoreOptions = {
  getCredentialPath: (providerId: ExternalChatProviderId) => string;
  safeStorage: SafeStorageAdapter;
  platform?: NodeJS.Platform;
  getLegacyOpenAICredentialPath?: () => string;
};

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function assertExternalChatProviderId(
  providerId: unknown,
): asserts providerId is ExternalChatProviderId {
  if (providerId !== 'openai' && providerId !== 'gemini') {
    throw new Error('지원하지 않는 External AI Provider입니다.');
  }
}

export function createExternalCredentialStore({
  getCredentialPath,
  safeStorage,
  platform = process.platform,
  getLegacyOpenAICredentialPath,
}: ExternalCredentialStoreOptions) {
  let operationQueue = Promise.resolve();

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function ensureSecureStorageAvailable(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('이 운영체제에서 안전한 API Key 저장소를 사용할 수 없습니다.');
    }

    if (
      platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error('안전한 시스템 암호 저장소를 사용할 수 없습니다.');
    }
  }

  function getProviderCredentialPath(
    providerId: ExternalChatProviderId,
  ): string {
    assertExternalChatProviderId(providerId);
    return getCredentialPath(providerId);
  }

  async function writeEncryptedApiKey(
    providerId: ExternalChatProviderId,
    apiKey: string,
  ): Promise<void> {
    const credentialPath = getProviderCredentialPath(providerId);
    const encryptedApiKey = await safeStorage.encryptStringAsync(apiKey);

    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(credentialPath, encryptedApiKey);
  }

  async function readLegacyOpenAIApiKey(): Promise<Buffer | null> {
    if (!getLegacyOpenAICredentialPath) {
      return null;
    }

    try {
      const encryptedApiKey = await readFile(getLegacyOpenAICredentialPath());
      return encryptedApiKey.length > 0 ? encryptedApiKey : null;
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }

      throw new Error('저장된 API Key 상태를 확인할 수 없습니다.');
    }
  }

  async function readEncryptedApiKey(
    providerId: ExternalChatProviderId,
  ): Promise<Buffer | null> {
    try {
      const encryptedApiKey = await readFile(
        getProviderCredentialPath(providerId),
      );
      return encryptedApiKey.length > 0 ? encryptedApiKey : null;
    } catch (error) {
      if (isFileNotFound(error)) {
        return providerId === 'openai' ? readLegacyOpenAIApiKey() : null;
      }

      throw new Error('저장된 API Key 상태를 확인할 수 없습니다.');
    }
  }

  return {
    hasApiKey: (providerId: ExternalChatProviderId) =>
      runExclusive(async () => (await readEncryptedApiKey(providerId)) !== null),

    saveApiKey: (providerId: ExternalChatProviderId, input: unknown) =>
      runExclusive(async () => {
        assertExternalChatProviderId(providerId);

        if (typeof input !== 'string' || !input.trim()) {
          throw new Error('API Key를 입력하세요.');
        }

        await ensureSecureStorageAvailable();

        try {
          await writeEncryptedApiKey(providerId, input.trim());
        } catch {
          throw new Error('API Key를 안전하게 저장하지 못했습니다.');
        }
      }),

    deleteApiKey: (providerId: ExternalChatProviderId) =>
      runExclusive(async () => {
        assertExternalChatProviderId(providerId);

        try {
          await unlink(getProviderCredentialPath(providerId));
        } catch (error) {
          if (!isFileNotFound(error)) {
            throw new Error('저장된 API Key를 삭제하지 못했습니다.');
          }
        }
      }),

    readApiKeyForMainProcess: (providerId: ExternalChatProviderId) =>
      runExclusive(async () => {
        assertExternalChatProviderId(providerId);
        const encryptedApiKey = await readEncryptedApiKey(providerId);

        if (!encryptedApiKey) {
          throw new Error('API Key가 설정되지 않았습니다.');
        }

        await ensureSecureStorageAvailable();

        try {
          const decrypted = await safeStorage.decryptStringAsync(
            encryptedApiKey,
          );
          const apiKey = decrypted.result.trim();

          if (!apiKey) {
            throw new Error('empty credential');
          }

          if (decrypted.shouldReEncrypt) {
            await writeEncryptedApiKey(providerId, apiKey);
          }

          return apiKey;
        } catch {
          throw new Error('저장된 API Key를 읽을 수 없습니다.');
        }
      }),
  };
}
