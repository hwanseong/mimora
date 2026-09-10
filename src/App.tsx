import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChatSession,
  getMostRecentChatSession,
  isChatRequestBusy,
  sortChatSessions,
  tryBeginExternalAction,
  type ChatSession,
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
import { removeInternalContextIdentifiers } from './chatCitationCleanup';
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
import { DerivedKnowledgeDraftModal } from './components/DerivedKnowledgeDraftModal';
import { QuickPromptBar } from './components/QuickPromptBar';
import { RecentChatsView } from './components/RecentChatsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { VaultBrowserView } from './components/VaultBrowserView';
import { WelcomePanel } from './components/WelcomePanel';
import {
  createSelectableWorkspaces,
  createWorkspaceSections,
  defaultWorkspace,
  canAskWorkspaceQuestion,
  canReadWorkspaceSession,
  canWriteWorkspaceSession,
  isAllWorkspaceScope,
  toSelectableWorkspace,
  type Workspace,
} from './workspaces';
import {
  emptyKnowledgeSearchFilters,
  type KnowledgeSearchFilters,
} from './knowledgeSearch';
import type { KnowledgeDomain } from './registry/knowledgeDomainRegistryTypes';
import type { KnowledgeType } from './registry/knowledgeTypeRegistryTypes';
import type { RegistryRuntimeMode } from './registry/types';
import {
  createDerivedKnowledgeSuggestion,
  deriveSecurityFromSources,
  normalizeDerivedKnowledgeDraft,
  type DerivedKnowledgeDraft,
  type DerivedKnowledgeSource,
} from './derivedKnowledge';
import { parseMimoraDocumentMetadata } from './metadata/mimoraMetadataParser';
import type { DocumentSecurity } from './metadata/types';
import type { KnowledgeDomainRegistry } from './registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistry } from './registry/knowledgeTypeRegistryTypes';
import type { ContentOriginSearchScope } from './contentOrigin';
import {
  createKnowledgeSearchFiltersFromScope,
  createGlobalSearchScope,
  createSearchScopeSnapshot,
  selectSearchScopeHistoryMessages,
} from './searchScope';
import type {
  SearchScopeSettings,
  VaultConfig,
  VaultSecurity,
  VaultType,
} from './settings';
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
  type ResponseUnmaskingSnapshotEntry,
} from './security/responseUnmasking';
import type {
  ExternalAIPerformanceMetrics,
  ExternalAIChatResult,
} from './externalAI';
import type { RagDocumentSecurity, RagSearchResult } from './rag';
import type { ScheduleQueryResult } from './schedule';
import { formatScheduleDisplayValue } from './scheduleUx';

const RAG_CHAT_SEARCH_TOP_K = 5;
const RAG_CHAT_CONTEXT_LIMIT = 4;
const RAG_CONTEXT_SNIPPET_MAX_CHARS = 320;
const SCHEDULE_CONTEXT_SNIPPET_MAX_CHARS = 320;

type PendingExternalRequest = {
  sessionId: ChatSession['sessionId'];
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
  ragRetrievalMs?: number;
  ragRetrievalError?: string;
  inFlight: boolean;
};

export function App() {
  const [activeView, setActiveView] = useState<
    'chat' | 'recent-chats' | 'vault-browser' | 'settings'
  >('chat');
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Workspace>(defaultWorkspace);
  const [registryWorkspaces, setRegistryWorkspaces] = useState<Workspace[]>([]);
  const [registryRuntimeMode, setRegistryRuntimeMode] =
    useState<RegistryRuntimeMode>('unresolved');
  const [isWorkspaceRegistryUnavailable, setIsWorkspaceRegistryUnavailable] =
    useState(false);
  const [message, setMessage] = useState('');
  const [aiMode, setAIMode] = useState<AIMode>('auto');
  const [isSavingAIMode, setIsSavingAIMode] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScopeSettings>({
    includeArchived: false,
    contentOriginScope: 'all',
  });
  const [knowledgeSearchFilters, setKnowledgeSearchFilters] =
    useState<KnowledgeSearchFilters>(emptyKnowledgeSearchFilters);
  const [knowledgeDomainOptions, setKnowledgeDomainOptions] = useState<
    KnowledgeDomain[]
  >([]);
  const [knowledgeTypeOptions, setKnowledgeTypeOptions] = useState<
    KnowledgeType[]
  >([]);
  const [
    isKnowledgeDomainRegistryAvailable,
    setIsKnowledgeDomainRegistryAvailable,
  ] = useState(false);
  const [
    isKnowledgeTypeRegistryAvailable,
    setIsKnowledgeTypeRegistryAvailable,
  ] = useState(false);
  const [isSavingSearchScope, setIsSavingSearchScope] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessions>({});
  const [selectedSessionIds, setSelectedSessionIds] = useState<
    Record<string, string>
  >({});
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
  const [derivedDraft, setDerivedDraft] = useState<DerivedKnowledgeDraft | null>(
    null,
  );
  const [derivedDraftVaults, setDerivedDraftVaults] = useState<VaultConfig[]>(
    [],
  );
  const [derivedDraftError, setDerivedDraftError] = useState<string | null>(
    null,
  );
  const [derivedDraftSavedPath, setDerivedDraftSavedPath] = useState<
    string | null
  >(null);
  const [isSavingDerivedDraft, setIsSavingDerivedDraft] = useState(false);
  const [isCreateSessionDialogOpen, setIsCreateSessionDialogOpen] =
    useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionWorkspaceId, setNewSessionWorkspaceId] =
    useState<Workspace['id']>(selectedWorkspace.id);
  const [renameSessionDialog, setRenameSessionDialog] = useState<{
    workspaceId: Workspace['id'];
    sessionId: ChatSession['sessionId'];
    title: string;
  } | null>(null);
  const [deleteSessionDialog, setDeleteSessionDialog] = useState<{
    workspaceId: Workspace['id'];
    sessionId: ChatSession['sessionId'];
    title: string;
  } | null>(null);
  const workspaceRequestStatusesRef = useRef<Map<string, ChatRequestStatus>>(
    new Map(),
  );
  const [workspaceRequestStatuses, setWorkspaceRequestStatuses] = useState<
    Record<string, ChatRequestStatus>
  >({});
  const [vaultDocumentRefreshSignal, setVaultDocumentRefreshSignal] = useState(0);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const newSessionTitleInputRef = useRef<HTMLInputElement>(null);
  const appFocusAnchorRef = useRef<HTMLDivElement>(null);
  const workspaceSections = useMemo(
    () =>
      createWorkspaceSections({
        registryWorkspaces,
        registryUnavailable: isWorkspaceRegistryUnavailable,
      }),
    [isWorkspaceRegistryUnavailable, registryWorkspaces],
  );
  const selectableWorkspaces = useMemo(
    () => createSelectableWorkspaces(workspaceSections),
    [workspaceSections],
  );
  const sessionCreatableWorkspaces = useMemo(
    () => selectableWorkspaces.filter(canWriteWorkspaceSession),
    [selectableWorkspaces],
  );
  const currentWorkspaceSessions = useMemo(
    () => sortChatSessions(chatSessions[selectedWorkspace.id] ?? []),
    [chatSessions, selectedWorkspace.id],
  );
  const storedSelectedSessionId = selectedSessionIds[selectedWorkspace.id] ?? null;
  const selectedSessionId =
    storedSelectedSessionId &&
    currentWorkspaceSessions.some(
      (session) => session.sessionId === storedSelectedSessionId,
    )
      ? storedSelectedSessionId
      : getMostRecentChatSession(currentWorkspaceSessions)?.sessionId ?? null;
  const selectedSession =
    currentWorkspaceSessions.find(
      (session) => session.sessionId === selectedSessionId,
    ) ?? null;
  const currentMessages = selectedSession?.messages ?? [];
  const currentContexts = workspaceContexts[selectedWorkspace.id] ?? [];
  const globalSearchScope = useMemo(
    () =>
      createGlobalSearchScope(
        searchScope.includeArchived,
        knowledgeSearchFilters,
        searchScope.contentOriginScope,
      ),
    [
      knowledgeSearchFilters,
      searchScope.contentOriginScope,
      searchScope.includeArchived,
    ],
  );
  const currentWorkspaceRequestStatus =
    selectedSessionId
      ? workspaceRequestStatuses[selectedSessionId] ?? 'idle'
      : 'idle';
  const isCurrentWorkspaceBusy = isChatRequestBusy(
    currentWorkspaceRequestStatus,
  );
  const canCreateSessionInCurrentWorkspace =
    canWriteWorkspaceSession(selectedWorkspace);
  const canAskQuestionInCurrentWorkspace =
    canAskWorkspaceQuestion(selectedWorkspace);
  const composerDisabledMessage = !canAskQuestionInCurrentWorkspace
    ? '종료된 Workspace입니다. 기존 대화는 열람할 수 있지만 새 질문은 할 수 없습니다.'
    : undefined;
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
    if (
      activeView === 'chat' &&
      !selectableWorkspaces.some(
        (workspace) => workspace.id === selectedWorkspace.id,
      )
    ) {
      setSelectedWorkspace(defaultWorkspace);
      setMessage('');
    }
  }, [activeView, selectableWorkspaces, selectedWorkspace.id]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[Archived Debug]', {
        uiIncludeArchived: searchScope.includeArchived,
        uiContentOriginScope: searchScope.contentOriginScope,
      });
    }
  }, [searchScope.contentOriginScope, searchScope.includeArchived]);

  async function refreshWorkspaceRegistry(): Promise<void> {
    try {
      const workspaceRegistry = await window.mimora.loadWorkspaceRegistry();
      const loadedWorkspaces =
        workspaceRegistry.workspaces.map(toSelectableWorkspace);

      setRegistryWorkspaces(loadedWorkspaces);
      setRegistryRuntimeMode(workspaceRegistry.runtimeMode ?? 'unresolved');
      setIsWorkspaceRegistryUnavailable(
        workspaceRegistry.state !== 'loaded' && loadedWorkspaces.length === 0,
      );
    } catch {
      setRegistryWorkspaces([]);
      setRegistryRuntimeMode('unresolved');
      setIsWorkspaceRegistryUnavailable(true);
    }
  }

  function refreshVaultDocumentSnapshot(): void {
    setVaultDocumentRefreshSignal((currentSignal) => currentSignal + 1);
  }

  useEffect(() => {
    void refreshWorkspaceRegistry();
  }, []);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      window.mimora.loadKnowledgeDomainRegistry(),
      window.mimora.loadKnowledgeTypeRegistry(),
    ])
      .then(([domainRegistry, typeRegistry]) => {
        if (!isMounted) {
          return;
        }

        setKnowledgeDomainOptions(domainRegistry.domains);
        setKnowledgeTypeOptions(typeRegistry.types);
        setIsKnowledgeDomainRegistryAvailable(Boolean(domainRegistry.registry));
        setIsKnowledgeTypeRegistryAvailable(Boolean(typeRegistry.registry));
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setKnowledgeDomainOptions([]);
        setKnowledgeTypeOptions([]);
        setIsKnowledgeDomainRegistryAvailable(false);
        setIsKnowledgeTypeRegistryAvailable(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setSelectedWorkspace((currentWorkspace) => {
      if (currentWorkspace.id === defaultWorkspace.id) {
        return currentWorkspace;
      }

      return (
        selectableWorkspaces.find(
          (workspace) => workspace.id === currentWorkspace.id,
        ) ?? defaultWorkspace
      );
    });
  }, [selectableWorkspaces]);

  useEffect(() => {
    let isMounted = true;

    void window.mimora
      .getSettings()
      .then((settings) => {
        if (isMounted) {
          setAIMode(settings.aiMode);
          setSearchScope(settings.search);
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
        setSelectedSessionIds(
          Object.fromEntries(
            Object.entries(result.sessions).flatMap(
              ([workspaceId, sessions]) => {
                const recentSession = getMostRecentChatSession(sessions);

                return recentSession
                  ? [[workspaceId, recentSession.sessionId]]
                  : [];
              },
            ),
          ),
        );
        setChatHistoryError(result.error ?? null);
        setChatHistoryStatus(result.status === 'ready' ? 'ready' : 'error');
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setChatSessions({});
        setSelectedSessionIds({});
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

  useEffect(() => {
    if (!isCreateSessionDialogOpen) {
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      newSessionTitleInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isCreateSessionDialogOpen]);

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

  function getNextSessionSortOrder(workspaceId: Workspace['id']): number {
    const sessions = chatSessions[workspaceId] ?? [];

    return sessions.reduce(
      (maxSortOrder, session) => Math.max(maxSortOrder, session.sortOrder),
      -1,
    ) + 1;
  }

  function updateChatSession(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
    updater: (session: ChatSession) => ChatSession,
  ): void {
    setChatSessions((currentSessions) => {
      const workspaceSessions = currentSessions[workspaceId] ?? [];
      let changed = false;
      const nextWorkspaceSessions = workspaceSessions.map((session) => {
        if (session.sessionId !== sessionId) {
          return session;
        }

        changed = true;
        return updater(session);
      });

      return changed
        ? {
            ...currentSessions,
            [workspaceId]: nextWorkspaceSessions,
          }
        : currentSessions;
    });
  }

  function createSessionForWorkspace(
    workspaceId: Workspace['id'],
    title = '새 대화',
  ): ChatSession {
    const session = createChatSession({
      workspaceId,
      title,
      sortOrder: getNextSessionSortOrder(workspaceId),
    });

    setChatSessions((currentSessions) => ({
      ...currentSessions,
      [workspaceId]: [...(currentSessions[workspaceId] ?? []), session],
    }));
    setSelectedSessionIds((currentSessionIds) => ({
      ...currentSessionIds,
      [workspaceId]: session.sessionId,
    }));

    return session;
  }

  function getOrCreateCurrentSession(): ChatSession {
    if (selectedSession) {
      return selectedSession;
    }

    return createSessionForWorkspace(selectedWorkspace.id);
  }

  function appendMessagesToSession(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
    newMessages: ChatMessage[],
    fallbackSession?: ChatSession,
  ): void {
    setChatSessions((currentSessions) => {
      const workspaceSessions = currentSessions[workspaceId] ?? [];
      const targetSession = workspaceSessions.find(
        (session) => session.sessionId === sessionId,
      );
      const sessionToUpdate = targetSession ?? fallbackSession;

      if (!sessionToUpdate) {
        return currentSessions;
      }

      const updatedAt =
        newMessages.at(-1)?.createdAt ?? new Date().toISOString();
      const nextSession: ChatSession = {
        ...sessionToUpdate,
        updatedAt,
        messages: [...sessionToUpdate.messages, ...newMessages],
      };
      const nextWorkspaceSessions = targetSession
        ? workspaceSessions.map((session) =>
            session.sessionId === sessionId ? nextSession : session,
          )
        : [...workspaceSessions, nextSession];

      return {
        ...currentSessions,
        [workspaceId]: nextWorkspaceSessions,
      };
    });
  }

  function toDerivedSourceSecurity(input: {
    vaultType: VaultType;
    vaultSecurity: VaultSecurity;
    documentSecurity?: DocumentSecurity;
  }): 'normal' | 'private' {
    return input.documentSecurity === 'private' ||
      input.vaultType === 'private' ||
      input.vaultSecurity === 'personal' ||
      input.vaultSecurity === 'sensitive'
      ? 'private'
      : 'normal';
  }

  function getKnowledgeDomainRegistryForDraft(): KnowledgeDomainRegistry | null {
    return isKnowledgeDomainRegistryAvailable
      ? { version: 1, domains: knowledgeDomainOptions }
      : null;
  }

  function getKnowledgeTypeRegistryForDraft(): KnowledgeTypeRegistry | null {
    return isKnowledgeTypeRegistryAvailable
      ? { version: 1, types: knowledgeTypeOptions }
      : null;
  }

  function getManualContextMetadata(context: AttachedContext) {
    if (context.metadata) {
      return context.metadata;
    }

    return parseMimoraDocumentMetadata(context.content, {
      knowledgeDomainRegistry: getKnowledgeDomainRegistryForDraft(),
      knowledgeTypeRegistry: getKnowledgeTypeRegistryForDraft(),
    }).metadata;
  }

  function getRagVaultSecurity(
    security: RagDocumentSecurity,
  ): VaultSecurity {
    return security === 'personal' ? 'personal' : 'sensitive';
  }

  function getRagDocumentSecurity(
    security: RagDocumentSecurity,
  ): DocumentSecurity | undefined {
    if (security === 'private') {
      return 'private';
    }

    return security === 'internal' ? 'internal' : undefined;
  }

  function createRagContextDocumentKey(context: AutoRetrievedContext): string {
    if (context.sourceType === 'rag') {
      return JSON.stringify([
        'rag',
        context.ragDocumentId ?? context.relativePath,
        context.documentId,
        context.heading ?? '',
        context.page ?? '',
      ]);
    }

    return JSON.stringify([context.vaultId, context.relativePath]);
  }

  function toRagAutoContext(result: RagSearchResult): AutoRetrievedContext {
    const documentSecurity = getRagDocumentSecurity(result.security);

    return {
      sourceType: 'rag',
      documentId: result.chunkId,
      ragDocumentId: result.ragDocumentId,
      workspaceIds: result.workspaceIds,
      originWorkspaceId: result.workspaceIds[0] ?? null,
      ...(documentSecurity ? { documentSecurity } : {}),
      vaultId: 'rag-library',
      vaultName: 'RAG Library',
      vaultType: 'knowledge',
      security: getRagVaultSecurity(result.security),
      relativePath: `rag://${result.ragDocumentId}/${result.chunkId}`,
      fileName: result.filename,
      score: result.adjustedScore ?? result.score,
      snippet: result.text.slice(0, RAG_CONTEXT_SNIPPET_MAX_CHARS),
      content: result.text,
      page: result.page,
      heading: result.heading,
    };
  }

  async function retrieveRagChatContext(input: {
    query: string;
    workspaceId: Workspace['id'];
    workspaceType: Workspace['type'];
  }): Promise<{
    contexts: AutoRetrievedContext[];
    elapsedMs: number;
    error?: string;
  }> {
    const startedTime = performance.now();
    const workspaceIds = isAllWorkspaceScope(input.workspaceId)
      ? []
      : [input.workspaceId];
    const security: RagDocumentSecurity =
      input.workspaceType === 'private' ? 'private' : 'internal';

    try {
      const results = await window.mimora.searchRagDocuments({
        query: input.query,
        workspaceIds,
        includeGlobal: true,
        security,
        topK: RAG_CHAT_SEARCH_TOP_K,
      });
      const contexts = results
        .slice(0, RAG_CHAT_CONTEXT_LIMIT)
        .map(toRagAutoContext);

      console.info('[Mimora RAG Chat Retrieval]', {
        queryChars: input.query.length,
        workspaceScope: workspaceIds.length > 0 ? workspaceIds : ['global'],
        hitCount: results.length,
        selectedContextCount: contexts.length,
        ragDocumentIds: [
          ...new Set(contexts.map((context) => context.ragDocumentId)),
        ],
      });

      return {
        contexts,
        elapsedMs: performance.now() - startedTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'RAG context retrieval failed.';

      console.warn('[Mimora RAG Chat Retrieval] Failed.', {
        queryChars: input.query.length,
        workspaceScope: workspaceIds.length > 0 ? workspaceIds : ['global'],
        error: errorMessage,
      });

      return {
        contexts: [],
        elapsedMs: performance.now() - startedTime,
        error: errorMessage,
      };
    }
  }

  function isScheduleQuestion(query: string): boolean {
    return /일정|진척|진도|지연|지체|착수|완료\s*예정|종료\s*예정|계획보다|계획\s*종료일|지킬\s*수|wbs|담당자|담당|작업|선행|후행|의존성|영향|성과|추세|예상|언제\s*(끝|완료)|schedule|progress|delay|delayed|task|resource|dependency|impact|forecast|estimate|earned\s*schedule/iu.test(
      query,
    );
  }

  function toScheduleAutoContext(
    result: ScheduleQueryResult,
  ): AutoRetrievedContext {
    return {
      sourceType: 'schedule',
      documentId: `schedule:${result.workspaceId}`,
      workspaceIds: [result.workspaceId],
      originWorkspaceId: result.workspaceId,
      documentSecurity: 'internal',
      vaultId: 'schedule-intelligence',
      vaultName: 'Schedule Intelligence',
      vaultType: 'knowledge',
      security: 'sensitive',
      relativePath: `schedule://${result.workspaceId}/${result.filename}`,
      fileName: result.filename,
      score: 1,
      snippet: result.contextText.slice(0, SCHEDULE_CONTEXT_SNIPPET_MAX_CHARS),
      content: result.contextText,
      heading: `기준일: ${result.asOfDate} / 분석: ${formatScheduleDisplayValue(result.kind)}`,
    };
  }

  function toMissingScheduleAutoContext(input: {
    workspaceId: Workspace['id'];
    query: string;
  }): AutoRetrievedContext {
    const content = [
      '[SCHEDULE ANALYSIS]',
      'Type: schedule_source_missing',
      '이 Workspace에 연결된 일정 파일이 없습니다.',
      'Settings > Schedule Intelligence에서 Schedule Excel을 먼저 등록해야 일정 분석을 수행할 수 있습니다.',
      `User Question: ${input.query}`,
      '[/SCHEDULE ANALYSIS]',
    ].join('\n');

    return {
      sourceType: 'schedule',
      documentId: `schedule:${input.workspaceId}:missing`,
      workspaceIds: [input.workspaceId],
      originWorkspaceId: input.workspaceId,
      documentSecurity: 'internal',
      vaultId: 'schedule-intelligence',
      vaultName: 'Schedule Intelligence',
      vaultType: 'knowledge',
      security: 'sensitive',
      relativePath: `schedule://${input.workspaceId}/not-connected`,
      fileName: '일정 파일 미연결',
      score: 1,
      snippet: content.slice(0, SCHEDULE_CONTEXT_SNIPPET_MAX_CHARS),
      content,
      heading: '이 Workspace에 연결된 일정 파일이 없습니다.',
    };
  }

  async function retrieveScheduleChatContext(input: {
    query: string;
    workspaceId: Workspace['id'];
  }): Promise<{
    contexts: AutoRetrievedContext[];
    elapsedMs: number;
    error?: string;
  }> {
    const startedTime = performance.now();

    if (isAllWorkspaceScope(input.workspaceId) || !isScheduleQuestion(input.query)) {
      return {
        contexts: [],
        elapsedMs: performance.now() - startedTime,
      };
    }

    try {
      const source = await window.mimora.getScheduleSource(input.workspaceId);

      if (!source) {
        return {
          contexts: [
            toMissingScheduleAutoContext({
              workspaceId: input.workspaceId,
              query: input.query,
            }),
          ],
          elapsedMs: performance.now() - startedTime,
        };
      }

      const result = await window.mimora.querySchedule({
        workspaceId: input.workspaceId,
        query: input.query,
      });
      const context = toScheduleAutoContext(result);

      console.info('[Mimora Schedule Chat Retrieval]', {
        queryChars: input.query.length,
        workspaceId: input.workspaceId,
        source: result.filename,
        kind: result.kind,
        selectedTaskCount: result.tasks.length,
        lastParsedAt: result.lastParsedAt,
      });

      return {
        contexts: [context],
        elapsedMs: performance.now() - startedTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Schedule context retrieval failed.';

      console.warn('[Mimora Schedule Chat Retrieval] Failed.', {
        queryChars: input.query.length,
        workspaceId: input.workspaceId,
        error: errorMessage,
      });

      return {
        contexts: [],
        elapsedMs: performance.now() - startedTime,
        error: errorMessage,
      };
    }
  }

  function createDerivedSources(
    manualContexts: AttachedContext[],
    autoContexts: AutoRetrievedContext[],
    assistantSources: LLMContextSource[],
  ): DerivedKnowledgeSource[] {
    const sources = new Map<string, DerivedKnowledgeSource>();

    for (const context of manualContexts) {
      const metadata = getManualContextMetadata(context);
      const source: DerivedKnowledgeSource = {
        vaultId: context.vaultId,
        ...(metadata.documentId ? { documentId: metadata.documentId } : {}),
        relativePath: context.relativePath,
        workspaceIds: metadata.workspaceIds,
        originWorkspaceId: metadata.originWorkspaceId ?? null,
        knowledgeDomains: metadata.knowledgeDomains,
        knowledgeTypes: metadata.knowledgeTypes,
        security: toDerivedSourceSecurity({
          vaultType: context.vaultType,
          vaultSecurity: context.security,
          documentSecurity: metadata.security,
        }),
      };

      sources.set(`${source.vaultId}:${source.relativePath}`, source);
    }

    for (const context of autoContexts) {
      const source: DerivedKnowledgeSource = {
        vaultId: context.vaultId,
        ...(context.mimoraDocumentId
          ? { documentId: context.mimoraDocumentId }
          : context.metadata?.documentId
            ? { documentId: context.metadata.documentId }
            : {}),
        relativePath: context.relativePath,
        workspaceIds: context.metadata?.workspaceIds ?? context.workspaceIds,
        originWorkspaceId:
          context.metadata?.originWorkspaceId ?? context.originWorkspaceId ?? null,
        knowledgeDomains: context.metadata?.knowledgeDomains ?? [],
        knowledgeTypes: context.metadata?.knowledgeTypes ?? [],
        security: toDerivedSourceSecurity({
          vaultType: context.vaultType,
          vaultSecurity: context.security,
          documentSecurity: context.metadata?.security,
        }),
      };

      sources.set(`${source.vaultId}:${source.relativePath}`, source);
    }

    for (const context of assistantSources) {
      const source: DerivedKnowledgeSource = {
        vaultId: context.vaultId,
        ...(context.metadata?.documentId
          ? { documentId: context.metadata.documentId }
          : {}),
        relativePath: context.relativePath,
        workspaceIds: context.metadata?.workspaceIds ?? [],
        originWorkspaceId: context.metadata?.originWorkspaceId ?? null,
        knowledgeDomains: context.metadata?.knowledgeDomains ?? [],
        knowledgeTypes: context.metadata?.knowledgeTypes ?? [],
        security: toDerivedSourceSecurity({
          vaultType: context.vaultType,
          vaultSecurity: context.security,
          documentSecurity: context.metadata?.security,
        }),
      };

      if (!sources.has(`${source.vaultId}:${source.relativePath}`)) {
        sources.set(`${source.vaultId}:${source.relativePath}`, source);
      }
    }

    return [...sources.values()];
  }

  function getFirstEligibleTargetVaultId(
    vaults: VaultConfig[],
    sources: DerivedKnowledgeSource[],
  ): string {
    const security = deriveSecurityFromSources(sources);
    const candidates =
      security === 'private'
        ? vaults.filter(
            (vault) => vault.type === 'private' || vault.security !== 'internal',
          )
        : vaults;
    const sourceVault = candidates.find((vault) =>
      sources.some((source) => source.vaultId === vault.id),
    );

    return sourceVault?.id ?? candidates[0]?.id ?? '';
  }

  function createDerivedDraftFromTurn(input: {
    workspaceId: Workspace['id'];
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    vaults: VaultConfig[];
  }): DerivedKnowledgeDraft {
    const manualContexts = input.userMessage.manualContext ?? [];
    const autoContexts = input.userMessage.autoContext ?? [];
    const assistantSources = input.assistantMessage.sources ?? [];
    const sourceDocuments = createDerivedSources(
      manualContexts,
      autoContexts,
      assistantSources,
    );
    const sourceMetadata = autoContexts
      .map((context) => context.metadata)
      .filter((metadata): metadata is NonNullable<typeof metadata> =>
        Boolean(metadata),
      );
    const manualMetadata = manualContexts.map(getManualContextMetadata);
    const assistantSourceMetadata = assistantSources
      .map((context) => context.metadata)
      .filter((metadata): metadata is NonNullable<typeof metadata> =>
        Boolean(metadata),
      );
    const allMetadata = [
      ...sourceMetadata,
      ...manualMetadata,
      ...assistantSourceMetadata,
    ];
    const snapshot = input.userMessage.searchScopeSnapshot;

    return createDerivedKnowledgeSuggestion({
      question: input.userMessage.content,
      content: input.assistantMessage.content,
      sourceDocuments,
      sourceMetadata: allMetadata,
      knowledgeDomainRegistry: getKnowledgeDomainRegistryForDraft(),
      knowledgeTypeRegistry: getKnowledgeTypeRegistryForDraft(),
      fallbackWorkspaceId: !isAllWorkspaceScope(input.workspaceId)
        ? input.workspaceId
        : null,
      fallbackKnowledgeDomain: snapshot?.domain ?? null,
      fallbackKnowledgeType: snapshot?.type ?? null,
      targetVaultId: getFirstEligibleTargetVaultId(
        input.vaults,
        sourceDocuments,
      ),
    });
  }

  function handleSelectWorkspace(workspace: Workspace): void {
    if (!canReadWorkspaceSession(workspace)) {
      return;
    }

    setSelectedWorkspace(workspace);
    setSelectedSessionIds((currentSessionIds) => {
      if (currentSessionIds[workspace.id]) {
        return currentSessionIds;
      }

      const recentSession = getMostRecentChatSession(
        chatSessions[workspace.id] ?? [],
      );

      return recentSession
        ? {
            ...currentSessionIds,
            [workspace.id]: recentSession.sessionId,
          }
        : currentSessionIds;
    });
    setActiveView('chat');
    setMessage('');
  }

  function handleSelectSession(
    workspace: Workspace,
    sessionId: ChatSession['sessionId'],
  ): void {
    if (!canReadWorkspaceSession(workspace)) {
      return;
    }

    if (
      !(chatSessions[workspace.id] ?? []).some(
        (session) => session.sessionId === sessionId,
      )
    ) {
      return;
    }

    setSelectedWorkspace(workspace);
    setSelectedSessionIds((currentSessionIds) => ({
      ...currentSessionIds,
      [workspace.id]: sessionId,
    }));
    setActiveView('chat');
    setMessage('');
  }

  function openCreateSessionDialog(workspaceId = selectedWorkspace.id): void {
    const workspace =
      selectableWorkspaces.find((item) => item.id === workspaceId) ??
      selectedWorkspace;

    if (!canWriteWorkspaceSession(workspace)) {
      return;
    }

    setRenameSessionDialog(null);
    setDeleteSessionDialog(null);
    setNewSessionTitle('');
    setNewSessionWorkspaceId(workspace.id);
    setIsCreateSessionDialogOpen(true);
  }

  function closeCreateSessionDialog(): void {
    setIsCreateSessionDialogOpen(false);
    setNewSessionTitle('');
    setNewSessionWorkspaceId(selectedWorkspace.id);
  }

  function submitCreateSession(): void {
    if (!isCreateSessionDialogOpen) {
      return;
    }

    const workspace = selectableWorkspaces.find(
      (item) => item.id === newSessionWorkspaceId,
    );

    if (!workspace || !canWriteWorkspaceSession(workspace)) {
      closeCreateSessionDialog();
      return;
    }

    const session = createSessionForWorkspace(
      workspace.id,
      newSessionTitle,
    );

    setSelectedWorkspace(workspace);
    setSelectedSessionIds((currentSessionIds) => ({
      ...currentSessionIds,
      [workspace.id]: session.sessionId,
    }));
    setActiveView('chat');
    setMessage('');
    setIsCreateSessionDialogOpen(false);
    setNewSessionTitle('');
    setNewSessionWorkspaceId(workspace.id);
  }

  function openRenameSessionDialog(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
  ): void {
    const session = (chatSessions[workspaceId] ?? []).find(
      (item) => item.sessionId === sessionId,
    );

    if (!session) {
      return;
    }

    setIsCreateSessionDialogOpen(false);
    setNewSessionTitle('');
    setDeleteSessionDialog(null);
    setRenameSessionDialog({
      workspaceId,
      sessionId,
      title: session.title,
    });
  }

  function closeRenameSessionDialog(): void {
    setRenameSessionDialog(null);
  }

  function submitRenameSession(): void {
    if (!renameSessionDialog) {
      return;
    }

    const nextTitle = renameSessionDialog.title.trim();

    if (!nextTitle) {
      return;
    }

    const session = (chatSessions[renameSessionDialog.workspaceId] ?? []).find(
      (item) => item.sessionId === renameSessionDialog.sessionId,
    );

    if (!session) {
      closeRenameSessionDialog();
      return;
    }

    updateChatSession(
      renameSessionDialog.workspaceId,
      renameSessionDialog.sessionId,
      (currentSession) => ({
        ...currentSession,
        title: nextTitle,
        updatedAt: new Date().toISOString(),
      }),
    );
    closeRenameSessionDialog();
  }

  function openDeleteSessionDialog(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
  ): void {
    const workspaceSessions = chatSessions[workspaceId] ?? [];
    const session = workspaceSessions.find(
      (item) => item.sessionId === sessionId,
    );

    if (!session) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsCreateSessionDialogOpen(false);
    setRenameSessionDialog(null);
    setDeleteSessionDialog({
      workspaceId,
      sessionId,
      title: session.title,
    });
  }

  function closeDeleteSessionDialog(): void {
    setDeleteSessionDialog(null);
  }

  function confirmDeleteSession(): void {
    if (!deleteSessionDialog) {
      return;
    }

    const { workspaceId, sessionId } = deleteSessionDialog;

    closeDeleteSessionDialog();
    deleteChatSession(workspaceId, sessionId);

    window.requestAnimationFrame(() => {
      appFocusAnchorRef.current?.focus();
    });
  }

  function deleteChatSession(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
  ): void {
    const workspaceSessions = chatSessions[workspaceId] ?? [];
    const session = workspaceSessions.find(
      (item) => item.sessionId === sessionId,
    );

    if (!session) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    pendingExternalRequestsRef.current.forEach((request, messageId) => {
      if (request.sessionId === sessionId) {
        pendingExternalRequestsRef.current.delete(messageId);
      }
    });
    workspaceRequestStatusesRef.current.delete(sessionId);
    setWorkspaceRequestStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      delete nextStatuses[sessionId];
      return nextStatuses;
    });
    setRenameSessionDialog((currentDialog) =>
      currentDialog?.sessionId === sessionId ? null : currentDialog,
    );
    setDeleteSessionDialog((currentDialog) =>
      currentDialog?.sessionId === sessionId ? null : currentDialog,
    );
    setChatSessions((currentSessions) => {
      const nextWorkspaceSessions = (currentSessions[workspaceId] ?? []).filter(
        (item) => item.sessionId !== sessionId,
      );
      const nextSessions = { ...currentSessions };

      if (nextWorkspaceSessions.length > 0) {
        nextSessions[workspaceId] = nextWorkspaceSessions;
      } else {
        delete nextSessions[workspaceId];
      }

      return nextSessions;
    });
    setSelectedSessionIds((currentSessionIds) => {
      const nextSessionIds = { ...currentSessionIds };
      const nextSession = getMostRecentChatSession(
        workspaceSessions.filter((item) => item.sessionId !== sessionId),
      );

      if (nextSession) {
        nextSessionIds[workspaceId] = nextSession.sessionId;
      } else {
        delete nextSessionIds[workspaceId];
      }

      return nextSessionIds;
    });
  }

  function reorderChatSession(
    workspaceId: Workspace['id'],
    draggedSessionId: ChatSession['sessionId'],
    targetSessionId: ChatSession['sessionId'],
  ): void {
    if (draggedSessionId === targetSessionId) {
      return;
    }

    setChatSessions((currentSessions) => {
      const workspaceSessions = sortChatSessions(
        currentSessions[workspaceId] ?? [],
      );
      const draggedIndex = workspaceSessions.findIndex(
        (session) => session.sessionId === draggedSessionId,
      );
      const targetIndex = workspaceSessions.findIndex(
        (session) => session.sessionId === targetSessionId,
      );

      if (draggedIndex < 0 || targetIndex < 0) {
        return currentSessions;
      }

      const nextWorkspaceSessions = [...workspaceSessions];
      const [draggedSession] = nextWorkspaceSessions.splice(draggedIndex, 1);

      nextWorkspaceSessions.splice(targetIndex, 0, draggedSession);

      return {
        ...currentSessions,
        [workspaceId]: nextWorkspaceSessions.map((session, index) => ({
          ...session,
          sortOrder: index,
        })),
      };
    });
  }

  async function handleCreateDerivedKnowledgeDraft(
    assistantMessageId: string,
  ): Promise<void> {
    const sessionMessages = currentMessages;
    const assistantIndex = sessionMessages.findIndex(
      (chatMessage) => chatMessage.id === assistantMessageId,
    );
    const assistantMessage = sessionMessages[assistantIndex];
    const userMessage = [...sessionMessages.slice(0, assistantIndex)]
      .reverse()
      .find((chatMessage) => chatMessage.role === 'user');

    if (!assistantMessage || assistantMessage.role !== 'assistant' || !userMessage) {
      return;
    }

    setDerivedDraftError(null);
    setDerivedDraftSavedPath(null);

    try {
      const settings = await window.mimora.getSettings();
      const draft = createDerivedDraftFromTurn({
        workspaceId: selectedWorkspace.id,
        userMessage,
        assistantMessage,
        vaults: settings.vaults,
      });

      if (import.meta.env.DEV) {
        const manualContextCount = userMessage.manualContext?.length ?? 0;
        const autoContextCount = userMessage.autoContext?.length ?? 0;
        const sourceCount = assistantMessage.sources?.length ?? 0;
        const actualContextDocumentCount = new Set(
          [
            ...(userMessage.manualContext ?? []),
            ...(userMessage.autoContext ?? []),
            ...(assistantMessage.sources ?? []),
          ].map((context) =>
            JSON.stringify([context.vaultId, context.relativePath]),
          ),
        ).size;

        console.info('[AI Wiki Draft Diagnostic]', {
          turnId: assistantMessage.id,
          sources: sourceCount,
          autoContext: autoContextCount,
          manualContext: manualContextCount,
          actualContextDocuments: actualContextDocumentCount,
          draftSourceDocuments: draft.sourceDocuments.length,
        });
      }

      setDerivedDraftVaults(settings.vaults);
      setDerivedDraft(draft);
    } catch (error) {
      setDerivedDraftError(
        error instanceof Error
          ? error.message
          : 'AI Wiki Draft를 만들지 못했습니다.',
      );
    }
  }

  async function handleSaveDerivedKnowledgeDraft(): Promise<void> {
    if (!derivedDraft) {
      return;
    }

    setIsSavingDerivedDraft(true);
    setDerivedDraftError(null);
    setDerivedDraftSavedPath(null);

    try {
      const result = await window.mimora.saveDerivedKnowledgeDraft(
        normalizeDerivedKnowledgeDraft(derivedDraft),
      );

      setDerivedDraftSavedPath(result.relativePath);
    } catch (error) {
      setDerivedDraftError(
        error instanceof Error
          ? error.message
          : 'AI Wiki Draft를 저장하지 못했습니다.',
      );
    } finally {
      setIsSavingDerivedDraft(false);
    }
  }

  function handleSendMessage(): void {
    const endToEndStartedTime = performance.now();
    const trimmedMessage = message.trim();

    if (
      !trimmedMessage ||
      isChatRequestBusy(
        selectedSessionId
          ? workspaceRequestStatusesRef.current.get(selectedSessionId) ?? 'idle'
          : 'idle',
      )
    ) {
      return;
    }

    if (!canAskQuestionInCurrentWorkspace) {
      return;
    }

    const targetSession = getOrCreateCurrentSession();

    const targetWorkspaceId = selectedWorkspace.id;
    const targetWorkspaceType = selectedWorkspace.type;
    const targetSessionId = targetSession.sessionId;
    const targetAIMode = aiMode;
    const isAllWorkspaceRequest = isAllWorkspaceScope(targetWorkspaceId);
    const targetGlobalSearchScope = createGlobalSearchScope(
      isAllWorkspaceRequest && globalSearchScope.includeArchived,
      isAllWorkspaceRequest
        ? createKnowledgeSearchFiltersFromScope(globalSearchScope)
        : emptyKnowledgeSearchFilters,
      isAllWorkspaceRequest ? globalSearchScope.contentOriginScope : 'all',
    );
    const targetIncludeArchived = targetGlobalSearchScope.includeArchived;
    const targetKnowledgeFilters =
      createKnowledgeSearchFiltersFromScope(targetGlobalSearchScope);
    const targetSearchScopeSnapshot =
      createSearchScopeSnapshot(targetGlobalSearchScope);

    const previousMessages = selectSearchScopeHistoryMessages(
      targetSession.messages,
      targetSearchScopeSnapshot,
      RECENT_HISTORY_MESSAGE_LIMIT,
    );

    if (import.meta.env.DEV) {
      console.info('[Mimora Search Scope]', {
        workspaceId: targetWorkspaceId,
        includeArchived: targetSearchScopeSnapshot.includeArchived,
        domain: targetSearchScopeSnapshot.domain,
        type: targetSearchScopeSnapshot.type,
        contentOriginScope: targetSearchScopeSnapshot.contentOriginScope,
        scopedHistoryMessages: previousMessages.length,
      });
      console.info('[Archived Debug]', {
        stage: 'sendMessage',
        workspaceId: targetWorkspaceId,
        uiIncludeArchived: searchScope.includeArchived,
        requestIncludeArchived: targetIncludeArchived,
        requestContentOriginScope: targetSearchScopeSnapshot.contentOriginScope,
        questionContainsArchivedMarker:
          trimmedMessage.includes('ARCHIVED-ONLY-777'),
      });
    }

    const manualContexts = [
      ...(workspaceContextsRef.current[targetWorkspaceId] ?? []),
    ];
    const userMessage: ChatMessage = {
      ...createMessage('user', trimmedMessage),
      autoContext: [],
      autoContextStatus: 'loading',
      manualContext: manualContexts,
      requestedMode: targetAIMode,
      searchScopeSnapshot: targetSearchScopeSnapshot,
    };
    const assistantMessage: ChatMessage = {
      ...createMessage('assistant', '참고 문서를 찾는 중입니다...'),
      requestStatus: 'retrieving-context',
      requestedMode: targetAIMode,
      searchScopeSnapshot: targetSearchScopeSnapshot,
      generationStatus: 'loading',
    };

    setWorkspaceRequestStatus(targetSessionId, 'retrieving-context');
    appendMessagesToSession(targetWorkspaceId, targetSessionId, [
      userMessage,
      assistantMessage,
    ], targetSession);
    setMessage('');

    void completeChatRequest(
      targetSessionId,
      targetWorkspaceId,
      targetWorkspaceType,
      targetAIMode,
      userMessage.id,
      assistantMessage.id,
      trimmedMessage,
      previousMessages,
      manualContexts,
      targetIncludeArchived,
      targetKnowledgeFilters,
      targetSearchScopeSnapshot.contentOriginScope,
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
      ...('sourceType' in context && context.sourceType
        ? { sourceType: context.sourceType }
        : {}),
      vaultId: context.vaultId,
      vaultName: context.vaultName,
      vaultType: context.vaultType,
      security: context.security,
      ...('documentSecurity' in context && context.documentSecurity
        ? { documentSecurity: context.documentSecurity }
        : {}),
      relativePath: context.relativePath,
      fileName: context.fileName,
      ...('snippet' in context ? { snippet: context.snippet } : {}),
      ...('metadata' in context && context.metadata
        ? { metadata: context.metadata }
        : {}),
      ...('ragDocumentId' in context && context.ragDocumentId
        ? { ragDocumentId: context.ragDocumentId }
        : {}),
      ...('page' in context ? { page: context.page } : {}),
      ...('heading' in context ? { heading: context.heading } : {}),
      ...('score' in context ? { relevanceScore: context.score } : {}),
      content: context.content,
    };
  }

  function getContextSources(
    manualContexts: AttachedContext[],
    autoContexts: AutoRetrievedContext[],
  ): LLMContextSource[] {
    const seenDocuments = new Set<string>();

    return [...manualContexts, ...autoContexts].flatMap((context) => {
      const documentKey =
        'sourceType' in context && context.sourceType === 'rag'
          ? createRagContextDocumentKey(context)
          : JSON.stringify([context.vaultId, context.relativePath]);

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
          ...('documentSecurity' in context && context.documentSecurity
            ? { documentSecurity: context.documentSecurity }
            : {}),
          ...('sourceType' in context && context.sourceType
            ? { sourceType: context.sourceType }
            : {}),
        relativePath: context.relativePath,
        fileName: context.fileName,
        ...('ragDocumentId' in context && context.ragDocumentId
          ? { ragDocumentId: context.ragDocumentId }
          : {}),
        ...('page' in context ? { page: context.page } : {}),
        ...('heading' in context ? { heading: context.heading } : {}),
        ...('metadata' in context && context.metadata
          ? { metadata: context.metadata }
          : {}),
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
    sessionId: ChatSession['sessionId'];
    workspaceId: Workspace['id'];
    assistantMessageId: string;
    query: string;
    previousMessages: ChatMessage[];
    manualContexts: AttachedContext[];
    autoContexts: AutoRetrievedContext[];
    routingDecision: RoutingDecision;
    retrievalMs: number;
    ragRetrievalMs?: number;
    ragRetrievalError?: string;
    totalElapsedMs: () => number;
  }): Promise<void> {
    setWorkspaceRequestStatus(input.sessionId, 'calling-local');
    completeAssistantMessage(input.workspaceId, input.sessionId, input.assistantMessageId, {
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
      ragRetrievalMs: input.ragRetrievalMs,
      ragRetrievalError: input.ragRetrievalError,
      totalElapsedMs: input.totalElapsedMs(),
    };

    console.info('[Mimora Performance]', {
      workspaceId: input.workspaceId,
      queryChars: metrics.queryChars,
      retrieval: { ms: metrics.retrievalMs },
      ragRetrieval: {
        contexts: metrics.ragContextCount,
        ms: metrics.ragRetrievalMs,
        error: metrics.ragRetrievalError,
      },
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

    completeAssistantMessage(input.workspaceId, input.sessionId, input.assistantMessageId, {
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
    setWorkspaceRequestStatus(input.sessionId, 'completed');
  }

  async function executeOpenAIRequest(
    request: PendingExternalRequest,
    routingDecision: RoutingDecision,
  ): Promise<void> {
    if (
      request.preview.documents.some(
        (document) =>
          document.documentSecurity === 'private' ||
          document.metadata?.security === 'private',
      )
    ) {
      throw new Error('Private 문서가 포함되어 외부 AI로 전송할 수 없습니다.');
    }

    setWorkspaceRequestStatus(request.sessionId, 'calling-external');
    completeAssistantMessage(request.workspaceId, request.sessionId, request.assistantMessageId, {
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
        documentSecurity: document.documentSecurity,
        relativePath: document.relativePath,
        fileName: document.fileName,
        metadata: document.metadata,
      })),
      maskingSnapshot: request.responseUnmaskingSnapshot,
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

    completeAssistantMessage(request.workspaceId, request.sessionId, request.assistantMessageId, {
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
    setWorkspaceRequestStatus(request.sessionId, 'completed');
  }

  async function completeChatRequest(
    sessionId: ChatSession['sessionId'],
    workspaceId: Workspace['id'],
    workspaceType: Workspace['type'],
    requestAIMode: AIMode,
    userMessageId: string,
    assistantMessageId: string,
    query: string,
    previousMessages: ChatMessage[],
    manualContexts: AttachedContext[],
    includeArchived: boolean,
    knowledgeFilters: KnowledgeSearchFilters,
    contentOriginScope: ContentOriginSearchScope,
    endToEndStartedTime: number,
  ): Promise<void> {
    let autoContext: AutoRetrievedContext[] = [];
    let autoContextError: string | undefined;
    let ragContext: AutoRetrievedContext[] = [];
    let ragRetrievalMs: number | undefined;
    let ragRetrievalError: string | undefined;
    const retrievalStartedTime = performance.now();

    try {
      if (import.meta.env.DEV) {
        console.info('[Archived Debug]', {
          stage: 'retrieveAutoContext:renderer',
          workspaceId,
          requestIncludeArchived: includeArchived,
          retrievalIncludeArchived: includeArchived,
          contentOriginScope,
          questionContainsArchivedMarker: query.includes('ARCHIVED-ONLY-777'),
        });
      }

      autoContext = await window.mimora.retrieveAutoContext({
        query,
        workspaceId,
        limit: 5,
        includeArchived,
        knowledgeFilters,
        contentOriginScope,
      });
    } catch (error) {
      autoContextError =
        error instanceof Error
          ? error.message
          : '자동 참조 문서를 검색하지 못했습니다.';
    }
    const ragRetrieval = await retrieveRagChatContext({
      query,
      workspaceId,
      workspaceType,
    });
    ragContext = ragRetrieval.contexts;
    ragRetrievalMs = ragRetrieval.elapsedMs;
    ragRetrievalError = ragRetrieval.error;

    const combinedAutoContext = [...autoContext, ...ragContext];
    const scheduleForcesLocal =
      !isAllWorkspaceScope(workspaceId) && isScheduleQuestion(query);
    const retrievalMs = performance.now() - retrievalStartedTime;

    completeAutoContextRetrieval(
      workspaceId,
      sessionId,
      userMessageId,
      combinedAutoContext,
      autoContextError,
    );

    let preview: ExternalPayloadPreview | undefined;
    let responseUnmaskingSnapshot: ResponseUnmaskingSnapshotEntry[] = [];
    let externalAvailable = false;
    let externalPreparationError: string | undefined;

    if (requestAIMode !== 'local' && !scheduleForcesLocal) {
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
          model: settings.externalAI.model,
          question: query,
          manualContexts,
          autoContexts: autoContext,
          maskingEntries: settings.masking.entries,
          registryWorkspaces,
          secretRules: getSecretRules(
            settings.secretDetection.customRules,
          ),
        });
        responseUnmaskingSnapshot = preview.responseUnmaskingSnapshot;
        logSecretDetection(preview);
        externalAvailable = Boolean(
          settings.externalAI.model && hasApiKey,
        );
        saveExternalPayloadPreviewForTurn(
          workspaceId,
          sessionId,
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
      mode: scheduleForcesLocal ? 'local' : requestAIMode,
      workspaceType,
      manualContexts,
      autoContexts: combinedAutoContext,
      safetyStatus: preview?.status,
      externalAvailable,
    });

    saveRoutingDecisionForTurn(
      workspaceId,
      sessionId,
      userMessageId,
      assistantMessageId,
      routingDecision,
    );

    if (preview && routingDecision.provider === 'local') {
      saveExternalApprovalForTurn(
        workspaceId,
        sessionId,
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
      ragContext: ragContext.length,
      ragDocumentIds: [
        ...new Set(ragContext.map((context) => context.ragDocumentId)),
      ],
    });

    try {
      if (routingDecision.provider === 'local') {
        const scheduleRetrieval = scheduleForcesLocal
          ? await retrieveScheduleChatContext({
              query,
              workspaceId,
            })
          : { contexts: [], elapsedMs: 0 };
        const localAutoContexts = [
          ...combinedAutoContext,
          ...scheduleRetrieval.contexts,
        ];

        if (scheduleForcesLocal) {
          console.info('[Mimora Schedule Routing]', {
            workspaceId,
            contextCount: scheduleRetrieval.contexts.length,
            elapsedMs: scheduleRetrieval.elapsedMs,
            error: 'error' in scheduleRetrieval ? scheduleRetrieval.error : undefined,
          });
        }

        await executeLocalAIRequest({
          sessionId,
          workspaceId,
          assistantMessageId,
          query,
          previousMessages,
          manualContexts,
          autoContexts: localAutoContexts,
          routingDecision,
          retrievalMs,
          ragRetrievalMs,
          ragRetrievalError,
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
          sessionId,
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

        if (preview.status === 'block' && hasPrivateDocumentPreview(preview)) {
          pendingExternalRequestsRef.current.set(assistantMessageId, request);
          saveExternalApprovalForTurn(
            workspaceId,
            sessionId,
            userMessageId,
            assistantMessageId,
            { required: false, approved: false },
          );
          completeAssistantMessage(workspaceId, sessionId, assistantMessageId, {
            content: 'Private 문서가 포함되어 외부 AI로 전송할 수 없습니다.',
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
          setWorkspaceRequestStatus(sessionId, 'completed');
        } else if (preview.status === 'block') {
          pendingExternalRequestsRef.current.set(assistantMessageId, request);
          saveExternalApprovalForTurn(
            workspaceId,
            sessionId,
            userMessageId,
            assistantMessageId,
            { required: false, approved: false },
          );
          completeAssistantMessage(workspaceId, sessionId, assistantMessageId, {
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
          setWorkspaceRequestStatus(sessionId, 'completed');
        } else if (preview.status === 'review-required') {
          pendingExternalRequestsRef.current.set(assistantMessageId, request);
          saveExternalApprovalForTurn(
            workspaceId,
            sessionId,
            userMessageId,
            assistantMessageId,
            { required: true, approved: false },
          );
          completeAssistantMessage(workspaceId, sessionId, assistantMessageId, {
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
          setWorkspaceRequestStatus(sessionId, 'review-required');
        } else {
          saveExternalApprovalForTurn(
            workspaceId,
            sessionId,
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

      completeAssistantMessage(workspaceId, sessionId, assistantMessageId, {
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
      setWorkspaceRequestStatus(sessionId, 'error');
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
      model: settings.externalAI.model,
      question: request.query,
      manualContexts: request.manualContexts,
      autoContexts: request.autoContexts,
      maskingEntries: settings.masking.entries,
      registryWorkspaces,
      secretRules: getSecretRules(settings.secretDetection.customRules),
    });

    return {
      preview,
      responseUnmaskingSnapshot: preview.responseUnmaskingSnapshot,
    };
  }

  async function handleApproveExternal(
    assistantMessageId: string,
  ): Promise<ExternalActionResult> {
    const request = pendingExternalRequestsRef.current.get(assistantMessageId);

    if (!request) {
      return { ok: false, error: '승인할 External 요청을 찾을 수 없습니다.' };
    }

    if (hasPrivateDocumentPreview(request.preview)) {
      return {
        ok: false,
        error: 'Private 문서가 포함되어 외부 AI로 전송할 수 없습니다.',
        preview: request.preview,
      };
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
        workspaceRequestStatusesRef.current.get(request.sessionId) ?? 'idle',
      )
    ) {
      return { ok: false, error: '이미 처리 중인 요청입니다.' };
    }

    if (!tryBeginExternalAction(request)) {
      return { ok: false, error: '이미 처리 중인 요청입니다.' };
    }
    setWorkspaceRequestStatus(request.sessionId, 'calling-external');
    completeAssistantMessage(request.workspaceId, request.sessionId, assistantMessageId, {
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
        request.sessionId,
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
          request.sessionId,
          request.userMessageId,
          request.assistantMessageId,
          blockedRoutingDecision,
        );
        saveExternalApprovalForTurn(
          request.workspaceId,
          request.sessionId,
          request.userMessageId,
          request.assistantMessageId,
          { required: false, approved: false },
        );
        completeAssistantMessage(request.workspaceId, request.sessionId, assistantMessageId, {
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
        setWorkspaceRequestStatus(request.sessionId, 'completed');

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
        request.sessionId,
        request.userMessageId,
        request.assistantMessageId,
        routingDecision,
      );
      saveExternalApprovalForTurn(
        request.workspaceId,
        request.sessionId,
        request.userMessageId,
        request.assistantMessageId,
        { required: true, approved: true, approvedAt },
      );

      await executeOpenAIRequest(request, routingDecision);
      pendingExternalRequestsRef.current.delete(assistantMessageId);
      return { ok: true };
    } catch (error) {
      const errorMessage = getExternalChatErrorMessage(error);

      completeAssistantMessage(request.workspaceId, request.sessionId, assistantMessageId, {
        content: errorMessage,
        generationStatus: 'error',
        requestStatus: 'error',
        routingDecision: request.routingDecision,
        externalSafetyAction: undefined,
      });
      setWorkspaceRequestStatus(request.sessionId, 'error');
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
        workspaceRequestStatusesRef.current.get(request.sessionId) ?? 'idle',
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
      request.sessionId,
      request.userMessageId,
      request.assistantMessageId,
      routingDecision,
    );
    completeAssistantMessage(request.workspaceId, request.sessionId, assistantMessageId, {
      content: 'Local AI가 분석 중입니다...',
      generationStatus: 'loading',
      requestStatus: 'calling-local',
      externalSafetyAction: undefined,
      routingDecision,
    });

    try {
      await executeLocalAIRequest({
        sessionId: request.sessionId,
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

      completeAssistantMessage(request.workspaceId, request.sessionId, assistantMessageId, {
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
      setWorkspaceRequestStatus(request.sessionId, 'error');
    } finally {
      pendingExternalRequestsRef.current.delete(assistantMessageId);
      request.inFlight = false;
    }
  }

  function completeAssistantMessage(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
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
    const sanitizedUpdate =
      typeof update.content === 'string'
        ? {
            ...update,
            content: removeInternalContextIdentifiers(update.content),
          }
        : update;

    updateChatSession(workspaceId, sessionId, (session) => {
      return {
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((chatMessage) =>
          chatMessage.id === assistantMessageId
            ? { ...chatMessage, ...sanitizedUpdate }
            : chatMessage,
        ),
      };
    });
  }

  function saveExternalPayloadPreviewForTurn(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
    userMessageId: string,
    externalPayloadPreview: ExternalPayloadPreview,
  ): void {
    updateChatSession(workspaceId, sessionId, (session) => {
      return {
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((chatMessage) =>
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

  function hasPrivateDocumentPreview(preview: ExternalPayloadPreview): boolean {
    return preview.documents.some(
      (document) =>
        document.documentSecurity === 'private' ||
        document.metadata?.security === 'private',
    );
  }

  function getExternalBlockMessage(preview: ExternalPayloadPreview): string {
    if (hasPrivateDocumentPreview(preview)) {
      return 'Private 문서가 포함되어 외부 AI로 전송할 수 없습니다.';
    }

    return preview.secretDetection.detected
      ? '외부 AI 전송 차단\n\nSecret / Credential 정보가 감지되었습니다.'
      : '보안 검사에 실패하여 외부 AI로 전송할 수 없습니다.';
  }

  function saveRoutingDecisionForTurn(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
    userMessageId: string,
    assistantMessageId: string,
    routingDecision: RoutingDecision,
  ): void {
    updateChatSession(workspaceId, sessionId, (session) => {
      return {
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((chatMessage) =>
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
    sessionId: ChatSession['sessionId'],
    userMessageId: string,
    assistantMessageId: string,
    externalApproval: ExternalApprovalInfo,
  ): void {
    updateChatSession(workspaceId, sessionId, (session) => {
      return {
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((chatMessage) =>
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

  async function handleChangeIncludeArchived(
    includeArchived: boolean,
  ): Promise<void> {
    const nextSearchScope: SearchScopeSettings = {
      ...searchScope,
      includeArchived,
    };

    setSearchScope(nextSearchScope);
    setIsSavingSearchScope(true);

    try {
      const settings = await window.mimora.updateSearchScope(nextSearchScope);
      setSearchScope(settings.search);
    } catch (error) {
      console.error('[Mimora Settings] Failed to update search scope.', {
        error: getChatErrorMessage(error),
      });
      setSearchScope((currentSearchScope) => ({
        ...currentSearchScope,
        includeArchived: !includeArchived,
      }));
    } finally {
      setIsSavingSearchScope(false);
    }
  }

  async function handleChangeContentOriginScope(
    contentOriginScope: ContentOriginSearchScope,
  ): Promise<void> {
    const previousSearchScope = searchScope;
    const nextSearchScope: SearchScopeSettings = {
      ...searchScope,
      contentOriginScope,
    };

    setSearchScope(nextSearchScope);
    setIsSavingSearchScope(true);

    try {
      const settings = await window.mimora.updateSearchScope(nextSearchScope);
      setSearchScope(settings.search);
    } catch (error) {
      console.error('[Mimora Settings] Failed to update search scope.', {
        error: getChatErrorMessage(error),
      });
      setSearchScope(previousSearchScope);
    } finally {
      setIsSavingSearchScope(false);
    }
  }

  function handleResetGlobalSearchScope(): void {
    setKnowledgeSearchFilters(emptyKnowledgeSearchFilters);

    if (
      searchScope.includeArchived ||
      searchScope.contentOriginScope !== 'all'
    ) {
      void window.mimora
        .updateSearchScope({
          includeArchived: false,
          contentOriginScope: 'all',
        })
        .then((settings) => {
          setSearchScope(settings.search);
        })
        .catch((error) => {
          console.error('[Mimora Settings] Failed to reset search scope.', {
            error: getChatErrorMessage(error),
          });
          setSearchScope({
            includeArchived: false,
            contentOriginScope: 'all',
          });
        });
    }
  }

  function completeAutoContextRetrieval(
    workspaceId: Workspace['id'],
    sessionId: ChatSession['sessionId'],
    userMessageId: string,
    autoContext: AutoRetrievedContext[],
    errorMessage?: string,
  ): void {
    updateChatSession(workspaceId, sessionId, (session) => {
      const userMessageIndex = session.messages.findIndex(
        (chatMessage) => chatMessage.id === userMessageId,
      );

      if (userMessageIndex < 0) {
        return session;
      }

      const userMessage = session.messages[userMessageIndex];
      const updatedUserMessage: ChatMessage = {
        ...userMessage,
        autoContext,
        autoContextStatus: errorMessage ? 'error' : 'complete',
        ...(errorMessage ? { autoContextError: errorMessage } : {}),
      };
      const nextSessionMessages = [...session.messages];

      nextSessionMessages.splice(userMessageIndex, 1, updatedUserMessage);

      return {
        ...session,
        updatedAt: new Date().toISOString(),
        messages: nextSessionMessages,
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
      <div
        aria-hidden="true"
        className="app-focus-anchor"
        ref={appFocusAnchorRef}
        tabIndex={-1}
      />
      <Sidebar
        chatSessions={chatSessions}
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
        selectedSessionId={activeView === 'chat' ? selectedSessionId : null}
        onCreateSession={openCreateSessionDialog}
        onDeleteSession={openDeleteSessionDialog}
        onRenameSession={openRenameSessionDialog}
        onReorderSession={reorderChatSession}
        onSelectSession={handleSelectSession}
        onSelectWorkspace={handleSelectWorkspace}
        registryRuntimeMode={registryRuntimeMode}
        workspaceSections={workspaceSections}
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
          <SettingsView
            onVaultDocumentsChanged={refreshVaultDocumentSnapshot}
            onWorkspaceRegistryChanged={refreshWorkspaceRegistry}
          />
        ) : activeView === 'recent-chats' ? (
          <RecentChatsView
            chatSessions={chatSessions}
            isLoading={chatHistoryStatus === 'loading'}
            onDeleteSession={deleteChatSession}
            onOpenSession={handleSelectSession}
            onRenameSession={openRenameSessionDialog}
            storageError={chatHistoryError}
            workspaces={selectableWorkspaces}
          />
        ) : activeView === 'vault-browser' ? (
          <VaultBrowserView
            currentWorkspace={selectedWorkspace}
            onAttachContext={(context) =>
              attachContextToWorkspace(selectedWorkspace.id, context)
            }
            onVaultFilesRefreshed={refreshVaultDocumentSnapshot}
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
              includeArchived={searchScope.includeArchived}
              contentOriginScope={searchScope.contentOriginScope}
              isKnowledgeDomainRegistryAvailable={
                isKnowledgeDomainRegistryAvailable
              }
              isKnowledgeTypeRegistryAvailable={
                isKnowledgeTypeRegistryAvailable
              }
              knowledgeDomainOptions={knowledgeDomainOptions}
              knowledgeFilters={knowledgeSearchFilters}
              knowledgeTypeOptions={knowledgeTypeOptions}
              onChangeAIMode={(nextAIMode) => {
                void handleChangeAIMode(nextAIMode);
              }}
              onChangeIncludeArchived={(includeArchived) => {
                void handleChangeIncludeArchived(includeArchived);
              }}
              onChangeContentOriginScope={(contentOriginScope) => {
                void handleChangeContentOriginScope(contentOriginScope);
              }}
              onChangeKnowledgeFilters={setKnowledgeSearchFilters}
              onResetSearchScope={handleResetGlobalSearchScope}
              searchScopeDisabled={
                isSavingSearchScope || isCurrentWorkspaceBusy
              }
              showSearchScope={isAllWorkspaceScope(selectedWorkspace.id)}
              createSessionDisabled={!canCreateSessionInCurrentWorkspace}
              sessionTitle={selectedSession?.title ?? null}
              workspaceStatus={
                selectedWorkspace.isSystem ? null : selectedWorkspace.status
              }
              workspaceLabel={selectedWorkspace.label}
              onCreateSession={() => {
                openCreateSessionDialog(selectedWorkspace.id);
              }}
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
                  onCreateDerivedKnowledgeDraft={(assistantMessageId) => {
                    void handleCreateDerivedKnowledgeDraft(assistantMessageId);
                  }}
                  onUseLocalAI={handleUseLocalAI}
                  registryWorkspaces={registryWorkspaces}
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
                  canAskQuestionInCurrentWorkspace ? (
                    <QuickPromptBar onSelectPrompt={handleSelectPrompt} />
                  ) : null
                ) : null}
                {!canAskQuestionInCurrentWorkspace ? (
                  <p className="chat-composer-notice">
                    종료된 Workspace입니다. 기존 대화는 열람할 수 있지만 새 질문은 할 수 없습니다.
                  </p>
                ) : null}
                <ChatInput
                  disabled={!canAskQuestionInCurrentWorkspace}
                  disabledMessage={composerDisabledMessage}
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
      <ContextPanel
        isKnowledgeDomainRegistryAvailable={isKnowledgeDomainRegistryAvailable}
        isKnowledgeTypeRegistryAvailable={isKnowledgeTypeRegistryAvailable}
        knowledgeDomainOptions={knowledgeDomainOptions}
        knowledgeTypeOptions={knowledgeTypeOptions}
        documentRefreshSignal={vaultDocumentRefreshSignal}
        onRefreshDocuments={refreshVaultDocumentSnapshot}
        registryRuntimeMode={registryRuntimeMode}
        registryWorkspaces={registryWorkspaces}
        selectedWorkspace={selectedWorkspace}
      />
      {isCreateSessionDialogOpen ? (
        <div
          className="session-dialog-backdrop"
          key="create-session-dialog"
          role="presentation"
        >
          <form
            className="session-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              submitCreateSession();
            }}
          >
            <h2>새 대화 만들기</h2>
            <label>
              <span>세션명</span>
              <input
                autoFocus
                onChange={(event) => {
                  setNewSessionTitle(event.target.value);
                }}
                placeholder="새 대화"
                ref={newSessionTitleInputRef}
                value={newSessionTitle}
              />
            </label>
            <label>
              <span>Workspace</span>
              <select
                onChange={(event) => {
                  setNewSessionWorkspaceId(event.target.value);
                }}
                value={newSessionWorkspaceId}
              >
                {sessionCreatableWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="session-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  closeCreateSessionDialog();
                }}
                type="button"
              >
                취소
              </button>
              <button className="primary-button" type="submit">
                생성
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {renameSessionDialog ? (
        <div
          className="session-dialog-backdrop"
          key="rename-session-dialog"
          role="presentation"
        >
          <form
            className="session-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              submitRenameSession();
            }}
          >
            <h2>세션 이름 변경</h2>
            <label>
              <span>세션명</span>
              <input
                autoFocus
                onChange={(event) => {
                  setRenameSessionDialog((currentDialog) =>
                    currentDialog
                      ? {
                          ...currentDialog,
                          title: event.target.value,
                        }
                      : currentDialog,
                  );
                }}
                value={renameSessionDialog.title}
              />
            </label>
            <div className="session-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  closeRenameSessionDialog();
                }}
                type="button"
              >
                취소
              </button>
              <button
                className="primary-button"
                disabled={renameSessionDialog.title.trim().length === 0}
                type="submit"
              >
                저장
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {deleteSessionDialog ? (
        <div
          className="session-dialog-backdrop"
          key="delete-session-dialog"
          role="presentation"
        >
          <form
            className="session-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              confirmDeleteSession();
            }}
          >
            <h2>세션 삭제</h2>
            <p className="session-dialog-message">
              "{deleteSessionDialog.title}" 세션을 삭제하시겠습니까?
              <br />
              삭제한 대화는 복구할 수 없습니다.
            </p>
            <div className="session-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  closeDeleteSessionDialog();
                }}
                type="button"
              >
                취소
              </button>
              <button className="danger-button" type="submit">
                삭제
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {derivedDraft ? (
        <DerivedKnowledgeDraftModal
          draft={derivedDraft}
          error={derivedDraftError}
          isSaving={isSavingDerivedDraft}
          knowledgeDomainOptions={knowledgeDomainOptions}
          knowledgeTypeOptions={knowledgeTypeOptions}
          onChange={(nextDraft) => {
            setDerivedDraftSavedPath(null);
            setDerivedDraft(normalizeDerivedKnowledgeDraft(nextDraft));
          }}
          onClose={() => {
            setDerivedDraft(null);
            setDerivedDraftError(null);
            setDerivedDraftSavedPath(null);
          }}
          onSave={() => {
            void handleSaveDerivedKnowledgeDraft();
          }}
          savedPath={derivedDraftSavedPath}
          vaults={derivedDraftVaults}
        />
      ) : null}
    </div>
  );
}
