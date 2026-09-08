export type KnowledgeSearchFilters = {
  domains: string[];
  types: string[];
};

export const emptyKnowledgeSearchFilters: KnowledgeSearchFilters = {
  domains: [],
  types: [],
};

export function normalizeKnowledgeSearchFilters(
  filters?: Partial<KnowledgeSearchFilters> | null,
): KnowledgeSearchFilters {
  return {
    domains: [
      ...new Set(
        (filters?.domains ?? [])
          .map((domain) => domain.trim())
          .filter(Boolean),
      ),
    ],
    types: [
      ...new Set(
        (filters?.types ?? [])
          .map((type) => type.trim())
          .filter(Boolean),
      ),
    ],
  };
}

export function hasActiveKnowledgeSearchFilters(
  filters?: KnowledgeSearchFilters | null,
): boolean {
  return Boolean(filters && (filters.domains.length > 0 || filters.types.length > 0));
}
