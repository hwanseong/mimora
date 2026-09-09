import type { MimoraDocumentMetadata } from '../metadata/types';
import { workspaceIdPattern, type Workspace } from '../workspace/types';
import {
  type MaskingEntry,
  type MaskingEntityType,
} from './maskingEngine';

export type MaskingContextDocument = {
  metadata?: MimoraDocumentMetadata;
  workspaceIds?: string[];
  originWorkspaceId?: string | null;
};

export type EffectiveMaskingSummary = {
  globalEntries: number;
  workspaceEntries: number;
  registryDerivedEntries: number;
  workspaceIds: string[];
  workspaceLabels: string[];
};

export type EffectiveMaskingResult = {
  entries: MaskingEntry[];
  summary: EffectiveMaskingSummary;
};

const registryDerivedDate = '1970-01-01T00:00:00.000Z';

function normalizeEntryScope(entry: MaskingEntry): MaskingEntry {
  return {
    ...entry,
    scope: entry.scope ?? 'global',
    source: entry.source ?? 'user',
  };
}

function collectDocumentWorkspaceIds(document: MaskingContextDocument): string[] {
  return [
    ...(document.metadata?.workspaceIds ?? []),
    ...(document.workspaceIds ?? []),
    document.metadata?.originWorkspaceId ?? document.originWorkspaceId ?? null,
  ].filter((workspaceId): workspaceId is string =>
    Boolean(workspaceId && workspaceId.trim()),
  );
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsValue(text: string, value: string): boolean {
  return Boolean(
    text &&
      value.trim() &&
      new RegExp(escapeRegularExpression(value.trim()), 'iu').test(text),
  );
}

export function collectActiveMaskingWorkspaceIds(
  documents: MaskingContextDocument[],
): string[] {
  const workspaceIds = new Set<string>();

  for (const document of documents) {
    for (const workspaceId of collectDocumentWorkspaceIds(document)) {
      workspaceIds.add(workspaceId);
    }
  }

  return [...workspaceIds];
}

function collectQuestionMatchedWorkspaceIds(input: {
  question: string;
  entries: MaskingEntry[];
  registryWorkspaces: Workspace[];
}): string[] {
  const workspaceIds = new Set<string>();

  for (const entry of input.entries) {
    if (
      entry.enabled &&
      entry.scope === 'workspace' &&
      entry.workspaceId &&
      containsValue(input.question, entry.value)
    ) {
      workspaceIds.add(entry.workspaceId);
    }
  }

  for (const workspace of input.registryWorkspaces) {
    if (
      containsValue(input.question, workspace.name) ||
      containsValue(input.question, workspace.id)
    ) {
      workspaceIds.add(workspace.id);
    }
  }

  return [...workspaceIds];
}

function collectApplicableMaskingWorkspaceIds(input: {
  currentWorkspaceId?: string;
  question: string;
  documents: MaskingContextDocument[];
  entries: MaskingEntry[];
  registryWorkspaces: Workspace[];
}): string[] {
  const workspaceIds = new Set<string>();

  if (
    input.currentWorkspaceId &&
    workspaceIdPattern.test(input.currentWorkspaceId)
  ) {
    workspaceIds.add(input.currentWorkspaceId);
  }

  for (const workspaceId of collectQuestionMatchedWorkspaceIds(input)) {
    workspaceIds.add(workspaceId);
  }

  for (const workspaceId of collectActiveMaskingWorkspaceIds(input.documents)) {
    workspaceIds.add(workspaceId);
  }

  return [...workspaceIds];
}

function getWorkspaceEntityType(workspace: Workspace): MaskingEntityType {
  if (workspace.type === 'project') {
    return 'project';
  }

  if (workspace.type === 'operation') {
    return 'operation';
  }

  return 'workspace';
}

function getNextAlias(
  type: MaskingEntityType,
  sequences: Map<MaskingEntityType, number>,
): string {
  const nextSequence = (sequences.get(type) ?? 0) + 1;

  sequences.set(type, nextSequence);
  return `${type.toUpperCase()}_${String(nextSequence).padStart(3, '0')}`;
}

function seedAliasSequences(entries: MaskingEntry[]): Map<MaskingEntityType, number> {
  const sequences = new Map<MaskingEntityType, number>();

  for (const entry of entries) {
    const match = new RegExp(`^${entry.type.toUpperCase()}_(\\d+)$`, 'u').exec(
      entry.alias,
    );

    if (!match) {
      continue;
    }

    sequences.set(
      entry.type,
      Math.max(sequences.get(entry.type) ?? 0, Number(match[1])),
    );
  }

  return sequences;
}

function createRegistryEntry(input: {
  workspaceId: string;
  type: MaskingEntityType;
  value: string;
  alias: string;
  suffix: string;
}): MaskingEntry {
  return {
    id: `registry:${input.workspaceId}:${input.suffix}`,
    type: input.type,
    value: input.value,
    alias: input.alias,
    scope: 'workspace',
    workspaceId: input.workspaceId,
    source: 'registry',
    enabled: true,
    createdAt: registryDerivedDate,
    updatedAt: registryDerivedDate,
  };
}

export function createRegistryDerivedMaskingEntries(input: {
  workspaceIds: string[];
  registryWorkspaces: Workspace[];
  existingEntries: MaskingEntry[];
}): MaskingEntry[] {
  const workspaceIds = new Set(input.workspaceIds);
  const workspacesById = new Map(
    input.registryWorkspaces.map((workspace) => [workspace.id, workspace]),
  );
  const sequences = seedAliasSequences(input.existingEntries);
  const entries: MaskingEntry[] = [];

  for (const workspaceId of workspaceIds) {
    const workspace = workspacesById.get(workspaceId);

    if (!workspace) {
      entries.push(
        createRegistryEntry({
          workspaceId,
          type: 'workspace',
          value: workspaceId,
          alias: getNextAlias('workspace', sequences),
          suffix: 'id',
        }),
      );
      continue;
    }

    if (workspace.name.trim()) {
      const type = getWorkspaceEntityType(workspace);

      entries.push(
        createRegistryEntry({
          workspaceId,
          type,
          value: workspace.name,
          alias: getNextAlias(type, sequences),
          suffix: 'name',
        }),
      );
    }

    entries.push(
      createRegistryEntry({
        workspaceId,
        type: 'workspace',
        value: workspace.id,
        alias: getNextAlias('workspace', sequences),
        suffix: 'id',
      }),
    );
  }

  return entries;
}

export function createEffectiveMaskingEntries(input: {
  entries: MaskingEntry[];
  currentWorkspaceId?: string;
  question?: string;
  documents: MaskingContextDocument[];
  registryWorkspaces?: Workspace[];
}): EffectiveMaskingResult {
  const normalizedEntries = input.entries.map(normalizeEntryScope);
  const registryWorkspaces = input.registryWorkspaces ?? [];
  const activeWorkspaceIds = collectApplicableMaskingWorkspaceIds({
    currentWorkspaceId: input.currentWorkspaceId,
    question: input.question ?? '',
    documents: input.documents,
    entries: normalizedEntries,
    registryWorkspaces,
  });
  const activeWorkspaceIdSet = new Set(activeWorkspaceIds);
  const globalEntries = normalizedEntries.filter(
    (entry) => entry.scope === 'global',
  );
  const workspaceEntries = normalizedEntries.filter(
    (entry) =>
      entry.scope === 'workspace' &&
      Boolean(entry.workspaceId) &&
      activeWorkspaceIdSet.has(entry.workspaceId ?? ''),
  );
  const registryDerivedEntries = createRegistryDerivedMaskingEntries({
    workspaceIds: activeWorkspaceIds,
    registryWorkspaces,
    existingEntries: [...globalEntries, ...workspaceEntries],
  });
  const workspacesById = new Map(
    registryWorkspaces.map((workspace) => [
      workspace.id,
      workspace,
    ]),
  );

  return {
    entries: [...globalEntries, ...workspaceEntries, ...registryDerivedEntries],
    summary: {
      globalEntries: globalEntries.length,
      workspaceEntries: workspaceEntries.length,
      registryDerivedEntries: registryDerivedEntries.length,
      workspaceIds: activeWorkspaceIds,
      workspaceLabels: activeWorkspaceIds.map(
        (workspaceId) => workspacesById.get(workspaceId)?.name ?? workspaceId,
      ),
    },
  };
}
