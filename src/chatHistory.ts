import type { ChatMessage, ChatSession, ChatSessions } from './chat';
import type { OpenAIUsage } from './externalAI';
import type { LLMContextSource } from './llmChat';
import type { DocumentSecurity, MimoraDocumentMetadata } from './metadata/types';
import type { ResponseUnmaskingInfo } from './chat';
import {
  aiModeOptions,
  getRoutingProviderType,
  type RoutingDecision,
} from './security/securityRouter';
import type { SearchScopeSnapshot } from './searchScope';
import { isContentOriginSearchScope } from './contentOrigin';
import {
  isChatHistoryWorkspaceId,
  normalizeChatHistoryWorkspaceId,
} from './workspaces';

export const CHAT_HISTORY_VERSION = 2 as const;
const LEGACY_CHAT_HISTORY_VERSION = 1;

export function isKnownWorkspaceId(value: unknown): value is string {
  return isChatHistoryWorkspaceId(value);
}

export type PersistedChatMessage = Pick<
  ChatMessage,
  'id' | 'role' | 'content' | 'createdAt'
> & {
  requestStatus?: 'completed' | 'error';
  requestedMode?: ChatMessage['requestedMode'];
  searchScopeSnapshot?: SearchScopeSnapshot;
  generationStatus?: 'complete' | 'error';
  generationErrorDetail?: string;
  sources?: LLMContextSource[];
  routingDecision?: RoutingDecision;
  externalApproval?: ChatMessage['externalApproval'];
  responseUnmasking?: ResponseUnmaskingInfo;
  model?: string;
  usage?: OpenAIUsage;
};

export type PersistedWorkspaceChat = {
  workspaceId: string;
  sessions: PersistedChatSession[];
  updatedAt: string;
};

export type PersistedChatSession = {
  sessionId: string;
  workspaceId: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  messages: PersistedChatMessage[];
};

export type PersistedChatHistory = {
  version: typeof CHAT_HISTORY_VERSION;
  sessions: Record<string, PersistedWorkspaceChat>;
};

export type ChatHistoryStorageStatus =
  | 'ready'
  | 'unavailable'
  | 'corrupt'
  | 'error';

export type ChatHistoryLoadResult = {
  sessions: ChatSessions;
  status: ChatHistoryStorageStatus;
  error?: string;
};

export type ChatHistorySaveResult = {
  sessionCount: number;
  messageCount: number;
};

function createLegacySessionId(workspaceId: string): string {
  return `legacy-${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function sanitizeDocumentMetadata(
  value: unknown,
): MimoraDocumentMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata: MimoraDocumentMetadata = {
    workspaceIds: sanitizeStringArray(value.workspaceIds),
    knowledgeDomains: sanitizeStringArray(value.knowledgeDomains),
    knowledgeTypes: sanitizeStringArray(value.knowledgeTypes),
    source:
      value.source === 'frontmatter' ||
      value.source === 'legacy' ||
      value.source === 'mixed' ||
      value.source === 'none'
        ? value.source
        : 'none',
  };

  if (typeof value.documentId === 'string') {
    metadata.documentId = value.documentId;
  }

  if (typeof value.originWorkspaceId === 'string') {
    metadata.originWorkspaceId = value.originWorkspaceId;
  }

  if (Array.isArray(value.rawKnowledgeDomains)) {
    metadata.rawKnowledgeDomains = sanitizeStringArray(
      value.rawKnowledgeDomains,
    );
  }

  if (Array.isArray(value.rawKnowledgeTypes)) {
    metadata.rawKnowledgeTypes = sanitizeStringArray(value.rawKnowledgeTypes);
  }

  if (
    value.security === 'normal' ||
    value.security === 'private' ||
    value.security === 'internal'
  ) {
    metadata.security = value.security;
  }

  if (value.contentOrigin === 'human' || value.contentOrigin === 'ai-derived') {
    metadata.contentOrigin = value.contentOrigin;
  }

  return metadata;
}

function sanitizeSources(value: unknown): LLMContextSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = value.flatMap((source) => {
    if (!isRecord(source)) {
      return [];
    }

    const {
      vaultId,
      vaultName,
      vaultType,
      security,
      documentSecurity,
      relativePath,
      fileName,
      metadata,
    } = source;
    const sanitizedMetadata = sanitizeDocumentMetadata(metadata);
    const sanitizedDocumentSecurity: DocumentSecurity | undefined =
      documentSecurity === 'normal' ||
      documentSecurity === 'private' ||
      documentSecurity === 'internal'
        ? documentSecurity
        : sanitizedMetadata?.security;

    return typeof vaultId === 'string' &&
      typeof vaultName === 'string' &&
      (vaultType === 'work' ||
        vaultType === 'knowledge' ||
        vaultType === 'private') &&
      (security === 'internal' ||
        security === 'personal' ||
        security === 'sensitive') &&
      typeof relativePath === 'string' &&
      typeof fileName === 'string'
      ? [
          {
            vaultId,
            vaultName,
            vaultType: vaultType as LLMContextSource['vaultType'],
            security: security as LLMContextSource['security'],
            ...(sanitizedDocumentSecurity
              ? { documentSecurity: sanitizedDocumentSecurity }
              : {}),
            relativePath,
            fileName,
            ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
          },
        ]
      : [];
  });

  return sources.length > 0 ? sources : undefined;
}

function sanitizeRoutingDecision(value: unknown): RoutingDecision | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const numberKeys = [
    'sensitiveContextCount',
    'personalContextCount',
    'manualContextCount',
    'autoContextCount',
  ] as const;
  const privateVaultContextCount =
    optionalNumber(value.privateVaultContextCount) ?? 0;
  const privateDocumentContextCount =
    optionalNumber(value.privateDocumentContextCount) ?? 0;

  if (
    !aiModeOptions.includes(value.mode as (typeof aiModeOptions)[number]) ||
    (value.provider !== 'local' &&
      value.provider !== 'openai' &&
      value.provider !== 'gemini') ||
    (value.security !== 'internal' &&
      value.security !== 'personal' &&
      value.security !== 'sensitive' &&
      value.security !== 'private') ||
    typeof value.reason !== 'string' ||
    typeof value.safetyStatus !== 'string' ||
    typeof value.approved !== 'boolean' ||
    numberKeys.some((key) => optionalNumber(value[key]) === undefined)
  ) {
    return undefined;
  }

  return {
    mode: value.mode as RoutingDecision['mode'],
    provider: value.provider,
    providerType:
      value.providerType === 'local' || value.providerType === 'external'
        ? value.providerType
        : getRoutingProviderType(value.provider),
    security: value.security,
    reason: value.reason as RoutingDecision['reason'],
    sensitiveContextCount: value.sensitiveContextCount as number,
    personalContextCount: value.personalContextCount as number,
    privateDocumentContextCount,
    privateVaultContextCount,
    manualContextCount: value.manualContextCount as number,
    autoContextCount: value.autoContextCount as number,
    safetyStatus: value.safetyStatus as RoutingDecision['safetyStatus'],
    approved: value.approved,
  };
}

function sanitizeResponseUnmasking(
  value: unknown,
): ResponseUnmaskingInfo | undefined {
  if (!isRecord(value) || !Array.isArray(value.replacements)) {
    return undefined;
  }

  const replacements = value.replacements.flatMap((replacement) => {
    if (
      !isRecord(replacement) ||
      typeof replacement.alias !== 'string' ||
      (replacement.entityType !== 'person' &&
        replacement.entityType !== 'client' &&
        replacement.entityType !== 'organization' &&
        replacement.entityType !== 'project' &&
        replacement.entityType !== 'system') ||
      optionalNumber(replacement.count) === undefined
    ) {
      return [];
    }

    return [
      {
        alias: replacement.alias,
        entityType: replacement.entityType as ResponseUnmaskingInfo['replacements'][number]['entityType'],
        count: replacement.count as number,
      },
    ];
  });
  const replacementCount = replacements.reduce(
    (total, replacement) => total + replacement.count,
    0,
  );

  return replacementCount > 0 ? { replacements, replacementCount } : undefined;
}

function sanitizeSearchScopeSnapshot(
  value: unknown,
): SearchScopeSnapshot | undefined {
  if (!isRecord(value) || typeof value.includeArchived !== 'boolean') {
    return undefined;
  }

  return {
    includeArchived: value.includeArchived,
    domain: typeof value.domain === 'string' ? value.domain : null,
    type: typeof value.type === 'string' ? value.type : null,
    contentOriginScope: isContentOriginSearchScope(value.contentOriginScope)
      ? value.contentOriginScope
      : 'all',
  };
}

function sanitizeUsage(value: unknown): OpenAIUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage = {
    inputTokens: optionalNumber(value.inputTokens),
    outputTokens: optionalNumber(value.outputTokens),
    totalTokens: optionalNumber(value.totalTokens),
  };

  return Object.values(usage).some((item) => item !== undefined)
    ? usage
    : undefined;
}

function sanitizePersistedMessage(value: unknown): PersistedChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    (value.role !== 'user' && value.role !== 'assistant') ||
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  const message: PersistedChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
  };
  const requestedMode = aiModeOptions.includes(
    value.requestedMode as (typeof aiModeOptions)[number],
  )
    ? (value.requestedMode as PersistedChatMessage['requestedMode'])
    : undefined;
  const sources = sanitizeSources(value.sources);
  const searchScopeSnapshot = sanitizeSearchScopeSnapshot(
    value.searchScopeSnapshot,
  );
  const routingDecision =
    value.role === 'assistant'
      ? sanitizeRoutingDecision(value.routingDecision)
      : undefined;
  const responseUnmasking = sanitizeResponseUnmasking(value.responseUnmasking);
  const usage = sanitizeUsage(value.usage);

  if (requestedMode) message.requestedMode = requestedMode;
  if (searchScopeSnapshot) message.searchScopeSnapshot = searchScopeSnapshot;
  if (value.requestStatus === 'completed' || value.requestStatus === 'error') {
    message.requestStatus = value.requestStatus;
  }
  if (value.generationStatus === 'complete' || value.generationStatus === 'error') {
    message.generationStatus = value.generationStatus;
  }
  if (typeof value.generationErrorDetail === 'string') {
    message.generationErrorDetail = value.generationErrorDetail;
  }
  if (sources) message.sources = sources;
  if (routingDecision) message.routingDecision = routingDecision;
  if (isRecord(value.externalApproval)) {
    const required = value.externalApproval.required;
    const approved = value.externalApproval.approved;

    if (typeof required === 'boolean' && typeof approved === 'boolean') {
      message.externalApproval = {
        required,
        approved,
        ...(typeof value.externalApproval.approvedAt === 'string'
          ? { approvedAt: value.externalApproval.approvedAt }
          : {}),
      };
    }
  }
  if (responseUnmasking) message.responseUnmasking = responseUnmasking;
  if (typeof value.model === 'string') message.model = value.model;
  if (usage) message.usage = usage;

  return message;
}

function sanitizePersistedChatSession(
  value: unknown,
  fallbackWorkspaceId: string,
  fallbackSortOrder: number,
): PersistedChatSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const workspaceId =
    typeof value.workspaceId === 'string'
      ? normalizeChatHistoryWorkspaceId(value.workspaceId)
      : fallbackWorkspaceId;

  if (
    !isKnownWorkspaceId(workspaceId) ||
    typeof value.sessionId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.messages)
  ) {
    return null;
  }

  const messages = value.messages.map(sanitizePersistedMessage);

  if (messages.some((message) => message === null)) {
    return null;
  }

  return {
    sessionId: value.sessionId,
    workspaceId,
    title: value.title.trim() || '새 대화',
    sortOrder:
      typeof value.sortOrder === 'number' && Number.isFinite(value.sortOrder)
        ? value.sortOrder
        : fallbackSortOrder,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages: messages as PersistedChatMessage[],
  };
}

function createPersistedSession(session: ChatSession): PersistedChatSession | null {
  const workspaceId = normalizeChatHistoryWorkspaceId(session.workspaceId);

  if (!isKnownWorkspaceId(workspaceId) || !session.sessionId) {
    return null;
  }

  const messages = session.messages
    .map(sanitizePersistedMessage)
    .filter((message): message is PersistedChatMessage => message !== null);
  const lastMessageAt = messages.at(-1)?.createdAt;

  return {
    sessionId: session.sessionId,
    workspaceId,
    title: session.title.trim() || '새 대화',
    sortOrder: Number.isFinite(session.sortOrder) ? session.sortOrder : 0,
    createdAt: session.createdAt || lastMessageAt || new Date(0).toISOString(),
    updatedAt: session.updatedAt || lastMessageAt || new Date(0).toISOString(),
    messages,
  };
}

export function createPersistedChatHistory(
  input: unknown,
): PersistedChatHistory {
  if (!isRecord(input)) {
    return { version: CHAT_HISTORY_VERSION, sessions: {} };
  }

  const sessions: PersistedChatHistory['sessions'] = {};

  for (const [workspaceId, rawSessions] of Object.entries(input)) {
    if (!isKnownWorkspaceId(workspaceId) || !Array.isArray(rawSessions)) {
      continue;
    }

    const normalizedWorkspaceId = normalizeChatHistoryWorkspaceId(workspaceId);
    const persistedSessions = rawSessions
      .map((session) => createPersistedSession(session as ChatSession))
      .filter(
        (session): session is PersistedChatSession =>
          session !== null && session.workspaceId === normalizedWorkspaceId,
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );

    if (persistedSessions.length === 0) {
      continue;
    }

    sessions[normalizedWorkspaceId] = {
      workspaceId: normalizedWorkspaceId,
      sessions: persistedSessions,
      updatedAt:
        [...persistedSessions].sort(
          (left, right) =>
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        )[0]?.updatedAt ?? new Date(0).toISOString(),
    };
  }

  return { version: CHAT_HISTORY_VERSION, sessions };
}

function parseLegacyPersistedChatHistory(input: Record<string, unknown>): PersistedChatHistory {
  if (!isRecord(input.sessions)) {
    throw new Error('INVALID_CHAT_HISTORY');
  }

  const sessions: ChatSessions = {};

  for (const [workspaceId, workspaceChat] of Object.entries(input.sessions)) {
    if (!isKnownWorkspaceId(workspaceId)) {
      continue;
    }

    const normalizedWorkspaceId = normalizeChatHistoryWorkspaceId(workspaceId);

    if (
      !isRecord(workspaceChat) ||
      !Array.isArray(workspaceChat.messages) ||
      typeof workspaceChat.updatedAt !== 'string'
    ) {
      throw new Error('INVALID_CHAT_HISTORY');
    }

    const messages = workspaceChat.messages.map(sanitizePersistedMessage);

    if (messages.some((message) => message === null) || messages.length === 0) {
      continue;
    }

    const lastMessageAt =
      (messages as PersistedChatMessage[]).at(-1)?.createdAt ??
      workspaceChat.updatedAt;

    sessions[normalizedWorkspaceId] = [
      {
        sessionId: createLegacySessionId(normalizedWorkspaceId),
        workspaceId: normalizedWorkspaceId,
        title: '새 대화',
        sortOrder: 0,
        createdAt:
          (messages as PersistedChatMessage[])[0]?.createdAt ??
          workspaceChat.updatedAt,
        updatedAt: lastMessageAt,
        messages: (messages as PersistedChatMessage[]).map((message) => ({
          ...message,
        })),
      },
    ];
  }

  return createPersistedChatHistory(sessions);
}

export function parsePersistedChatHistory(input: unknown): PersistedChatHistory {
  if (!isRecord(input) || !isRecord(input.sessions)) {
    throw new Error('INVALID_CHAT_HISTORY');
  }

  if (input.version === LEGACY_CHAT_HISTORY_VERSION) {
    return parseLegacyPersistedChatHistory(input);
  }

  if (input.version !== CHAT_HISTORY_VERSION) {
    throw new Error('INVALID_CHAT_HISTORY');
  }

  const sessions: ChatSessions = {};

  for (const [workspaceId, workspaceChat] of Object.entries(input.sessions)) {
    if (!isKnownWorkspaceId(workspaceId)) {
      continue;
    }

    const normalizedWorkspaceId = normalizeChatHistoryWorkspaceId(workspaceId);
    if (
      !isRecord(workspaceChat) ||
      (workspaceChat.workspaceId !== workspaceId &&
        workspaceChat.workspaceId !== normalizedWorkspaceId) ||
      !Array.isArray(workspaceChat.sessions) ||
      typeof workspaceChat.updatedAt !== 'string'
    ) {
      throw new Error('INVALID_CHAT_HISTORY');
    }

    const workspaceSessions = workspaceChat.sessions.map((session, index) =>
      sanitizePersistedChatSession(session, normalizedWorkspaceId, index),
    );

    if (workspaceSessions.some((session) => session === null)) {
      throw new Error('INVALID_CHAT_HISTORY');
    }

    const normalizedSessions = (workspaceSessions as PersistedChatSession[])
      .filter((session) => session.workspaceId === normalizedWorkspaceId)
      .map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({ ...message })),
      }));

    if (normalizedSessions.length > 0) {
      sessions[normalizedWorkspaceId] = normalizedSessions;
    }
  }

  return createPersistedChatHistory(sessions);
}

export function restoreChatSessions(history: PersistedChatHistory): ChatSessions {
  return Object.fromEntries(
    Object.entries(history.sessions).map(([workspaceId, workspaceChat]) => [
      workspaceId,
      workspaceChat.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({ ...message })),
      })),
    ]),
  );
}

export function countPersistedMessages(history: PersistedChatHistory): number {
  return Object.values(history.sessions).reduce(
    (total, workspaceChat) =>
      total +
      workspaceChat.sessions.reduce(
        (workspaceTotal, session) => workspaceTotal + session.messages.length,
        0,
      ),
    0,
  );
}

export function countPersistedSessions(history: PersistedChatHistory): number {
  return Object.values(history.sessions).reduce(
    (total, workspaceChat) => total + workspaceChat.sessions.length,
    0,
  );
}
