import { useRef, useState } from 'react';
import { assistantTestResponse, type ChatMessage } from './chat';
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

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

  function handleSendMessage(): void {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    const userMessage = createMessage('user', trimmedMessage);
    const assistantMessage = createMessage('assistant', assistantTestResponse);

    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ]);
    setMessage('');
  }

  return (
    <div className="app-layout">
      <Sidebar
        selectedWorkspaceId={selectedWorkspace.id}
        onSelectWorkspace={setSelectedWorkspace}
      />
      <main className="chat-area" aria-label={`${selectedWorkspace.label} 채팅`}>
        <ChatHeader workspaceLabel={selectedWorkspace.label} />
        <div className="message-area">
          {messages.length === 0 ? (
            <WelcomePanel onSelectPrompt={handleSelectPrompt} />
          ) : (
            <ChatMessages messages={messages} />
          )}
        </div>
        <div className="chat-composer">
          {messages.length > 0 ? (
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
