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
import type { KnowledgeDomainRegistryParseResult } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistryParseResult } from '../registry/knowledgeTypeRegistryTypes';
import type { WorkspaceRegistryParseResult } from '../registry/workspaceRegistryTypes';
import {
  documentIdValidationStatusLabels,
  type DocumentIdValidationStatus,
  type DocumentIdValidationSummary,
} from '../documentIdValidation';

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
  onVaultDocumentsChanged,
  onWorkspaceRegistryChanged,
}: {
  onVaultDocumentsChanged?: () => void;
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
  const [knowledgeDomainRegistry, setKnowledgeDomainRegistry] =
    useState<KnowledgeDomainRegistryParseResult | null>(null);
  const [knowledgeTypeRegistry, setKnowledgeTypeRegistry] =
    useState<KnowledgeTypeRegistryParseResult | null>(null);
  const [showWorkspaceRegistryIssues, setShowWorkspaceRegistryIssues] =
    useState(false);
  const [showKnowledgeDomainRegistryIssues, setShowKnowledgeDomainRegistryIssues] =
    useState(false);
  const [showKnowledgeTypeRegistryIssues, setShowKnowledgeTypeRegistryIssues] =
    useState(false);
  const [documentIdValidation, setDocumentIdValidation] =
    useState<DocumentIdValidationSummary | null>(null);
  const [documentIdValidationError, setDocumentIdValidationError] =
    useState<string | null>(null);
  const [documentIdProblemFilter, setDocumentIdProblemFilter] =
    useState<DocumentIdValidationStatus | null>(null);

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
  const documentIdProblemDocuments = useMemo(
    () =>
      documentIdValidation?.documents.filter(
        (document) =>
          documentIdProblemFilter !== null &&
          document.status === documentIdProblemFilter &&
          document.status !== 'valid',
      ) ?? [],
    [documentIdProblemFilter, documentIdValidation],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const loadedSettings = await window.mimora.getSettings();

        if (isMounted) {
          setSettings(loadedSettings);
          setLocalAIForm({ ...loadedSettings.localAI });
          const [
            loadedRegistryStatus,
            loadedWorkspaceRegistry,
            loadedKnowledgeDomainRegistry,
            loadedKnowledgeTypeRegistry,
            loadedDocumentIdValidation,
          ] =
            await Promise.all([
              window.mimora.getRegistryStatus(),
              window.mimora.loadWorkspaceRegistry(),
              window.mimora.loadKnowledgeDomainRegistry(),
              window.mimora.loadKnowledgeTypeRegistry(),
              window.mimora.validateDocumentIds(),
            ]);

          if (isMounted) {
            setRegistryStatus(loadedRegistryStatus);
            setWorkspaceRegistry(loadedWorkspaceRegistry);
            setKnowledgeDomainRegistry(loadedKnowledgeDomainRegistry);
            setKnowledgeTypeRegistry(loadedKnowledgeTypeRegistry);
            setDocumentIdValidation(loadedDocumentIdValidation);
            setDocumentIdValidationError(null);
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
    const [
      nextRegistryStatus,
      nextWorkspaceRegistry,
      nextKnowledgeDomainRegistry,
      nextKnowledgeTypeRegistry,
    ] = await Promise.all([
      window.mimora.getRegistryStatus(),
      window.mimora.loadWorkspaceRegistry(),
      window.mimora.loadKnowledgeDomainRegistry(),
      window.mimora.loadKnowledgeTypeRegistry(),
    ]);
    setRegistryStatus(nextRegistryStatus);
    setWorkspaceRegistry(nextWorkspaceRegistry);
    setKnowledgeDomainRegistry(nextKnowledgeDomainRegistry);
    setKnowledgeTypeRegistry(nextKnowledgeTypeRegistry);
  }

  async function refreshDocumentIdValidation(): Promise<void> {
    try {
      const nextDocumentIdValidation =
        await window.mimora.validateDocumentIds();

      setDocumentIdValidation(nextDocumentIdValidation);
      setDocumentIdValidationError(null);
      onVaultDocumentsChanged?.();
    } catch (error) {
      setDocumentIdValidation(null);
      setDocumentIdValidationError(getErrorMessage(error));
    }
  }

  async function handleReloadRegistry(): Promise<void> {
    setErrorMessage(null);

    try {
      await refreshRegistryStatus();
      await onWorkspaceRegistryChanged?.();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
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
      await refreshDocumentIdValidation();
      onVaultDocumentsChanged?.();
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
      await refreshDocumentIdValidation();
      onVaultDocumentsChanged?.();
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
    if (registryStatus?.runtime.mode === 'normal') {
      return 'Registry Markdown을 정상적으로 사용 중입니다.';
    }

    if (registryStatus?.runtime.mode === 'degraded') {
      return 'Registry를 현재 읽을 수 없어 마지막 정상 상태를 사용 중입니다.';
    }

    if (registryStatus?.runtime.mode === 'unresolved') {
      return 'Registry를 확인할 수 없습니다.';
    }

    if (!settings.registry.homeVaultId) {
      return 'Registry Home Vault가 지정되지 않았습니다.';
    }

    if (!registryHomeVault || registryStatus?.homeVaultAvailable === false) {
      return 'Registry Home Vault에 접근할 수 없습니다.';
    }

    return 'Registry Home Vault에 접근할 수 있습니다.';
  }

  function getRegistryModeLabel(): string {
    if (!registryStatus) {
      return 'Loading';
    }

    return registryStatus.runtime.mode === 'normal'
      ? 'Normal'
      : registryStatus.runtime.mode === 'degraded'
        ? 'Degraded'
        : 'Unresolved';
  }

  function getRegistryRuntimeDetail(): string {
    if (!registryStatus) {
      return 'Registry 상태를 불러오는 중입니다.';
    }

    if (registryStatus.runtime.mode === 'normal') {
      return `Workspace Registry · ${registryStatus.runtime.workspaceCount} / Knowledge Domains · ${registryStatus.runtime.knowledgeDomainCount} / Knowledge Types · ${registryStatus.runtime.knowledgeTypeCount}`;
    }

    if (registryStatus.runtime.mode === 'degraded') {
      return `Using cached registry · Last successful load: ${
        registryStatus.runtime.lastSuccessfulLoad ?? 'unknown'
      }`;
    }

    return 'No valid Registry available';
  }

  function getRegistryRuntimeIssueText(): string {
    const issues = registryStatus?.runtime.issues ?? [];

    if (issues.length === 0) {
      return '';
    }

    return issues
      .map((issue) => `${issue.registry}: ${issue.message}`)
      .join(' / ');
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

  function getKnowledgeDomainRegistryStatusText(): string {
    if (!knowledgeDomainRegistry) {
      return 'not loaded';
    }

    if (knowledgeDomainRegistry.state === 'loaded') {
      return `loaded · ${knowledgeDomainRegistry.domains.length} Domains`;
    }

    if (knowledgeDomainRegistry.state === 'loaded-with-errors') {
      const errorCount = knowledgeDomainRegistry.issues.filter(
        (issue) => issue.severity === 'error',
      ).length;
      return `validation errors: ${errorCount}`;
    }

    if (knowledgeDomainRegistry.state === 'not-found') {
      return 'not found';
    }

    if (knowledgeDomainRegistry.state === 'inaccessible') {
      return 'inaccessible';
    }

    return 'unavailable';
  }

  function getKnowledgeTypeRegistryStatusText(): string {
    if (!knowledgeTypeRegistry) {
      return 'not loaded';
    }

    if (knowledgeTypeRegistry.state === 'loaded') {
      return `loaded · ${knowledgeTypeRegistry.types.length} Types`;
    }

    if (knowledgeTypeRegistry.state === 'loaded-with-errors') {
      const errorCount = knowledgeTypeRegistry.issues.filter(
        (issue) => issue.severity === 'error',
      ).length;
      return `validation errors: ${errorCount}`;
    }

    if (knowledgeTypeRegistry.state === 'not-found') {
      return 'not found';
    }

    if (knowledgeTypeRegistry.state === 'inaccessible') {
      return 'inaccessible';
    }

    return 'unavailable';
  }

  function getRegistryFileStatusClass(fileKey: string): string {
    if (registryStatus?.runtime.mode === 'degraded') {
      return registryStatus.runtime.issues.some(
        (issue) => issue.registry === fileKey,
      )
        ? 'warning'
        : 'found';
    }

    if (registryStatus?.runtime.mode === 'unresolved') {
      return 'missing';
    }

    if (fileKey === 'workspaces') {
      return workspaceRegistry?.state === 'loaded'
        ? 'found'
        : workspaceRegistry?.state === 'loaded-with-errors'
          ? 'warning'
          : 'missing';
    }

    if (fileKey === 'knowledge-domains') {
      return knowledgeDomainRegistry?.state === 'loaded'
        ? 'found'
        : knowledgeDomainRegistry?.state === 'loaded-with-errors'
          ? 'warning'
          : 'missing';
    }

    if (fileKey === 'knowledge-types') {
      return knowledgeTypeRegistry?.state === 'loaded'
        ? 'found'
        : knowledgeTypeRegistry?.state === 'loaded-with-errors'
          ? 'warning'
          : 'missing';
    }

    return 'missing';
  }

  function getRegistryFileStatusLabel(fileKey: string, fileExists: boolean): string {
    if (registryStatus?.runtime.mode === 'degraded') {
      return registryStatus.runtime.issues.some(
        (issue) => issue.registry === fileKey,
      )
        ? 'cached · current issue'
        : 'cached';
    }

    if (fileKey === 'workspaces') {
      return getWorkspaceRegistryStatusText();
    }

    if (fileKey === 'knowledge-domains') {
      return getKnowledgeDomainRegistryStatusText();
    }

    if (fileKey === 'knowledge-types') {
      return getKnowledgeTypeRegistryStatusText();
    }

    return getRegistryFileStatusText(fileExists);
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
          <button
            className="secondary-button"
            onClick={() => {
              void handleReloadRegistry();
            }}
            type="button"
          >
            Registry 다시 읽기
          </button>
        </div>

        <div
          className={`registry-runtime-status ${
            registryStatus?.runtime.mode ?? 'unresolved'
          }`}
        >
          <strong>Mode: {getRegistryModeLabel()}</strong>
          <span>{getRegistryRuntimeDetail()}</span>
          {getRegistryRuntimeIssueText() ? (
            <small>{getRegistryRuntimeIssueText()}</small>
          ) : null}
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
                <span className={getRegistryFileStatusClass(file.key)}>
                  {getRegistryFileStatusLabel(file.key, file.exists)}
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
                {file.key === 'knowledge-domains' &&
                knowledgeDomainRegistry &&
                knowledgeDomainRegistry.issues.length > 0 ? (
                  <button
                    className="registry-issues-toggle"
                    onClick={() => {
                      setShowKnowledgeDomainRegistryIssues(
                        !showKnowledgeDomainRegistryIssues,
                      );
                    }}
                    type="button"
                  >
                    문제 보기
                  </button>
                ) : null}
                {file.key === 'knowledge-types' &&
                knowledgeTypeRegistry &&
                knowledgeTypeRegistry.issues.length > 0 ? (
                  <button
                    className="registry-issues-toggle"
                    onClick={() => {
                      setShowKnowledgeTypeRegistryIssues(
                        !showKnowledgeTypeRegistryIssues,
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
        {showKnowledgeDomainRegistryIssues &&
        knowledgeDomainRegistry &&
        knowledgeDomainRegistry.issues.length > 0 ? (
          <div className="registry-issues">
            <h3>Knowledge Domain Registry Issues</h3>
            <ul>
              {knowledgeDomainRegistry.issues.map((issue, index) => (
                <li className={issue.severity} key={`${issue.code}-${index}`}>
                  <strong>
                    {issue.severity === 'error' ? '오류' : '경고'}
                    {issue.canonicalName ? ` ${issue.canonicalName}` : ''}
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
        {showKnowledgeTypeRegistryIssues &&
        knowledgeTypeRegistry &&
        knowledgeTypeRegistry.issues.length > 0 ? (
          <div className="registry-issues">
            <h3>Knowledge Type Registry Issues</h3>
            <ul>
              {knowledgeTypeRegistry.issues.map((issue, index) => (
                <li className={issue.severity} key={`${issue.code}-${index}`}>
                  <strong>
                    {issue.severity === 'error' ? '오류' : '경고'}
                    {issue.canonicalName ? ` ${issue.canonicalName}` : ''}
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

      <section
        className="document-id-validation-card"
        aria-labelledby="document-id-validation-heading"
      >
        <div className="registry-header">
          <div>
            <h2 id="document-id-validation-heading">
              Document ID Validation
            </h2>
            <p>
              Read-only validation across all registered Vault Markdown files.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              void refreshDocumentIdValidation();
            }}
            type="button"
          >
            Re-scan
          </button>
        </div>

        {documentIdValidationError ? (
          <p className="document-id-validation-error" role="alert">
            {documentIdValidationError}
          </p>
        ) : null}

        <div className="document-id-count-grid">
          {(
            [
              'valid',
              'missing',
              'invalid-format',
              'duplicate',
            ] satisfies DocumentIdValidationStatus[]
          ).map((status) => {
            const count = documentIdValidation?.counts[status] ?? 0;
            const isProblemStatus = status !== 'valid';
            const isActive = documentIdProblemFilter === status;

            return (
              <button
                aria-pressed={isActive}
                className={`document-id-count-card ${status}${
                  isActive ? ' active' : ''
                }`}
                disabled={!isProblemStatus || count === 0}
                key={status}
                onClick={() => {
                  setDocumentIdProblemFilter(isActive ? null : status);
                }}
                type="button"
              >
                <span>{documentIdValidationStatusLabels[status]}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>

        {documentIdValidation ? (
          <p className="document-id-validation-meta">
            Scanned {documentIdValidation.documentCount} Markdown files in{' '}
            {documentIdValidation.vaultCount} Vaults.
          </p>
        ) : (
          <p className="document-id-validation-meta">
            Document ID validation has not run yet.
          </p>
        )}

        {documentIdValidation?.errors.length ? (
          <div className="document-id-validation-errors">
            <strong>Scan warnings</strong>
            <ul>
              {documentIdValidation.errors.map((error, index) => (
                <li key={`${error.vaultId}-${index}`}>
                  {error.vaultName}: {error.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {documentIdProblemFilter ? (
          <div className="document-id-problem-list">
            <div className="document-id-problem-heading">
              {documentIdValidationStatusLabels[documentIdProblemFilter]}
            </div>
            {documentIdProblemFilter === 'duplicate' &&
            documentIdValidation?.duplicateGroups.length ? (
              documentIdValidation.duplicateGroups.map((group) => (
                <article
                  className="document-id-duplicate-group"
                  key={group.documentId}
                >
                  <strong>{group.documentId}</strong>
                  <span>Used in {group.documents.length} documents</span>
                  <ul>
                    {group.documents.map((document) => (
                      <li
                        key={`${document.vaultId}:${document.relativePath}`}
                      >
                        {document.vaultName} / {document.relativePath}
                      </li>
                    ))}
                  </ul>
                </article>
              ))
            ) : documentIdProblemDocuments.length > 0 ? (
              documentIdProblemDocuments.map((document) => (
                <article
                  className="document-id-problem-row"
                  key={`${document.vaultId}:${document.relativePath}`}
                >
                  <strong>{document.fileName}</strong>
                  <span>{document.vaultName}</span>
                  <code>{document.documentId ?? 'Missing'}</code>
                  <em>{documentIdValidationStatusLabels[document.status]}</em>
                </article>
              ))
            ) : (
              <p className="document-id-validation-meta">
                No documents for this status.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <MaskingSettingsSection
        onSettingsChange={setSettings}
        settings={settings}
        workspaces={workspaceRegistry?.workspaces ?? []}
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
