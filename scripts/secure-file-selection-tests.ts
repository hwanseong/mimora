import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSecureFileSelectionStore,
  SecureFileSelectionError,
  validateSelectionOnlyIpcInput,
} from '../electron/secureFileSelection';
import type {
  RagImportInput,
  RagReplaceInput,
} from '../src/rag';
import type { ScheduleRegisterInput } from '../src/schedule';

const root = await mkdtemp(path.join(os.tmpdir(), 'mimora-secure-selection-'));

function expectSecureError(
  operation: () => Promise<unknown> | unknown,
  code: SecureFileSelectionError['code'],
): Promise<void> {
  return assert.rejects(
    async () => operation(),
    (error: unknown) =>
      error instanceof SecureFileSelectionError && error.code === code,
  );
}

try {
  const ragPath = path.join(root, 'project-plan.md');
  const ragReplacementPath = path.join(root, 'replacement.txt');
  const schedulePath = path.join(root, 'WS-2026-0001_Schedule.xlsm');
  const unsupportedPath = path.join(root, 'schedule.xls');
  const missingPath = path.join(root, 'missing.md');

  await writeFile(ragPath, '# Project plan\n', 'utf8');
  await writeFile(ragReplacementPath, 'replacement\n', 'utf8');
  await writeFile(schedulePath, Buffer.from('schedule'));
  await writeFile(unsupportedPath, Buffer.from('unsupported'));

  const store = createSecureFileSelectionStore();

  const ragSelection = await store.create(ragPath, 'rag-import');
  assert.equal(ragSelection.name, 'project-plan.md');
  assert.equal(await store.consume(ragSelection.selectionId, 'rag-import'), ragPath);

  await expectSecureError(
    () => store.consume(ragSelection.selectionId, 'rag-import'),
    'invalid_selection_id',
  );

  const scheduleSelection = await store.create(schedulePath, 'schedule-register');
  assert.equal(scheduleSelection.name, 'WS-2026-0001_Schedule.xlsm');
  assert.equal(
    await store.consume(scheduleSelection.selectionId, 'schedule-register'),
    schedulePath,
  );

  const ragForWrongPurpose = await store.create(ragPath, 'rag-import');
  await expectSecureError(
    () => store.consume(ragForWrongPurpose.selectionId, 'schedule-register'),
    'selection_purpose_mismatch',
  );
  await expectSecureError(
    () => store.consume(ragForWrongPurpose.selectionId, 'rag-import'),
    'invalid_selection_id',
  );

  const scheduleForWrongPurpose = await store.create(
    schedulePath,
    'schedule-register',
  );
  await expectSecureError(
    () => store.consume(scheduleForWrongPurpose.selectionId, 'rag-import'),
    'selection_purpose_mismatch',
  );

  await expectSecureError(
    () => store.create(unsupportedPath, 'schedule-register'),
    'unsupported_file_type',
  );
  await expectSecureError(
    () => store.create(unsupportedPath, 'rag-import'),
    'unsupported_file_type',
  );
  await expectSecureError(
    () => store.create(missingPath, 'rag-import'),
    'selected_file_missing',
  );

  let now = 1_000;
  const expiringStore = createSecureFileSelectionStore({
    ttlMs: 100,
    now: () => now,
  });
  const expiringSelection = await expiringStore.create(ragPath, 'rag-import');
  now += 101;
  await expectSecureError(
    () => expiringStore.consume(expiringSelection.selectionId, 'rag-import'),
    'expired_selection_id',
  );

  const replaceSelection = await store.create(ragReplacementPath, 'rag-replace');
  assert.equal(
    await store.consume(replaceSelection.selectionId, 'rag-replace'),
    ragReplacementPath,
  );

  const importInput = validateSelectionOnlyIpcInput<RagImportInput>(
    {
      selectionId: 'selection-id',
      workspaceIds: ['WS-2026-0001'],
      security: 'internal',
    },
    ['selectionId', 'workspaceIds', 'security'],
    'RAG import',
  );
  assert.equal(importInput.selectionId, 'selection-id');

  const replaceInput = validateSelectionOnlyIpcInput<RagReplaceInput>(
    {
      ragDocumentId: 'RAG-2026-000001',
      selectionId: 'selection-id',
    },
    ['ragDocumentId', 'selectionId'],
    'RAG replace',
  );
  assert.equal(replaceInput.ragDocumentId, 'RAG-2026-000001');

  const scheduleInput =
    validateSelectionOnlyIpcInput<ScheduleRegisterInput>(
      {
        workspaceId: 'WS-2026-0001',
        selectionId: 'selection-id',
      },
      ['workspaceId', 'selectionId'],
      'Schedule register',
    );
  assert.equal(scheduleInput.workspaceId, 'WS-2026-0001');

  assert.throws(
    () =>
      validateSelectionOnlyIpcInput<RagImportInput>(
        {
          sourcePath: ragPath,
          workspaceIds: ['WS-2026-0001'],
          security: 'internal',
        },
        ['selectionId', 'workspaceIds', 'security'],
        'RAG import',
      ),
    /Raw local paths are not accepted/u,
  );

  await unlink(ragPath);
  const missingAfterSelection = await store.create(ragReplacementPath, 'rag-import');
  await unlink(ragReplacementPath);
  await expectSecureError(
    () => store.consume(missingAfterSelection.selectionId, 'rag-import'),
    'selected_file_missing',
  );

  assert.equal(store.size(), 0);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('secure-file-selection-tests passed');
