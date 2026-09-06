import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  countPersistedMessages,
  createPersistedChatHistory,
  isKnownWorkspaceId,
  parsePersistedChatHistory,
  restoreChatSessions,
  type ChatHistoryLoadResult,
  type ChatHistorySaveResult,
  type PersistedChatHistory,
} from '../src/chatHistory';
import type { SafeStorageAdapter } from './openAICredentialStore';

type ChatHistoryStoreOptions = {
  getHistoryPath: () => string;
  safeStorage: SafeStorageAdapter;
  platform?: NodeJS.Platform;
};

const ATOMIC_RENAME_RETRY_DELAYS_MS = [25, 75, 150];

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function getErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createChatHistoryStore({
  getHistoryPath,
  safeStorage,
  platform = process.platform,
}: ChatHistoryStoreOptions) {
  let operationQueue = Promise.resolve();
  let historyState: PersistedChatHistory | null = null;

  function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);

    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function ensureEncryptionAvailable(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('이 환경에서는 안전한 대화 저장을 사용할 수 없습니다.');
    }

    if (
      platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error('이 환경에서는 안전한 대화 저장을 사용할 수 없습니다.');
    }
  }

  async function atomicWrite(encryptedHistory: Buffer): Promise<void> {
    const historyPath = getHistoryPath();
    const temporaryPath = `${historyPath}.${process.pid}.${randomUUID()}.tmp`;

    await mkdir(path.dirname(historyPath), { recursive: true });

    try {
      await writeFile(temporaryPath, encryptedHistory, {
        flag: 'wx',
        mode: 0o600,
      });

      for (
        let attempt = 0;
        attempt <= ATOMIC_RENAME_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        try {
          await rename(temporaryPath, historyPath);
          return;
        } catch (error) {
          const errorCode = getErrorCode(error);

          if (
            attempt === ATOMIC_RENAME_RETRY_DELAYS_MS.length ||
            (errorCode !== 'EPERM' && errorCode !== 'EBUSY' && errorCode !== 'EACCES')
          ) {
            throw error;
          }

          await delay(ATOMIC_RENAME_RETRY_DELAYS_MS[attempt]);
        }
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function persist(history: PersistedChatHistory): Promise<ChatHistorySaveResult> {
    await ensureEncryptionAvailable();
    try {
      const serializedHistory = JSON.stringify(history);
      const encryptedHistory = await safeStorage.encryptStringAsync(serializedHistory);

      await atomicWrite(encryptedHistory);
    } catch {
      throw new Error('대화 기록을 안전하게 저장하지 못했습니다.');
    }
    historyState = history;

    const result = {
      sessionCount: Object.keys(history.sessions).length,
      messageCount: countPersistedMessages(history),
    };

    console.info('[Mimora Chat Storage]', {
      sessions: result.sessionCount,
      messages: result.messageCount,
      save: 'success',
    });

    return result;
  }

  async function loadUnlocked(): Promise<ChatHistoryLoadResult> {
    try {
      await ensureEncryptionAvailable();
    } catch (error) {
      historyState = null;
      return {
        sessions: {},
        status: 'unavailable',
        error:
          error instanceof Error
            ? error.message
            : '이 환경에서는 안전한 대화 저장을 사용할 수 없습니다.',
      };
    }

    let encryptedHistory: Buffer;

    try {
      encryptedHistory = await readFile(getHistoryPath());
    } catch (error) {
      if (isFileNotFound(error)) {
        historyState = createPersistedChatHistory({});
        return { sessions: {}, status: 'ready' };
      }

      historyState = null;
      return {
        sessions: {},
        status: 'error',
        error: '저장된 대화 기록을 읽을 수 없습니다.',
      };
    }

    try {
      const decrypted = await safeStorage.decryptStringAsync(encryptedHistory);
      const parsed = parsePersistedChatHistory(JSON.parse(decrypted.result));

      historyState = parsed;

      if (decrypted.shouldReEncrypt) {
        await persist(parsed);
      }

      const sessions = restoreChatSessions(parsed);

      console.info('[Mimora Chat Storage]', {
        sessions: Object.keys(sessions).length,
        messages: countPersistedMessages(parsed),
        load: 'success',
      });

      return { sessions, status: 'ready' };
    } catch {
      historyState = null;
      return {
        sessions: {},
        status: 'corrupt',
        error:
          '저장된 대화 기록을 복원할 수 없습니다. 기존 파일은 변경하지 않았습니다.',
      };
    }
  }

  return {
    loadChatHistory: () => runExclusive(loadUnlocked),

    saveChatHistory: (input: unknown) =>
      runExclusive(async () => persist(parsePersistedChatHistory(input))),

    deleteWorkspaceChat: (workspaceId: unknown) =>
      runExclusive(async () => {
        if (!isKnownWorkspaceId(workspaceId)) {
          throw new Error('삭제할 Workspace 대화 정보가 올바르지 않습니다.');
        }

        if (!historyState) {
          const loaded = await loadUnlocked();

          if (loaded.status !== 'ready' || !historyState) {
            throw new Error(
              loaded.error ?? '저장된 대화 기록을 변경할 수 없습니다.',
            );
          }
        }

        const nextHistory: PersistedChatHistory = {
          ...historyState,
          sessions: { ...historyState.sessions },
        };

        delete nextHistory.sessions[workspaceId];
        return persist(nextHistory);
      }),
  };
}
