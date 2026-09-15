import { isAiDerivedDocument } from '../contentOrigin';
import type { LLMContextSource } from '../llmChat';
import { vaultSecurityLabels } from '../settings';

export function SourcesList({ sources }: { sources: LLMContextSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="message-sources" aria-label="응답 출처">
      <strong>출처</strong>
      <ul>
        {sources.map((source) => {
          const isRagSource = source.sourceType === 'rag';
          const isScheduleSource = source.sourceType === 'schedule';
          const isIssueSource = source.sourceType === 'issue';
          const isProtected =
            source.vaultType === 'private' ||
            source.security === 'sensitive';
          const isPrivateDocument =
            source.documentSecurity === 'private' ||
            source.metadata?.security === 'private';
          const isAiDerived = isAiDerivedDocument(source.metadata);
          const documentId = source.metadata?.documentId?.trim();

          return (
            <li
              key={JSON.stringify([
                source.vaultId,
                source.relativePath,
                source.ragDocumentId ?? '',
                source.page ?? '',
                source.heading ?? '',
              ])}
              title={`${source.relativePath} · ${vaultSecurityLabels[source.security]}`}
            >
              <span>{source.fileName}</span>
              {isRagSource ? (
                <span className="document-id-source-badge">RAG</span>
              ) : null}
              {isScheduleSource ? (
                <span className="document-id-source-badge">Schedule 일정</span>
              ) : null}
              {source.ragDocumentId ? (
                <span className="document-id-source-badge">
                  {source.ragDocumentId}
                </span>
              ) : null}
              {isIssueSource ? (
                <span className="document-id-source-badge">Issue</span>
              ) : null}
              {documentId ? (
                <span className="document-id-source-badge">{documentId}</span>
              ) : null}
              {source.page !== undefined && source.page !== null ? (
                <span> · p.{source.page}</span>
              ) : null}
              {source.heading ? <span> · {source.heading}</span> : null}
              <span> · {source.vaultName}</span>
              {isAiDerived ? (
                <span className="ai-derived-source-badge">AI Wiki</span>
              ) : null}
              {isPrivateDocument ? (
                <span className="ai-derived-source-badge">Private</span>
              ) : null}
              {isProtected ? <span>Protected</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
