import { isAiDerivedDocument } from '../contentOrigin';
import type { LLMContextSource } from '../llmChat';
import { vaultSecurityLabels } from '../settings';

export function SourcesList({ sources }: { sources: LLMContextSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="message-sources" aria-label="응답 출처">
      <strong>Sources</strong>
      <ul>
        {sources.map((source) => {
          const isProtected =
            source.vaultType === 'private' ||
            source.security === 'sensitive';
          const isAiDerived = isAiDerivedDocument(source.metadata);

          return (
            <li
              key={JSON.stringify([source.vaultId, source.relativePath])}
              title={`${source.relativePath} · ${vaultSecurityLabels[source.security]}`}
            >
              <span>{source.fileName}</span>
              <span> · {source.vaultName}</span>
              {isAiDerived ? (
                <span className="ai-derived-source-badge">AI Wiki</span>
              ) : null}
              {isProtected ? <span>Protected</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
