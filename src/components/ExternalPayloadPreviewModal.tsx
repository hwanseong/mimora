import {
  effectiveSecurityLabels,
} from '../security/securityRouter';
import type {
  ExternalPayloadPreview,
} from '../security/externalPayloadPreview';
import { maskingEntityTypeLabels } from '../security/maskingEngine';
import {
  vaultSecurityLabels,
  vaultTypeLabels,
} from '../settings';

const safetyStatusLabels = {
  pass: 'PASS',
  'review-required': 'REVIEW REQUIRED',
  block: 'BLOCKED',
};

export function ExternalPayloadPreviewModal({
  preview,
  onClose,
  onApprove,
  onUseLocalAI,
  isProcessing = false,
  actionError,
}: {
  preview: ExternalPayloadPreview;
  onClose: () => void;
  onApprove?: () => Promise<void>;
  onUseLocalAI?: () => Promise<void>;
  isProcessing?: boolean;
  actionError?: string | null;
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
            <p className="eyebrow">
              {preview.status === 'review-required'
                ? 'Review required · 승인 전에는 전송되지 않음'
                : 'External Payload Safety Review'}
            </p>
            <h2 id="external-preview-heading">External Payload Preview</h2>
          </div>
          <button
            aria-label="External Payload Preview 닫기"
            className="secondary-button"
            disabled={isProcessing}
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
        </header>

        <div className="external-preview-body">
        <div className={`external-preview-status ${preview.status}`}>
          <strong>
            {preview.status === 'pass'
              ? '✓ '
              : preview.status === 'block'
                ? '⛔ '
                : '⚠ '}
            {safetyStatusLabels[preview.status]}
          </strong>
          <span>
            Effective Security ·{' '}
            {effectiveSecurityLabels[preview.effectiveSecurity]}
          </span>
        </div>

        {preview.secretDetection.detected ? (
          <section className="external-preview-section secret-detection-block">
            <h3>⛔ Secret / Credential detected</h3>
            <p>
              외부 Payload는 생성되지 않았으며 실제 Secret 값은 Preview에서
              숨겼습니다.
            </p>
            <ul>
              {preview.secretDetection.detections.map((detection) => (
                <li
                  key={`${detection.ruleId}-${detection.documentId ?? 'question'}`}
                >
                  <strong>
                    {detection.source === 'custom' ? 'Custom Rule: ' : ''}
                    {detection.ruleName}
                  </strong>
                  <span>{detection.documentId ?? 'User Question'}</span>
                  <span>{detection.count} match</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
                    ←{' '}
                    {replacement.type === 'internal-ip'
                      ? 'Internal network address'
                      : replacement.original}{' '}
                    ·{' '}
                    {replacement.type === 'file-path'
                      ? 'File path'
                      : replacement.type === 'internal-ip'
                        ? 'Internal IP'
                      : maskingEntityTypeLabels[replacement.type]}{' '}
                    ·{' '}
                    {replacement.count} occurrences
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="external-preview-section">
          <h3>External Payload Safety</h3>
          <ul className="external-preview-checks">
            {preview.safety.checks.map((safetyCheck) => (
              <li className={safetyCheck.status} key={safetyCheck.id}>
                <span aria-hidden="true">
                  {safetyCheck.status === 'pass'
                    ? '✓'
                    : safetyCheck.status === 'warn'
                      ? '⚠'
                      : '⛔'}
                </span>
                <div>
                  <strong>{safetyCheck.label}</strong>
                  <small>{safetyCheck.message}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="external-preview-section external-text-section">
          {preview.secretDetection.detected ? (
            <p className="external-preview-empty">
              Secret HARD BLOCK · External Payload를 생성하지 않았습니다.
            </p>
          ) : (
            <details>
              <summary>
                <strong>Final External Payload</strong>
                <span>Alias-only document boundaries</span>
              </summary>
              <pre>{preview.externalText}</pre>
            </details>
          )}
        </section>
        </div>

        <footer className="external-preview-footer">
          <div className="external-preview-footer-summary">
            <span>
              {preview.totalReplacementCount} replacements ·{' '}
              {preview.maskedContextChars} masked context chars
            </span>
            {actionError ? <small role="alert">{actionError}</small> : null}
          </div>
          <div className="external-preview-actions">
            <button
              className="secondary-button"
              disabled={isProcessing}
              onClick={onClose}
              type="button"
            >
              닫기
            </button>
            {onUseLocalAI &&
            (preview.status === 'review-required' ||
              preview.status === 'block') ? (
              <button
                className="secondary-button"
                disabled={isProcessing}
                onClick={() => {
                  void onUseLocalAI();
                }}
                type="button"
              >
                {isProcessing ? '처리 중…' : 'Local AI로 처리'}
              </button>
            ) : null}
            {preview.status === 'review-required' && onApprove ? (
              <button
                className="primary-button"
                disabled={isProcessing}
                onClick={() => {
                  void onApprove();
                }}
                type="button"
              >
                {isProcessing ? '전송 준비 중…' : '승인 후 OpenAI 전송'}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
