import { useRef, useState } from 'react';
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ContextPanel } from './components/ContextPanel';
import { Sidebar } from './components/Sidebar';
import { WelcomePanel } from './components/WelcomePanel';
import { defaultWorkspace, type Workspace } from './workspaces';

export function App() {
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [message, setMessage] = useState('');
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  function handleSelectPrompt(promptText: string): void {
    setMessage(promptText);
    chatInputRef.current?.focus();
  }

  return (
    <div className="app-layout">
      <Sidebar
        selectedWorkspaceId={selectedWorkspace.id}
        onSelectWorkspace={setSelectedWorkspace}
      />
      <main className="chat-area" aria-label={`${selectedWorkspace.label} 채팅`}>
        <ChatHeader workspaceLabel={selectedWorkspace.label} />
        <WelcomePanel onSelectPrompt={handleSelectPrompt} />
        <ChatInput
          ref={chatInputRef}
          value={message}
          onChange={setMessage}
        />
      </main>
      <ContextPanel />
    </div>
  );
}
