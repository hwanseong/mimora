import { useEffect, useState } from 'react';
import {
  aiProviderCatalog,
  defaultExternalAISettings,
  externalChatProviderOptions,
  getAIProviderDisplayName,
  type ExternalAISettings,
} from '../externalAI';
import type { ConnectionTestResult, LLMModel } from '../localAI';
import type { MimoraSettings } from '../settings';

type ExternalAISettingsSectionProps = {
  settings: MimoraSettings;
  onSettingsChange: (settings: MimoraSettings) => void;
};

type Feedback = {
  tone: 'success' | 'error';
  message: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'External AI 설정을 처리하지 못했습니다.';
}

function formatProviderConnectionSuccess(
  providerName: string,
  modelCount: number | undefined,
): string {
  const countText =
    typeof modelCount === 'number'
      ? `사용 가능한 텍스트 모델 ${modelCount.toLocaleString()}개`
      : '연결 상태 정상';

  return `${providerName} 연결 성공 · ${countText}`;
}

export function ExternalAISettingsSection({
  settings,
  onSettingsChange,
}: ExternalAISettingsSectionProps) {
  const [form, setForm] = useState<ExternalAISettings>({
    ...defaultExternalAISettings,
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [models, setModels] = useState<LLMModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [connectionResult, setConnectionResult] =
    useState<ConnectionTestResult | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const settingsChanged =
    form.provider !== settings.externalAI.provider ||
    form.model !== settings.externalAI.model;
  const configuredModelMissing = Boolean(
    modelsLoaded &&
      form.model &&
      !models.some((model) => model.model === form.model),
  );
  const providerDisplayName = getAIProviderDisplayName(form.provider);

  useEffect(() => {
    setForm({ ...settings.externalAI });
  }, [settings.externalAI]);

  useEffect(() => {
    let isMounted = true;

    void window.mimora
      .hasExternalCredential(form.provider)
      .then((isStored) => {
        if (isMounted) {
          setHasApiKey(isStored);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setHasApiKey(false);
          setFeedback({ tone: 'error', message: getErrorMessage(error) });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [form.provider]);

  async function saveApiKey(): Promise<void> {
    setIsSavingKey(true);
    setFeedback(null);

    try {
      const isStored = await window.mimora.saveExternalCredential(
        form.provider,
        apiKeyInput,
      );
      setApiKeyInput('');
      setHasApiKey(isStored);
      setConnectionResult(null);
      setFeedback({ tone: 'success', message: 'API Key를 안전하게 저장했습니다.' });
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error) });
    } finally {
      setIsSavingKey(false);
    }
  }

  async function deleteApiKey(): Promise<void> {
    setIsDeletingKey(true);
    setFeedback(null);

    try {
      const isStored = await window.mimora.deleteExternalCredential(
        form.provider,
      );
      setHasApiKey(isStored);
      setApiKeyInput('');
      setModels([]);
      setModelsLoaded(false);
      setConnectionResult(null);
      setShowDeleteConfirmation(false);
      setFeedback({ tone: 'success', message: '저장된 API Key를 삭제했습니다.' });
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error) });
    } finally {
      setIsDeletingKey(false);
    }
  }

  async function refreshModels(): Promise<void> {
    setIsRefreshingModels(true);
    setFeedback(null);

    try {
      const availableModels = await window.mimora.listExternalAIModels(
        form.provider,
      );
      setModels(availableModels);
      setModelsLoaded(true);
      setFeedback({
        tone: 'success',
        message: `사용 가능한 텍스트 모델 ${availableModels.length.toLocaleString()}개를 불러왔습니다.`,
      });
    } catch (error) {
      setModels([]);
      setModelsLoaded(false);
      setFeedback({ tone: 'error', message: getErrorMessage(error) });
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function testConnection(): Promise<void> {
    setIsTestingConnection(true);
    setFeedback(null);

    try {
      const result = await window.mimora.testExternalAIConnection(form.provider);
      setConnectionResult(
        result.connected
          ? {
              ...result,
              message: formatProviderConnectionSuccess(
                providerDisplayName,
                result.modelCount,
              ),
            }
          : result,
      );
    } catch (error) {
      setConnectionResult({ connected: false, message: getErrorMessage(error) });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function saveSettings(): Promise<void> {
    setIsSavingSettings(true);
    setFeedback(null);

    try {
      const nextSettings = await window.mimora.updateExternalAISettings(form);
      onSettingsChange(nextSettings);
      setForm({ ...nextSettings.externalAI });
      setFeedback({ tone: 'success', message: 'External AI 설정을 저장했습니다.' });
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error) });
    } finally {
      setIsSavingSettings(false);
    }
  }

  return (
    <section className="local-ai-card external-ai-card" aria-labelledby="external-ai-heading">
      <div className="local-ai-header">
        <div>
          <h2 id="external-ai-heading">External AI</h2>
          <p>OpenAI / Google Gemini 연결과 모델 설정</p>
        </div>
        <span
          className={`local-ai-connection ${
            connectionResult?.connected ? 'is-connected' : ''
          }`}
        >
          <span
            className={`status-dot ${
              connectionResult?.connected ? 'is-connected' : ''
            }`}
            aria-hidden="true"
          />
          <span>{connectionResult?.connected ? '연결됨' : '미연결'}</span>
        </span>
      </div>

      <form
        className="local-ai-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSettings();
        }}
      >
        <label>
          <span>Provider</span>
          <select
            onChange={(event) => {
              const provider =
                event.target.value as ExternalAISettings['provider'];
              setForm({
                provider,
                model:
                  aiProviderCatalog[provider].defaultChatModel ??
                  (settings.externalAI.provider === provider
                    ? settings.externalAI.model
                    : null),
              });
              setApiKeyInput('');
              setHasApiKey(null);
              setModels([]);
              setModelsLoaded(false);
              setConnectionResult(null);
              setFeedback(null);
            }}
            value={form.provider}
          >
            {externalChatProviderOptions.map((provider) => (
              <option key={provider} value={provider}>
                {getAIProviderDisplayName(provider)}
              </option>
            ))}
          </select>
        </label>

        <div className="external-api-key-field">
          <label>
            <span>API Key</span>
            <input
              autoComplete="new-password"
              onChange={(event) => {
                setApiKeyInput(event.target.value);
                setFeedback(null);
              }}
              placeholder={hasApiKey ? 'API Key 저장됨' : `${providerDisplayName} API Key 입력`}
              spellCheck={false}
              type="password"
              value={apiKeyInput}
            />
          </label>
          <button
            className="secondary-button"
            disabled={isSavingKey || !apiKeyInput.trim()}
            onClick={() => {
              void saveApiKey();
            }}
            type="button"
          >
            {isSavingKey ? '저장 중...' : 'API Key 저장'}
          </button>
          <button
            className="secondary-button"
            disabled={isDeletingKey || !hasApiKey}
            onClick={() => {
              setShowDeleteConfirmation(true);
            }}
            type="button"
          >
            API Key 삭제
          </button>
        </div>

        <label className="local-ai-model-field">
          <span>Model</span>
          <select
            onChange={(event) => {
              setForm({ ...form, model: event.target.value || null });
              setFeedback(null);
            }}
            value={form.model ?? ''}
          >
            {!form.model ? <option value="">모델을 선택하세요</option> : null}
            {form.model && !models.some((model) => model.model === form.model) ? (
              <option value={form.model}>
                {form.model}
                {modelsLoaded ? ' (목록에서 확인되지 않음)' : ' (현재 설정)'}
              </option>
            ) : null}
            {models.map((model) => (
              <option key={model.model} value={model.model}>
                {model.model}
              </option>
            ))}
          </select>
        </label>

        <div className="local-ai-actions">
          <button
            className="secondary-button"
            disabled={isRefreshingModels || !hasApiKey}
            onClick={() => {
              void refreshModels();
            }}
            type="button"
          >
            {isRefreshingModels ? '조회 중...' : '모델 새로고침'}
          </button>
          <button
            className="secondary-button"
            disabled={isTestingConnection}
            onClick={() => {
              void testConnection();
            }}
            type="button"
          >
            {isTestingConnection ? '확인 중...' : 'Connection Test'}
          </button>
          <button
            className="primary-button"
            disabled={isSavingSettings || !settingsChanged}
            type="submit"
          >
            {isSavingSettings ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </form>

      {showDeleteConfirmation ? (
        <div className="external-key-confirmation" role="alertdialog">
          <p>저장된 {providerDisplayName} API Key를 삭제하시겠습니까?</p>
          <div>
            <button
              className="secondary-button"
              onClick={() => setShowDeleteConfirmation(false)}
              type="button"
            >
              취소
            </button>
            <button
              className="danger-button"
              disabled={isDeletingKey}
              onClick={() => {
                void deleteApiKey();
              }}
              type="button"
            >
              {isDeletingKey ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="local-ai-messages" aria-live="polite">
        <p className={hasApiKey ? 'success' : 'warning'}>
          {hasApiKey === null
            ? 'API Key 저장 상태 확인 중'
            : hasApiKey
              ? 'API Key 저장됨'
              : 'API Key가 설정되지 않았습니다.'}
        </p>
        {connectionResult ? (
          <p className={connectionResult.connected ? 'success' : 'error'}>
            {connectionResult.message}
          </p>
        ) : null}
        {feedback ? <p className={feedback.tone}>{feedback.message}</p> : null}
        {configuredModelMissing ? (
          <p className="warning">선택한 모델을 현재 접근 가능한 목록에서 확인할 수 없습니다.</p>
        ) : null}
      </div>
    </section>
  );
}
