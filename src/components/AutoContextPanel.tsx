import { useState } from 'react';
import type { AutoRetrievedContext } from '../autoContext';
import {
  contentOriginSearchScopeLabels,
  isAiDerivedDocument,
} from '../contentOrigin';
import type { SearchScopeSnapshot } from '../searchScope';
import { vaultSecurityLabels, vaultTypeLabels } from '../settings';

export function AutoContextPanel({
  contexts,
  error,
  searchScopeSnapshot,
  status,
}: {
  contexts: AutoRetrievedContext[];
  error?: string;
  searchScopeSnapshot?: SearchScopeSnapshot;
  status: 'loading' | 'complete' | 'error';
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );

  if (status === 'loading') {
    return (
      <div className="auto-context-state" role="status">
        관련 문서 검색 중...
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="auto-context-state error" role="status" title={error}>
        자동 참조 검색을 완료하지 못했습니다.
      </div>
    );
  }

  if (contexts.length === 0) {
    return <div className="auto-context-state">자동 참조 문서 0개</div>;
  }

  const selectedContext =
    contexts.find((context) => context.documentId === selectedDocumentId) ??
    null;
  const containsSensitive = contexts.some(
    (context) =>
      context.vaultType === 'private' || context.security === 'sensitive',
  );
  const hasSearchScopeSnapshot = Boolean(
    searchScopeSnapshot &&
      (searchScopeSnapshot.includeArchived ||
        searchScopeSnapshot.domain ||
        searchScopeSnapshot.type ||
        searchScopeSnapshot.contentOriginScope !== 'all'),
  );

  return (
    <details className="auto-context-details">
      <summary>
        <span>자동 참조 문서 {contexts.length}개</span>
        {containsSensitive ? <span>Sensitive 포함</span> : null}
      </summary>
      <div className="auto-context-body">
        {hasSearchScopeSnapshot && searchScopeSnapshot ? (
          <small className="auto-context-scope">
            Search Scope · Archived:{' '}
            {searchScopeSnapshot.includeArchived ? 'Included' : 'Excluded'}
            {searchScopeSnapshot.domain
              ? ` · Domain: ${searchScopeSnapshot.domain}`
              : ''}
            {searchScopeSnapshot.type
              ? ` · Type: ${searchScopeSnapshot.type}`
              : ''}
            {searchScopeSnapshot.contentOriginScope !== 'all'
              ? ` · Source: ${
                  contentOriginSearchScopeLabels[
                    searchScopeSnapshot.contentOriginScope
                  ]
                }`
              : ''}
          </small>
        ) : null}
        <div className="auto-context-documents">
          {contexts.map((context) => {
            const isAiDerived = isAiDerivedDocument(context.metadata);

            return (
              <button
                aria-pressed={selectedDocumentId === context.documentId}
                className={
                  selectedDocumentId === context.documentId ? 'active' : undefined
                }
                key={context.documentId}
                onClick={() => {
                  setSelectedDocumentId((currentId) =>
                    currentId === context.documentId ? null : context.documentId,
                  );
                }}
                title={`${context.vaultName} · ${context.relativePath} · ${vaultSecurityLabels[context.security]}`}
                type="button"
              >
                <span>{context.fileName}</span>
                {isAiDerived ? (
                  <span className="ai-derived-inline-badge">AI Wiki</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {selectedContext ? (
          <div className="auto-context-preview" aria-label="자동 참조 상세">
            <div className="auto-context-preview-meta">
              <strong>{selectedContext.fileName}</strong>
              <span>
                {selectedContext.vaultName} ·{' '}
                {vaultTypeLabels[selectedContext.vaultType]} ·{' '}
                {vaultSecurityLabels[selectedContext.security]} · score{' '}
                {selectedContext.score}
              </span>
            </div>
            <p>{selectedContext.snippet}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
