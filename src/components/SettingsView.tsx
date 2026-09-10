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
import type {
  RagDocument,
  RagEmbeddingStatus,
  RagFileSelection,
  RagPythonStatus,
  RagSettings,
  RagSearchResult,
} from '../rag';
import {
  ragEmbeddingProviderOptions,
} from '../rag';
import type {
  CanonicalScheduleTask,
  ScheduleFileSelection,
  ScheduleQueryResult,
  ScheduleSource,
  ScheduleTaskAnalysis,
  ScheduleSummary,
} from '../schedule';
import {
  getScheduleQueryResultDisplayState,
  getScheduleRegisterButtonLabel,
  getScheduleReparseButtonLabel,
  getScheduleStageLabel,
  isScheduleOperationBusy,
  type ScheduleOperationStage,
} from '../scheduleUx';
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getRagSecurityLabel(security: RagDocument['security']): string {
  return security === 'private' ? 'Private' : vaultSecurityLabels[security];
}

function formatProgress(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : '-';
}

function formatScheduleDate(value: string | null | undefined): string {
  return value || '-';
}

function formatSchedulePeriod(task: CanonicalScheduleTask): string {
  return `${formatScheduleDate(task.plannedStart)} ~ ${formatScheduleDate(
    task.plannedFinish,
  )}`;
}

function formatScheduleAllocation(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(0)}%`
    : '-';
}

function normalizeScheduleLookupText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLocaleLowerCase();
}

function getMatchingScheduleResource(
  task: CanonicalScheduleTask,
  target: string | null | undefined,
) {
  const normalizedTarget = normalizeScheduleLookupText(target);

  if (!normalizedTarget) {
    return task.resource[0] ?? null;
  }

  return (
    task.resource.find(
      (resource) =>
        normalizeScheduleLookupText(resource.name) === normalizedTarget,
    ) ?? null
  );
}

function getScheduleQueryKindLabel(kind: ScheduleQueryResult['kind']): string {
  switch (kind) {
    case 'resource_lookup':
      return 'Resource lookup';
    case 'resource_status':
      return 'Resource status';
    case 'task_lookup':
      return 'Task lookup';
    case 'task_status':
      return 'Task status';
    case 'delayed_tasks':
      return 'Delayed tasks';
    case 'active_tasks':
      return 'Active tasks';
    case 'starting_between':
      return 'Starting tasks';
    case 'finishing_between':
      return 'Finishing tasks';
    case 'summary':
      return 'Schedule summary';
  }
}

function getScheduleStatusLabel(
  status: ScheduleTaskAnalysis['status'] | undefined,
): string {
  switch (status) {
    case 'completed':
      return '완료';
    case 'active':
    case 'in_progress':
      return '진행 중';
    case 'delayed':
      return '지연';
    case 'not_started':
      return '미착수';
    default:
      return '-';
  }
}

function ScheduleIntelligenceSection({
  workspaceRegistry,
}: {
  workspaceRegistry: WorkspaceRegistryParseResult | null;
}) {
  const workspaces = useMemo(
    () =>
      (workspaceRegistry?.workspaces ?? []).filter(
        (workspace) => workspace.status !== 'archived',
      ),
    [workspaceRegistry],
  );
  const [workspaceId, setWorkspaceId] = useState('');
  const [storageRoot, setStorageRoot] = useState('');
  const [source, setSource] = useState<ScheduleSource | null>(null);
  const [summary, setSummary] = useState<ScheduleSummary | null>(null);
  const [selectedFile, setSelectedFile] =
    useState<ScheduleFileSelection | null>(null);
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] =
    useState<ScheduleQueryResult | null>(null);
  const [showRawQueryJson, setShowRawQueryJson] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ScheduleOperationStage>('idle');
  const isBusy = isScheduleOperationBusy(stage);
  const stageLabel = getScheduleStageLabel(stage);
  const queryDisplay = getScheduleQueryResultDisplayState(showRawQueryJson);

  useEffect(() => {
    setWorkspaceId((currentWorkspaceId) =>
      currentWorkspaceId || workspaces[0]?.id || '',
    );
  }, [workspaces]);

  useEffect(() => {
    let isMounted = true;

    async function loadScheduleState(): Promise<void> {
      if (!workspaceId) {
        return;
      }

      try {
        const [nextStorageRoot, nextSource] = await Promise.all([
          window.mimora.getScheduleStorageRoot(),
          window.mimora.getScheduleSource(workspaceId),
        ]);

        if (!isMounted) {
          return;
        }

        setStorageRoot(nextStorageRoot);
        setSource(nextSource);
        setSummary(null);
        setQueryResult(null);
        setShowRawQueryJson(false);
        setError(null);
        setStage('idle');
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError));
        }
      }
    }

    void loadScheduleState();

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  async function handleSelectSchedule(): Promise<void> {
    const selection = await window.mimora.selectScheduleSourceFile();

    if (selection) {
      setSelectedFile(selection);
      setMessage(null);
      setError(null);
      setStage('idle');
    }
  }

  async function refreshSourceAfterFailure(): Promise<void> {
    if (!workspaceId) {
      return;
    }

    try {
      setSource(await window.mimora.getScheduleSource(workspaceId));
    } catch {
      // Keep the original operation error visible.
    }
  }

  async function handleRegisterSchedule(): Promise<void> {
    if (!workspaceId || !selectedFile) {
      setError('Workspace와 Schedule Excel을 먼저 선택하세요.');
      return;
    }

    setStage('registering');
    setError(null);
    setMessage(null);

    try {
      const nextSource = await window.mimora.registerScheduleSource({
        workspaceId,
        selectionId: selectedFile.selectionId,
      });

      setSource(nextSource);
      setSummary(null);
      setQueryResult(null);
      setShowRawQueryJson(false);
      setSelectedFile(null);
      setStage('parsing');

      const result = await window.mimora.refreshSchedule(workspaceId, {
        force: true,
      });

      setStage('building_cache');
      setSource(result.source);
      setSummary(result.summary);
      setMessage(
        `Parsed: ${result.summary.taskCount.toLocaleString()} WBS nodes`,
      );
      setStage('parsed');
    } catch (registerError) {
      setStage('failed');
      await refreshSourceAfterFailure();
      setError(getErrorMessage(registerError));
    }
  }

  async function handleRefreshSchedule(): Promise<void> {
    if (!workspaceId) {
      return;
    }

    setStage('parsing');
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.refreshSchedule(workspaceId, {
        force: true,
      });

      setStage('building_cache');
      setSource(result.source);
      setSummary(result.summary);
      setQueryResult(null);
      setShowRawQueryJson(false);
      setMessage(
        `Re-parsed: ${result.summary.taskCount.toLocaleString()} WBS nodes`,
      );
      setStage('parsed');
    } catch (refreshError) {
      setStage('failed');
      await refreshSourceAfterFailure();
      setError(getErrorMessage(refreshError));
    }
  }

  async function handleRemoveSchedule(): Promise<void> {
    if (!workspaceId || !source) {
      return;
    }

    const confirmed = window.confirm(
      '이 일정 파일을 Mimora에서 연결 해제합니다.\n원본 Excel 파일은 삭제하지 않습니다.',
    );

    if (!confirmed) {
      return;
    }

    setStage('registering');
    setError(null);
    setMessage(null);

    try {
      await window.mimora.removeScheduleSource(workspaceId);
      setSource(null);
      setSummary(null);
      setQueryResult(null);
      setShowRawQueryJson(false);
      setSelectedFile(null);
      setMessage('Schedule source removed. Original Excel file was not changed.');
      setStage('idle');
    } catch (removeError) {
      setStage('failed');
      setError(getErrorMessage(removeError));
    }
  }

  async function handleQuerySchedule(): Promise<void> {
    if (!workspaceId || !query.trim()) {
      setError('Schedule query를 입력하세요.');
      return;
    }

    setStage('parsing');
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.querySchedule({
        workspaceId,
        query,
      });

      setQueryResult(result);
      setShowRawQueryJson(false);
      setSummary(result.summary);
      setMessage(`Query returned ${result.tasks.length.toLocaleString()} tasks.`);
      setStage('parsed');
    } catch (queryError) {
      setStage('failed');
      setError(getErrorMessage(queryError));
    }
  }

  function renderScheduleTaskTable(
    tasks: CanonicalScheduleTask[],
    columns: 'resource' | 'standard' | 'status',
  ) {
    if (tasks.length === 0) {
      return (
        <p className="schedule-query-empty">
          Matching schedule tasks were not found.
        </p>
      );
    }

    return (
      <div className="schedule-query-table-wrap">
        <table className="schedule-query-table">
          <thead>
            <tr>
              <th>WBS</th>
              <th>작업</th>
              {columns !== 'standard' ? <th>배정률</th> : null}
              <th>계획기간</th>
              {columns === 'standard' ? <th>실제기간</th> : null}
              <th>진척률</th>
              {columns === 'status' ? <th>상태</th> : null}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const resource = getMatchingScheduleResource(
                task,
                queryResult?.target,
              );
              const analysis = queryResult?.taskAnalyses?.find(
                (item) => item.taskId === task.taskId,
              );

              return (
                <tr key={task.taskId}>
                  <td>{task.wbs}</td>
                  <td>{task.name}</td>
                  {columns !== 'standard' ? (
                    <td>
                      {formatScheduleAllocation(
                        analysis?.allocation ?? resource?.allocation,
                      )}
                    </td>
                  ) : null}
                  <td>{formatSchedulePeriod(task)}</td>
                  {columns === 'standard' ? (
                    <td>
                      {formatScheduleDate(task.actualStart)} ~{' '}
                      {formatScheduleDate(task.actualFinish)}
                    </td>
                  ) : null}
                  <td>{formatProgress(task.actualProgress)}</td>
                  {columns === 'status' ? (
                    <td>{getScheduleStatusLabel(analysis?.status)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderScheduleQueryResult() {
    if (!queryResult) {
      return null;
    }

    return (
      <div className="schedule-formatted-result">
        <div className="schedule-query-result-header">
          <div>
            <strong>{getScheduleQueryKindLabel(queryResult.kind)}</strong>
            <span>As of {queryResult.asOfDate}</span>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              setShowRawQueryJson((current) => !current);
            }}
            type="button"
          >
            {showRawQueryJson ? 'Raw JSON 숨기기' : 'Raw JSON 보기'}
          </button>
        </div>

        {queryDisplay.showFormattedResult &&
        queryResult.kind === 'summary' ? (
          <div className="schedule-summary-grid compact">
            <span>WBS Nodes <strong>{queryResult.summary.taskCount.toLocaleString()}</strong></span>
            <span>Leaf Tasks <strong>{queryResult.summary.leafTaskCount.toLocaleString()}</strong></span>
            <span>Active Tasks <strong>{queryResult.summary.activeTaskCount.toLocaleString()}</strong></span>
            <span>Delayed Tasks <strong>{queryResult.summary.delayedTaskCount.toLocaleString()}</strong></span>
            <span>Planned <strong>{formatProgress(queryResult.summary.plannedProgress)}</strong></span>
            <span>Actual <strong>{formatProgress(queryResult.summary.actualProgress)}</strong></span>
          </div>
        ) : null}

        {queryDisplay.showFormattedResult &&
        queryResult.kind === 'resource_lookup' ? (
          <>
            <p className="schedule-query-target">
              담당자: <strong>{queryResult.target ?? '-'}</strong>
            </p>
            {renderScheduleTaskTable(queryResult.tasks, 'resource')}
          </>
        ) : null}

        {queryDisplay.showFormattedResult &&
        queryResult.kind === 'resource_status' ? (
          <>
            <p className="schedule-query-target">
              담당자: <strong>{queryResult.target ?? '-'}</strong>
            </p>
            {queryResult.resourceStatusSummary ? (
              <div className="schedule-status-summary">
                <span>담당 작업 <strong>{queryResult.resourceStatusSummary.totalTasks.toLocaleString()}</strong></span>
                <span>완료 <strong>{queryResult.resourceStatusSummary.completedTasks.toLocaleString()}</strong></span>
                <span>진행 중 <strong>{queryResult.resourceStatusSummary.activeTasks.toLocaleString()}</strong></span>
                <span>지연 <strong>{queryResult.resourceStatusSummary.delayedTasks.toLocaleString()}</strong></span>
                <span>미착수 <strong>{queryResult.resourceStatusSummary.notStartedTasks.toLocaleString()}</strong></span>
              </div>
            ) : null}
            {renderScheduleTaskTable(queryResult.tasks, 'status')}
          </>
        ) : null}

        {queryDisplay.showFormattedResult &&
        queryResult.kind === 'task_status' ? (
          renderScheduleTaskTable(queryResult.tasks, 'status')
        ) : null}

        {queryDisplay.showFormattedResult &&
        queryResult.kind !== 'summary' &&
        queryResult.kind !== 'resource_lookup' &&
        queryResult.kind !== 'resource_status' &&
        queryResult.kind !== 'task_status' ? (
          renderScheduleTaskTable(queryResult.tasks, 'standard')
        ) : null}

        {queryDisplay.showRawJson ? (
          <pre className="schedule-query-result">
            {JSON.stringify(
              {
                kind: queryResult.kind,
                target: queryResult.target,
                detectedEntityType: queryResult.detectedEntityType,
                detectedEntity: queryResult.detectedEntity,
                detectedIntent: queryResult.detectedIntent,
                asOfDate: queryResult.asOfDate,
                tasks: queryResult.tasks.slice(0, 5),
                taskAnalyses: queryResult.taskAnalyses?.slice(0, 5),
                resourceStatusSummary: queryResult.resourceStatusSummary,
                summary: queryResult.summary,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <section className="schedule-intelligence-card" aria-labelledby="schedule-intelligence-heading">
      <div className="registry-header">
        <div>
          <h2 id="schedule-intelligence-heading">Schedule Intelligence</h2>
          <p>Live Excel source. Parsed cache is derived data; RAG indexing is not used.</p>
        </div>
        <button
          className="secondary-button"
          disabled={isBusy || !workspaceId || !source}
          onClick={() => {
            void handleRefreshSchedule();
          }}
          type="button"
        >
          {getScheduleReparseButtonLabel(stage)}
        </button>
      </div>

      <div className="registry-runtime-summary">
        <span>
          Storage: <code>{storageRoot || 'Loading...'}</code>
        </span>
        <span>
          Status: <strong>{source?.parseStatus ?? 'not registered'}</strong>
        </span>
        <span>
          Source: <strong>{source?.filename ?? selectedFile?.name ?? '-'}</strong>
        </span>
        {source?.lastParsedAt ? <span>Last Parsed: {source.lastParsedAt}</span> : null}
        {stageLabel ? <span>Step: <strong>{stageLabel}</strong></span> : null}
        {source?.parseError ? <span>Error: {source.parseError}</span> : null}
      </div>

      {message ? <p className="settings-success-message">{message}</p> : null}
      {error ? <p className="settings-error-message">{error}</p> : null}

      <div className="schedule-source-controls">
        <label>
          <span>Workspace</span>
          <select
            disabled={isBusy || workspaces.length === 0}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
            }}
            value={workspaceId}
          >
            {workspaces.length === 0 ? (
              <option value="">No active Workspace</option>
            ) : null}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={isBusy || !workspaceId}
          onClick={() => {
            void handleSelectSchedule();
          }}
          type="button"
        >
          Select Schedule
        </button>
        <span>{selectedFile?.name ?? source?.filename ?? 'No schedule selected'}</span>
        <button
          className="primary-button"
          disabled={isBusy || !workspaceId || !selectedFile}
          onClick={() => {
            void handleRegisterSchedule();
          }}
          type="button"
        >
          {getScheduleRegisterButtonLabel(stage)}
        </button>
        <button
          className="secondary-button"
          disabled={isBusy || !workspaceId || !source}
          onClick={() => {
            void handleRemoveSchedule();
          }}
          type="button"
        >
          연결 해제
        </button>
      </div>

      {summary ? (
        <div className="schedule-summary-grid">
          <span>WBS Nodes <strong>{summary.taskCount.toLocaleString()}</strong></span>
          <span>Leaf Tasks <strong>{summary.leafTaskCount.toLocaleString()}</strong></span>
          <span>Active Tasks <strong>{summary.activeTaskCount.toLocaleString()}</strong></span>
          <span>Delayed Tasks <strong>{summary.delayedTaskCount.toLocaleString()}</strong></span>
          <span>Planned <strong>{formatProgress(summary.plannedProgress)}</strong></span>
          <span>Actual <strong>{formatProgress(summary.actualProgress)}</strong></span>
        </div>
      ) : null}

      <div className="schedule-query-test">
        <input
          disabled={isBusy || !source}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="이번 주 종료 예정 작업은?"
          type="search"
          value={query}
        />
        <button
          className="secondary-button"
          disabled={isBusy || !source || !query.trim()}
          onClick={() => {
            void handleQuerySchedule();
          }}
          type="button"
        >
          Query Test
        </button>
      </div>

      {renderScheduleQueryResult()}
    </section>
  );
}

function RagDocumentLibrarySection({
  ragSettings,
  workspaceRegistry,
}: {
  ragSettings: RagSettings;
  workspaceRegistry: WorkspaceRegistryParseResult | null;
}) {
  const [pythonStatus, setPythonStatus] = useState<RagPythonStatus | null>(null);
  const [storageRoot, setStorageRoot] = useState('');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [selectedFile, setSelectedFile] = useState<RagFileSelection | null>(null);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [security, setSecurity] = useState<VaultSecurity>('internal');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchWorkspaceId, setSearchWorkspaceId] = useState('');
  const [searchIncludeGlobal, setSearchIncludeGlobal] = useState(true);
  const [searchTopK, setSearchTopK] = useState(ragSettings.defaultTopK);
  const [searchThreshold, setSearchThreshold] = useState(
    ragSettings.similarityThreshold,
  );
  const [searchResults, setSearchResults] = useState<RagSearchResult[]>([]);
  const [isSearchBusy, setIsSearchBusy] = useState(false);
  const importableWorkspaces = useMemo(
    () =>
      (workspaceRegistry?.workspaces ?? []).filter(
        (workspace) => workspace.status !== 'archived',
      ),
    [workspaceRegistry],
  );
  const workspaceNames = useMemo(
    () =>
      new Map(
        (workspaceRegistry?.workspaces ?? []).map((workspace) => [
          workspace.id,
          workspace.name,
        ]),
      ),
    [workspaceRegistry],
  );

  async function refreshRagDocuments(): Promise<void> {
    const [nextPythonStatus, nextStorageRoot] = await Promise.all([
      window.mimora.getRagPythonStatus(),
      window.mimora.getRagStorageRoot(),
    ]);

    setPythonStatus(nextPythonStatus);
    setStorageRoot(nextStorageRoot);

    if (!nextPythonStatus.available) {
      setDocuments([]);
      return;
    }

    setDocuments(await window.mimora.listRagDocuments());
  }

  useEffect(() => {
    let isMounted = true;

    void refreshRagDocuments().catch((refreshError: unknown) => {
      if (isMounted) {
        setError(getErrorMessage(refreshError));
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setSearchTopK(ragSettings.defaultTopK);
    setSearchThreshold(ragSettings.similarityThreshold);
  }, [ragSettings.defaultTopK, ragSettings.similarityThreshold]);

  async function handleSelectFile(): Promise<void> {
    const selection = await window.mimora.selectRagDocumentFile();

    if (selection) {
      setSelectedFile(selection);
      setMessage(null);
      setError(null);
    }
  }

  async function handleImport(): Promise<void> {
    if (!selectedFile) {
      setError('Import할 RAG 문서를 먼저 선택하세요.');
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.importRagDocument({
        selectionId: selectedFile.selectionId,
        workspaceIds: selectedWorkspaceIds,
        security,
      });

      setMessage(
        result.status === 'duplicate'
          ? `Duplicate document: ${result.duplicateOf}`
          : `Imported: ${result.document.ragDocumentId}`,
      );
      setSelectedFile(null);
      await refreshRagDocuments();
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(document: RagDocument): Promise<void> {
    if (!window.confirm(`${document.originalFilename} 삭제할까요?`)) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await window.mimora.deleteRagDocument(document.ragDocumentId);
      setMessage(`Deleted: ${document.ragDocumentId}`);
      await refreshRagDocuments();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReplace(document: RagDocument): Promise<void> {
    const selection = await window.mimora.selectRagDocumentFile();

    if (!selection) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.replaceRagDocument({
        ragDocumentId: document.ragDocumentId,
        selectionId: selection.selectionId,
      });

      setMessage(
        result.status === 'duplicate'
          ? `Duplicate document: ${result.duplicateOf}`
          : `${result.status}: ${result.document.ragDocumentId}`,
      );
      await refreshRagDocuments();
    } catch (replaceError) {
      setError(getErrorMessage(replaceError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleIndex(document: RagDocument): Promise<void> {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.indexRagDocument({
        ragDocumentId: document.ragDocumentId,
      });
      setMessage(
        `Indexed: ${result.document.ragDocumentId} (${result.document.chunkCount.toLocaleString()} chunks)`,
      );
      await refreshRagDocuments();
    } catch (indexError) {
      setError(getErrorMessage(indexError));
      await refreshRagDocuments().catch(() => undefined);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSearch(): Promise<void> {
    if (!searchQuery.trim()) {
      setError('RAG Search query is required.');
      return;
    }

    setIsSearchBusy(true);
    setError(null);
    setMessage(null);

    try {
      const results = await window.mimora.searchRagDocuments({
        query: searchQuery,
        workspaceIds: searchWorkspaceId ? [searchWorkspaceId] : [],
        includeGlobal: searchIncludeGlobal,
        security: 'internal',
        topK: searchTopK,
        similarityThreshold: searchThreshold,
      });
      setSearchResults(results);
      setMessage(`RAG Search returned ${results.length.toLocaleString()} chunks.`);
    } catch (searchError) {
      setSearchResults([]);
      setError(getErrorMessage(searchError));
    } finally {
      setIsSearchBusy(false);
    }
  }

  function toggleWorkspace(workspaceId: string): void {
    setSelectedWorkspaceIds((currentWorkspaceIds) =>
      currentWorkspaceIds.includes(workspaceId)
        ? currentWorkspaceIds.filter((item) => item !== workspaceId)
        : [...currentWorkspaceIds, workspaceId],
    );
  }

  const isPythonUnavailable = pythonStatus?.available === false;
  const activeEmbeddingModel =
    ragSettings.embeddingProvider === 'openai'
      ? ragSettings.openAIEmbeddingModel
      : ragSettings.localEmbeddingModel;

  return (
    <section className="rag-library-card" aria-labelledby="rag-library-heading">
      <div className="registry-header">
        <div>
          <h2 id="rag-library-heading">RAG Documents</h2>
          <p>Managed imports only. Original files and Vault Markdown are not modified.</p>
        </div>
        <button
          className="secondary-button"
          disabled={isBusy}
          onClick={() => {
            void refreshRagDocuments();
          }}
          type="button"
        >
          Refresh
        </button>
      </div>

      <div className="registry-runtime-summary">
        <span>
          Python:{' '}
          <strong>{pythonStatus?.available ? 'Available' : 'Unavailable'}</strong>
        </span>
        <span>
          Storage: <code>{storageRoot || 'Loading...'}</code>
        </span>
        {pythonStatus?.version ? <span>Python {pythonStatus.version}</span> : null}
      </div>

      {message ? <p className="settings-success-message">{message}</p> : null}
      {error ? <p className="settings-error-message">{error}</p> : null}

      <div className="rag-import-panel">
        <button
          className="secondary-button"
          disabled={isBusy}
          onClick={() => {
            void handleSelectFile();
          }}
          type="button"
        >
          Select Document
        </button>
        <span>{selectedFile?.name ?? 'No file selected'}</span>
        <label>
          <span>Security</span>
          <select
            disabled={isBusy}
            onChange={(event) => {
              setSecurity(event.target.value as VaultSecurity);
            }}
            value={security}
          >
            {vaultSecurityOptions.map((option) => (
              <option key={option} value={option}>
                {vaultSecurityLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary-button"
          disabled={isBusy || isPythonUnavailable || !selectedFile}
          onClick={() => {
            void handleImport();
          }}
          type="button"
        >
          Import
        </button>
      </div>

      <div className="rag-workspace-picker">
        <strong>Workspace Scope</strong>
        <label>
            <input
              checked={selectedWorkspaceIds.length === 0}
              disabled={isBusy || isPythonUnavailable}
            onChange={() => {
              setSelectedWorkspaceIds([]);
            }}
            type="checkbox"
          />
          Global
        </label>
        {importableWorkspaces.map((workspace) => (
          <label key={workspace.id}>
            <input
              checked={selectedWorkspaceIds.includes(workspace.id)}
              disabled={isBusy || isPythonUnavailable}
              onChange={() => {
                toggleWorkspace(workspace.id);
              }}
              type="checkbox"
            />
            {workspace.name}
          </label>
        ))}
      </div>

      {documents.length === 0 ? (
        <p className="document-id-validation-meta">
          No RAG documents imported yet.
        </p>
      ) : (
        <div className="rag-document-list">
          {documents.map((document) => (
            <article className="rag-document-row" key={document.ragDocumentId}>
              <div>
                <strong>{document.originalFilename}</strong>
                <code>{document.ragDocumentId}</code>
              </div>
              <span>
                {document.workspaceIds.length > 0
                  ? document.workspaceIds
                      .map((workspaceId) => workspaceNames.get(workspaceId) ?? workspaceId)
                      .join(', ')
                  : 'Global'}
              </span>
              <span>{getRagSecurityLabel(document.security)}</span>
              <span>{document.fileType}</span>
              <span>{document.status}</span>
              <span>
                {document.chunkCount.toLocaleString()} chunks
                {document.embeddingModel ? ` · ${document.embeddingModel}` : ''}
              </span>
              <span>{formatFileSize(document.fileSize)}</span>
              <div className="rag-document-actions">
                <button
                  className="secondary-button"
                  disabled={isBusy || isPythonUnavailable}
                  onClick={() => {
                    void handleIndex(document);
                  }}
                  type="button"
                >
                  {document.status === 'indexed' ? 'Reindex' : 'Index'}
                </button>
                <button
                  className="secondary-button"
                  disabled={isBusy || isPythonUnavailable}
                  onClick={() => {
                    void handleReplace(document);
                  }}
                  type="button"
                >
                  Replace
                </button>
                <button
                  className="danger-button"
                  disabled={isBusy || isPythonUnavailable}
                  onClick={() => {
                    void handleDelete(document);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="rag-search-test-panel">
        <div className="registry-header">
          <div>
            <h3>RAG Search Test</h3>
            <p>Returns indexed chunks only. Chat retrieval is not connected yet.</p>
          </div>
          <span>
            {ragSettings.embeddingProvider} · {activeEmbeddingModel}
          </span>
        </div>
        <div className="rag-search-controls">
          <input
            disabled={isSearchBusy || isPythonUnavailable}
            onChange={(event) => {
              setSearchQuery(event.target.value);
            }}
            placeholder="Search indexed RAG documents"
            type="search"
            value={searchQuery}
          />
          <select
            disabled={isSearchBusy || isPythonUnavailable}
            onChange={(event) => {
              setSearchWorkspaceId(event.target.value);
            }}
            value={searchWorkspaceId}
          >
            <option value="">Global only</option>
            {importableWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <label>
            <span>Global</span>
            <input
              checked={searchIncludeGlobal}
              disabled={isSearchBusy || isPythonUnavailable}
              onChange={(event) => {
                setSearchIncludeGlobal(event.target.checked);
              }}
              type="checkbox"
            />
          </label>
          <label>
            <span>Top K</span>
            <input
              disabled={isSearchBusy || isPythonUnavailable}
              max={20}
              min={1}
              onChange={(event) => {
                setSearchTopK(Number(event.target.value));
              }}
              type="number"
              value={searchTopK}
            />
          </label>
          <label>
            <span>Threshold</span>
            <input
              disabled={isSearchBusy || isPythonUnavailable}
              max={1}
              min={-1}
              onChange={(event) => {
                setSearchThreshold(Number(event.target.value));
              }}
              step={0.01}
              type="number"
              value={searchThreshold}
            />
          </label>
          <button
            className="secondary-button"
            disabled={isSearchBusy || isPythonUnavailable || !searchQuery.trim()}
            onClick={() => {
              void handleSearch();
            }}
            type="button"
          >
            Search
          </button>
        </div>
        {searchResults.length > 0 ? (
          <div className="rag-search-results">
            {searchResults.map((result) => (
              <article key={result.chunkId}>
                <div>
                  <strong>{result.filename}</strong>
                  <span>
                    {result.heading ? `${result.heading} · ` : ''}
                    {result.page ? `p.${result.page} · ` : ''}
                    {result.scope ? `${result.scope} · ` : ''}
                    {result.ragDocumentId} · dense{' '}
                    {result.denseRank ? `#${result.denseRank} ` : '- '}
                    {(result.denseScore ?? result.rawScore ?? 0).toFixed(4)}
                    {' · lexical '}
                    {result.lexicalRank ? `#${result.lexicalRank}` : '-'}
                    {' · hybrid '}
                    {result.hybridRank ? `#${result.hybridRank} ` : ''}
                    {(result.hybridScore ?? result.score).toFixed(4)}
                    {' · adjusted '}
                    {(result.adjustedScore ?? result.score).toFixed(4)}
                  </span>
                </div>
                <p>{result.text}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
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
  const [ragForm, setRagForm] = useState<RagSettings>({
    ...defaultSettings.rag,
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
  const [ragEmbeddingStatus, setRagEmbeddingStatus] =
    useState<RagEmbeddingStatus | null>(null);
  const [isCheckingRagEmbedding, setIsCheckingRagEmbedding] = useState(false);
  const [isSavingRagSettings, setIsSavingRagSettings] = useState(false);
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
  const ragSettingsChanged =
    ragForm.embeddingProvider !== settings.rag.embeddingProvider ||
    ragForm.localEmbeddingModel !== settings.rag.localEmbeddingModel ||
    ragForm.openAIEmbeddingModel !== settings.rag.openAIEmbeddingModel ||
    ragForm.chunkSize !== settings.rag.chunkSize ||
    ragForm.chunkOverlap !== settings.rag.chunkOverlap;
  const indexedRagDocumentsNeedReembedding = ragSettingsChanged;
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
          setRagForm({ ...loadedSettings.rag });
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

  function getRagEmbeddingModel(form: RagSettings): string {
    return form.embeddingProvider === 'openai'
      ? form.openAIEmbeddingModel
      : form.localEmbeddingModel;
  }

  async function checkRagEmbeddingStatus(): Promise<void> {
    setIsCheckingRagEmbedding(true);
    setRagEmbeddingStatus(null);
    setLocalAIFeedback(null);

    try {
      const status = await window.mimora.checkRagEmbeddingStatus({
        provider: ragForm.embeddingProvider,
        embeddingModel: getRagEmbeddingModel(ragForm),
      });
      setRagEmbeddingStatus(status);
      setLocalAIFeedback({
        tone: status.available ? 'success' : 'error',
        message: status.message,
      });
    } catch (error) {
      setRagEmbeddingStatus(null);
      setLocalAIFeedback({
        tone: 'error',
        message: getErrorMessage(error),
      });
    } finally {
      setIsCheckingRagEmbedding(false);
    }
  }

  async function saveRagSettings(): Promise<void> {
    setIsSavingRagSettings(true);
    setLocalAIFeedback(null);

    try {
      const nextSettings = await window.mimora.updateRagSettings(ragForm);
      setSettings(nextSettings);
      setRagForm({ ...nextSettings.rag });
      setLocalAIFeedback({
        tone: 'success',
        message: 'RAG embedding settings saved.',
      });
    } catch (error) {
      setLocalAIFeedback({
        tone: 'error',
        message: getErrorMessage(error),
      });
    } finally {
      setIsSavingRagSettings(false);
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

        <form
          className="rag-embedding-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveRagSettings();
          }}
        >
          <div className="rag-embedding-heading">
            <div>
              <h3>Embedding</h3>
              <p>Chat model and embedding model are configured separately.</p>
            </div>
            <span>
              {ragForm.embeddingProvider === 'local'
                ? 'Local by default'
                : 'OpenAI selected'}
            </span>
          </div>

          <label>
            <span>Embedding Provider</span>
            <select
              onChange={(event) => {
                setRagForm({
                  ...ragForm,
                  embeddingProvider: event.target.value as RagSettings['embeddingProvider'],
                });
                setRagEmbeddingStatus(null);
                setLocalAIFeedback(null);
              }}
              value={ragForm.embeddingProvider}
            >
              {ragEmbeddingProviderOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === 'local' ? 'Local' : 'OpenAI'}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Local Embedding Model</span>
            <input
              disabled={ragForm.embeddingProvider !== 'local'}
              onChange={(event) => {
                setRagForm({
                  ...ragForm,
                  localEmbeddingModel: event.target.value,
                });
                setRagEmbeddingStatus(null);
                setLocalAIFeedback(null);
              }}
              placeholder={defaultSettings.rag.localEmbeddingModel}
              spellCheck={false}
              value={ragForm.localEmbeddingModel}
            />
          </label>

          <label>
            <span>OpenAI Embedding Model</span>
            <input
              disabled={ragForm.embeddingProvider !== 'openai'}
              onChange={(event) => {
                setRagForm({
                  ...ragForm,
                  openAIEmbeddingModel: event.target.value,
                });
                setRagEmbeddingStatus(null);
                setLocalAIFeedback(null);
              }}
              placeholder={defaultSettings.rag.openAIEmbeddingModel}
              spellCheck={false}
              value={ragForm.openAIEmbeddingModel}
            />
          </label>

          <label>
            <span>Chunk Size</span>
            <input
              max={12000}
              min={1000}
              onChange={(event) => {
                setRagForm({
                  ...ragForm,
                  chunkSize: Number(event.target.value),
                });
              }}
              type="number"
              value={ragForm.chunkSize}
            />
          </label>

          <label>
            <span>Overlap</span>
            <input
              max={3000}
              min={0}
              onChange={(event) => {
                setRagForm({
                  ...ragForm,
                  chunkOverlap: Number(event.target.value),
                });
              }}
              type="number"
              value={ragForm.chunkOverlap}
            />
          </label>

          <div className="rag-embedding-actions">
            <button
              className="secondary-button"
              disabled={
                isCheckingRagEmbedding ||
                (ragForm.embeddingProvider === 'local' &&
                  !localAIForm.endpoint.trim())
              }
              onClick={() => {
                void checkRagEmbeddingStatus();
              }}
              type="button"
            >
              {isCheckingRagEmbedding ? 'Checking...' : 'Check Embedding'}
            </button>
            <button
              className="primary-button"
              disabled={isSavingRagSettings || !ragSettingsChanged}
              type="submit"
            >
              {isSavingRagSettings ? 'Saving...' : 'Save RAG Settings'}
            </button>
          </div>

          {ragEmbeddingStatus ? (
            <p className="rag-embedding-status">
              {ragEmbeddingStatus.provider} · {ragEmbeddingStatus.model}
              {ragEmbeddingStatus.dimension
                ? ` · ${ragEmbeddingStatus.dimension} dimensions`
                : ''}
            </p>
          ) : null}
          {indexedRagDocumentsNeedReembedding ? (
            <p className="rag-embedding-warning">
              Embedding configuration changed. Indexed RAG documents need re-embedding.
            </p>
          ) : null}
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

      <ScheduleIntelligenceSection workspaceRegistry={workspaceRegistry} />

      <RagDocumentLibrarySection
        ragSettings={settings.rag}
        workspaceRegistry={workspaceRegistry}
      />

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
