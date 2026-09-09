import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createWorkspaceInsightStorePayload,
  parseWorkspaceInsightSnapshots,
  type WorkspaceInsightSnapshot,
  type WorkspaceInsightSnapshots,
  type WorkspaceInsightStoreLoadResult,
  type WorkspaceInsightStoreSaveResult,
} from '../src/workspaceInsight';
import type { SafeStorageAdapter } from './openAICredentialStore';

type WorkspaceInsightStoreOptions = {
  getInsightPath: () => string;
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

export function createWorkspaceInsightStore({
  getInsightPath,
  safeStorage,
  platform = process.platform,
}: WorkspaceInsightStoreOptions) {
  let operationQueue = Promise.resolve();
  let snapshotState: WorkspaceInsightSnapshots | null = null;

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
      throw new Error('현재 환경에서 안전한 Insight 저장소를 사용할 수 없습니다.');
    }

    if (
      platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new Error('현재 환경에서 안전한 Insight 저장소를 사용할 수 없습니다.');
    }
  }

  async function atomicWrite(encryptedPayload: Buffer): Promise<void> {
    const insightPath = getInsightPath();
    const temporaryPath = `${insightPath}.${process.pid}.${randomUUID()}.tmp`;

    await mkdir(path.dirname(insightPath), { recursive: true });

    try {
      await writeFile(temporaryPath, encryptedPayload, {
        flag: 'wx',
        mode: 0o600,
      });

      for (
        let attempt = 0;
        attempt <= ATOMIC_RENAME_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        try {
          await rename(temporaryPath, insightPath);
          return;
        } catch (error) {
          const errorCode = getErrorCode(error);

          if (
            attempt === ATOMIC_RENAME_RETRY_DELAYS_MS.length ||
            (errorCode !== 'EPERM' &&
              errorCode !== 'EBUSY' &&
              errorCode !== 'EACCES')
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

  async function persist(
    snapshots: WorkspaceInsightSnapshots,
  ): Promise<WorkspaceInsightStoreSaveResult> {
    await ensureEncryptionAvailable();

    try {
      const serializedPayload = JSON.stringify(
        createWorkspaceInsightStorePayload(snapshots),
      );
      const encryptedPayload =
        await safeStorage.encryptStringAsync(serializedPayload);

      await atomicWrite(encryptedPayload);
    } catch {
      throw new Error('AI Insight snapshot을 안전하게 저장하지 못했습니다.');
    }

    snapshotState = snapshots;

    return {
      snapshotCount: Object.keys(snapshots).length,
    };
  }

  async function loadUnlocked(): Promise<WorkspaceInsightStoreLoadResult> {
    try {
      await ensureEncryptionAvailable();
    } catch (error) {
      snapshotState = null;
      return {
        snapshots: {},
        status: 'unavailable',
        error:
          error instanceof Error
            ? error.message
            : '현재 환경에서 안전한 Insight 저장소를 사용할 수 없습니다.',
      };
    }

    let encryptedPayload: Buffer;

    try {
      encryptedPayload = await readFile(getInsightPath());
    } catch (error) {
      if (isFileNotFound(error)) {
        snapshotState = {};
        return { snapshots: {}, status: 'ready' };
      }

      snapshotState = null;
      return {
        snapshots: {},
        status: 'error',
        error: '저장된 AI Insight snapshot을 읽을 수 없습니다.',
      };
    }

    try {
      const decrypted = await safeStorage.decryptStringAsync(encryptedPayload);
      const snapshots = parseWorkspaceInsightSnapshots(
        JSON.parse(decrypted.result) as unknown,
      );

      snapshotState = snapshots;

      if (decrypted.shouldReEncrypt) {
        await persist(snapshots);
      }

      return { snapshots, status: 'ready' };
    } catch {
      snapshotState = null;
      return {
        snapshots: {},
        status: 'corrupt',
        error: '저장된 AI Insight snapshot을 복원할 수 없습니다.',
      };
    }
  }

  return {
    loadWorkspaceInsights: () => runExclusive(loadUnlocked),

    saveWorkspaceInsight: (snapshot: WorkspaceInsightSnapshot) =>
      runExclusive(async () => {
        if (!snapshotState) {
          const loaded = await loadUnlocked();

          if (loaded.status !== 'ready') {
            throw new Error(
              loaded.error ?? 'AI Insight snapshot을 저장할 수 없습니다.',
            );
          }
        }

        const nextSnapshots = {
          ...(snapshotState ?? {}),
          [snapshot.workspaceId]: snapshot,
        };

        return persist(nextSnapshots);
      }),
  };
}
