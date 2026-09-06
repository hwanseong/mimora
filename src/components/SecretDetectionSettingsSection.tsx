import { useState } from 'react';
import type { MimoraSettings } from '../settings';
import {
  builtInSecretRules,
  testSecretRule,
  validateCustomSecretRuleInput,
  type CustomSecretRule,
  type SecretRule,
} from '../security/secretDetector';

type SecretRuleFormState = {
  id?: string;
  name: string;
  kind: 'keyword-value' | 'regex';
  keywordText: string;
  pattern: string;
  enabled: boolean;
  testText: string;
  testCount: number | null;
};

const emptyForm: SecretRuleFormState = {
  name: '',
  kind: 'keyword-value',
  keywordText: '',
  pattern: '',
  enabled: true,
  testText: '',
  testCount: null,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Custom Secret Rule을 저장하지 못했습니다.';
}

function toRuleInput(form: SecretRuleFormState) {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    kind: form.kind,
    enabled: form.enabled,
    ...(form.kind === 'keyword-value'
      ? {
          keywords: form.keywordText
            .split(',')
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        }
      : { pattern: form.pattern }),
  };
}

export function SecretDetectionSettingsSection({
  settings,
  onSettingsChange,
}: {
  settings: MimoraSettings;
  onSettingsChange: (settings: MimoraSettings) => void;
}) {
  const [form, setForm] = useState<SecretRuleFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomSecretRule | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function editRule(rule: CustomSecretRule): void {
    setDeleteTarget(null);
    setErrorMessage(null);
    setForm({
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      keywordText: rule.keywords?.join(', ') ?? '',
      pattern: rule.pattern ?? '',
      enabled: rule.enabled,
      testText: '',
      testCount: null,
    });
  }

  async function saveRule(): Promise<void> {
    if (!form) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const validated = validateCustomSecretRuleInput(toRuleInput(form));
      const nextSettings = form.id
        ? await window.mimora.updateSecretRule({
            ...validated,
            id: form.id,
          })
        : await window.mimora.addSecretRule(validated);

      onSettingsChange(nextSettings);
      setForm(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleRule(rule: CustomSecretRule): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.updateSecretRule({
        id: rule.id,
        name: rule.name,
        kind: rule.kind,
        enabled: !rule.enabled,
        keywords: rule.keywords,
        pattern: rule.pattern,
      });

      onSettingsChange(nextSettings);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function deleteRule(rule: CustomSecretRule): Promise<void> {
    setErrorMessage(null);

    try {
      onSettingsChange(await window.mimora.deleteSecretRule(rule.id));
      setDeleteTarget(null);
      setForm((currentForm) =>
        currentForm?.id === rule.id ? null : currentForm,
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function testRule(): void {
    if (!form) {
      return;
    }

    try {
      const validated = validateCustomSecretRuleInput(toRuleInput(form));
      const rule: SecretRule = {
        id: form.id ?? 'custom-rule-test',
        name: validated.name,
        source: 'custom',
        kind: validated.kind,
        enabled: true,
        severity: 'hard-block',
        category: 'custom-secret',
        keywords: validated.keywords,
        pattern: validated.pattern,
      };

      setErrorMessage(null);
      setForm({
        ...form,
        testCount: testSecretRule(form.testText, rule),
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <section
      aria-labelledby="secret-detection-heading"
      className="masking-card secret-detection-card"
    >
      <div className="masking-header">
        <div>
          <p className="eyebrow">Security</p>
          <h2 id="secret-detection-heading">Secret Detection</h2>
          <p>Credential이 발견되면 사용자 승인과 관계없이 외부 전송을 차단합니다.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            setDeleteTarget(null);
            setErrorMessage(null);
            setForm({ ...emptyForm });
          }}
          type="button"
        >
          + Rule 추가
        </button>
      </div>

      {errorMessage ? (
        <p className="masking-error" role="alert">{errorMessage}</p>
      ) : null}

      <div className="secret-rule-group">
        <h3>Built-in Rules</h3>
        <div className="masking-entry-list secret-rule-list">
          {builtInSecretRules.map((rule) => (
            <article className="masking-entry" key={rule.id}>
              <div>
                <strong>✓ {rule.name}</strong>
                <span>{rule.category} · HARD BLOCK</span>
              </div>
              <span className="secret-protected-badge">Built-in · Protected</span>
            </article>
          ))}
        </div>
      </div>

      <div className="secret-rule-group">
        <h3>Custom Rules</h3>
        {settings.secretDetection.customRules.length === 0 ? (
          <p className="masking-empty">등록된 Custom Secret Rule이 없습니다.</p>
        ) : null}
        <div className="masking-entry-list secret-rule-list">
          {settings.secretDetection.customRules.map((rule) => (
            <article
              className={`masking-entry${rule.enabled ? '' : ' is-disabled'}`}
              key={rule.id}
            >
              <div>
                <strong>{rule.name}</strong>
                <span>
                  {rule.kind === 'keyword-value' ? 'Keyword + Value' : 'Regex'} · HARD BLOCK
                </span>
              </div>
              <div className="masking-entry-actions">
                <button className="secondary-button" onClick={() => void toggleRule(rule)} type="button">
                  {rule.enabled ? '사용 중' : '사용 안 함'}
                </button>
                <button className="secondary-button" onClick={() => editRule(rule)} type="button">수정</button>
                <button className="secondary-button" onClick={() => setDeleteTarget(rule)} type="button">삭제</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {form ? (
        <form className="masking-form secret-rule-form" onSubmit={(event) => { event.preventDefault(); void saveRule(); }}>
          <label>
            <span>Rule Name</span>
            <input autoFocus onChange={(event) => setForm({ ...form, name: event.target.value, testCount: null })} value={form.name} />
          </label>
          <label>
            <span>Detection Type</span>
            <select onChange={(event) => setForm({ ...form, kind: event.target.value as SecretRuleFormState['kind'], testCount: null })} value={form.kind}>
              <option value="keyword-value">Keyword + Value</option>
              <option value="regex">Regex</option>
            </select>
          </label>
          {form.kind === 'keyword-value' ? (
            <label>
              <span>Keywords</span>
              <input onChange={(event) => setForm({ ...form, keywordText: event.target.value, testCount: null })} placeholder="db_password, dbpasswd" value={form.keywordText} />
            </label>
          ) : (
            <label>
              <span>Regex Pattern</span>
              <input onChange={(event) => setForm({ ...form, pattern: event.target.value, testCount: null })} spellCheck={false} value={form.pattern} />
            </label>
          )}
          <label>
            <span>Severity</span>
            <input disabled value="HARD BLOCK" />
          </label>
          <label className="secret-enabled-field">
            <input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" />
            <span>Enabled</span>
          </label>
          <label className="secret-test-text">
            <span>Test Text</span>
            <textarea onChange={(event) => setForm({ ...form, testText: event.target.value, testCount: null })} value={form.testText} />
          </label>
          <div className="masking-form-actions">
            <button className="secondary-button" disabled={!form.testText} onClick={testRule} type="button">Test Rule</button>
            {form.testCount !== null ? (
              <strong aria-live="polite">
                {form.testCount > 0 ? `${form.testCount} matches detected` : 'Match 없음'}
              </strong>
            ) : null}
            <div>
              <button className="secondary-button" onClick={() => setForm(null)} type="button">취소</button>
              <button className="primary-button" disabled={isSaving} type="submit">{isSaving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </form>
      ) : null}

      {deleteTarget ? (
        <div className="masking-delete-confirmation" role="alertdialog">
          <p>'{deleteTarget.name}' Rule을 삭제하시겠습니까?</p>
          <div>
            <button className="secondary-button" onClick={() => setDeleteTarget(null)} type="button">취소</button>
            <button className="danger-button" onClick={() => void deleteRule(deleteTarget)} type="button">삭제</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
