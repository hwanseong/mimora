import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildDerivedKnowledgeMarkdown,
  normalizeDerivedKnowledgeDraft,
  validateDerivedKnowledgeDraft,
  type SaveDerivedKnowledgeInput,
  type SaveDerivedKnowledgeResult,
} from '../src/derivedKnowledge';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import type { createSettingsStore } from './settingsStore';

type SettingsStore = ReturnType<typeof createSettingsStore>;

const wikiDirectoryRelativePath = '_mimora/wiki';

function getFsErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AI Wiki Draft 입력값이 올바르지 않습니다.');
  }
}

function validateSaveInput(input: unknown): SaveDerivedKnowledgeInput {
  assertRecord(input);

  const candidate = input as Partial<SaveDerivedKnowledgeInput>;

  if (
    typeof candidate.title !== 'string' ||
    typeof candidate.content !== 'string' ||
    !Array.isArray(candidate.sourceDocuments) ||
    !Array.isArray(candidate.workspaceIds) ||
    !Array.isArray(candidate.knowledgeDomains) ||
    !Array.isArray(candidate.knowledgeTypes) ||
    typeof candidate.targetVaultId !== 'string' ||
    typeof candidate.documentId !== 'string' ||
    typeof candidate.filename !== 'string'
  ) {
    throw new Error('AI Wiki Draft 입력값이 올바르지 않습니다.');
  }

  const draft = normalizeDerivedKnowledgeDraft({
    title: candidate.title,
    content: candidate.content,
    sourceDocuments: candidate.sourceDocuments.flatMap((source) => {
      if (
        typeof source !== 'object' ||
        source === null ||
        Array.isArray(source)
      ) {
        return [];
      }

      const item = source as Partial<
        SaveDerivedKnowledgeInput['sourceDocuments'][number]
      >;

      return typeof item.vaultId === 'string' &&
        typeof item.relativePath === 'string' &&
        (item.security === 'normal' || item.security === 'private')
        ? [
            {
              vaultId: item.vaultId,
              ...(typeof item.documentId === 'string'
                ? { documentId: item.documentId }
                : {}),
              relativePath: item.relativePath,
              workspaceIds: Array.isArray(item.workspaceIds)
                ? item.workspaceIds.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
              originWorkspaceId:
                typeof item.originWorkspaceId === 'string'
                  ? item.originWorkspaceId
                  : null,
              knowledgeDomains: Array.isArray(item.knowledgeDomains)
                ? item.knowledgeDomains.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
              knowledgeTypes: Array.isArray(item.knowledgeTypes)
                ? item.knowledgeTypes.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
              security: item.security,
            },
          ]
        : [];
    }),
    workspaceIds: candidate.workspaceIds.filter(
      (value): value is string => typeof value === 'string',
    ),
    originWorkspaceId:
      typeof candidate.originWorkspaceId === 'string'
        ? candidate.originWorkspaceId
        : null,
    knowledgeDomains: candidate.knowledgeDomains.filter(
      (value): value is string => typeof value === 'string',
    ),
    knowledgeTypes: candidate.knowledgeTypes.filter(
      (value): value is string => typeof value === 'string',
    ),
    excludedKnowledgeSuggestions: Array.isArray(
      candidate.excludedKnowledgeSuggestions,
    )
      ? candidate.excludedKnowledgeSuggestions.flatMap((suggestion) => {
          if (
            typeof suggestion !== 'object' ||
            suggestion === null ||
            Array.isArray(suggestion)
          ) {
            return [];
          }

          const item = suggestion as Partial<
            SaveDerivedKnowledgeInput['excludedKnowledgeSuggestions'][number]
          >;

          return typeof item.value === 'string' &&
            (item.category === 'domain' || item.category === 'type')
            ? [
                {
                  value: item.value,
                  category: item.category,
                  reason: 'not-registered' as const,
                  sourceCount:
                    typeof item.sourceCount === 'number' ? item.sourceCount : 1,
                },
              ]
            : [];
        })
      : [],
    security: candidate.security === 'private' ? 'private' : 'normal',
    contentOrigin: 'ai-derived',
    targetVaultId: candidate.targetVaultId,
    documentId: candidate.documentId,
    filename: candidate.filename,
  });
  const errors = validateDerivedKnowledgeDraft(draft);

  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  return draft;
}

async function walkMarkdownFiles(
  rootPath: string,
  directoryPath: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkMarkdownFiles(rootPath, absolutePath, files);
    } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) {
      files.push(path.relative(rootPath, absolutePath).split(path.sep).join('/'));
    }
  }
}

async function assertDocumentIdIsUnique(
  settingsStore: SettingsStore,
  documentId: string,
): Promise<void> {
  const settings = await settingsStore.getSettings();

  for (const vault of settings.vaults) {
    let rootPath: string;

    try {
      rootPath = await realpath(path.resolve(vault.path));
    } catch {
      continue;
    }

    const files: string[] = [];

    try {
      await walkMarkdownFiles(rootPath, rootPath, files);
    } catch {
      continue;
    }

    for (const relativePath of files) {
      try {
        const absolutePath = path.resolve(rootPath, relativePath);
        const content = await readFile(absolutePath, 'utf8');
        const metadataResult = parseMimoraDocumentMetadata(content);

        if (metadataResult.metadata.documentId === documentId) {
          throw new Error('이미 존재하는 Document ID입니다.');
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === '이미 존재하는 Document ID입니다.'
        ) {
          throw error;
        }
      }
    }
  }
}

export function createDerivedKnowledgeService(settingsStore: SettingsStore) {
  return {
    async saveDerivedKnowledgeDraft(
      input: unknown,
    ): Promise<SaveDerivedKnowledgeResult> {
      const draft = validateSaveInput(input);
      const settings = await settingsStore.getSettings();
      const targetVault = settings.vaults.find(
        (vault) => vault.id === draft.targetVaultId,
      );

      if (!targetVault) {
        throw new Error('Target Vault를 찾을 수 없습니다.');
      }

      if (
        draft.security === 'private' &&
        targetVault.type !== 'private' &&
        targetVault.security === 'internal'
      ) {
        throw new Error(
          'Private AI Wiki Draft는 Private 성격의 Vault에만 저장할 수 있습니다.',
        );
      }

      const targetVaultRoot = await realpath(path.resolve(targetVault.path));
      const targetStats = await stat(targetVaultRoot);

      if (!targetStats.isDirectory()) {
        throw new Error('Target Vault 경로가 폴더가 아닙니다.');
      }

      const wikiDirectoryPath = path.resolve(
        targetVaultRoot,
        wikiDirectoryRelativePath,
      );
      const targetFilePath = path.resolve(wikiDirectoryPath, draft.filename);

      if (
        !isWithinRoot(targetVaultRoot, wikiDirectoryPath) ||
        !isWithinRoot(targetVaultRoot, targetFilePath)
      ) {
        throw new Error('AI Wiki 저장 경로가 Target Vault 밖으로 벗어났습니다.');
      }

      try {
        await stat(targetFilePath);
        throw new Error('같은 파일명이 이미 존재합니다. 다른 파일명을 입력하세요.');
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === '같은 파일명이 이미 존재합니다. 다른 파일명을 입력하세요.'
        ) {
          throw error;
        }

        if (getFsErrorCode(error) !== 'ENOENT') {
          throw error;
        }
      }

      await assertDocumentIdIsUnique(settingsStore, draft.documentId);
      await mkdir(wikiDirectoryPath, { recursive: true });
      await writeFile(targetFilePath, buildDerivedKnowledgeMarkdown(draft), {
        encoding: 'utf8',
        flag: 'wx',
      });

      return {
        vaultId: targetVault.id,
        relativePath: `${wikiDirectoryRelativePath}/${draft.filename}`,
        fileName: draft.filename,
        documentId: draft.documentId,
      };
    },
  };
}
