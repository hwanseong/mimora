import {
  effectiveSecurityLabels,
  type AIMode,
  type EffectiveSecurity,
} from '../security/securityRouter';
import type { KnowledgeSearchFilters } from '../knowledgeSearch';
import type { KnowledgeDomain } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeType } from '../registry/knowledgeTypeRegistryTypes';

export function ChatHeader({
  workspaceLabel,
  aiMode,
  effectiveSecurity,
  disabled = false,
  includeArchived = false,
  knowledgeDomainOptions = [],
  knowledgeFilters,
  knowledgeTypeOptions = [],
  onChangeAIMode,
  onChangeIncludeArchived,
  onChangeKnowledgeFilters,
  searchScopeDisabled = false,
  showSearchScope = false,
}: {
  workspaceLabel: string;
  aiMode: AIMode;
  effectiveSecurity: EffectiveSecurity;
  disabled?: boolean;
  includeArchived?: boolean;
  knowledgeDomainOptions?: KnowledgeDomain[];
  knowledgeFilters?: KnowledgeSearchFilters;
  knowledgeTypeOptions?: KnowledgeType[];
  onChangeAIMode: (aiMode: AIMode) => void;
  onChangeIncludeArchived?: (includeArchived: boolean) => void;
  onChangeKnowledgeFilters?: (filters: KnowledgeSearchFilters) => void;
  searchScopeDisabled?: boolean;
  showSearchScope?: boolean;
}) {
  const selectedDomain = knowledgeFilters?.domains[0] ?? '';
  const selectedType = knowledgeFilters?.types[0] ?? '';

  return (
    <header className="chat-header">
      <div className="workspace-heading">
        <p className="eyebrow">현재 Workspace</p>
        <h1>{workspaceLabel}</h1>
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
              <span>Domain</span>
              <select
                disabled={searchScopeDisabled || !onChangeKnowledgeFilters}
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
                disabled={searchScopeDisabled || !onChangeKnowledgeFilters}
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
          </div>
        ) : null}
      </div>

      <div className="header-meta" aria-label="채팅 설정">
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
    </header>
  );
}
