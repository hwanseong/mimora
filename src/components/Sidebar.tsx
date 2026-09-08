import type { Workspace, WorkspaceSection, WorkspaceStatus } from '../workspaces';

const statusLabels: Partial<Record<WorkspaceStatus, string>> = {
  planned: 'Planned',
  on_hold: 'On Hold',
  closed: 'Closed',
};

function NavSection({
  title,
  items,
  message,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  title: string;
  items: Workspace[];
  message?: string;
  selectedWorkspaceId: string;
  onSelectWorkspace: (workspace: Workspace) => void;
}) {
  return (
    <section className="nav-section" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`}>{title}</h2>
      <div className="nav-list">
        {message ? <p className="nav-section-message">{message}</p> : null}
        {items.map((item) => (
          <button
            aria-pressed={item.id === selectedWorkspaceId}
            className={`nav-item${item.id === selectedWorkspaceId ? ' active' : ''}`}
            key={item.id}
            onClick={() => {
              onSelectWorkspace(item);
            }}
            type="button"
          >
            <span className="nav-item-label">{item.label}</span>
            {statusLabels[item.status] ? (
              <span className="nav-status-badge">{statusLabels[item.status]}</span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

export function Sidebar({
  isRecentChatsActive,
  isVaultBrowserActive,
  isSettingsActive,
  onOpenRecentChats,
  onOpenVaultBrowser,
  onOpenSettings,
  workspaceSections,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  isRecentChatsActive: boolean;
  isVaultBrowserActive: boolean;
  isSettingsActive: boolean;
  onOpenRecentChats: () => void;
  onOpenVaultBrowser: () => void;
  onOpenSettings: () => void;
  workspaceSections: WorkspaceSection[];
  selectedWorkspaceId: string;
  onSelectWorkspace: (workspace: Workspace) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Mimora 탐색">
      <div className="sidebar-top">
        <div className="logo-text">Mimora</div>
        {workspaceSections.map((section) => (
          <NavSection
            items={section.items}
            key={section.title}
            message={section.message}
            onSelectWorkspace={onSelectWorkspace}
            selectedWorkspaceId={selectedWorkspaceId}
            title={section.title}
          />
        ))}
      </div>

      <div className="sidebar-bottom">
        <button
          aria-pressed={isRecentChatsActive}
          className={`nav-item${isRecentChatsActive ? ' active' : ''}`}
          onClick={onOpenRecentChats}
          type="button"
        >
          최근 대화
        </button>
        <button
          aria-pressed={isVaultBrowserActive}
          className={`nav-item${isVaultBrowserActive ? ' active' : ''}`}
          onClick={onOpenVaultBrowser}
          type="button"
        >
          Vault Browser
        </button>
        <button
          aria-pressed={isSettingsActive}
          className={`nav-item${isSettingsActive ? ' active' : ''}`}
          onClick={onOpenSettings}
          type="button"
        >
          설정
        </button>
      </div>
    </aside>
  );
}
