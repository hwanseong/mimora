import { useEffect, useRef, useState } from 'react';
import { type ChatMessage, type ChatSessions } from './chat';
import type { AutoRetrievedContext } from './autoContext';
import {
  type AttachedContext,
  type WorkspaceContexts,
} from './attachedContext';
import {
  RECENT_HISTORY_MESSAGE_LIMIT,
  type LLMChatMessage,
  type LLMContextDocument,
  type LocalAIPerformanceMetrics,
} from './llmChat';
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
import {
  evaluateSecurity,
  routeAIRequest,
  type AIMode,
  type RoutingDecision,
} from './security/securityRouter';

export function App() {
  const [activeView, setActiveView] = useState<
    'chat' | 'vault-browser' | 'settings'
  >('chat');
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [message, setMessage] = useState('');
  const [aiMode, setAIMode] = useState<AIMode>('auto');
  const [isSavingAIMode, setIsSavingAIMode] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [workspaceContexts, setWorkspaceContexts] =
    useState<WorkspaceContexts>({});
  const workspaceContextsRef = useRef<WorkspaceContexts>({});
  const generatingWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const [generatingWorkspaceIds, setGeneratingWorkspaceIds] = useState<
    Set<string>
  >(new Set());
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const currentMessages = chatSessions[selectedWorkspace.id] ?? [];
  const currentContexts = workspaceContexts[selectedWorkspace.id] ?? [];
  const isCurrentWorkspaceGenerating = generatingWorkspaceIds.has(
    selectedWorkspace.id,
  );
  const latestRoutingDecision = currentMessages.reduce<
    RoutingDecision | undefined
  >(
    (latestDecision, chatMessage) =>
      chatMessage.routingDecision ?? latestDecision,
    undefined,
  );
  const currentSecurity =
    latestRoutingDecision?.security ??
    evaluateSecurity(selectedWorkspace.type, currentContexts).security;

  useEffect(() => {
    let isMounted = true;

    void window.mimora
      .getSettings()
      .then((settings) => {
        if (isMounted) {
          setAIMode(settings.aiMode);
        }
      })
      .catch((error: unknown) => {
        console.error('[Mimora Settings] Failed to load AI Mode.', {
          error: getChatErrorMessage(error),
        });
      });

    return () => {
      isMounted = false;
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
    const endToEndStartedTime = performance.now();
    const trimmedMessage = message.trim();

    if (
      !trimmedMessage ||
      generatingWorkspaceIdsRef.current.has(selectedWorkspace.id)
    ) {
      return;
    }

    const targetWorkspaceId = selectedWorkspace.id;
    const targetWorkspaceType = selectedWorkspace.type;
    const targetAIMode = aiMode;
    const previousMessages = (chatSessions[targetWorkspaceId] ?? []).slice(
      -RECENT_HISTORY_MESSAGE_LIMIT,
    );
    const manualContexts = [
      ...(workspaceContextsRef.current[targetWorkspaceId] ?? []),
    ];
    const userMessage: ChatMessage = {
      ...createMessage('user', trimmedMessage),
      autoContext: [],
      autoContextStatus: 'loading',
      manualContext: manualContexts,
    };
    const assistantMessage: ChatMessage = {
      ...createMessage('assistant', 'Mimora가 분석 중입니다...'),
      generationStatus: 'loading',
    };

    setWorkspaceGenerating(targetWorkspaceId, true);
    appendMessagesToSession(targetWorkspaceId, [userMessage, assistantMessage]);
    setMessage('');

    void completeChatRequest(
      targetWorkspaceId,
      targetWorkspaceType,
      targetAIMode,
      userMessage.id,
      assistantMessage.id,
      trimmedMessage,
      previousMessages,
      manualContexts,
      endToEndStartedTime,
    );
  }

  function toLLMContextDocument(
    context: AttachedContext | AutoRetrievedContext,
  ): LLMContextDocument {
    return {
      vaultId: context.vaultId,
      vaultName: context.vaultName,
      vaultType: context.vaultType,
      security: context.security,
      relativePath: context.relativePath,
      fileName: context.fileName,
      ...('snippet' in context ? { snippet: context.snippet } : {}),
      content: context.content,
    };
  }

  function getChatErrorMessage(error: unknown): string {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Local AI 응답을 생성하지 못했습니다.';

    if (
      errorMessage.includes('Error invoking remote method') ||
      errorMessage.includes('\n    at ')
    ) {
      return 'Local AI 응답을 생성하지 못했습니다. Settings에서 연결 상태를 확인하세요.';
    }

    return errorMessage;
  }

  async function completeChatRequest(
    workspaceId: Workspace['id'],
    workspaceType: Workspace['type'],
    requestAIMode: AIMode,
    userMessageId: string,
    assistantMessageId: string,
    query: string,
    previousMessages: ChatMessage[],
    manualContexts: AttachedContext[],
    endToEndStartedTime: number,
  ): Promise<void> {
    let autoContext: AutoRetrievedContext[] = [];
    let autoContextError: string | undefined;
    const retrievalStartedTime = performance.now();

    try {
      autoContext = await window.mimora.retrieveAutoContext({
        query,
        limit: 5,
      });
    } catch (error) {
      autoContextError =
        error instanceof Error
          ? error.message
          : '자동 참조 문서를 검색하지 못했습니다.';
    }
    const retrievalMs = performance.now() - retrievalStartedTime;

    completeAutoContextRetrieval(
      workspaceId,
      userMessageId,
      autoContext,
      autoContextError,
    );

    const routingDecision = routeAIRequest({
      mode: requestAIMode,
      workspaceType,
      manualContexts,
      autoContexts: autoContext,
    });

    saveRoutingDecisionForTurn(
      workspaceId,
      userMessageId,
      assistantMessageId,
      routingDecision,
    );

    console.info('[Mimora Routing]', {
      mode: routingDecision.mode,
      workspace: workspaceId,
      security: routingDecision.security,
      provider: routingDecision.provider,
      reason: routingDecision.reason,
      manualContext: routingDecision.manualContextCount,
      autoContext: routingDecision.autoContextCount,
    });

    try {
      const history: LLMChatMessage[] = previousMessages.map(
        (previousMessage) => ({
          role: previousMessage.role,
          content: previousMessage.content,
        }),
      );
      const response = await window.mimora.chatWithLocalAI({
        workspaceId,
        question: query,
        history,
        manualContexts: manualContexts.map(toLLMContextDocument),
        autoContexts: autoContext.map(toLLMContextDocument),
      });
      const metrics: LocalAIPerformanceMetrics = {
        ...response.performance,
        retrievalMs,
        totalElapsedMs: performance.now() - endToEndStartedTime,
      };

      console.info('[Mimora Performance]', {
        workspaceId,
        queryChars: metrics.queryChars,
        retrieval: {
          ms: metrics.retrievalMs,
        },
        contextBuild: {
          ms: metrics.contextBuildMs,
        },
        context: {
          manualCount: metrics.manualContextCount,
          autoCount: metrics.autoContextCount,
          deduplicatedDocumentCount: metrics.deduplicatedDocumentCount,
          documentsUsed: metrics.documentCount,
          rawChars: metrics.rawContextChars,
          finalChars: metrics.finalContextChars,
        },
        history: {
          messages: metrics.historyMessageCount,
          chars: metrics.historyChars,
        },
        prompt: {
          systemChars: metrics.systemPromptChars,
          finalUserPromptChars: metrics.finalPromptChars,
          requestChars: metrics.requestChars,
        },
        ollama: {
          roundTripMs: metrics.ollamaRoundTripMs,
          ...metrics.ollama,
        },
        responseChars: metrics.responseChars,
        total: {
          elapsedMs: metrics.totalElapsedMs,
        },
      });

      completeAssistantMessage(workspaceId, assistantMessageId, {
        content: response.content,
        generationStatus: 'complete',
        sources: response.sources,
        performance: metrics,
        routingDecision,
      });
    } catch (error) {
      const errorMessage = getChatErrorMessage(error);

      completeAssistantMessage(workspaceId, assistantMessageId, {
        content: errorMessage,
        generationStatus: 'error',
        routingDecision,
        ...(errorMessage === 'Local AI 응답 시간이 초과되었습니다.'
          ? {
              generationErrorDetail:
                '참고 문서가 많거나 Local AI 처리 속도가 느린 경우 발생할 수 있습니다.',
            }
          : {}),
      });
    } finally {
      setWorkspaceGenerating(workspaceId, false);
    }
  }

  function completeAssistantMessage(
    workspaceId: Workspace['id'],
    assistantMessageId: string,
    update: Partial<Pick<
      ChatMessage,
      | 'content'
      | 'generationStatus'
      | 'generationErrorDetail'
      | 'sources'
      | 'performance'
      | 'routingDecision'
    >>,
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];

      return {
        ...currentSessions,
        [workspaceId]: sessionMessages.map((chatMessage) =>
          chatMessage.id === assistantMessageId
            ? { ...chatMessage, ...update }
            : chatMessage,
        ),
      };
    });
  }

  function saveRoutingDecisionForTurn(
    workspaceId: Workspace['id'],
    userMessageId: string,
    assistantMessageId: string,
    routingDecision: RoutingDecision,
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];

      return {
        ...currentSessions,
        [workspaceId]: sessionMessages.map((chatMessage) =>
          chatMessage.id === userMessageId ||
          chatMessage.id === assistantMessageId
            ? { ...chatMessage, routingDecision }
            : chatMessage,
        ),
      };
    });
  }

  async function handleChangeAIMode(nextAIMode: AIMode): Promise<void> {
    const previousAIMode = aiMode;

    setAIMode(nextAIMode);
    setIsSavingAIMode(true);

    try {
      const settings = await window.mimora.updateAIMode(nextAIMode);

      setAIMode(settings.aiMode);
    } catch (error) {
      setAIMode(previousAIMode);
      console.error('[Mimora Settings] Failed to save AI Mode.', {
        error: getChatErrorMessage(error),
      });
    } finally {
      setIsSavingAIMode(false);
    }
  }

  function completeAutoContextRetrieval(
    workspaceId: Workspace['id'],
    userMessageId: string,
    autoContext: AutoRetrievedContext[],
    errorMessage?: string,
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];
      const userMessageIndex = sessionMessages.findIndex(
        (chatMessage) => chatMessage.id === userMessageId,
      );

      if (userMessageIndex < 0) {
        return currentSessions;
      }

      const userMessage = sessionMessages[userMessageIndex];
      const updatedUserMessage: ChatMessage = {
        ...userMessage,
        autoContext,
        autoContextStatus: errorMessage ? 'error' : 'complete',
        ...(errorMessage ? { autoContextError: errorMessage } : {}),
      };
      const nextSessionMessages = [...sessionMessages];

      nextSessionMessages.splice(userMessageIndex, 1, updatedUserMessage);

      return {
        ...currentSessions,
        [workspaceId]: nextSessionMessages,
      };
    });
  }

  function setWorkspaceGenerating(
    workspaceId: Workspace['id'],
    isGenerating: boolean,
  ): void {
    const nextWorkspaceIds = new Set(generatingWorkspaceIdsRef.current);

    if (isGenerating) {
      nextWorkspaceIds.add(workspaceId);
    } else {
      nextWorkspaceIds.delete(workspaceId);
    }

    generatingWorkspaceIdsRef.current = nextWorkspaceIds;
    setGeneratingWorkspaceIds(nextWorkspaceIds);
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
            <ChatHeader
              aiMode={aiMode}
              disabled={isSavingAIMode || isCurrentWorkspaceGenerating}
              effectiveSecurity={currentSecurity}
              onChangeAIMode={(nextAIMode) => {
                void handleChangeAIMode(nextAIMode);
              }}
              workspaceLabel={selectedWorkspace.label}
            />
            <div className="message-area">
              {currentMessages.length === 0 ? (
                <WelcomePanel onSelectPrompt={handleSelectPrompt} />
              ) : (
                <ChatMessages
                  messages={currentMessages}
                  workspaceId={selectedWorkspace.id}
                />
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
                disabled={isCurrentWorkspaceGenerating}
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
