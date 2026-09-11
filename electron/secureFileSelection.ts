import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ragSupportedExtensions,
  type RagFileSelection,
} from '../src/rag';
import {
  scheduleSupportedExtensions,
  type ScheduleFileSelection,
} from '../src/schedule';

export type FileSelectionPurpose =
  | 'rag-import'
  | 'rag-replace'
  | 'schedule-register';

export type PendingFileSelection = {
  path: string;
  purpose: FileSelectionPurpose;
  createdAt: number;
};

export class SecureFileSelectionError extends Error {
  constructor(
    public readonly code:
      | 'invalid_selection_id'
      | 'expired_selection_id'
      | 'selection_purpose_mismatch'
      | 'unsupported_file_type'
      | 'selected_file_missing',
    message: string,
  ) {
    super(message);
    this.name = 'SecureFileSelectionError';
  }
}

const defaultSelectionTtlMs = 10 * 60 * 1000;
const rawPathKeys = ['sourcePath', 'absolutePath', 'filePath', 'path'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSelectionOnlyIpcInput<T extends object>(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): T {
  if (!isRecord(value)) {
    throw new SecureFileSelectionError(
      'invalid_selection_id',
      `${label} input is invalid.`,
    );
  }

  const hasRawPathKey = rawPathKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );

  if (hasRawPathKey) {
    throw new SecureFileSelectionError(
      'invalid_selection_id',
      `${label} requires a native file selectionId. Raw local paths are not accepted.`,
    );
  }

  const allowedKeySet = new Set(allowedKeys);

  if (!Object.keys(value).every((key) => allowedKeySet.has(key))) {
    throw new SecureFileSelectionError(
      'invalid_selection_id',
      `${label} input is invalid.`,
    );
  }

  return value as T;
}

function getAllowedExtensions(
  purpose: FileSelectionPurpose,
): readonly string[] {
  if (purpose === 'schedule-register') {
    return scheduleSupportedExtensions;
  }

  return ragSupportedExtensions;
}

async function assertSupportedExistingFile(
  filePath: string,
  purpose: FileSelectionPurpose,
): Promise<string> {
  const normalizedPath = path.resolve(filePath);
  const extension = path.extname(normalizedPath).toLocaleLowerCase();

  if (!getAllowedExtensions(purpose).includes(extension)) {
    throw new SecureFileSelectionError(
      'unsupported_file_type',
      purpose === 'schedule-register'
        ? '지원하지 않는 일정 파일 형식입니다. .xlsx 또는 .xlsm 파일을 선택하세요.'
        : '지원하지 않는 RAG 문서 형식입니다. .pdf, .docx, .md, .txt 파일을 선택하세요.',
    );
  }

  try {
    const stats = await stat(normalizedPath);

    if (!stats.isFile()) {
      throw new SecureFileSelectionError(
        'selected_file_missing',
        '선택한 파일을 찾을 수 없습니다.',
      );
    }
  } catch (error) {
    if (error instanceof SecureFileSelectionError) {
      throw error;
    }

    throw new SecureFileSelectionError(
      'selected_file_missing',
      '선택한 파일을 찾을 수 없습니다.',
    );
  }

  return normalizedPath;
}

export function createSecureFileSelectionStore(options?: {
  ttlMs?: number;
  now?: () => number;
}) {
  const selections = new Map<string, PendingFileSelection>();
  const ttlMs = options?.ttlMs ?? defaultSelectionTtlMs;
  const now = options?.now ?? (() => Date.now());

  async function create(
    filePath: string,
    purpose: FileSelectionPurpose,
  ): Promise<RagFileSelection | ScheduleFileSelection> {
    const normalizedPath = await assertSupportedExistingFile(filePath, purpose);
    const selectionId = randomUUID();

    selections.set(selectionId, {
      path: normalizedPath,
      purpose,
      createdAt: now(),
    });

    return {
      selectionId,
      name: path.basename(normalizedPath),
    };
  }

  async function consume(
    selectionId: unknown,
    purpose: FileSelectionPurpose,
  ): Promise<string> {
    if (typeof selectionId !== 'string' || !selectionId.trim()) {
      throw new SecureFileSelectionError(
        'invalid_selection_id',
        '파일 선택 정보가 올바르지 않습니다. 파일을 다시 선택하세요.',
      );
    }

    const selection = selections.get(selectionId);

    if (!selection) {
      throw new SecureFileSelectionError(
        'invalid_selection_id',
        '파일 선택 정보가 만료되었거나 존재하지 않습니다. 파일을 다시 선택하세요.',
      );
    }

    selections.delete(selectionId);

    if (now() - selection.createdAt > ttlMs) {
      throw new SecureFileSelectionError(
        'expired_selection_id',
        '파일 선택 정보가 만료되었습니다. 파일을 다시 선택하세요.',
      );
    }

    if (selection.purpose !== purpose) {
      throw new SecureFileSelectionError(
        'selection_purpose_mismatch',
        '선택한 파일을 이 작업에 사용할 수 없습니다. 파일을 다시 선택하세요.',
      );
    }

    return assertSupportedExistingFile(selection.path, purpose);
  }

  function size(): number {
    return selections.size;
  }

  return {
    create,
    consume,
    size,
  };
}

export type SecureFileSelectionStore = ReturnType<
  typeof createSecureFileSelectionStore
>;
