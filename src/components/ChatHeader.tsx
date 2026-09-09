import {
  contentOriginSearchScopeLabels,
  contentOriginSearchScopes,
  type ContentOriginSearchScope,
} from '../contentOrigin';
import type { KnowledgeSearchFilters } from '../knowledgeSearch';
import type { KnowledgeDomain } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeType } from '../registry/knowledgeTypeRegistryTypes';
import {
  effectiveSecurityLabels,
  type AIMode,
  type EffectiveSecurity,
} from '../security/securityRouter';

export function ChatHeader({
  workspaceLabel,
  sessionTitle,
  aiMode,
  effectiveSecurity,
  disabled = false,
  includeArchived = false,
  contentOriginScope = 'all',
  isKnowledgeDomainRegistryAvailable = true,
  isKnowledgeTypeRegistryAvailable = true,
  knowledgeDomainOptions = [],
  knowledgeFilters,
  knowledgeTypeOptions = [],
  onChangeAIMode,
  onChangeIncludeArchived,
  onChangeContentOriginScope,
  onChangeKnowledgeFilters,
  onResetSearchScope,
  onCreateSession,
  searchScopeDisabled = false,
  showSearchScope = false,
}: {
  workspaceLabel: string;
  sessionTitle?: string | null;
  aiMode: AIMode;
  effectiveSecurity: EffectiveSecurity;
  disabled?: boolean;
  includeArchived?: boolean;
  contentOriginScope?: ContentOriginSearchScope;
  isKnowledgeDomainRegistryAvailable?: boolean;
  isKnowledgeTypeRegistryAvailable?: boolean;
  knowledgeDomainOptions?: KnowledgeDomain[];
  knowledgeFilters?: KnowledgeSearchFilters;
  knowledgeTypeOptions?: KnowledgeType[];
  onChangeAIMode: (aiMode: AIMode) => void;
  onChangeIncludeArchived?: (includeArchived: boolean) => void;
  onChangeContentOriginScope?: (
    contentOriginScope: ContentOriginSearchScope,
  ) => void;
  onChangeKnowledgeFilters?: (filters: KnowledgeSearchFilters) => void;
  onResetSearchScope?: () => void;
  onCreateSession?: () => void;
  searchScopeDisabled?: boolean;
  showSearchScope?: boolean;
}) {
  const selectedDomain = knowledgeFilters?.domains[0] ?? '';
  const selectedType = knowledgeFilters?.types[0] ?? '';
  const knowledgeRegistryUnavailable =
    !isKnowledgeDomainRegistryAvailable || !isKnowledgeTypeRegistryAvailable;

  return (
    <header className="chat-header">
      <div className="chat-header-inner">
        <div className="workspace-heading">
          <p className="eyebrow">현재 Workspace</p>
          <h1>{workspaceLabel}</h1>
          {sessionTitle ? (
            <p className="chat-session-title">{sessionTitle}</p>
          ) : null}
          {showSearchScope ? (
            <label
              className="archived-search-toggle"
              title="Archived Workspace에 연결된 문서까지 검색합니다."
            >
              <input
                checked={includeArchived}
                disabled={searchScopeDisabled || !onChangeIncludeArchived}
                onChange={(event) => {
                  onChangeIncludeArchived?.(event.target.checked);
                }}
                type="checkbox"
              />
              <span>과거 업무 포함</span>
            </label>
          ) : null}
          {showSearchScope ? (
            <div className="knowledge-filter-controls" aria-label="Knowledge filters">
              <label>
                <span>Source</span>
                <select
                  disabled={searchScopeDisabled || !onChangeContentOriginScope}
                  onChange={(event) => {
                    onChangeContentOriginScope?.(
                      event.target.value as ContentOriginSearchScope,
                    );
                  }}
                  value={contentOriginScope}
                >
                  {contentOriginSearchScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {contentOriginSearchScopeLabels[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Domain</span>
                <select
                  disabled={
                    searchScopeDisabled ||
                    !onChangeKnowledgeFilters ||
                    !isKnowledgeDomainRegistryAvailable
                  }
                  onChange={(event) => {
                    onChangeKnowledgeFilters?.({
                      domains: event.target.value ? [event.target.value] : [],
                      types: selectedType ? [selectedType] : [],
                    });
                  }}
                  value={selectedDomain}
                >
                  <option value="">전체</option>
                  {knowledgeDomainOptions.map((domain) => (
                    <option key={domain.canonicalName} value={domain.canonicalName}>
                      {domain.canonicalName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Type</span>
                <select
                  disabled={
                    searchScopeDisabled ||
                    !onChangeKnowledgeFilters ||
                    !isKnowledgeTypeRegistryAvailable
                  }
                  onChange={(event) => {
                    onChangeKnowledgeFilters?.({
                      domains: selectedDomain ? [selectedDomain] : [],
                      types: event.target.value ? [event.target.value] : [],
                    });
                  }}
                  value={selectedType}
                >
                  <option value="">전체</option>
                  {knowledgeTypeOptions.map((type) => (
                    <option key={type.canonicalName} value={type.canonicalName}>
                      {type.canonicalName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="knowledge-filter-reset"
                disabled={
                  searchScopeDisabled ||
                  (!includeArchived &&
                    contentOriginScope === 'all' &&
                    !selectedDomain &&
                    !selectedType)
                }
                onClick={onResetSearchScope}
                type="button"
              >
                필터 초기화
              </button>
              {knowledgeRegistryUnavailable ? (
                <span className="knowledge-filter-status">
                  Knowledge Registry unavailable
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="header-meta" aria-label="채팅 설정">
          <button
            className="new-chat-button"
            onClick={onCreateSession}
            type="button"
          >
            + 새 대화
          </button>
          <label className="ai-mode-control">
            <span>AI Mode</span>
            <select
              aria-label="AI Mode"
              disabled={disabled}
              onChange={(event) => {
                onChangeAIMode(event.target.value as AIMode);
              }}
              value={aiMode}
            >
              <option value="auto">Auto</option>
              <option value="local">Local</option>
              <option value="external">External</option>
            </select>
          </label>
          <span className={`security-badge ${effectiveSecurity}`}>
            Security: {effectiveSecurityLabels[effectiveSecurity]}
          </span>
        </div>
      </div>
    </header>
  );
}
