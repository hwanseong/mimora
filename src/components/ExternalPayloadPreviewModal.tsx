import {
  effectiveSecurityLabels,
} from '../security/securityRouter';
import type {
  ExternalPayloadBlocker,
  ExternalPayloadPreview,
} from '../security/externalPayloadPreview';
import { maskingEntityTypeLabels } from '../security/maskingEngine';
import {
  vaultSecurityLabels,
  vaultTypeLabels,
} from '../settings';

const blockerLabels: Record<ExternalPayloadBlocker, string> = {
  'manual-review-required': '외부 전송 전 수동 검토가 필요합니다.',
  'private-vault-context': 'Private Vault 문서가 포함되어 있습니다.',
  'sensitive-context': 'Sensitive Context가 포함되어 있습니다.',
  'unmasked-data-possible':
    'Dictionary에 등록되지 않은 민감정보가 남아 있을 수 있습니다.',
};

export function ExternalPayloadPreviewModal({
  preview,
  onClose,
}: {
  preview: ExternalPayloadPreview;
  onClose: () => void;
}) {
  return (
    <div className="external-preview-backdrop" role="presentation">
      <section
        aria-labelledby="external-preview-heading"
        aria-modal="true"
        className="external-preview-modal"
        role="dialog"
      >
        <header className="external-preview-header">
          <div>
            <p className="eyebrow">Dry Run · No external transmission</p>
            <h2 id="external-preview-heading">External Payload Preview</h2>
          </div>
          <button
            aria-label="External Payload Preview 닫기"
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
        </header>

        <div className="external-preview-status">
          <strong>⚠ Review Required</strong>
          <span>
            Effective Security ·{' '}
            {effectiveSecurityLabels[preview.effectiveSecurity]}
          </span>
        </div>

        <section className="external-preview-section">
          <h3>Masked Question</h3>
          <pre>{preview.maskedQuestion}</pre>
        </section>

        <section className="external-preview-section">
          <div className="external-preview-section-heading">
            <h3>Masked Context</h3>
            <span>{preview.documentCount} documents</span>
          </div>
          <div className="external-preview-documents">
            {preview.documents.length === 0 ? (
              <p className="external-preview-empty">Context가 없습니다.</p>
            ) : null}
            {preview.documents.map((document) => (
              <article key={document.documentId}>
                <div className="external-preview-document-meta">
                  <strong>{document.documentId}</strong>
                  <span>
                    Local metadata · {document.vaultName} ·{' '}
                    {vaultTypeLabels[document.vaultType]} ·{' '}
                    {vaultSecurityLabels[document.security]}
                  </span>
                  <span>{document.relativePath}</span>
                </div>
                <pre>{document.maskedContent}</pre>
                <small>{document.replacementCount} replacements</small>
              </article>
            ))}
          </div>
        </section>

        <section className="external-preview-section">
          <h3>Masking Summary · Local metadata only</h3>
          {preview.replacements.length === 0 ? (
            <p className="external-preview-empty">적용된 Entity가 없습니다.</p>
          ) : (
            <ul className="external-preview-replacements">
              {preview.replacements.map((replacement) => (
                <li key={replacement.entryId}>
                  <strong>[{replacement.alias}]</strong>
                  <span>
                    ← {replacement.original} ·{' '}
                    {maskingEntityTypeLabels[replacement.type]} ·{' '}
                    {replacement.count} occurrences
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="external-preview-section">
          <h3>Security Check</h3>
          <ul className="external-preview-blockers">
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blockerLabels[blocker]}</li>
            ))}
          </ul>
        </section>

        <section className="external-preview-section external-text-section">
          <div className="external-preview-section-heading">
            <h3>External Text</h3>
            <span>Alias-only document boundaries</span>
          </div>
          <pre>{preview.externalText}</pre>
        </section>

        <footer className="external-preview-footer">
          <span>
            {preview.totalReplacementCount} replacements ·{' '}
            {preview.maskedContextChars} masked context chars
          </span>
          <strong>Preview only · 전송 기능 없음</strong>
        </footer>
      </section>
    </div>
  );
}
