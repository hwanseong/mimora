import { useEffect, useRef, useState } from 'react';
import {
  isChatRequestBusy,
  tryBeginExternalAction,
  type ChatMessage,
  type ChatRequestStatus,
  type ChatSessions,
  type ExternalActionResult,
  type ExternalApprovalInfo,
} from './chat';
import type { AutoRetrievedContext } from './autoContext';
import { createPersistedChatHistory } from './chatHistory';
import {
  type AttachedContext,
  type WorkspaceContexts,
} from './attachedContext';
import {
  RECENT_HISTORY_MESSAGE_LIMIT,
  type LLMChatMessage,
  type LLMContextDocument,
  type LLMContextSource,
  type LocalAIPerformanceMetrics,
} from './llmChat';
import { AttachedContextBar } from './components/AttachedContextBar';
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessages } from './components/ChatMessages';
import { ContextPanel } from './components/ContextPanel';
import { QuickPromptBar } from './components/QuickPromptBar';
import { RecentChatsView } from './components/RecentChatsView';
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
import {
  createExternalPayloadPreview,
  type ExternalPayloadPreview,
} from './security/externalPayloadPreview';
import { getSecretRules } from './security/secretDetector';
import {
  applyResponseUnmasking,
  createResponseUnmaskingSnapshot,
  type ResponseUnmaskingSnapshotEntry,
} from './security/responseUnmasking';
import type {
  ExternalAIPerformanceMetrics,
  ExternalAIChatResult,
} from './externalAI';

type PendingExternalRequest = {
  workspaceId: Workspace['id'];
  workspaceType: Workspace['type'];
  userMessageId: string;
  assistantMessageId: string;
  query: string;
  previousMessages: ChatMessage[];
  manualContexts: AttachedContext[];
  autoContexts: AutoRetrievedContext[];
  preview: ExternalPayloadPreview;
  responseUnmaskingSnapshot: ResponseUnmaskingSnapshotEntry[];
  routingDecision: RoutingDecision;
  retrievalMs: number;
  inFlight: boolean;
};

export function App() {
  const [activeView, setActiveView] = useState<
    'chat' | 'recent-chats' | 'vault-browser' | 'settings'
  >('chat');
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [message, setMessage] = useState('');
  const [aiMode, setAIMode] = useState<AIMode>('auto');
  const [isSavingAIMode, setIsSavingAIMode] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [chatHistoryStatus, setChatHistoryStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [chatHistoryError, setChatHistoryError] = useState<string | null>(null);
  const skipNextChatHistorySaveRef = useRef(false);
  const [workspaceContexts, setWorkspaceContexts] =
    useState<WorkspaceContexts>({});
  const workspaceContextsRef = useRef<WorkspaceContexts>({});
  const pendingExternalRequestsRef = useRef<
    Map<string, PendingExternalRequest>
  >(new Map());
  const workspaceRequestStatusesRef = useRef<Map<string, ChatRequestStatus>>(
    new Map(),
  );
  const [workspaceRequestStatuses, setWorkspaceRequestStatuses] = useState<
    Record<string, ChatRequestStatus>
  >({});
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const currentMessages = chatSessions[selectedWorkspace.id] ?? [];
  const currentContexts = workspaceContexts[selectedWorkspace.id] ?? [];
  const currentWorkspaceRequestStatus =
    workspaceRequestStatuses[selectedWorkspace.id] ?? 'idle';
  const isCurrentWorkspaceBusy = isChatRequestBusy(
    currentWorkspaceRequestStatus,
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

  useEffect(() => {
    let isMounted = true;

    void window.mimora
      .loadChatHistory()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        skipNextChatHistorySaveRef.current = result.status === 'ready';
        setChatSessions(result.sessions);
        setChatHistoryError(result.error ?? null);
        setChatHistoryStatus(result.status === 'ready' ? 'ready' : 'error');
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setChatSessions({});
        setChatHistoryError(
          error instanceof Error
            ? error.message
            : '저장된 대화 기록을 불러오지 못했습니다.',
        );
        setChatHistoryStatus('error');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (chatHistoryStatus !== 'ready') {
      return;
    }

    if (skipNextChatHistorySaveRef.current) {
      skipNextChatHistorySaveRef.current = false;
      return;
    }

    const persistedHistory = createPersistedChatHistory(chatSessions);

    void window.mimora
      .saveChatHistory(persistedHistory)
      .then(() => {
        setChatHistoryError(null);
      })
      .catch((error: unknown) => {
        setChatHistoryError(
          error instanceof Error
            ? error.message
            : '대화 기록을 안전하게 저장하지 못했습니다.',
        );
      });
  }, [chatHistoryStatus, chatSessions]);

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
      isChatRequestBusy(
        workspaceRequestStatusesRef.current.get(selectedWorkspace.id) ??
          'idle',
      )
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
      requestedMode: targetAIMode,
    };
    const assistantMessage: ChatMessage = {
      ...createMessage('assistant', '참고 문서를 찾는 중입니다...'),
      requestStatus: 'retrieving-context',
      requestedMode: targetAIMode,
      generationStatus: 'loading',
    };

    setWorkspaceRequestStatus(targetWorkspaceId, 'retrieving-context');
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

  async function handleDeleteWorkspaceChat(workspace: Workspace): Promise<void> {
    if (chatHistoryStatus !== 'ready') {
      throw new Error(
        chatHistoryError ?? '안전한 대화 저장소를 사용할 수 없습니다.',
      );
    }

    await window.mimora.deleteWorkspaceChat(workspace.id);

    for (const [messageId, request] of pendingExternalRequestsRef.current) {
      if (request.workspaceId === workspace.id) {
        pendingExternalRequestsRef.current.delete(messageId);
      }
    }

    workspaceRequestStatusesRef.current.delete(workspace.id);
    setWorkspaceRequestStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[workspace.id];
      return nextStatuses;
    });
    setChatSessions((currentSessions) => {
      const nextSessions = { ...currentSessions };
      delete nextSessions[workspace.id];
      return nextSessions;
    });

    const nextContexts = { ...workspaceContextsRef.current };
    delete nextContexts[workspace.id];
    workspaceContextsRef.current = nextContexts;
    setWorkspaceContexts(nextContexts);
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

  function getContextSources(
    manualContexts: AttachedContext[],
    autoContexts: AutoRetrievedContext[],
  ): LLMContextSource[] {
    const seenDocuments = new Set<string>();

    return [...manualContexts, ...autoContexts].flatMap((context) => {
      const documentKey = JSON.stringify([
        context.vaultId,
        context.relativePath,
      ]);

      if (seenDocuments.has(documentKey)) {
        return [];
      }

      seenDocuments.add(documentKey);
      return [
        {
          vaultId: context.vaultId,
          vaultName: context.vaultName,
          vaultType: context.vaultType,
          security: context.security,
          relativePath: context.relativePath,
          fileName: context.fileName,
        },
      ];
    });
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

  function getExternalChatErrorMessage(error: unknown): string {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'OpenAI API 요청을 처리하지 못했습니다.';

    if (
      errorMessage.includes('Error invoking remote method') ||
      errorMessage.includes('\n    at ')
    ) {
      return 'OpenAI API 요청을 처리하지 못했습니다. Settings에서 연결 상태를 확인하세요.';
    }

    return errorMessage;
  }

  async function executeLocalAIRequest(input: {
    workspaceId: Workspace['id'];
    assistantMessageId: string;
    query: string;
    previousMessages: ChatMessage[];
    manualContexts: AttachedContext[];
    autoContexts: AutoRetrievedContext[];
    routingDecision: RoutingDecision;
    retrievalMs: number;
    totalElapsedMs: () => number;
  }): Promise<void> {
    setWorkspaceRequestStatus(input.workspaceId, 'calling-local');
    completeAssistantMessage(input.workspaceId, input.assistantMessageId, {
      content: 'Local AI가 분석 중입니다...',
      generationStatus: 'loading',
      requestStatus: 'calling-local',
      generationErrorDetail: undefined,
      externalSafetyAction: undefined,
      routingDecision: input.routingDecision,
    });

    const history: LLMChatMessage[] = input.previousMessages.map(
      (previousMessage) => ({
        role: previousMessage.role,
        content: previousMessage.content,
      }),
    );
    const response = await window.mimora.chatWithLocalAI({
      workspaceId: input.workspaceId,
      question: input.query,
      history,
      manualContexts: input.manualContexts.map(toLLMContextDocument),
      autoContexts: input.autoContexts.map(toLLMContextDocument),
    });
    const metrics: LocalAIPerformanceMetrics = {
      ...response.performance,
      retrievalMs: input.retrievalMs,
      totalElapsedMs: input.totalElapsedMs(),
    };

    console.info('[Mimora Performance]', {
      workspaceId: input.workspaceId,
      queryChars: metrics.queryChars,
      retrieval: { ms: metrics.retrievalMs },
      contextBuild: { ms: metrics.contextBuildMs },
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
      total: { elapsedMs: metrics.totalElapsedMs },
    });

    completeAssistantMessage(input.workspaceId, input.assistantMessageId, {
      content: response.content,
      generationStatus: 'complete',
      requestStatus: 'completed',
      generationErrorDetail: undefined,
      sources: response.sources,
      performance: metrics,
      routingDecision: input.routingDecision,
      externalSafetyAction: undefined,
      model: response.model,
    });
    setWorkspaceRequestStatus(input.workspaceId, 'completed');
  }

  async function executeOpenAIRequest(
    request: PendingExternalRequest,
    routingDecision: RoutingDecision,
  ): Promise<void> {
    setWorkspaceRequestStatus(request.workspaceId, 'calling-external');
    completeAssistantMessage(request.workspaceId, request.assistantMessageId, {
      content: 'OpenAI가 분석 중입니다...',
      generationStatus: 'loading',
      requestStatus: 'calling-external',
      generationErrorDetail: undefined,
      externalSafetyAction: undefined,
      routingDecision,
    });

    const response: ExternalAIChatResult = await window.mimora.chatWithOpenAI({
      workspaceId: request.workspaceId,
      mode:
        routingDecision.mode === 'external' ? 'external' : 'auto',
      externalText: request.preview.externalText,
      documents: request.preview.documents.map((document) => ({
        documentId: document.documentId,
        vaultName: document.vaultName,
        vaultType: document.vaultType,
        security: document.security,
        relativePath: document.relativePath,
        fileName: document.fileName,
      })),
      approved: routingDecision.approved,
    });
    const externalPerformance: ExternalAIPerformanceMetrics = {
      ...response.performance,
      retrievalMs: request.retrievalMs,
      totalElapsedMs:
        request.retrievalMs + response.performance.openAIRoundTripMs,
    };
    const unmaskingResult = applyResponseUnmasking({
      provider: 'openai',
      text: response.content,
      snapshot: request.responseUnmaskingSnapshot,
    });

    console.info('[Mimora Response Unmasking]', {
      mappings: request.responseUnmaskingSnapshot.length,
      replacements: unmaskingResult.replacementCount,
      entityTypes: [
        ...new Set(
          unmaskingResult.replacements.map(
            (replacement) => replacement.entityType,
          ),
        ),
      ],
    });

    completeAssistantMessage(request.workspaceId, request.assistantMessageId, {
      content: unmaskingResult.displayText,
      rawExternalResponse: unmaskingResult.maskedText,
      responseUnmaskingSnapshot: request.responseUnmaskingSnapshot.map(
        (mapping) => ({ ...mapping }),
      ),
      responseUnmasking: {
        replacements: unmaskingResult.replacements,
        replacementCount: unmaskingResult.replacementCount,
      },
      generationStatus: 'complete',
      requestStatus: 'completed',
      sources: getContextSources(
        request.manualContexts,
        request.autoContexts,
      ),
      externalPerformance,
      routingDecision: {
        ...routingDecision,
        safetyStatus: response.safetyStatus,
      },
      model: response.model,
      usage: response.usage,
    });
    setWorkspaceRequestStatus(request.workspaceId, 'completed');
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

    let preview: ExternalPayloadPreview | undefined;
    let responseUnmaskingSnapshot: ResponseUnmaskingSnapshotEntry[] = [];
    let externalAvailable = false;
    let externalPreparationError: string | undefined;

    if (requestAIMode !== 'local') {
      try {
        const [settings, hasApiKey] = await Promise.all([
          window.mimora.getSettings(),
          window.mimora.hasOpenAIApiKey(),
        ]);
        const effectiveSecurity = evaluateSecurity(
          workspaceType,
          [...manualContexts, ...autoContext],
        ).security;

        preview = createExternalPayloadPreview({
          workspaceId,
          effectiveSecurity,
          question: query,
          manualContexts,
          autoContexts: autoContext,
          maskingEntries: settings.masking.entries,
          secretRules: getSecretRules(
            settings.secretDetection.customRules,
          ),
        });
        responseUnmaskingSnapshot = createResponseUnmaskingSnapshot(
          settings.masking.entries,
          preview.replacements.map((replacement) => replacement.alias),
        );
        logSecretDetection(preview);
        externalAvailable = Boolean(
          settings.externalAI.model && hasApiKey,
        );
        saveExternalPayloadPreviewForTurn(
          workspaceId,
          userMessageId,
          preview,
        );
      } catch (error) {
        externalPreparationError =
          error instanceof Error
            ? error.message
            : '외부 전송용 보안 Payload를 준비하지 못했습니다.';
      }
    }

    const routingDecision = routeAIRequest({
      mode: requestAIMode,
      workspaceType,
      manualContexts,
      autoContexts: autoContext,
      safetyStatus: preview?.status,
      externalAvailable,
    });

    saveRoutingDecisionForTurn(
      workspaceId,
      userMessageId,
      assistantMessageId,
      routingDecision,
    );

    if (preview && routingDecision.provider === 'local') {
      saveExternalApprovalForTurn(
        workspaceId,
        userMessageId,
        assistantMessageId,
        { required: false, approved: false },
      );
    }

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
      if (routingDecision.provider === 'local') {
        await executeLocalAIRequest({
          workspaceId,
          assistantMessageId,
          query,
          previousMessages,
          manualContexts,
          autoContexts: autoContext,
          routingDecision,
          retrievalMs,
          totalElapsedMs: () => performance.now() - endToEndStartedTime,
        });
      } else {
        if (!preview) {
          throw new Error(
            externalPreparationError ??
              '외부 전송용 보안 Payload를 준비하지 못했습니다.',
          );
        }

        const request: PendingExternalRequest = {
          workspaceId,
          workspaceType,
          userMessageId,
          assistantMessageId,
          query,
          previousMessages,
          manualContexts,
          autoContexts: autoContext,
          preview,
          responseUnmaskingSnapshot,
          routingDecision,
          retrievalMs,
          inFlight: false,
        };

        if (preview.status === 'block') {
          pendingExternalRequestsRef.current.set(assistantMessageId, request);
          saveExternalApprovalForTurn(
            workspaceId,
            userMessageId,
            assistantMessageId,
            { required: false, approved: false },
          );
          completeAssistantMessage(workspaceId, assistantMessageId, {
            content: preview.secretDetection.detected
              ? '⛔ 외부 AI 전송 차단\n\nSecret / Credential 정보가 감지되었습니다.'
              : '보안 검사에 실패하여 외부 AI로 전송할 수 없습니다.',
            generationStatus: 'complete',
            requestStatus: 'completed',
            sources: getContextSources(manualContexts, autoContext),
            routingDecision,
            externalSafetyAction: {
              status: 'block',
              requestMessageId: userMessageId,
              reasons: preview.safety.checks
                .filter((check) => check.status === 'fail')
                .map((check) => check.message),
              secretDetections: preview.secretDetection.detections,
            },
          });
          setWorkspaceRequestStatus(workspaceId, 'completed');
        } else if (preview.status === 'review-required') {
          pendingExternalRequestsRef.current.set(assistantMessageId, request);
          saveExternalApprovalForTurn(
            workspaceId,
            userMessageId,
            assistantMessageId,
            { required: true, approved: false },
          );
          completeAssistantMessage(workspaceId, assistantMessageId, {
            content: '외부 AI 전송 전 검토가 필요합니다.',
            generationStatus: 'complete',
            requestStatus: 'review-required',
            sources: getContextSources(manualContexts, autoContext),
            routingDecision,
            externalSafetyAction: {
              status: 'review-required',
              requestMessageId: userMessageId,
              reasons: preview.safety.checks
                .filter((check) => check.status === 'warn')
                .map((check) => check.message),
            },
          });
          setWorkspaceRequestStatus(workspaceId, 'review-required');
        } else {
          saveExternalApprovalForTurn(
            workspaceId,
            userMessageId,
            assistantMessageId,
            { required: false, approved: false },
          );
          await executeOpenAIRequest(request, routingDecision);
        }
      }
    } catch (error) {
      const errorMessage =
        routingDecision.provider === 'openai'
          ? getExternalChatErrorMessage(error)
          : getChatErrorMessage(error);

      completeAssistantMessage(workspaceId, assistantMessageId, {
        content: errorMessage,
        generationStatus: 'error',
        requestStatus: 'error',
        routingDecision,
        ...(errorMessage === 'Local AI 응답 시간이 초과되었습니다.'
          ? {
              generationErrorDetail:
                '참고 문서가 많거나 Local AI 처리 속도가 느린 경우 발생할 수 있습니다.',
            }
          : {}),
      });
      setWorkspaceRequestStatus(workspaceId, 'error');
    }
  }

  async function rebuildExternalPreview(
    request: PendingExternalRequest,
  ): Promise<{
    preview: ExternalPayloadPreview;
    responseUnmaskingSnapshot: ResponseUnmaskingSnapshotEntry[];
  }> {
    const settings = await window.mimora.getSettings();
    const effectiveSecurity = evaluateSecurity(
      request.workspaceType,
      [...request.manualContexts, ...request.autoContexts],
    ).security;

    const preview = createExternalPayloadPreview({
      workspaceId: request.workspaceId,
      effectiveSecurity,
      question: request.query,
      manualContexts: request.manualContexts,
      autoContexts: request.autoContexts,
      maskingEntries: settings.masking.entries,
      secretRules: getSecretRules(settings.secretDetection.customRules),
    });

    return {
      preview,
      responseUnmaskingSnapshot: createResponseUnmaskingSnapshot(
        settings.masking.entries,
        preview.replacements.map((replacement) => replacement.alias),
      ),
    };
  }

  async function handleApproveExternal(
    assistantMessageId: string,
  ): Promise<ExternalActionResult> {
    const request = pendingExternalRequestsRef.current.get(assistantMessageId);

    if (!request) {
      return { ok: false, error: '승인할 External 요청을 찾을 수 없습니다.' };
    }

    if (request.preview.status === 'block') {
      return {
        ok: false,
        error: '보안 검사에 실패한 요청은 승인할 수 없습니다.',
        preview: request.preview,
      };
    }

    if (request.preview.status !== 'review-required') {
      return {
        ok: false,
        error: '사용자 승인이 필요한 요청이 아닙니다.',
        preview: request.preview,
      };
    }

    if (
      isChatRequestBusy(
        workspaceRequestStatusesRef.current.get(request.workspaceId) ?? 'idle',
      )
    ) {
      return { ok: false, error: '이미 처리 중인 요청입니다.' };
    }

    if (!tryBeginExternalAction(request)) {
      return { ok: false, error: '이미 처리 중인 요청입니다.' };
    }
    setWorkspaceRequestStatus(request.workspaceId, 'calling-external');
    completeAssistantMessage(request.workspaceId, assistantMessageId, {
      content: '외부 전송을 다시 확인하는 중입니다...',
      generationStatus: 'loading',
      requestStatus: 'calling-external',
      externalSafetyAction: undefined,
    });

    try {
      const {
        preview: revalidatedPreview,
        responseUnmaskingSnapshot,
      } = await rebuildExternalPreview(request);
      logSecretDetection(revalidatedPreview);

      request.preview = revalidatedPreview;
      request.responseUnmaskingSnapshot = responseUnmaskingSnapshot;
      saveExternalPayloadPreviewForTurn(
        request.workspaceId,
        request.userMessageId,
        revalidatedPreview,
      );

      if (revalidatedPreview.status === 'block') {
        const blockedRoutingDecision: RoutingDecision = {
          ...request.routingDecision,
          provider: 'openai',
          reason: 'external-safety-block',
          safetyStatus: 'block',
          approved: false,
        };

        request.routingDecision = blockedRoutingDecision;
        saveRoutingDecisionForTurn(
          request.workspaceId,
          request.userMessageId,
          request.assistantMessageId,
          blockedRoutingDecision,
        );
        saveExternalApprovalForTurn(
          request.workspaceId,
          request.userMessageId,
          request.assistantMessageId,
          { required: false, approved: false },
        );
        completeAssistantMessage(request.workspaceId, assistantMessageId, {
          content: revalidatedPreview.secretDetection.detected
            ? '⛔ 외부 AI 전송 차단\n\nSecret / Credential 정보가 감지되었습니다.'
            : '보안 검사에 실패하여 외부 AI로 전송할 수 없습니다.',
          generationStatus: 'complete',
          requestStatus: 'completed',
          sources: getContextSources(
            request.manualContexts,
            request.autoContexts,
          ),
          routingDecision: blockedRoutingDecision,
          externalSafetyAction: {
            status: 'block',
            requestMessageId: request.userMessageId,
            reasons: revalidatedPreview.safety.checks
              .filter((check) => check.status === 'fail')
              .map((check) => check.message),
            secretDetections: revalidatedPreview.secretDetection.detections,
          },
        });
        setWorkspaceRequestStatus(request.workspaceId, 'completed');

        return {
          ok: false,
          error: '보안 검사에 실패한 요청은 승인할 수 없습니다.',
          preview: revalidatedPreview,
        };
      }

      const approvedAt = new Date().toISOString();
      const routingDecision: RoutingDecision = {
        ...request.routingDecision,
        provider: 'openai',
        reason: 'user-approved',
        safetyStatus: revalidatedPreview.status,
        approved: true,
      };

      request.routingDecision = routingDecision;
      saveRoutingDecisionForTurn(
        request.workspaceId,
        request.userMessageId,
        request.assistantMessageId,
        routingDecision,
      );
      saveExternalApprovalForTurn(
        request.workspaceId,
        request.userMessageId,
        request.assistantMessageId,
        { required: true, approved: true, approvedAt },
      );

      await executeOpenAIRequest(request, routingDecision);
      pendingExternalRequestsRef.current.delete(assistantMessageId);
      return { ok: true };
    } catch (error) {
      const errorMessage = getExternalChatErrorMessage(error);

      completeAssistantMessage(request.workspaceId, assistantMessageId, {
        content: errorMessage,
        generationStatus: 'error',
        requestStatus: 'error',
        routingDecision: request.routingDecision,
        externalSafetyAction: undefined,
      });
      setWorkspaceRequestStatus(request.workspaceId, 'error');
      pendingExternalRequestsRef.current.delete(assistantMessageId);
      return { ok: false, error: errorMessage };
    } finally {
      request.inFlight = false;
    }
  }

  async function handleUseLocalAI(assistantMessageId: string): Promise<void> {
    const request = pendingExternalRequestsRef.current.get(assistantMessageId);

    if (
      !request ||
      isChatRequestBusy(
        workspaceRequestStatusesRef.current.get(request.workspaceId) ?? 'idle',
      )
    ) {
      return;
    }

    if (!tryBeginExternalAction(request)) {
      return;
    }
    const fallbackStartedTime = performance.now();
    const routingDecision: RoutingDecision = {
      ...request.routingDecision,
      provider: 'local',
      reason: 'user-selected-local-fallback',
      approved: false,
    };

    saveRoutingDecisionForTurn(
      request.workspaceId,
      request.userMessageId,
      request.assistantMessageId,
      routingDecision,
    );
    completeAssistantMessage(request.workspaceId, assistantMessageId, {
      content: 'Local AI가 분석 중입니다...',
      generationStatus: 'loading',
      requestStatus: 'calling-local',
      externalSafetyAction: undefined,
      routingDecision,
    });

    try {
      await executeLocalAIRequest({
        workspaceId: request.workspaceId,
        assistantMessageId,
        query: request.query,
        previousMessages: request.previousMessages,
        manualContexts: request.manualContexts,
        autoContexts: request.autoContexts,
        routingDecision,
        retrievalMs: request.retrievalMs,
        totalElapsedMs: () =>
          request.retrievalMs + (performance.now() - fallbackStartedTime),
      });
    } catch (error) {
      const errorMessage = getChatErrorMessage(error);

      completeAssistantMessage(request.workspaceId, assistantMessageId, {
        content: errorMessage,
        generationStatus: 'error',
        requestStatus: 'error',
        routingDecision,
        ...(errorMessage === 'Local AI 응답 시간이 초과되었습니다.'
          ? {
              generationErrorDetail:
                '참고 문서가 많거나 Local AI 처리 속도가 느린 경우 발생할 수 있습니다.',
            }
          : {}),
      });
      setWorkspaceRequestStatus(request.workspaceId, 'error');
    } finally {
      pendingExternalRequestsRef.current.delete(assistantMessageId);
      request.inFlight = false;
    }
  }

  function completeAssistantMessage(
    workspaceId: Workspace['id'],
    assistantMessageId: string,
    update: Partial<Pick<
      ChatMessage,
      | 'content'
      | 'requestStatus'
      | 'generationStatus'
      | 'generationErrorDetail'
      | 'sources'
      | 'performance'
      | 'externalPerformance'
      | 'routingDecision'
      | 'externalSafetyAction'
      | 'externalApproval'
      | 'model'
      | 'usage'
      | 'rawExternalResponse'
      | 'responseUnmaskingSnapshot'
      | 'responseUnmasking'
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

  function saveExternalPayloadPreviewForTurn(
    workspaceId: Workspace['id'],
    userMessageId: string,
    externalPayloadPreview: ExternalPayloadPreview,
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];

      return {
        ...currentSessions,
        [workspaceId]: sessionMessages.map((chatMessage) =>
          chatMessage.id === userMessageId
            ? { ...chatMessage, externalPayloadPreview }
            : chatMessage,
        ),
      };
    });
  }

  function logSecretDetection(preview: ExternalPayloadPreview): void {
    const matchedRuleIds = [
      ...new Set(
        preview.secretDetection.detections.map(
          (detection) => detection.ruleId,
        ),
      ),
    ];

    console.info('[Mimora Secret Detection]', {
      documents: preview.documentCount,
      detected: preview.secretDetection.detected,
      rulesMatched: matchedRuleIds.length,
      totalMatches: preview.secretDetection.totalCount,
      matchedRules: matchedRuleIds,
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

  function saveExternalApprovalForTurn(
    workspaceId: Workspace['id'],
    userMessageId: string,
    assistantMessageId: string,
    externalApproval: ExternalApprovalInfo,
  ): void {
    setChatSessions((currentSessions) => {
      const sessionMessages = currentSessions[workspaceId] ?? [];

      return {
        ...currentSessions,
        [workspaceId]: sessionMessages.map((chatMessage) =>
          chatMessage.id === userMessageId ||
          chatMessage.id === assistantMessageId
            ? { ...chatMessage, externalApproval }
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

  function setWorkspaceRequestStatus(
    workspaceId: Workspace['id'],
    status: ChatRequestStatus,
  ): void {
    workspaceRequestStatusesRef.current.set(workspaceId, status);
    setWorkspaceRequestStatuses((currentStatuses) => ({
      ...currentStatuses,
      [workspaceId]: status,
    }));
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
        isRecentChatsActive={activeView === 'recent-chats'}
        isVaultBrowserActive={activeView === 'vault-browser'}
        isSettingsActive={activeView === 'settings'}
        onOpenRecentChats={() => {
          setActiveView('recent-chats');
          setMessage('');
        }}
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
            : activeView === 'recent-chats'
              ? '최근 대화'
            : activeView === 'vault-browser'
              ? 'Vault Browser'
              : `${selectedWorkspace.label} 채팅`
        }
      >
        {activeView === 'settings' ? (
          <SettingsView />
        ) : activeView === 'recent-chats' ? (
          <RecentChatsView
            chatSessions={chatSessions}
            isLoading={chatHistoryStatus === 'loading'}
            onDeleteWorkspaceChat={handleDeleteWorkspaceChat}
            onOpenWorkspace={handleSelectWorkspace}
            storageError={chatHistoryError}
          />
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
              disabled={isSavingAIMode || isCurrentWorkspaceBusy}
              effectiveSecurity={currentSecurity}
              onChangeAIMode={(nextAIMode) => {
                void handleChangeAIMode(nextAIMode);
              }}
              workspaceLabel={selectedWorkspace.label}
            />
            <div className="message-area">
              {chatHistoryStatus === 'loading' ? (
                <p className="chat-history-loading">대화 기록을 불러오는 중입니다...</p>
              ) : currentMessages.length === 0 ? (
                <WelcomePanel onSelectPrompt={handleSelectPrompt} />
              ) : (
                <ChatMessages
                  messages={currentMessages}
                  onApproveExternal={handleApproveExternal}
                  onUseLocalAI={handleUseLocalAI}
                  workspaceId={selectedWorkspace.id}
                />
              )}
            </div>
            {chatHistoryStatus !== 'loading' ? (
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
                  requestStatus={currentWorkspaceRequestStatus}
                  ref={chatInputRef}
                  value={message}
                  onChange={setMessage}
                  onSubmit={handleSendMessage}
                />
              </div>
            ) : null}
          </>
        )}
      </main>
      <ContextPanel />
    </div>
  );
}
