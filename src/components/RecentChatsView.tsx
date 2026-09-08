import { useEffect, useState } from 'react';
import type { ChatSessions } from '../chat';
import type { Workspace } from '../workspaces';

export const RECENT_CHAT_PREVIEW_MAX_CHARS = 72;
export const PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS = 60;

export type RecentChatItem = {
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

  return `${characters
    .slice(0, maxChars - 1)
    .join('')
    .trimEnd()}…`;
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
  messages: ChatSessions[string],
): ChatSessions[string][number] | undefined {
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
  return workspaces
    .flatMap((workspace) => {
      const messages = chatSessions[workspace.id] ?? [];

      if (messages.length === 0) {
        return [];
      }

      const lastMessage = messages.at(-1);
      const lastUserMessage = getLastUserMessage(messages);
      const previewMessage = lastUserMessage ?? lastMessage;

      return lastMessage && previewMessage
        ? [
            {
              workspace,
              preview: truncatePreview(
                previewMessage.content,
                workspace.type === 'private'
                  ? PRIVATE_RECENT_CHAT_PREVIEW_MAX_CHARS
                  : RECENT_CHAT_PREVIEW_MAX_CHARS,
              ),
              messageCount: messages.length,
              lastUpdatedAt: lastMessage.createdAt,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        getTimestamp(right.lastUpdatedAt) - getTimestamp(left.lastUpdatedAt) ||
        left.workspace.label.localeCompare(right.workspace.label),
    );
}

export function RecentChatsView({
  chatSessions,
  isLoading = false,
  onDeleteWorkspaceChat,
  onOpenWorkspace,
  storageError,
  workspaces,
}: {
  chatSessions: ChatSessions;
  isLoading?: boolean;
  onDeleteWorkspaceChat: (workspace: Workspace) => Promise<void>;
  onOpenWorkspace: (workspace: Workspace) => void;
  storageError?: string | null;
  workspaces: Workspace[];
}) {
  const recentChats = createRecentChatItems(chatSessions, workspaces);
  const [now, setNow] = useState(() => Date.now());
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await onDeleteWorkspaceChat(deleteTarget);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : '대화 기록을 삭제하지 못했습니다.',
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="recent-chats-view" aria-labelledby="recent-chats-title">
      <header className="recent-chats-header">
        <p className="eyebrow">Chat history</p>
        <h1 id="recent-chats-title">최근 대화</h1>
        <p>현재 실행 중인 Mimora의 Workspace별 대화입니다.</p>
      </header>

      {storageError ? (
        <p className="recent-chats-storage-error" role="status">
          {storageError}
        </p>
      ) : null}

      {deleteTarget ? (
        <div className="recent-chat-delete-confirmation" role="alertdialog">
          <div>
            <strong>{deleteTarget.label}의 대화 기록을 삭제하시겠습니까?</strong>
            <p>
              대화 기록만 삭제됩니다. Obsidian Vault와 프로젝트 문서는 삭제되지
              않습니다.
            </p>
            {deleteError ? <p className="recent-chat-delete-error">{deleteError}</p> : null}
          </div>
          <div className="recent-chat-delete-actions">
            <button
              className="secondary-button"
              disabled={isDeleting}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              type="button"
            >
              취소
            </button>
            <button
              className="danger-button"
              disabled={isDeleting}
              onClick={() => {
                void confirmDelete();
              }}
              type="button"
            >
              {isDeleting ? '삭제 중…' : '대화 삭제'}
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
            <article
              className="recent-chat-item"
              key={item.workspace.id}
            >
              <button
                className="recent-chat-open"
                onClick={() => {
                  onOpenWorkspace(item.workspace);
                }}
                type="button"
              >
                <span className="recent-chat-main">
                  <strong>{item.workspace.label}</strong>
                  <span>“{item.preview}”</span>
                </span>
                <span className="recent-chat-count">
                  {item.messageCount.toLocaleString()} messages ·{' '}
                  {formatRecentChatTime(item.lastUpdatedAt, now)}
                </span>
              </button>
              <button
                aria-label={`${item.workspace.label} 대화 기록 삭제`}
                className="recent-chat-delete"
                onClick={() => {
                  setDeleteTarget(item.workspace);
                  setDeleteError(null);
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
