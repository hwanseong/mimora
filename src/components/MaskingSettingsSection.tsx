import { useState } from 'react';
import type { MimoraSettings } from '../settings';
import {
  maskText,
  maskingEntityTypeLabels,
  maskingEntityTypes,
  type MaskingEntityType,
  type MaskingEntry,
  type MaskingResult,
} from '../security/maskingEngine';

type MaskingFormState = {
  id?: string;
  value: string;
  type: MaskingEntityType;
  enabled: boolean;
};

const emptyMaskingForm: MaskingFormState = {
  value: '',
  type: 'person',
  enabled: true,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Masking Dictionary를 저장하지 못했습니다.';
}

export function MaskingSettingsSection({
  settings,
  onSettingsChange,
}: {
  settings: MimoraSettings;
  onSettingsChange: (settings: MimoraSettings) => void;
}) {
  const [formState, setFormState] = useState<MaskingFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaskingEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<MaskingResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function editEntry(entry: MaskingEntry): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState({
      id: entry.id,
      value: entry.value,
      type: entry.type,
      enabled: entry.enabled,
    });
  }

  async function saveEntry(): Promise<void> {
    if (!formState || !formState.value.trim()) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const nextSettings = formState.id
        ? await window.mimora.updateMaskingEntry({
            id: formState.id,
            value: formState.value,
            type: formState.type,
            enabled: formState.enabled,
          })
        : await window.mimora.addMaskingEntry({
            value: formState.value,
            type: formState.type,
          });

      onSettingsChange(nextSettings);
      setFormState(null);
      setTestResult(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleEntry(entry: MaskingEntry): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.updateMaskingEntry({
        id: entry.id,
        value: entry.value,
        type: entry.type,
        enabled: !entry.enabled,
      });

      onSettingsChange(nextSettings);
      setTestResult(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function deleteEntry(entry: MaskingEntry): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.deleteMaskingEntry(entry.id);

      onSettingsChange(nextSettings);
      setDeleteTarget(null);
      setFormState((currentForm) =>
        currentForm?.id === entry.id ? null : currentForm,
      );
      setTestResult(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <section className="masking-card" aria-labelledby="masking-heading">
      <div className="masking-header">
        <div>
          <h2 id="masking-heading">Masking Dictionary</h2>
          <p>외부 전송용 텍스트를 로컬에서 익명화합니다.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            setErrorMessage(null);
            setDeleteTarget(null);
            setFormState({ ...emptyMaskingForm });
          }}
          type="button"
        >
          + Entity 추가
        </button>
      </div>

      {errorMessage ? (
        <p className="masking-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {formState ? (
        <form
          className="masking-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEntry();
          }}
        >
          <label>
            <span>원본 값</span>
            <input
              autoFocus
              onChange={(event) => {
                setFormState({ ...formState, value: event.target.value });
              }}
              placeholder="예: 김철수"
              value={formState.value}
            />
          </label>
          <label>
            <span>Type</span>
            <select
              onChange={(event) => {
                setFormState({
                  ...formState,
                  type: event.target.value as MaskingEntityType,
                });
              }}
              value={formState.type}
            >
              {maskingEntityTypes.map((type) => (
                <option key={type} value={type}>
                  {maskingEntityTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
          <div className="masking-form-actions">
            <span>Alias는 Type별로 자동 생성됩니다.</span>
            <div>
              <button
                className="secondary-button"
                onClick={() => {
                  setFormState(null);
                }}
                type="button"
              >
                취소
              </button>
              <button
                className="primary-button"
                disabled={isSaving || !formState.value.trim()}
                type="submit"
              >
                {isSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <div className="masking-entry-list">
        {settings.masking.entries.length === 0 ? (
          <p className="masking-empty">등록된 Masking Entity가 없습니다.</p>
        ) : null}
        {settings.masking.entries.map((entry) => (
          <article
            className={`masking-entry${entry.enabled ? '' : ' is-disabled'}`}
            key={entry.id}
          >
            <div>
              <strong>{entry.value}</strong>
              <span>
                {maskingEntityTypeLabels[entry.type]} · {entry.alias}
              </span>
            </div>
            <div className="masking-entry-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  void toggleEntry(entry);
                }}
                type="button"
              >
                {entry.enabled ? '사용 중' : '사용 안 함'}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  editEntry(entry);
                }}
                type="button"
              >
                수정
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setFormState(null);
                  setDeleteTarget(entry);
                }}
                type="button"
              >
                삭제
              </button>
            </div>
          </article>
        ))}
      </div>

      {deleteTarget ? (
        <div className="masking-delete-confirmation" role="alertdialog">
          <p>'{deleteTarget.value}' Entity를 삭제하시겠습니까?</p>
          <div>
            <button
              className="secondary-button"
              onClick={() => {
                setDeleteTarget(null);
              }}
              type="button"
            >
              취소
            </button>
            <button
              className="danger-button"
              onClick={() => {
                void deleteEntry(deleteTarget);
              }}
              type="button"
            >
              삭제
            </button>
          </div>
        </div>
      ) : null}

      <div className="masking-test">
        <label>
          <span>Test Text</span>
          <textarea
            onChange={(event) => {
              setTestText(event.target.value);
              setTestResult(null);
            }}
            placeholder="Masking 결과를 확인할 문장을 입력하세요."
            value={testText}
          />
        </label>
        <button
          className="secondary-button"
          disabled={!testText}
          onClick={() => {
            setTestResult(maskText(testText, settings.masking.entries));
          }}
          type="button"
        >
          Masking Test
        </button>
        {testResult ? (
          <div className="masking-test-result" aria-live="polite">
            <p>{testResult.maskedText}</p>
            <span>{testResult.totalReplacementCount} replacements</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
