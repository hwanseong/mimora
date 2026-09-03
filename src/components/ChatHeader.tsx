export function ChatHeader({ workspaceLabel }: { workspaceLabel: string }) {
  return (
    <header className="chat-header">
      <div>
        <p className="eyebrow">현재 Workspace</p>
        <h1>{workspaceLabel}</h1>
      </div>

      <div className="header-meta" aria-label="채팅 설정">
        <span>AI Mode: Auto</span>
        <span>Security: Internal</span>
      </div>
    </header>
  );
}
