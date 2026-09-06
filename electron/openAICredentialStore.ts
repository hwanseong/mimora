import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type SafeStorageAdapter = {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (plainText: string) => Promise<Buffer>;
  decryptStringAsync: (
    encrypted: Buffer,
  ) => Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend?: () => string;
};

type OpenAICredentialStoreOptions = {
  getCredentialPath: () => string;
  safeStorage: SafeStorageAdapter;
  platform?: NodeJS.Platform;
};

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export function createOpenAICredentialStore({
  getCredentialPath,
  safeStorage,
  platform = process.platform,
}: OpenAICredentialStoreOptions) {
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

  async function writeEncryptedApiKey(apiKey: string): Promise<void> {
    const credentialPath = getCredentialPath();
    const encryptedApiKey = await safeStorage.encryptStringAsync(apiKey);

    await mkdir(path.dirname(credentialPath), { recursive: true });
    await writeFile(credentialPath, encryptedApiKey);
  }

  async function readEncryptedApiKey(): Promise<Buffer | null> {
    try {
      const encryptedApiKey = await readFile(getCredentialPath());
      return encryptedApiKey.length > 0 ? encryptedApiKey : null;
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }

      throw new Error('저장된 API Key 상태를 확인할 수 없습니다.');
    }
  }

  return {
    hasApiKey: () =>
      runExclusive(async () => (await readEncryptedApiKey()) !== null),

    saveApiKey: (input: unknown) =>
      runExclusive(async () => {
        if (typeof input !== 'string' || !input.trim()) {
          throw new Error('OpenAI API Key를 입력하세요.');
        }

        await ensureSecureStorageAvailable();

        try {
          await writeEncryptedApiKey(input.trim());
        } catch {
          throw new Error('OpenAI API Key를 안전하게 저장하지 못했습니다.');
        }
      }),

    deleteApiKey: () =>
      runExclusive(async () => {
        try {
          await unlink(getCredentialPath());
        } catch (error) {
          if (!isFileNotFound(error)) {
            throw new Error('저장된 OpenAI API Key를 삭제하지 못했습니다.');
          }
        }
      }),

    readApiKeyForMainProcess: () =>
      runExclusive(async () => {
        const encryptedApiKey = await readEncryptedApiKey();

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
            await writeEncryptedApiKey(apiKey);
          }

          return apiKey;
        } catch {
          throw new Error('저장된 OpenAI API Key를 읽을 수 없습니다.');
        }
      }),
  };
}
