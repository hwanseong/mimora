import { useEffect, useRef, useState } from 'react';
import {
  assistantTestResponse,
  type ChatMessage,
  type ChatSessions,
} from './chat';
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessages } from './components/ChatMessages';
import { ContextPanel } from './components/ContextPanel';
import { QuickPromptBar } from './components/QuickPromptBar';
import { Sidebar } from './components/Sidebar';
import { WelcomePanel } from './components/WelcomePanel';
import { defaultWorkspace, type Workspace } from './workspaces';

export function App() {
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [message, setMessage] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const assistantResponseTimeouts = useRef<number[]>([]);
  const currentMessages = chatSessions[selectedWorkspace.id] ?? [];

  useEffect(() => {
    return () => {
      assistantResponseTimeouts.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, []);

  function handleSelectPrompt(promptText: string): void {
    setMessage(promptText);
    chatInputRef.current?.focus();
  }

  function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
    return {
      id: `${role}-${Date.now()}-${crypto.randomUUID()}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }

  function appendMessagesToSession(
    workspaceId: Workspace['id'],
    newMessages: ChatMessage[],
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];

      return {
        ...currentSessions,
        [workspaceId]: [...sessionMessages, ...newMessages],
      };
    });
  }

  function handleSelectWorkspace(workspace: Workspace): void {
    setSelectedWorkspace(workspace);
    setMessage('');
  }

  function handleSendMessage(): void {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    const targetWorkspaceId = selectedWorkspace.id;
    const userMessage = createMessage('user', trimmedMessage);

    appendMessagesToSession(targetWorkspaceId, [userMessage]);
    setMessage('');

    const timeoutId = window.setTimeout(() => {
      const assistantMessage = createMessage('assistant', assistantTestResponse);
      appendMessagesToSession(targetWorkspaceId, [assistantMessage]);
      assistantResponseTimeouts.current =
        assistantResponseTimeouts.current.filter((id) => id !== timeoutId);
    }, 400);

    assistantResponseTimeouts.current.push(timeoutId);
  }

  return (
    <div className="app-layout">
      <Sidebar
        selectedWorkspaceId={selectedWorkspace.id}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <main className="chat-area" aria-label={`${selectedWorkspace.label} 채팅`}>
        <ChatHeader workspaceLabel={selectedWorkspace.label} />
        <div className="message-area">
          {currentMessages.length === 0 ? (
            <WelcomePanel onSelectPrompt={handleSelectPrompt} />
          ) : (
            <ChatMessages messages={currentMessages} />
          )}
        </div>
        <div className="chat-composer">
          {currentMessages.length > 0 ? (
            <QuickPromptBar onSelectPrompt={handleSelectPrompt} />
          ) : null}
          <ChatInput
            ref={chatInputRef}
            value={message}
            onChange={setMessage}
            onSubmit={handleSendMessage}
          />
        </div>
      </main>
      <ContextPanel />
    </div>
  );
}
