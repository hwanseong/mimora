import { useState } from 'react';
import {
  buildDerivedKnowledgeBodyMarkdown,
  buildDerivedKnowledgeMarkdown,
  createDraftFilename,
  normalizeDerivedKnowledgeDraft,
  validateDerivedKnowledgeDraft,
  type DerivedKnowledgeDraft,
} from '../derivedKnowledge';
import type { KnowledgeDomain } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeType } from '../registry/knowledgeTypeRegistryTypes';
import {
  vaultSecurityLabels,
  vaultTypeLabels,
  type VaultConfig,
} from '../settings';
import { MarkdownRenderer } from './MarkdownRenderer';

function splitCommaValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinValues(values: string[]): string {
  return values.join(', ');
}

function isPrivateTargetCandidate(vault: VaultConfig): boolean {
  return vault.type === 'private' || vault.security !== 'internal';
}

function displayValue(value?: string | null, fallback = '자동 추론 불가'): string {
  return value?.trim() ? value : fallback;
}

function displayValues(values: string[], fallback = '미선택'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function DerivedKnowledgeDraftModal({
  draft,
  error,
  isSaving,
  knowledgeDomainOptions,
  knowledgeTypeOptions,
  onChange,
  onClose,
  onSave,
  savedPath,
  vaults,
}: {
  draft: DerivedKnowledgeDraft;
  error?: string | null;
  isSaving: boolean;
  knowledgeDomainOptions: KnowledgeDomain[];
  knowledgeTypeOptions: KnowledgeType[];
  onChange: (draft: DerivedKnowledgeDraft) => void;
  onClose: () => void;
  onSave: () => void;
  savedPath?: string | null;
  vaults: VaultConfig[];
}) {
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const normalizedDraft = normalizeDerivedKnowledgeDraft(draft);
  const markdownPreview = buildDerivedKnowledgeMarkdown(normalizedDraft);
  const bodyPreview = buildDerivedKnowledgeBodyMarkdown(normalizedDraft);
  const validationErrors = validateDerivedKnowledgeDraft(normalizedDraft);
  const targetVaults =
    normalizedDraft.security === 'private'
      ? vaults.filter(isPrivateTargetCandidate)
      : vaults;
  const sourceCount = normalizedDraft.sourceDocuments.length;

  function changeTitle(title: string): void {
    const currentAutoFilename = createDraftFilename(draft.title);
    const shouldSyncFilename =
      !draft.filename || draft.filename === currentAutoFilename;

    onChange({
      ...draft,
      title,
      filename: shouldSyncFilename ? createDraftFilename(title) : draft.filename,
    });
  }

  return (
    <div className="derived-draft-backdrop" role="presentation">
      <section
        aria-labelledby="derived-draft-heading"
        aria-modal="true"
        className="derived-draft-modal"
        role="dialog"
      >
        <div className="derived-draft-header">
          <div>
            <p className="eyebrow">AI Wiki Draft</p>
            <h2 id="derived-draft-heading">AI Wiki 초안</h2>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="derived-draft-body">
          <div className="derived-draft-form">
            <label>
              <span>Title</span>
              <input
                onChange={(event) => {
                  changeTitle(event.target.value);
                }}
                value={draft.title}
              />
            </label>
            <label>
              <span>Document ID</span>
              <input
                onChange={(event) => {
                  onChange({ ...draft, documentId: event.target.value });
                }}
                placeholder="DOC-2026-0601"
                value={draft.documentId}
              />
            </label>
            <label>
              <span>Filename</span>
              <input
                onChange={(event) => {
                  onChange({ ...draft, filename: event.target.value });
                }}
                value={draft.filename}
              />
            </label>
            <label>
              <span>Workspace IDs</span>
              <input
                onChange={(event) => {
                  onChange({
                    ...draft,
                    workspaceIds: splitCommaValues(event.target.value),
                  });
                }}
                placeholder="자동 추론 불가"
                value={joinValues(draft.workspaceIds)}
              />
            </label>
            <label>
              <span>Origin Workspace</span>
              <input
                onChange={(event) => {
                  onChange({
                    ...draft,
                    originWorkspaceId: event.target.value,
                  });
                }}
                placeholder="자동 추론 불가"
                value={draft.originWorkspaceId ?? ''}
              />
            </label>
            <label>
              <span>Knowledge Domains</span>
              <input
                list="derived-knowledge-domain-options"
                onChange={(event) => {
                  onChange({
                    ...draft,
                    knowledgeDomains: splitCommaValues(event.target.value),
                  });
                }}
                value={joinValues(draft.knowledgeDomains)}
              />
            </label>
            <datalist id="derived-knowledge-domain-options">
              {knowledgeDomainOptions.map((domain) => (
                <option key={domain.canonicalName} value={domain.canonicalName} />
              ))}
            </datalist>
            <label>
              <span>Knowledge Type</span>
              <select
                onChange={(event) => {
                  onChange({
                    ...draft,
                    knowledgeTypes: event.target.value
                      ? [event.target.value]
                      : [],
                  });
                }}
                value={draft.knowledgeTypes[0] ?? ''}
              >
                <option value="">Select type</option>
                {knowledgeTypeOptions.map((type) => (
                  <option key={type.canonicalName} value={type.canonicalName}>
                    {type.canonicalName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target Vault</span>
              <select
                onChange={(event) => {
                  onChange({ ...draft, targetVaultId: event.target.value });
                }}
                value={draft.targetVaultId}
              >
                <option value="">Select vault</option>
                {targetVaults.map((vault) => (
                  <option key={vault.id} value={vault.id}>
                    {vault.name} · {vaultTypeLabels[vault.type]} ·{' '}
                    {vaultSecurityLabels[vault.security]}
                  </option>
                ))}
              </select>
            </label>
            <div className="derived-draft-readonly-grid">
              <span>Security</span>
              <strong>{normalizedDraft.security.toUpperCase()}</strong>
              <span>Content Origin</span>
              <strong>AI Derived</strong>
              <span>Sources</span>
              <strong>{sourceCount} documents</strong>
            </div>
            {normalizedDraft.security === 'private' ? (
              <p className="derived-draft-private-note">
                Private Source가 포함되어 보안등급은 Private으로 상속되었습니다.
              </p>
            ) : null}
            {error ? (
              <p className="derived-draft-error" role="alert">
                {error}
              </p>
            ) : null}
            {savedPath ? (
              <p className="derived-draft-success" role="status">
                저장 완료: {savedPath}
              </p>
            ) : null}
            {validationErrors.length > 0 ? (
              <ul className="derived-draft-validation">
                {validationErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="derived-draft-preview">
            <section className="derived-metadata-preview-card">
              <div className="derived-draft-preview-heading">
                <strong>Rendered Metadata Preview</strong>
                <span>저장 metadata와 동일</span>
              </div>
              <dl>
                <div>
                  <dt>Document ID</dt>
                  <dd>{displayValue(normalizedDraft.documentId, '미입력')}</dd>
                </div>
                <div>
                  <dt>Workspace IDs</dt>
                  <dd>{displayValues(normalizedDraft.workspaceIds)}</dd>
                </div>
                <div>
                  <dt>Origin Workspace</dt>
                  <dd>{displayValue(normalizedDraft.originWorkspaceId)}</dd>
                </div>
                <div>
                  <dt>Knowledge Domains</dt>
                  <dd>{displayValues(normalizedDraft.knowledgeDomains)}</dd>
                </div>
                <div>
                  <dt>Knowledge Type</dt>
                  <dd>{displayValues(normalizedDraft.knowledgeTypes)}</dd>
                </div>
                <div>
                  <dt>Security</dt>
                  <dd>{normalizedDraft.security.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Content Origin</dt>
                  <dd>AI Derived</dd>
                </div>
                <div>
                  <dt>Sources</dt>
                  <dd>{sourceCount} documents</dd>
                </div>
              </dl>
            </section>
            <section className="derived-body-preview-card">
              <div className="derived-draft-preview-heading">
                <strong>Rendered Wiki Body Preview</strong>
                <span>metadata 제외 본문</span>
              </div>
              <MarkdownRenderer
                className="derived-body-markdown"
                content={bodyPreview}
              />
            </section>
            <div className="derived-raw-preview-heading">
              <button
                className="secondary-button"
                onClick={() => {
                  setShowRawMarkdown((currentValue) => !currentValue);
                }}
                type="button"
              >
                {showRawMarkdown ? 'Raw Markdown 숨기기' : 'Raw Markdown 보기'}
              </button>
              <span>_mimora/wiki/{normalizedDraft.filename || '...'}</span>
            </div>
            {showRawMarkdown ? <pre>{markdownPreview}</pre> : null}
          </div>
        </div>

        <div className="derived-draft-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            취소
          </button>
          <button
            className="primary-button"
            disabled={isSaving || validationErrors.length > 0}
            onClick={onSave}
            type="button"
          >
            {isSaving ? '저장 중' : '저장'}
          </button>
        </div>
      </section>
    </div>
  );
}
