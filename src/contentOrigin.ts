import type { ContentOrigin, MimoraDocumentMetadata } from './metadata/types';

export type ContentOriginSearchScope = 'all' | 'original' | 'ai-derived';

export const contentOriginSearchScopes = [
  'all',
  'original',
  'ai-derived',
] as const satisfies readonly ContentOriginSearchScope[];

export const contentOriginSearchScopeLabels: Record<
  ContentOriginSearchScope,
  string
> = {
  all: '전체',
  original: '원본만',
  'ai-derived': 'AI Wiki만',
};

export function isContentOriginSearchScope(
  value: unknown,
): value is ContentOriginSearchScope {
  return (
    typeof value === 'string' &&
    contentOriginSearchScopes.includes(value as ContentOriginSearchScope)
  );
}

export function getEffectiveContentOrigin(
  metadata?: Pick<MimoraDocumentMetadata, 'contentOrigin'> | null,
): ContentOrigin {
  return metadata?.contentOrigin === 'ai-derived' ? 'ai-derived' : 'human';
}

export function isAiDerivedDocument(
  metadata?: Pick<MimoraDocumentMetadata, 'contentOrigin'> | null,
): boolean {
  return getEffectiveContentOrigin(metadata) === 'ai-derived';
}

export function documentMatchesContentOriginScope(
  metadata: Pick<MimoraDocumentMetadata, 'contentOrigin'>,
  scope: ContentOriginSearchScope = 'all',
): boolean {
  if (scope === 'all') {
    return true;
  }

  return getEffectiveContentOrigin(metadata) ===
    (scope === 'ai-derived' ? 'ai-derived' : 'human');
}
