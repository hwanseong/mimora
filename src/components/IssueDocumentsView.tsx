import { Fragment, useEffect, useMemo, useState } from 'react';
import type { WorkspaceRegistryParseResult } from '../registry/workspaceRegistryTypes';
import type {
  CanonicalIssue,
  IssueDocument,
  IssueFileSelection,
  IssueQueryResult,
  IssueSummary,
  ProjectDocumentSecurity,
} from '../issue';
import {
  formatIssueDelayStatus,
  hasMissingDueRisk,
  isCanonicalIssueCompleted,
} from '../issue';
import { formatScheduleDateTime } from '../scheduleUx';

type OperationStage = 'idle' | 'registering' | 'parsing' | 'parsed' | 'failed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Issue Documents could not be loaded.';
}

function isBusy(stage: OperationStage): boolean {
  return stage === 'registering' || stage === 'parsing';
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : '-';
}

function statusLabel(document: IssueDocument | null, stage: OperationStage): string {
  if (stage === 'registering') {
    return 'Registering';
  }
  if (stage === 'parsing') {
    return 'Parsing';
  }
  if (stage === 'failed') {
    return 'Failed';
  }
  return document?.parseStatus ?? 'not registered';
}

function parseIssueError(error: string): {
  message: string;
  debugDetails: string | null;
} {
  const [message, ...details] = error.split('; ');

  return {
    message,
    debugDetails: details.length > 0 ? details.join('\n') : null,
  };
}

function formatIssueValue(value: string | number | boolean | null | undefined): string {
  if (value === true) {
    return 'Y';
  }
  if (value === false) {
    return 'N';
  }
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return String(value);
}

function issueRowKey(issue: CanonicalIssue): string {
  return `${issue.itemId || issue.issueId}-${issue.sourceRow}`;
}

function formatSkipReason(reason: string): string {
  switch (reason) {
    case 'empty_or_unidentified_row':
      return '식별 가능한 이슈 데이터 없음';
    case 'missing_title_or_description':
      return '이슈사건/내용 없음';
    case 'missing_status_partial_parse':
      return '상태 없음, 부분 파싱';
    default:
      return reason;
  }
}

export function IssueDocumentsView() {
  const [workspaceRegistry, setWorkspaceRegistry] =
    useState<WorkspaceRegistryParseResult | null>(null);
  const [storageRoot, setStorageRoot] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [document, setDocument] = useState<IssueDocument | null>(null);
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [selectedFile, setSelectedFile] = useState<IssueFileSelection | null>(null);
  const [security, setSecurity] = useState<ProjectDocumentSecurity>('internal');
  const [query, setQuery] = useState('open overdue issues by owner');
  const [includeCompletedHistory, setIncludeCompletedHistory] = useState(false);
  const [queryResult, setQueryResult] = useState<IssueQueryResult | null>(null);
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [showSkippedRows, setShowSkippedRows] = useState(false);
  const [showCompletedHistory, setShowCompletedHistory] = useState(false);
  const [stage, setStage] = useState<OperationStage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = isBusy(stage);
  const documentParseError = document?.parseError
    ? parseIssueError(document.parseError)
    : null;

  const workspaces = useMemo(
    () =>
      (workspaceRegistry?.workspaces ?? []).filter(
        (workspace) => workspace.status !== 'archived',
      ),
    [workspaceRegistry],
  );

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      try {
        const [loadedWorkspaceRegistry, loadedStorageRoot] = await Promise.all([
          window.mimora.loadWorkspaceRegistry(),
          window.mimora.getIssueStorageRoot(),
        ]);

        if (!isMounted) {
          return;
        }

        setWorkspaceRegistry(loadedWorkspaceRegistry);
        setStorageRoot(loadedStorageRoot);
        setWorkspaceId(
          (currentWorkspaceId) =>
            currentWorkspaceId ||
            loadedWorkspaceRegistry.workspaces.find(
              (workspace) => workspace.status !== 'archived',
            )?.id ||
            '',
        );
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError));
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspaceIssue(): Promise<void> {
      if (!workspaceId) {
        setDocument(null);
        setSummary(null);
        return;
      }

      try {
        const currentDocument = await window.mimora.getIssueDocument(workspaceId);

        if (!isMounted) {
          return;
        }

        setDocument(currentDocument);
        setSecurity(currentDocument?.security ?? 'internal');
        setSelectedFile(null);
        setQueryResult(null);
        if (currentDocument?.parseStatus === 'parsed') {
          setSummary(await window.mimora.getIssueSummary(workspaceId));
        } else {
          setSummary(null);
        }
        setError(null);
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError));
          setDocument(null);
          setSummary(null);
        }
      }
    }

    void loadWorkspaceIssue();

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  async function handleSelectFile(): Promise<void> {
    const selection = await window.mimora.selectIssueSourceFile();

    if (selection) {
      setSelectedFile(selection);
      setMessage(null);
      setError(null);
    }
  }

  async function handleRegister(): Promise<void> {
    if (!workspaceId || !selectedFile) {
      setError('Select a Workspace and Issue Excel file first.');
      return;
    }

    setStage('registering');
    setError(null);
    setMessage(null);

    try {
      const nextDocument = await window.mimora.registerIssueDocument({
        workspaceId,
        selectionId: selectedFile.selectionId,
        security,
      });
      setDocument(nextDocument);
      setSelectedFile(null);
      setQueryResult(null);
      setExpandedIssueKey(null);
      setStage('parsing');
      const result = await window.mimora.refreshIssueDocument(workspaceId, {
        force: true,
      });
      setDocument(result.document);
      setSummary(result.summary);
      setExpandedIssueKey(null);
      setStage('parsed');
      setMessage('Issue Excel registered and parsed.');
    } catch (registerError) {
      setStage('failed');
      setError(getErrorMessage(registerError));
      setDocument(await window.mimora.getIssueDocument(workspaceId).catch(() => null));
    }
  }

  async function handleRefresh(): Promise<void> {
    if (!workspaceId || !document) {
      return;
    }

    setStage('parsing');
    setError(null);
    setMessage(null);

    try {
      const result = await window.mimora.refreshIssueDocument(workspaceId, {
        force: true,
      });
      setDocument(result.document);
      setSummary(result.summary);
      setExpandedIssueKey(null);
      setStage('parsed');
      setMessage('Issue Excel reparsed.');
    } catch (refreshError) {
      setStage('failed');
      setError(getErrorMessage(refreshError));
      setDocument(await window.mimora.getIssueDocument(workspaceId).catch(() => null));
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!workspaceId || !document) {
      return;
    }

    setStage('registering');
    setError(null);
    setMessage(null);

    try {
      await window.mimora.removeIssueDocument(workspaceId);
      setDocument(null);
      setSummary(null);
      setQueryResult(null);
      setSelectedFile(null);
      setExpandedIssueKey(null);
      setMessage('Issue Excel disconnected.');
      setStage('idle');
    } catch (disconnectError) {
      setStage('failed');
      setError(getErrorMessage(disconnectError));
    }
  }

  async function handleQuery(): Promise<void> {
    if (!workspaceId || !query.trim()) {
      return;
    }

    setStage('parsing');
    setError(null);
    setMessage(null);

    try {
      const effectiveQuery = includeCompletedHistory
        ? `${query.trim()} 전체 이력`
        : query;
      const result = await window.mimora.queryIssues({
        workspaceId,
        query: effectiveQuery,
      });
      setQueryResult(result);
      setSummary(result.summary);
      setExpandedIssueKey(null);
      setShowCompletedHistory(false);
      setStage('parsed');
      setMessage(`Issue query complete: ${result.kind}`);
    } catch (queryError) {
      setStage('failed');
      setError(getErrorMessage(queryError));
    }
  }

  const activeIssues =
    queryResult?.issues.filter((issue) => !isCanonicalIssueCompleted(issue)) ??
    [];
  const completedHistoryIssues =
    queryResult?.issues.filter((issue) => isCanonicalIssueCompleted(issue)) ??
    [];

  function renderIssueTable(
    issues: CanonicalIssue[],
    section: 'active' | 'completed',
  ) {
    if (issues.length === 0) {
      return (
        <p className="schedule-query-empty">
          {section === 'completed'
            ? '완료 이력이 없습니다.'
            : '진행중/미해결 이슈가 없습니다.'}
        </p>
      );
    }

    return (
      <div className="schedule-query-table-wrap">
        <table className="schedule-query-table">
          <thead>
            <tr>
              <th>이슈영역</th>
              <th>단계</th>
              <th>이슈사건</th>
              <th className="issue-date-column">발생일</th>
              <th>조치담당자</th>
              <th className="issue-date-column">
                {section === 'completed' ? '완료일' : '조치예정일'}
              </th>
              <th>상태</th>
              <th>{section === 'completed' ? '완료지연' : '지연'}</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              const key = issueRowKey(issue);
              const isExpanded = expandedIssueKey === key;
              const dateValue =
                section === 'completed'
                  ? issue.completedDate ?? issue.resolvedDate ?? issue.actionDate
                  : issue.targetDate ?? issue.dueDate;

              return (
                <Fragment key={key}>
                  <tr
                    className="issue-query-row"
                    onClick={() => {
                      setExpandedIssueKey(isExpanded ? null : key);
                    }}
                  >
                    <td>{formatIssueValue(issue.issueArea)}</td>
                    <td>{formatIssueValue(issue.phase)}</td>
                    <td>
                      <button className="issue-row-button" type="button">
                        {formatIssueValue(issue.issueEvent || issue.title)}
                      </button>
                    </td>
                    <td className="issue-date-column">
                      {formatIssueValue(issue.occurredDate)}
                    </td>
                    <td>{formatIssueValue(issue.actionOwner ?? issue.owner)}</td>
                    <td className="issue-date-column">
                      {formatIssueValue(dateValue)}
                    </td>
                    <td>
                      {formatIssueValue(
                        issue.progressStatus ?? issue.rawStatus ?? issue.status,
                      )}
                    </td>
                    <td>{formatIssueDelayStatus(issue)}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="issue-detail-row">
                      <td colSpan={8}>
                        <div className="issue-detail-panel">
                          <div>
                            <span>이슈영역</span>
                            <strong>{formatIssueValue(issue.issueArea)}</strong>
                          </div>
                          <div>
                            <span>이슈분류</span>
                            <strong>{formatIssueValue(issue.issueCategory)}</strong>
                          </div>
                          <div>
                            <span>단계</span>
                            <strong>{formatIssueValue(issue.phase)}</strong>
                          </div>
                          <div>
                            <span>이슈발생일</span>
                            <strong>{formatIssueValue(issue.occurredDate)}</strong>
                          </div>
                          <div className="issue-detail-wide">
                            <span>이슈사건</span>
                            <strong>
                              {formatIssueValue(issue.issueEvent || issue.title)}
                            </strong>
                          </div>
                          <div className="issue-detail-wide">
                            <span>대응방안</span>
                            <strong>
                              {formatIssueValue(
                                issue.responsePlan ?? issue.actionPlan,
                              )}
                            </strong>
                          </div>
                          <div>
                            <span>조치담당자</span>
                            <strong>
                              {formatIssueValue(issue.actionOwner ?? issue.owner)}
                            </strong>
                          </div>
                          <div>
                            <span>조치예정일</span>
                            <strong>
                              {formatIssueValue(issue.targetDate ?? issue.dueDate)}
                            </strong>
                          </div>
                          <div>
                            <span>조직지원필요여부</span>
                            <strong>
                              {formatIssueValue(issue.organizationSupportRequired)}
                            </strong>
                          </div>
                          <div>
                            <span>진행상황</span>
                            <strong>
                              {formatIssueValue(issue.progressStatus ?? issue.rawStatus)}
                            </strong>
                          </div>
                          <div>
                            <span>조치일자</span>
                            <strong>
                              {formatIssueValue(issue.actionDate ?? issue.resolvedDate)}
                            </strong>
                          </div>
                          <div>
                            <span>상태</span>
                            <strong>{formatIssueValue(issue.status)}</strong>
                          </div>
                          <div>
                            <span>Issue age</span>
                            <strong>
                              {formatIssueValue(issue.derivedMetrics.issueAgeDays)}
                            </strong>
                          </div>
                          <div>
                            <span>지연 상태</span>
                            <strong>{formatIssueDelayStatus(issue)}</strong>
                          </div>
                          <div>
                            <span>완료 지연일</span>
                            <strong>
                              {formatIssueValue(
                                issue.derivedMetrics.completedLateDays,
                              )}
                            </strong>
                          </div>
                          <div>
                            <span>Risk flags</span>
                            <strong>
                              {Array.from(
                                new Set([
                                  ...(issue.derivedMetrics.riskFlags ?? []),
                                  ...(hasMissingDueRisk(issue)
                                    ? ['missing_due']
                                    : []),
                                ]),
                              ).join(', ') || '-'}
                            </strong>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="settings-view issue-documents-view" aria-labelledby="issue-documents-heading">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Issue Intelligence</p>
          <h1 id="issue-documents-heading">Issue Documents</h1>
        </div>
        <button
          className="secondary-button"
          disabled={busy || !document}
          onClick={() => {
            void handleRefresh();
          }}
          type="button"
        >
          다시 읽기
        </button>
      </div>

      <section className="schedule-intelligence-card issue-intelligence-card">
        <div className="schedule-source-status">
          <div>
            <span>Status</span>
            <strong>{statusLabel(document, stage)}</strong>
          </div>
          <div>
            <span>Source file</span>
            <strong>{document?.originalFileName ?? selectedFile?.name ?? '-'}</strong>
          </div>
          <div>
            <span>Last analyzed</span>
            <strong>{formatScheduleDateTime(document?.lastAnalyzedAt)}</strong>
          </div>
          <div>
            <span>Security</span>
            <strong>{document?.security ?? security}</strong>
          </div>
          {documentParseError ? (
            <div className="schedule-source-status-error">
              <span>Error</span>
              <strong>{documentParseError.message}</strong>
              {documentParseError.debugDetails ? (
                <details>
                  <summary>Debug details</summary>
                  <pre>{documentParseError.debugDetails}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
          <p>
            Storage: <code>{storageRoot || 'loading...'}</code>
          </p>
        </div>

        {message ? <p className="settings-success-message">{message}</p> : null}
        {error ? <p className="settings-error-message">{error}</p> : null}

        <div className="schedule-source-controls issue-source-controls">
          <label>
            <span>Workspace</span>
            <select
              disabled={busy || workspaces.length === 0}
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
          <label>
            <span>Security</span>
            <select
              disabled={busy}
              onChange={(event) => {
                setSecurity(event.target.value as ProjectDocumentSecurity);
              }}
              value={security}
            >
              <option value="internal">internal</option>
              <option value="private">private</option>
            </select>
          </label>
          {document ? (
            <>
              <div className="issue-source-file">
                <span>Source filename</span>
                <strong>{selectedFile?.name ?? document.originalFileName}</strong>
              </div>
              <div className="issue-source-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    void handleRefresh();
                  }}
                  type="button"
                >
                  다시 읽기
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !workspaceId}
                  onClick={() => {
                    void handleSelectFile();
                  }}
                  type="button"
                >
                  파일 변경
                </button>
                {selectedFile ? (
                  <button
                    className="primary-button"
                    disabled={busy || !workspaceId}
                    onClick={() => {
                      void handleRegister();
                    }}
                    type="button"
                  >
                    등록
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={busy || !workspaceId}
                  onClick={() => {
                    void handleDisconnect();
                  }}
                  type="button"
                >
                  연결 해제
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="issue-source-file">
                <span>Source filename</span>
                <strong>{selectedFile?.name ?? '선택된 이슈 파일 없음'}</strong>
              </div>
              <div className="issue-source-actions">
                <button
                  className="secondary-button"
                  disabled={busy || !workspaceId}
                  onClick={() => {
                    void handleSelectFile();
                  }}
                  type="button"
                >
                  이슈 파일 선택
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !workspaceId || !selectedFile}
                  onClick={() => {
                    void handleRegister();
                  }}
                  type="button"
                >
                  등록
                </button>
              </div>
            </>
          )}
        </div>

        {summary ? (
          <>
            <div className="schedule-summary-grid issue-summary-grid">
              <span>Total <strong>{summary.totalIssues.toLocaleString()}</strong></span>
              <span>Open/In progress <strong>{(summary.openInProgressIssues ?? summary.openIssues).toLocaleString()}</strong></span>
              <span>Resolved <strong>{(summary.resolvedIssues ?? summary.completedIssues).toLocaleString()}</strong></span>
              <span>Overdue <strong>{summary.overdueOpenIssues.toLocaleString()}</strong></span>
              <span>Completion <strong>{formatPercent(summary.completionRate)}</strong></span>
              <button
                className="issue-summary-button"
                disabled={(summary.skippedRows ?? 0) === 0}
                onClick={() => {
                  setShowSkippedRows((current) => !current);
                }}
                type="button"
              >
                Skipped rows <strong>{(summary.skippedRows ?? 0).toLocaleString()}</strong>
              </button>
            </div>
            {showSkippedRows ? (
              <div className="issue-skipped-panel">
                {(summary.parseWarnings ?? []).length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary.parseWarnings ?? []).map((warning) => (
                        <tr key={`${warning.row}-${warning.reason}`}>
                          <td>{warning.row}</td>
                          <td>{formatSkipReason(warning.reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>Skipped row가 없습니다.</p>
                )}
              </div>
            ) : null}
            <p className="issue-summary-secondary">
              Issues {(summary.issueCount ?? summary.totalIssues).toLocaleString()} · Risks {(summary.riskCount ?? 0).toLocaleString()}
            </p>
          </>
        ) : null}

        <div className="schedule-query-test">
          <p className="schedule-query-target">
            이슈 분석 기능을 검증하기 위한 테스트입니다. 실제 업무 질문은 Workspace Chat에서 사용할 수 있습니다.
          </p>
          <input
            disabled={busy || !document}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="overdue open issues by owner"
            type="search"
            value={query}
          />
          <label className="issue-query-toggle">
            <input
              checked={includeCompletedHistory}
              disabled={busy || !document}
              onChange={(event) => {
                setIncludeCompletedHistory(event.target.checked);
              }}
              type="checkbox"
            />
            <span>완료 이력 포함</span>
          </label>
          <button
            className="secondary-button"
            disabled={busy || !document || !query.trim()}
            onClick={() => {
              void handleQuery();
            }}
            type="button"
          >
            쿼리 테스트
          </button>
        </div>

        {queryResult ? (
          <div className="schedule-formatted-result">
            <div className="schedule-query-result-header">
              <div>
                <strong>{queryResult.kind}</strong>
                <span>As of {queryResult.asOfDate}</span>
              </div>
            </div>
            {queryResult.queryPlan ? (
              <div className="issue-query-plan">
                <span>
                  원문 질문
                  <strong>{query}</strong>
                </span>
                <span>
                  감지된 의도
                  <strong>{queryResult.queryPlan.detectedIntent}</strong>
                </span>
                <span>
                  상태
                  <strong>{queryResult.queryPlan.statusFilter}</strong>
                </span>
                <span>
                  추가 필터
                  <strong>{queryResult.queryPlan.additionalFilters.join(' → ') || '-'}</strong>
                </span>
                <span>
                  정렬
                  <strong>{queryResult.queryPlan.sortOrder.join(' → ') || '-'}</strong>
                </span>
                <span>
                  대상 건수
                  <strong>{queryResult.queryPlan.filteredIssueCount?.toLocaleString() ?? '-'}</strong>
                </span>
              </div>
            ) : null}
            {queryResult.structuredQuery || queryResult.queryPlan?.structuredQuery ? (
              <details className="issue-query-json">
                <summary>정규화 Query JSON 보기</summary>
                <pre>
                  {JSON.stringify(
                    queryResult.structuredQuery ?? queryResult.queryPlan?.structuredQuery,
                    null,
                    2,
                  )}
                </pre>
              </details>
            ) : null}
            {queryResult.assignees?.length ? (
              <div className="issue-assignee-summary">
                {queryResult.assignees.slice(0, 6).map((assignee) => (
                  <div key={assignee.owner}>
                    <strong>{assignee.owner}</strong>
                    <span>Open {assignee.openAssigned.toLocaleString()}</span>
                    <span>Overdue {assignee.overdueAssigned.toLocaleString()}</span>
                    <span>예정일 없음 {(assignee.missingDueAssigned ?? 0).toLocaleString()}</span>
                    <span>업데이트 지연 {(assignee.staleUpdateAssigned ?? 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {queryResult.kind === 'owner_bottlenecks' ? (
              <p className="issue-query-note">
                기본 목록은 미해결 이슈만 표시합니다. 완료 이력은 “전체” 또는 “완료된” 조건으로 별도 조회하세요.
              </p>
            ) : null}
            <section className="issue-result-section">
              <div className="issue-result-section-header">
                <h3>진행중/미해결 이슈</h3>
                <span>{activeIssues.length.toLocaleString()}건</span>
              </div>
              {renderIssueTable(activeIssues, 'active')}
            </section>
            {includeCompletedHistory || completedHistoryIssues.length > 0 ? (
              <section className="issue-result-section secondary">
                <button
                  className="issue-result-section-toggle"
                  onClick={() => {
                    setShowCompletedHistory((current) => !current);
                  }}
                  type="button"
                >
                  <span>완료 이력</span>
                  <strong>{completedHistoryIssues.length.toLocaleString()}건</strong>
                  <em>{showCompletedHistory ? '접기' : '펼치기'}</em>
                </button>
                {showCompletedHistory
                  ? renderIssueTable(completedHistoryIssues, 'completed')
                  : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}
