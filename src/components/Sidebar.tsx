import { useState } from 'react';
import {
  sortChatSessions,
  type ChatSession,
  type ChatSessions,
} from '../chat';
import {
  canCreateWorkspaceSession,
  workspaceStatusLabels,
  type Workspace,
  type WorkspaceSection,
} from '../workspaces';
import type { RegistryRuntimeMode } from '../registry/types';

function NavSection({
  title,
  items,
  message,
  chatSessions,
  selectedWorkspaceId,
  selectedSessionId,
  onSelectWorkspace,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onReorderSession,
}: {
  title: string;
  items: Workspace[];
  message?: string;
  chatSessions: ChatSessions;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onSelectSession: (workspace: Workspace, sessionId: string) => void;
  onCreateSession: (workspaceId: string) => void;
  onRenameSession: (workspaceId: string, sessionId: string) => void;
  onDeleteSession: (workspaceId: string, sessionId: string) => void;
  onReorderSession: (
    workspaceId: string,
    draggedSessionId: string,
    targetSessionId: string,
  ) => void;
}) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<
    Record<string, boolean>
  >({});
  const [draggedSession, setDraggedSession] = useState<{
    workspaceId: string;
    sessionId: string;
  } | null>(null);

  return (
    <section className="nav-section" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`}>{title}</h2>
      <div className="nav-list">
        {message ? <p className="nav-section-message">{message}</p> : null}
        {items.map((item) => {
          const sessions = sortChatSessions(chatSessions[item.id] ?? []);
          const isCollapsed = collapsedWorkspaces[item.id] === true;
          const isWorkspaceSelected = item.id === selectedWorkspaceId;
          const statusLabel = item.isSystem
            ? null
            : workspaceStatusLabels[item.status];
          const canCreateSession = canCreateWorkspaceSession(item);

          return (
            <div className="workspace-nav-group" key={item.id}>
              <div className="workspace-nav-row">
                <button
                  aria-label={isCollapsed ? 'Expand workspace' : 'Collapse workspace'}
                  className="workspace-collapse-button"
                  onClick={() => {
                    setCollapsedWorkspaces((currentCollapsed) => ({
                      ...currentCollapsed,
                      [item.id]: !isCollapsed,
                    }));
                  }}
                  type="button"
                >
                  {isCollapsed ? '>' : 'v'}
                </button>
                <button
                  aria-pressed={isWorkspaceSelected && !selectedSessionId}
                  className={`nav-item workspace-nav-item${
                    isWorkspaceSelected && !selectedSessionId ? ' active' : ''
                  }`}
                  onClick={() => {
                    onSelectWorkspace(item);
                  }}
                  type="button"
                >
                  <span className="nav-item-label">{item.label}</span>
                  {statusLabel ? (
                    <span className={`nav-status-badge ${item.status}`}>
                      {statusLabel}
                    </span>
                  ) : null}
                </button>
              </div>
              {!isCollapsed ? (
                <div className="workspace-session-list">
                  {sessions.map((session: ChatSession) => (
                    <div
                      className="workspace-session-row"
                      draggable
                      key={session.sessionId}
                      onDragEnd={() => {
                        setDraggedSession(null);
                      }}
                      onDragOver={(event) => {
                        if (draggedSession?.workspaceId === item.id) {
                          event.preventDefault();
                        }
                      }}
                      onDragStart={() => {
                        setDraggedSession({
                          workspaceId: item.id,
                          sessionId: session.sessionId,
                        });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();

                        if (
                          draggedSession?.workspaceId === item.id &&
                          draggedSession.sessionId !== session.sessionId
                        ) {
                          onReorderSession(
                            item.id,
                            draggedSession.sessionId,
                            session.sessionId,
                          );
                        }

                        setDraggedSession(null);
                      }}
                    >
                      <button
                        aria-pressed={selectedSessionId === session.sessionId}
                        className={`workspace-session-item${
                          selectedSessionId === session.sessionId ? ' active' : ''
                        }`}
                        onClick={() => {
                          onSelectSession(item, session.sessionId);
                        }}
                        title={session.title}
                        type="button"
                      >
                        {session.title}
                      </button>
                      <button
                        aria-label={`${session.title} rename`}
                        className="workspace-session-menu"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          onRenameSession(item.id, session.sessionId);
                        }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`${session.title} delete`}
                        className="workspace-session-menu"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          setDraggedSession(null);
                          onDeleteSession(item.id, session.sessionId);
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  {canCreateSession ? (
                    <button
                      className="workspace-session-add"
                      onClick={() => {
                        onCreateSession(item.id);
                      }}
                      type="button"
                    >
                      + 새 대화
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
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
  registryRuntimeMode = 'normal',
  chatSessions,
  workspaceSections,
  selectedWorkspaceId,
  selectedSessionId,
  onSelectWorkspace,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onReorderSession,
}: {
  isRecentChatsActive: boolean;
  isVaultBrowserActive: boolean;
  isSettingsActive: boolean;
  onOpenRecentChats: () => void;
  onOpenVaultBrowser: () => void;
  onOpenSettings: () => void;
  registryRuntimeMode?: RegistryRuntimeMode;
  chatSessions: ChatSessions;
  workspaceSections: WorkspaceSection[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onSelectSession: (workspace: Workspace, sessionId: string) => void;
  onCreateSession: (workspaceId: string) => void;
  onRenameSession: (workspaceId: string, sessionId: string) => void;
  onDeleteSession: (workspaceId: string, sessionId: string) => void;
  onReorderSession: (
    workspaceId: string,
    draggedSessionId: string,
    targetSessionId: string,
  ) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Mimora 탐색">
      <div className="sidebar-top">
        <div className="logo-text">Mimora</div>
        {registryRuntimeMode !== 'normal' ? (
          <div className={`sidebar-registry-status ${registryRuntimeMode}`}>
            {registryRuntimeMode === 'degraded'
              ? 'Registry cache 사용 중'
              : 'Registry 확인 필요'}
          </div>
        ) : null}
        {workspaceSections.map((section) => (
          <NavSection
            items={section.items}
            chatSessions={chatSessions}
            key={section.title}
            message={section.message}
            onCreateSession={onCreateSession}
            onDeleteSession={onDeleteSession}
            onRenameSession={onRenameSession}
            onReorderSession={onReorderSession}
            onSelectSession={onSelectSession}
            onSelectWorkspace={onSelectWorkspace}
            selectedSessionId={selectedSessionId}
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
