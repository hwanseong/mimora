import { useEffect, useMemo, useState } from 'react';
import type { MimoraSettings } from '../settings';
import type { Workspace } from '../workspace/types';
import {
  maskText,
  maskingEntityTypeLabels,
  maskingEntityTypes,
  type MaskingEntryScope,
  type MaskingEntityType,
  type MaskingEntry,
  type MaskingResult,
} from '../security/maskingEngine';
import {
  createEffectiveMaskingEntries,
  createRegistryDerivedMaskingEntries,
} from '../security/maskingScope';

type MaskingFormState = {
  id?: string;
  value: string;
  type: MaskingEntityType;
  scope: MaskingEntryScope;
  workspaceId?: string;
  enabled: boolean;
};

type MaskingTab = 'global' | 'workspace';

function createEmptyMaskingForm(
  scope: MaskingEntryScope,
  workspaceId?: string,
): MaskingFormState {
  return {
    value: '',
    type: 'person',
    scope,
    workspaceId: scope === 'workspace' ? workspaceId : undefined,
    enabled: true,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Masking Dictionary를 저장하지 못했습니다.';
}

function getEntryScope(entry: MaskingEntry): MaskingEntryScope {
  return entry.scope ?? 'global';
}

function getWorkspaceLabel(workspace: Workspace): string {
  const status = workspace.status === 'archived' ? ' · Archived' : '';

  return `${workspace.name}${status}`;
}

export function MaskingSettingsSection({
  settings,
  workspaces,
  onSettingsChange,
}: {
  settings: MimoraSettings;
  workspaces: Workspace[];
  onSettingsChange: (settings: MimoraSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<MaskingTab>('global');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    workspaces[0]?.id ?? '',
  );
  const [formState, setFormState] = useState<MaskingFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaskingEntry | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<MaskingResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      null,
    [selectedWorkspaceId, workspaces],
  );
  const globalEntries = useMemo(
    () =>
      settings.masking.entries.filter(
        (entry) => getEntryScope(entry) === 'global',
      ),
    [settings.masking.entries],
  );
  const workspaceEntries = useMemo(
    () =>
      settings.masking.entries.filter(
        (entry) =>
          getEntryScope(entry) === 'workspace' &&
          entry.workspaceId === selectedWorkspaceId,
      ),
    [selectedWorkspaceId, settings.masking.entries],
  );
  const registryDerivedEntries = useMemo(
    () =>
      selectedWorkspaceId
        ? createRegistryDerivedMaskingEntries({
            workspaceIds: [selectedWorkspaceId],
            registryWorkspaces: workspaces,
            existingEntries: settings.masking.entries,
          })
        : [],
    [selectedWorkspaceId, settings.masking.entries, workspaces],
  );
  const testEntries = useMemo(() => {
    if (activeTab === 'global') {
      return globalEntries;
    }

    return createEffectiveMaskingEntries({
      entries: settings.masking.entries,
      currentWorkspaceId: selectedWorkspaceId,
      question: testText,
      documents: selectedWorkspaceId
        ? [{ workspaceIds: [selectedWorkspaceId] }]
        : [],
      registryWorkspaces: workspaces,
    }).entries;
  }, [
    activeTab,
    globalEntries,
    selectedWorkspaceId,
    settings.masking.entries,
    workspaces,
  ]);
  const visibleEntries =
    activeTab === 'global' ? globalEntries : workspaceEntries;

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces[0]) {
      setSelectedWorkspaceId(workspaces[0].id);
      return;
    }

    if (
      selectedWorkspaceId &&
      !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(workspaces[0]?.id ?? '');
    }
  }, [selectedWorkspaceId, workspaces]);

  function openCreateForm(): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState(
      createEmptyMaskingForm(
        activeTab,
        activeTab === 'workspace' ? selectedWorkspaceId : undefined,
      ),
    );
  }

  function editEntry(entry: MaskingEntry): void {
    const scope = getEntryScope(entry);

    setErrorMessage(null);
    setDeleteTarget(null);
    setActiveTab(scope);

    if (scope === 'workspace' && entry.workspaceId) {
      setSelectedWorkspaceId(entry.workspaceId);
    }

    setFormState({
      id: entry.id,
      value: entry.value,
      type: entry.type,
      scope,
      workspaceId: entry.workspaceId,
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
            scope: formState.scope,
            workspaceId: formState.workspaceId,
            enabled: formState.enabled,
          })
        : await window.mimora.addMaskingEntry({
            value: formState.value,
            type: formState.type,
            scope: formState.scope,
            workspaceId: formState.workspaceId,
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
        scope: getEntryScope(entry),
        workspaceId: entry.workspaceId,
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
          <p>External payload에 포함되는 민감 Entity를 로컬에서 alias로 치환합니다.</p>
        </div>
        <button
          className="secondary-button"
          disabled={activeTab === 'workspace' && !selectedWorkspaceId}
          onClick={openCreateForm}
          type="button"
        >
          + Entity 추가
        </button>
      </div>

      <div className="masking-tabs" role="tablist" aria-label="Masking scope">
        <button
          aria-selected={activeTab === 'global'}
          className={activeTab === 'global' ? 'active' : ''}
          onClick={() => {
            setActiveTab('global');
            setFormState(null);
            setDeleteTarget(null);
            setTestResult(null);
          }}
          role="tab"
          type="button"
        >
          Global
        </button>
        <button
          aria-selected={activeTab === 'workspace'}
          className={activeTab === 'workspace' ? 'active' : ''}
          onClick={() => {
            setActiveTab('workspace');
            setFormState(null);
            setDeleteTarget(null);
            setTestResult(null);
          }}
          role="tab"
          type="button"
        >
          Workspace
        </button>
      </div>

      {activeTab === 'workspace' ? (
        <label className="masking-workspace-picker">
          <span>Workspace</span>
          <select
            disabled={workspaces.length === 0}
            onChange={(event) => {
              setSelectedWorkspaceId(event.target.value);
              setFormState(null);
              setDeleteTarget(null);
              setTestResult(null);
            }}
            value={selectedWorkspaceId}
          >
            {workspaces.length === 0 ? (
              <option value="">Registry Workspace가 없습니다</option>
            ) : null}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {getWorkspaceLabel(workspace)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
              placeholder="예: 홍길동"
              value={formState.value}
            />
          </label>
          <label>
            <span>Category</span>
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
            <span>
              {formState.scope === 'global'
                ? '모든 External 요청에 적용됩니다.'
                : '선택한 Workspace 문서가 실제 Context에 포함될 때만 적용됩니다.'}
            </span>
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
                disabled={
                  isSaving ||
                  !formState.value.trim() ||
                  (formState.scope === 'workspace' && !formState.workspaceId)
                }
                type="submit"
              >
                {isSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {activeTab === 'global' ? (
        <p className="masking-scope-help">
          Global Dictionary는 context 문서가 없어도 모든 External payload에 적용됩니다.
        </p>
      ) : (
        <div className="masking-registry-preview">
          <div>
            <strong>Registry 자동 Masking</strong>
            <span>
              {selectedWorkspace
                ? `${selectedWorkspace.name} 문서가 실제 Context에 포함될 때 적용`
                : 'Workspace를 선택하세요'}
            </span>
          </div>
          {registryDerivedEntries.length === 0 ? (
            <p className="masking-empty">자동 masking 후보가 없습니다.</p>
          ) : (
            <ul>
              {registryDerivedEntries.map((entry) => (
                <li key={entry.id}>
                  <span>자동</span>
                  <strong>{entry.value}</strong>
                  <em>{entry.alias}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="masking-entry-list">
        {visibleEntries.length === 0 ? (
          <p className="masking-empty">
            {activeTab === 'global'
              ? '등록된 Global Masking Entity가 없습니다.'
              : '선택한 Workspace에 등록된 Masking Entity가 없습니다.'}
          </p>
        ) : null}
        {visibleEntries.map((entry) => (
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
            setTestResult(maskText(testText, testEntries));
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
