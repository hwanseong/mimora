import { type Workspace, workspaceSections } from '../workspaces';

function NavSection({
  title,
  items,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  title: string;
  items: Workspace[];
  selectedWorkspaceId: string;
  onSelectWorkspace: (workspace: Workspace) => void;
}) {
  return (
    <section className="nav-section" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`}>{title}</h2>
      <div className="nav-list">
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
            {item.label}
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
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  isRecentChatsActive: boolean;
  isVaultBrowserActive: boolean;
  isSettingsActive: boolean;
  onOpenRecentChats: () => void;
  onOpenVaultBrowser: () => void;
  onOpenSettings: () => void;
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
