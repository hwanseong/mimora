import { useEffect, useMemo, useState } from 'react';
import {
  defaultLocalAISettings,
  type ConnectionTestResult,
  type LLMModel,
  type LocalAISettings,
} from '../localAI';
import {
  defaultSettings,
  vaultSecurityLabels,
  vaultSecurityOptions,
  vaultTypeLabels,
  vaultTypeOptions,
  type MimoraSettings,
  type UpdateVaultInput,
  type VaultConfig,
  type VaultSecurity,
  type VaultType,
} from '../settings';
import { MaskingSettingsSection } from './MaskingSettingsSection';
import { ExternalAISettingsSection } from './ExternalAISettingsSection';
import { SecretDetectionSettingsSection } from './SecretDetectionSettingsSection';
import type { RegistryStatus } from '../registry/types';
import type { WorkspaceRegistryParseResult } from '../registry/workspaceRegistryTypes';

type VaultFormState = {
  id?: string;
  name: string;
  autoSuggestedName: string | null;
  type: VaultType;
  security: VaultSecurity;
  path: string;
};

type LocalAIFeedback = {
  tone: 'success' | 'error';
  message: string;
};

const emptyFormState: VaultFormState = {
  name: '',
  autoSuggestedName: null,
  type: 'work',
  security: 'internal',
  path: '',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '설정을 저장하지 못했습니다.';
}

export function SettingsView({
  onWorkspaceRegistryChanged,
}: {
  onWorkspaceRegistryChanged?: () => Promise<void> | void;
}) {
  const [settings, setSettings] = useState<MimoraSettings>(defaultSettings);
  const [formState, setFormState] = useState<VaultFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [localAIForm, setLocalAIForm] = useState<LocalAISettings>({
    ...defaultLocalAISettings,
  });
  const [localAIModels, setLocalAIModels] = useState<LLMModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [localAIFeedback, setLocalAIFeedback] =
    useState<LocalAIFeedback | null>(null);
  const [connectionResult, setConnectionResult] =
    useState<ConnectionTestResult | null>(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSavingLocalAI, setIsSavingLocalAI] = useState(false);
  const [registryStatus, setRegistryStatus] =
    useState<RegistryStatus | null>(null);
  const [workspaceRegistry, setWorkspaceRegistry] =
    useState<WorkspaceRegistryParseResult | null>(null);
  const [showWorkspaceRegistryIssues, setShowWorkspaceRegistryIssues] =
    useState(false);

  const isEditing = Boolean(formState?.id);
  const sortedVaults = useMemo(() => settings.vaults, [settings.vaults]);
  const registryHomeVault = settings.registry.homeVaultId
    ? settings.vaults.find((vault) => vault.id === settings.registry.homeVaultId)
    : null;
  const deleteTargetIsRegistryHome =
    Boolean(deleteTarget) && deleteTarget?.id === settings.registry.homeVaultId;
  const configuredModelMissing = Boolean(
    modelsLoaded &&
      localAIForm.model &&
      !localAIModels.some((model) => model.model === localAIForm.model),
  );
  const localAISettingsChanged =
    localAIForm.provider !== settings.localAI.provider ||
    localAIForm.endpoint !== settings.localAI.endpoint ||
    localAIForm.model !== settings.localAI.model;

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const loadedSettings = await window.mimora.getSettings();

        if (isMounted) {
          setSettings(loadedSettings);
          setLocalAIForm({ ...loadedSettings.localAI });
          const [loadedRegistryStatus, loadedWorkspaceRegistry] =
            await Promise.all([
              window.mimora.getRegistryStatus(),
              window.mimora.loadWorkspaceRegistry(),
            ]);

          if (isMounted) {
            setRegistryStatus(loadedRegistryStatus);
            setWorkspaceRegistry(loadedWorkspaceRegistry);
          }
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(getErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  async function refreshRegistryStatus(): Promise<void> {
    const [nextRegistryStatus, nextWorkspaceRegistry] = await Promise.all([
      window.mimora.getRegistryStatus(),
      window.mimora.loadWorkspaceRegistry(),
    ]);
    setRegistryStatus(nextRegistryStatus);
    setWorkspaceRegistry(nextWorkspaceRegistry);
  }

  function getConnectionInput() {
    return {
      provider: localAIForm.provider,
      endpoint: localAIForm.endpoint,
    };
  }

  async function refreshLocalAIModels(): Promise<void> {
    setIsRefreshingModels(true);
    setLocalAIFeedback(null);

    try {
      const models = await window.mimora.listLocalAIModels(
        getConnectionInput(),
      );
      setLocalAIModels(models);
      setModelsLoaded(true);
      setLocalAIFeedback({
        tone: 'success',
        message: `설치 모델 ${models.length}개를 불러왔습니다.`,
      });
    } catch (error) {
      setLocalAIModels([]);
      setModelsLoaded(false);
      setLocalAIFeedback({
        tone: 'error',
        message: getErrorMessage(error),
      });
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function testLocalAIConnection(): Promise<void> {
    setIsTestingConnection(true);
    setLocalAIFeedback(null);

    try {
      const result = await window.mimora.testLocalAIConnection(
        getConnectionInput(),
      );
      setConnectionResult(result);
    } catch (error) {
      setConnectionResult({
        connected: false,
        message: `연결 실패: ${getErrorMessage(error)}`,
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function saveLocalAISettings(): Promise<void> {
    setIsSavingLocalAI(true);
    setLocalAIFeedback(null);

    try {
      const nextSettings = await window.mimora.updateLocalAISettings(
        localAIForm,
      );
      setSettings(nextSettings);
      setLocalAIForm({ ...nextSettings.localAI });
      setLocalAIFeedback({
        tone: 'success',
        message: 'Local AI 설정을 저장했습니다.',
      });
    } catch (error) {
      setLocalAIFeedback({
        tone: 'error',
        message: getErrorMessage(error),
      });
    } finally {
      setIsSavingLocalAI(false);
    }
  }

  function openAddForm(): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState(emptyFormState);
  }

  function openEditForm(vault: VaultConfig): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState({
      id: vault.id,
      name: vault.name,
      autoSuggestedName: null,
      type: vault.type,
      security: vault.security,
      path: vault.path,
    });
  }

  async function chooseFolder(): Promise<void> {
    const selection = await window.mimora.selectVaultDirectory();

    if (selection) {
      setFormState((currentFormState) =>
        currentFormState
          ? (() => {
              const shouldUseSuggestedName =
                !currentFormState.id &&
                (!currentFormState.name.trim() ||
                  currentFormState.name === currentFormState.autoSuggestedName);

              return {
                ...currentFormState,
                name: shouldUseSuggestedName
                  ? selection.suggestedName
                  : currentFormState.name,
                autoSuggestedName: shouldUseSuggestedName
                  ? selection.suggestedName
                  : currentFormState.autoSuggestedName,
                path: selection.path,
              };
            })()
          : currentFormState,
      );
    }
  }

  async function saveVault(): Promise<void> {
    if (!formState) {
      return;
    }

    setErrorMessage(null);

    try {
      const nextSettings = formState.id
        ? await window.mimora.updateVault({
            id: formState.id,
            name: formState.name,
            type: formState.type,
            security: formState.security,
            path: formState.path,
          } satisfies UpdateVaultInput)
        : await window.mimora.addVault({
            name: formState.name,
            type: formState.type,
            security: formState.security,
            path: formState.path,
          });

      setSettings(nextSettings);
      setFormState(null);
      await refreshRegistryStatus();
      await onWorkspaceRegistryChanged?.();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function deleteVault(vault: VaultConfig): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.deleteVault(vault.id);
      setSettings(nextSettings);
      setDeleteTarget(null);
      await refreshRegistryStatus();
      await onWorkspaceRegistryChanged?.();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function updateRegistryHomeVault(homeVaultId: string): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.updateRegistryHomeVault(
        homeVaultId || null,
      );
      setSettings(nextSettings);
      await refreshRegistryStatus();
      await onWorkspaceRegistryChanged?.();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function getRegistryMessage(): string {
    if (!settings.registry.homeVaultId) {
      return 'Registry Home Vault가 지정되지 않았습니다.';
    }

    if (!registryHomeVault || registryStatus?.homeVaultAvailable === false) {
      return 'Registry Home Vault에 접근할 수 없습니다.';
    }

    return 'Registry Home Vault에 접근할 수 있습니다.';
  }

  function getWorkspaceRegistryStatusText(): string {
    if (!workspaceRegistry) {
      return '○ not loaded';
    }

    if (workspaceRegistry.state === 'loaded') {
      return `● loaded · ${workspaceRegistry.workspaces.length} Workspaces`;
    }

    if (workspaceRegistry.state === 'loaded-with-errors') {
      const errorCount = workspaceRegistry.issues.filter(
        (issue) => issue.severity === 'error',
      ).length;
      return `⚠ validation errors: ${errorCount}`;
    }

    if (workspaceRegistry.state === 'not-found') {
      return '○ not found';
    }

    if (workspaceRegistry.state === 'inaccessible') {
      return '○ inaccessible';
    }

    return '○ unavailable';
  }

  function getRegistryFileStatusText(fileExists: boolean): string {
    return fileExists ? '● found' : '○ not found';
  }

  return (
    <section className="settings-view" aria-labelledby="settings-heading">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 id="settings-heading">Mimora Settings</h1>
        </div>
        <button className="secondary-button" onClick={openAddForm} type="button">
          + Vault 추가
        </button>
      </div>

      {errorMessage ? (
        <p className="settings-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <section className="local-ai-card" aria-labelledby="local-ai-heading">
        <div className="local-ai-header">
          <div>
            <h2 id="local-ai-heading">Local AI</h2>
            <p>로컬 또는 원격 Ollama 연결 설정</p>
          </div>
          <span
            className={`local-ai-connection ${
              connectionResult?.connected ? 'is-connected' : ''
            }`}
          >
            {connectionResult?.connected ? '● Connected' : '○ Not connected'}
          </span>
        </div>

        <form
          className="local-ai-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveLocalAISettings();
          }}
        >
          <label>
            <span>Provider</span>
            <select disabled value={localAIForm.provider}>
              <option value="ollama">Ollama</option>
            </select>
          </label>

          <label className="local-ai-endpoint-field">
            <span>Endpoint</span>
            <input
              onChange={(event) => {
                setLocalAIForm({
                  ...localAIForm,
                  endpoint: event.target.value,
                });
                setLocalAIModels([]);
                setModelsLoaded(false);
                setConnectionResult(null);
                setLocalAIFeedback(null);
              }}
              placeholder={defaultLocalAISettings.endpoint}
              spellCheck={false}
              value={localAIForm.endpoint}
            />
          </label>

          <label className="local-ai-model-field">
            <span>Model</span>
            <select
              onChange={(event) => {
                setLocalAIForm({
                  ...localAIForm,
                  model: event.target.value || null,
                });
                setLocalAIFeedback(null);
              }}
              value={localAIForm.model ?? ''}
            >
              {!localAIForm.model ? (
                <option value="">설치 모델을 선택하세요.</option>
              ) : null}
              {localAIForm.model &&
              !localAIModels.some(
                (model) => model.model === localAIForm.model,
              ) ? (
                <option value={localAIForm.model}>
                  {localAIForm.model}
                  {modelsLoaded ? ' (설치되지 않음)' : ' (현재 설정)'}
                </option>
              ) : null}
              {localAIModels.map((model) => (
                <option key={model.model} value={model.model}>
                  {model.model || model.name}
                </option>
              ))}
            </select>
          </label>

          <div className="local-ai-actions">
            <button
              className="secondary-button"
              disabled={isRefreshingModels || !localAIForm.endpoint.trim()}
              onClick={() => {
                void refreshLocalAIModels();
              }}
              type="button"
            >
              {isRefreshingModels ? '조회 중…' : '모델 새로고침'}
            </button>
            <button
              className="secondary-button"
              disabled={isTestingConnection || !localAIForm.endpoint.trim()}
              onClick={() => {
                void testLocalAIConnection();
              }}
              type="button"
            >
              {isTestingConnection ? '확인 중…' : 'Connection Test'}
            </button>
            <button
              className="primary-button"
              disabled={
                isSavingLocalAI ||
                !localAISettingsChanged ||
                !localAIForm.endpoint.trim()
              }
              type="submit"
            >
              {isSavingLocalAI ? '저장 중…' : '설정 저장'}
            </button>
          </div>
        </form>

        <div className="local-ai-messages" aria-live="polite">
          {connectionResult ? (
            <p className={connectionResult.connected ? 'success' : 'error'}>
              {connectionResult.message}
            </p>
          ) : null}
          {localAIFeedback ? (
            <p className={localAIFeedback.tone}>
              {localAIFeedback.message}
            </p>
          ) : null}
          {configuredModelMissing ? (
            <p className="warning">
              선택된 모델이 현재 Ollama에 설치되어 있지 않습니다.
            </p>
          ) : null}
        </div>
      </section>

      <ExternalAISettingsSection
        onSettingsChange={setSettings}
        settings={settings}
      />

      <section className="registry-card" aria-labelledby="registry-heading">
        <div className="registry-header">
          <div>
            <h2 id="registry-heading">Registry</h2>
            <p>{getRegistryMessage()}</p>
          </div>
        </div>

        <label className="registry-home-field">
          <span>Registry Home Vault</span>
          <select
            disabled={settings.vaults.length === 0}
            onChange={(event) => {
              void updateRegistryHomeVault(event.target.value);
            }}
            value={settings.registry.homeVaultId ?? ''}
          >
            <option value="">
              {settings.vaults.length === 0
                ? '등록된 Vault가 없습니다'
                : '선택하지 않음'}
            </option>
            {settings.vaults.map((vault) => (
              <option key={vault.id} value={vault.id}>
                {vault.name}
              </option>
            ))}
          </select>
        </label>

        <div className="registry-file-list">
          {(registryStatus?.files ?? []).map((file) => (
            <div className="registry-file-row" key={file.key}>
              <div>
                <strong>
                  {file.key === 'workspaces'
                    ? 'Workspace Registry'
                    : file.key === 'knowledge-domains'
                      ? 'Knowledge Domains'
                      : 'Knowledge Types'}
                </strong>
                <span>{file.relativePath}</span>
              </div>
              <div className="registry-file-status">
                <span
                  className={
                    file.key === 'workspaces'
                      ? workspaceRegistry?.state === 'loaded'
                        ? 'found'
                        : workspaceRegistry?.state === 'loaded-with-errors'
                          ? 'warning'
                          : 'missing'
                      : file.exists
                        ? 'found'
                        : 'missing'
                  }
                >
                  {file.key === 'workspaces'
                    ? getWorkspaceRegistryStatusText()
                    : getRegistryFileStatusText(file.exists)}
                </span>
                {file.key === 'workspaces' &&
                workspaceRegistry &&
                workspaceRegistry.issues.length > 0 ? (
                  <button
                    className="registry-issues-toggle"
                    onClick={() => {
                      setShowWorkspaceRegistryIssues(
                        !showWorkspaceRegistryIssues,
                      );
                    }}
                    type="button"
                  >
                    문제 보기
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {showWorkspaceRegistryIssues &&
        workspaceRegistry &&
        workspaceRegistry.issues.length > 0 ? (
          <div className="registry-issues">
            <h3>Workspace Registry Issues</h3>
            <ul>
              {workspaceRegistry.issues.map((issue, index) => (
                <li className={issue.severity} key={`${issue.code}-${index}`}>
                  <strong>
                    {issue.severity === 'error' ? '⛔' : '⚠'}
                    {issue.workspaceId ? ` ${issue.workspaceId}` : ''}
                  </strong>
                  <span>
                    {issue.message}
                    {issue.row ? ` · row ${issue.row}` : ''}
                    {issue.field ? ` · ${issue.field}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <MaskingSettingsSection
        onSettingsChange={setSettings}
        settings={settings}
      />

      <SecretDetectionSettingsSection
        onSettingsChange={setSettings}
        settings={settings}
      />

      {formState ? (
        <form
          className="vault-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveVault();
          }}
        >
          <h2>{isEditing ? 'Vault 수정' : 'Vault 추가'}</h2>
          <label>
            <span>Vault 이름</span>
            <input
              onChange={(event) => {
                setFormState({ ...formState, name: event.target.value });
              }}
              value={formState.name}
            />
          </label>

          <label>
            <span>Vault 유형</span>
            <select
              onChange={(event) => {
                setFormState({
                  ...formState,
                  type: event.target.value as VaultType,
                });
              }}
              value={formState.type}
            >
              {vaultTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {vaultTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>보안등급</span>
            <select
              onChange={(event) => {
                setFormState({
                  ...formState,
                  security: event.target.value as VaultSecurity,
                });
              }}
              value={formState.security}
            >
              {vaultSecurityOptions.map((security) => (
                <option key={security} value={security}>
                  {vaultSecurityLabels[security]}
                </option>
              ))}
            </select>
          </label>

          <div className="vault-folder-field">
            <span>폴더</span>
            <div>
              <button
                className="secondary-button"
                onClick={() => {
                  void chooseFolder();
                }}
                type="button"
              >
                폴더 선택
              </button>
              <p>{formState.path || '선택된 폴더가 없습니다.'}</p>
            </div>
          </div>

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setFormState(null);
              }}
              type="button"
            >
              취소
            </button>
            <button className="primary-button" type="submit">
              저장
            </button>
          </div>
        </form>
      ) : null}

      {deleteTarget ? (
        <div className="delete-confirmation" role="alertdialog">
          <p>
            '{deleteTarget.name}' Vault 등록을 삭제하시겠습니까?
            <br />
            실제 Obsidian Vault 폴더나 파일은 삭제되지 않습니다.
            {deleteTargetIsRegistryHome ? (
              <>
                <br />
                이 Vault는 Registry Home Vault로 지정되어 있으며, 삭제 시
                Registry Home 지정이 해제됩니다.
              </>
            ) : null}
          </p>
          <div className="form-actions">
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
                void deleteVault(deleteTarget);
              }}
              type="button"
            >
              삭제
            </button>
          </div>
        </div>
      ) : null}

      <div className="vault-list">
        {isLoading ? <p className="empty-vaults">설정을 불러오는 중입니다.</p> : null}

        {!isLoading && sortedVaults.length === 0 ? (
          <p className="empty-vaults">
            등록된 Vault가 없습니다.
            <br />
            Mimora에서 사용할 Obsidian Vault를 추가하세요.
          </p>
        ) : null}

        {sortedVaults.map((vault) => (
          <article className="vault-card" key={vault.id}>
            <div className="vault-card-header">
              <h2>{vault.name}</h2>
              <div className="vault-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    openEditForm(vault);
                  }}
                  type="button"
                >
                  수정
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setErrorMessage(null);
                    setFormState(null);
                    setDeleteTarget(vault);
                  }}
                  type="button"
                >
                  삭제
                </button>
              </div>
            </div>

            <dl className="vault-details">
              <div>
                <dt>Type</dt>
                <dd>{vaultTypeLabels[vault.type]}</dd>
              </div>
              <div>
                <dt>Security</dt>
                <dd>{vaultSecurityLabels[vault.security]}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>{vault.path}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
