import {
  emptyKnowledgeSearchFilters,
  normalizeKnowledgeSearchFilters,
  type KnowledgeSearchFilters,
} from './knowledgeSearch';
import {
  isContentOriginSearchScope,
  type ContentOriginSearchScope,
} from './contentOrigin';

export type GlobalSearchScope = {
  includeArchived: boolean;
  knowledgeDomains: string[];
  knowledgeTypes: string[];
  contentOriginScope: ContentOriginSearchScope;
};

export type SearchScopeSnapshot = {
  includeArchived: boolean;
  domain?: string | null;
  type?: string | null;
  contentOriginScope: ContentOriginSearchScope;
};

export type SearchScopedHistoryMessage = {
  role: 'user' | 'assistant';
  searchScopeSnapshot?: SearchScopeSnapshot;
};

export const defaultGlobalSearchScope: GlobalSearchScope = {
  includeArchived: false,
  knowledgeDomains: [],
  knowledgeTypes: [],
  contentOriginScope: 'all',
};

function normalizeSnapshotValue(value?: string | null): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : null;
}

function normalizeSearchScopeSnapshot(
  snapshot?: SearchScopeSnapshot | null,
): SearchScopeSnapshot {
  return {
    includeArchived: snapshot?.includeArchived === true,
    domain: normalizeSnapshotValue(snapshot?.domain),
    type: normalizeSnapshotValue(snapshot?.type),
    contentOriginScope: isContentOriginSearchScope(
      snapshot?.contentOriginScope,
    )
      ? snapshot.contentOriginScope
      : 'all',
  };
}

export function createGlobalSearchScope(
  includeArchived: boolean,
  knowledgeFilters: KnowledgeSearchFilters = emptyKnowledgeSearchFilters,
  contentOriginScope: ContentOriginSearchScope = 'all',
): GlobalSearchScope {
  const normalizedFilters = normalizeKnowledgeSearchFilters(knowledgeFilters);

  return {
    includeArchived,
    knowledgeDomains: normalizedFilters.domains,
    knowledgeTypes: normalizedFilters.types,
    contentOriginScope,
  };
}

export function createSearchScopeSnapshot(
  searchScope: GlobalSearchScope,
): SearchScopeSnapshot {
  return {
    includeArchived: searchScope.includeArchived,
    domain: normalizeSnapshotValue(searchScope.knowledgeDomains[0]),
    type: normalizeSnapshotValue(searchScope.knowledgeTypes[0]),
    contentOriginScope: searchScope.contentOriginScope,
  };
}

export function createKnowledgeSearchFiltersFromScope(
  searchScope: GlobalSearchScope,
): KnowledgeSearchFilters {
  return {
    domains: [...searchScope.knowledgeDomains],
    types: [...searchScope.knowledgeTypes],
  };
}

export function hasActiveSearchScopeSnapshot(
  snapshot?: SearchScopeSnapshot | null,
): boolean {
  const normalizedSnapshot = normalizeSearchScopeSnapshot(snapshot);

  return Boolean(
    normalizedSnapshot.includeArchived ||
      normalizedSnapshot.domain ||
      normalizedSnapshot.type ||
      normalizedSnapshot.contentOriginScope !== 'all',
  );
}

export function areSearchScopeSnapshotsEqual(
  left?: SearchScopeSnapshot | null,
  right?: SearchScopeSnapshot | null,
): boolean {
  const normalizedLeft = normalizeSearchScopeSnapshot(left);
  const normalizedRight = normalizeSearchScopeSnapshot(right);

  return (
    normalizedLeft.includeArchived === normalizedRight.includeArchived &&
    normalizedLeft.domain === normalizedRight.domain &&
    normalizedLeft.type === normalizedRight.type &&
    normalizedLeft.contentOriginScope === normalizedRight.contentOriginScope
  );
}

function shouldRetainHistoryTurnForScope(
  turnSnapshot: SearchScopeSnapshot | undefined,
  currentSnapshot: SearchScopeSnapshot,
): boolean {
  if (turnSnapshot) {
    return areSearchScopeSnapshotsEqual(turnSnapshot, currentSnapshot);
  }

  return !hasActiveSearchScopeSnapshot(currentSnapshot);
}

export function selectSearchScopeHistoryMessages<
  Message extends SearchScopedHistoryMessage,
>(
  messages: Message[],
  currentSnapshot: SearchScopeSnapshot,
  limit: number,
): Message[] {
  const selectedMessages: Message[] = [];
  let currentTurnMatches = !hasActiveSearchScopeSnapshot(currentSnapshot);

  for (const message of messages) {
    if (message.role === 'user') {
      currentTurnMatches = shouldRetainHistoryTurnForScope(
        message.searchScopeSnapshot,
        currentSnapshot,
      );
    } else if (message.searchScopeSnapshot) {
      currentTurnMatches = shouldRetainHistoryTurnForScope(
        message.searchScopeSnapshot,
        currentSnapshot,
      );
    }

    if (currentTurnMatches) {
      selectedMessages.push(message);
    }
  }

  return selectedMessages.slice(-limit);
}
