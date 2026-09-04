import { useEffect, useRef, useState } from 'react';
import {
  assistantTestResponse,
  type ChatMessage,
  type ChatSessions,
} from './chat';
import {
  type AttachedContext,
  type WorkspaceContexts,
} from './attachedContext';
import { AttachedContextBar } from './components/AttachedContextBar';
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessages } from './components/ChatMessages';
import { ContextPanel } from './components/ContextPanel';
import { QuickPromptBar } from './components/QuickPromptBar';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { VaultBrowserView } from './components/VaultBrowserView';
import { WelcomePanel } from './components/WelcomePanel';
import { defaultWorkspace, type Workspace } from './workspaces';

export function App() {
  const [activeView, setActiveView] = useState<
    'chat' | 'vault-browser' | 'settings'
  >('chat');
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [message, setMessage] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [workspaceContexts, setWorkspaceContexts] =
    useState<WorkspaceContexts>({});
  const workspaceContextsRef = useRef<WorkspaceContexts>({});
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const assistantResponseTimeouts = useRef<number[]>([]);
  const currentMessages = chatSessions[selectedWorkspace.id] ?? [];
  const currentContexts = workspaceContexts[selectedWorkspace.id] ?? [];

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
    setActiveView('chat');
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

  function attachContextToWorkspace(
    workspaceId: Workspace['id'],
    context: AttachedContext,
  ): boolean {
    const existingContexts = workspaceContextsRef.current[workspaceId] ?? [];

    if (existingContexts.some((item) => item.id === context.id)) {
      return false;
    }

    const nextContexts = {
      ...workspaceContextsRef.current,
      [workspaceId]: [...existingContexts, context],
    };

    workspaceContextsRef.current = nextContexts;
    setWorkspaceContexts(nextContexts);
    return true;
  }

  function removeContextFromWorkspace(
    workspaceId: Workspace['id'],
    contextId: string,
  ): void {
    const existingContexts = workspaceContextsRef.current[workspaceId] ?? [];
    const nextWorkspaceContexts = existingContexts.filter(
      (context) => context.id !== contextId,
    );

    if (nextWorkspaceContexts.length === existingContexts.length) {
      return;
    }

    const nextContexts = {
      ...workspaceContextsRef.current,
      [workspaceId]: nextWorkspaceContexts,
    };

    workspaceContextsRef.current = nextContexts;
    setWorkspaceContexts(nextContexts);
  }

  return (
    <div className="app-layout">
      <Sidebar
        isVaultBrowserActive={activeView === 'vault-browser'}
        isSettingsActive={activeView === 'settings'}
        onOpenVaultBrowser={() => {
          setActiveView('vault-browser');
          setMessage('');
        }}
        onOpenSettings={() => {
          setActiveView('settings');
          setMessage('');
        }}
        selectedWorkspaceId={activeView === 'chat' ? selectedWorkspace.id : ''}
        onSelectWorkspace={handleSelectWorkspace}
      />
      <main
        className={`chat-area${activeView !== 'chat' ? ' settings-area' : ''}`}
        aria-label={
          activeView === 'settings'
            ? '설정'
            : activeView === 'vault-browser'
              ? 'Vault Browser'
              : `${selectedWorkspace.label} 채팅`
        }
      >
        {activeView === 'settings' ? (
          <SettingsView />
        ) : activeView === 'vault-browser' ? (
          <VaultBrowserView
            currentWorkspace={selectedWorkspace}
            onAttachContext={(context) =>
              attachContextToWorkspace(selectedWorkspace.id, context)
            }
            onOpenSettings={() => {
              setActiveView('settings');
            }}
          />
        ) : (
          <>
            <ChatHeader workspaceLabel={selectedWorkspace.label} />
            <div className="message-area">
              {currentMessages.length === 0 ? (
                <WelcomePanel onSelectPrompt={handleSelectPrompt} />
              ) : (
                <ChatMessages messages={currentMessages} />
              )}
            </div>
            <div className="chat-composer">
              <AttachedContextBar
                contexts={currentContexts}
                onRemove={(contextId) => {
                  removeContextFromWorkspace(selectedWorkspace.id, contextId);
                }}
              />
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
          </>
        )}
      </main>
      <ContextPanel />
    </div>
  );
}
