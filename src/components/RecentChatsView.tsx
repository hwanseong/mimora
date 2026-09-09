import { useEffect, useState } from 'react';
import type { ChatSession, ChatSessions } from '../chat';
import type { Workspace } from '../workspaces';

export const RECENT_CHAT_PREVIEW_MAX_CHARS = 72;
export const PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS = 60;

export type RecentChatItem = {
  session: ChatSession;
  workspace: Workspace;
  preview: string;
  messageCount: number;
  lastUpdatedAt: string;
};

function truncatePreview(text: string, maxChars: number): string {
  const normalizedText = text.replace(/\s+/gu, ' ').trim();
  const characters = [...normalizedText];

  if (characters.length <= maxChars) {
    return normalizedText;
  }

  return `${characters.slice(0, maxChars - 1).join('').trimEnd()}…`;
}

function getTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatRecentChatTime(
  createdAt: string,
  now = Date.now(),
): string {
  const timestamp = getTimestamp(createdAt);

  if (timestamp === 0) {
    return '시간 정보 없음';
  }

  const elapsedMilliseconds = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);

  if (elapsedMinutes < 1) {
    return '방금 전';
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 7) {
    return `${elapsedDays}일 전`;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function getLastUserMessage(
  messages: ChatSession['messages'],
): ChatSession['messages'][number] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index];
    }
  }

  return undefined;
}

export function createRecentChatItems(
  chatSessions: ChatSessions,
  workspaces: Workspace[],
): RecentChatItem[] {
  const visibleWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));

  return workspaces
    .flatMap((workspace) =>
      (chatSessions[workspace.id] ?? []).flatMap((session) => {
        if (
          session.workspaceId !== workspace.id ||
          !visibleWorkspaceIds.has(session.workspaceId) ||
          session.messages.length === 0
        ) {
          return [];
        }

        const lastMessage = session.messages.at(-1);
        const lastUserMessage = getLastUserMessage(session.messages);
        const previewMessage = lastUserMessage ?? lastMessage;

        return lastMessage && previewMessage
          ? [
              {
                session,
                workspace,
                preview: truncatePreview(
                  previewMessage.content,
                  workspace.type === 'private'
                    ? PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS
                    : RECENT_CHAT_PREVIEW_MAX_CHARS,
                ),
                messageCount: session.messages.length,
                lastUpdatedAt: session.updatedAt || lastMessage.createdAt,
              },
            ]
          : [];
      }),
    )
    .sort(
      (left, right) =>
        getTimestamp(right.lastUpdatedAt) - getTimestamp(left.lastUpdatedAt) ||
        left.workspace.label.localeCompare(right.workspace.label) ||
        left.session.title.localeCompare(right.session.title),
    );
}

export function RecentChatsView({
  chatSessions,
  isLoading = false,
  onDeleteSession,
  onOpenSession,
  onRenameSession,
  storageError,
  workspaces,
}: {
  chatSessions: ChatSessions;
  isLoading?: boolean;
  onDeleteSession: (workspaceId: string, sessionId: string) => void;
  onOpenSession: (workspace: Workspace, sessionId: string) => void;
  onRenameSession: (workspaceId: string, sessionId: string) => void;
  storageError?: string | null;
  workspaces: Workspace[];
}) {
  const recentChats = createRecentChatItems(chatSessions, workspaces);
  const [now, setNow] = useState(() => Date.now());
  const [deleteTarget, setDeleteTarget] = useState<RecentChatItem | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <section className="recent-chats-view" aria-labelledby="recent-chats-title">
      <header className="recent-chats-header">
        <p className="eyebrow">Chat history</p>
        <h1 id="recent-chats-title">최근 대화</h1>
        <p>Workspace별 Chat Session 기록입니다.</p>
      </header>

      {storageError ? (
        <p className="recent-chats-storage-error" role="status">
          {storageError}
        </p>
      ) : null}

      {deleteTarget ? (
        <div className="recent-chat-delete-confirmation" role="alertdialog">
          <div>
            <strong>{deleteTarget.session.title} 세션을 삭제하시겠습니까?</strong>
            <p>삭제한 대화는 복구할 수 없습니다.</p>
          </div>
          <div className="recent-chat-delete-actions">
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
              onClick={(event) => {
                event.currentTarget.blur();
                onDeleteSession(
                  deleteTarget.workspace.id,
                  deleteTarget.session.sessionId,
                );
                setDeleteTarget(null);
              }}
              type="button"
            >
              삭제
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="recent-chats-empty">
          <p>대화 기록을 불러오는 중입니다...</p>
        </div>
      ) : recentChats.length === 0 ? (
        <div className="recent-chats-empty">
          <p>아직 대화 기록이 없습니다.</p>
        </div>
      ) : (
        <div className="recent-chats-list">
          {recentChats.map((item) => (
            <article className="recent-chat-item" key={item.session.sessionId}>
              <button
                className="recent-chat-open"
                onClick={() => {
                  onOpenSession(item.workspace, item.session.sessionId);
                }}
                type="button"
              >
                <span className="recent-chat-main">
                  <strong>{item.session.title}</strong>
                  <small>{item.workspace.label}</small>
                  <span>{item.preview}</span>
                </span>
                <span className="recent-chat-count">
                  {item.messageCount.toLocaleString()} messages ·{' '}
                  {formatRecentChatTime(item.lastUpdatedAt, now)}
                </span>
              </button>
              <button
                aria-label={`${item.session.title} 이름 변경`}
                className="recent-chat-delete"
                onClick={(event) => {
                  event.currentTarget.blur();
                  onRenameSession(item.workspace.id, item.session.sessionId);
                }}
                type="button"
              >
                Rename
              </button>
              <button
                aria-label={`${item.session.title} 삭제`}
                className="recent-chat-delete"
                onClick={(event) => {
                  event.currentTarget.blur();
                  setDeleteTarget(item);
                }}
                type="button"
              >
                삭제
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
