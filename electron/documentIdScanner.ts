import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { documentIdPattern } from '../src/metadata/types';
import { parseMimoraDocumentMetadata } from '../src/metadata/mimoraMetadataParser';
import type { SuggestedDocumentIdResult } from '../src/derivedKnowledge';
import type { createSettingsStore } from './settingsStore';
import { isOfficialRegistryMarkdownPath } from './vaultFiles';

type SettingsStore = ReturnType<typeof createSettingsStore>;

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function normalizeVaultRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/gu, '/').replace(/^\/+/u, '');
}

async function walkMarkdownFiles(
  rootPath: string,
  directoryPath: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    let entryStats;

    try {
      entryStats = await lstat(entryPath);
    } catch {
      continue;
    }

    if (entryStats.isSymbolicLink()) {
      continue;
    }

    if (entryStats.isDirectory()) {
      try {
        const canonicalDirectoryPath = await realpath(entryPath);

        if (isWithinRoot(rootPath, canonicalDirectoryPath)) {
          await walkMarkdownFiles(rootPath, canonicalDirectoryPath, files);
        }
      } catch {
        continue;
      }
    } else if (
      entryStats.isFile() &&
      path.extname(entry.name).toLocaleLowerCase() === '.md'
    ) {
      const relativePath = normalizeVaultRelativePath(
        path.relative(rootPath, entryPath),
      );

      if (!isOfficialRegistryMarkdownPath(relativePath)) {
        files.push(relativePath);
      }
    }
  }
}

function getSuggestionYear(generatedAt?: string | null): number {
  if (generatedAt?.trim()) {
    const parsedDate = new Date(generatedAt);

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.getFullYear();
    }
  }

  return new Date().getFullYear();
}

function getDocumentIdSequenceForYear(
  documentId: string,
  year: number,
): number | null {
  if (!documentIdPattern.test(documentId)) {
    return null;
  }

  const [, documentYear, sequence] =
    /^DOC-(\d{4})-(\d{4})$/u.exec(documentId) ?? [];

  if (Number(documentYear) !== year) {
    return null;
  }

  return Number(sequence);
}

export async function scanValidDocumentIds(
  settingsStore: SettingsStore,
): Promise<string[]> {
  const settings = await settingsStore.getSettings();
  const documentIds: string[] = [];

  for (const vault of settings.vaults) {
    let rootPath: string;

    try {
      rootPath = await realpath(path.resolve(vault.path));
      const rootStats = await stat(rootPath);

      if (!rootStats.isDirectory()) {
        continue;
      }
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

        if (!isWithinRoot(rootPath, absolutePath)) {
          continue;
        }

        const content = await readFile(absolutePath, 'utf8');
        const documentId = parseMimoraDocumentMetadata(content)
          .metadata.documentId?.trim();

        if (documentId && documentIdPattern.test(documentId)) {
          documentIds.push(documentId);
        }
      } catch {
        continue;
      }
    }
  }

  return [...new Set(documentIds)];
}

export async function suggestNextDocumentId(input: {
  settingsStore: SettingsStore;
  generatedAt?: string | null;
}): Promise<SuggestedDocumentIdResult> {
  const year = getSuggestionYear(input.generatedAt);
  const documentIds = await scanValidDocumentIds(input.settingsStore);
  const maxSequence = documentIds.reduce((currentMax, documentId) => {
    const sequence = getDocumentIdSequenceForYear(documentId, year);

    return sequence === null ? currentMax : Math.max(currentMax, sequence);
  }, 0);
  const sequence = maxSequence + 1;

  return {
    documentId: `DOC-${year}-${String(sequence).padStart(4, '0')}`,
    year,
    sequence,
    scannedDocumentCount: documentIds.length,
  };
}

export async function isDocumentIdAvailable(input: {
  settingsStore: SettingsStore;
  documentId: string;
}): Promise<boolean> {
  const documentIds = await scanValidDocumentIds(input.settingsStore);

  return !documentIds.includes(input.documentId);
}
