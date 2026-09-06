import type { ChatMessage, ChatSessions } from './chat';
import type { OpenAIUsage } from './externalAI';
import type { LLMContextSource } from './llmChat';
import type { ResponseUnmaskingInfo } from './chat';
import {
  aiModeOptions,
  type RoutingDecision,
} from './security/securityRouter';
import { workspaceSections } from './workspaces';

export const CHAT_HISTORY_VERSION = 1 as const;
const workspaceIds = new Set(
  workspaceSections.flatMap((section) =>
    section.items.map((workspace) => workspace.id),
  ),
);

export function isKnownWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && workspaceIds.has(value);
}

export type PersistedChatMessage = Pick<
  ChatMessage,
  'id' | 'role' | 'content' | 'createdAt'
> & {
  requestStatus?: 'completed' | 'error';
  requestedMode?: ChatMessage['requestedMode'];
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
  messages: PersistedChatMessage[];
  updatedAt: string;
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

function sanitizeSources(value: unknown): LLMContextSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = value.flatMap((source) => {
    if (!isRecord(source)) {
      return [];
    }

    const { vaultId, vaultName, vaultType, security, relativePath, fileName } =
      source;

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
            relativePath,
            fileName,
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
    'privateVaultContextCount',
    'manualContextCount',
    'autoContextCount',
  ] as const;

  if (
    !aiModeOptions.includes(value.mode as (typeof aiModeOptions)[number]) ||
    (value.provider !== 'local' && value.provider !== 'openai') ||
    (value.security !== 'internal' &&
      value.security !== 'personal' &&
      value.security !== 'sensitive') ||
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
    security: value.security,
    reason: value.reason as RoutingDecision['reason'],
    sensitiveContextCount: value.sensitiveContextCount as number,
    personalContextCount: value.personalContextCount as number,
    privateVaultContextCount: value.privateVaultContextCount as number,
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
  const routingDecision =
    value.role === 'assistant'
      ? sanitizeRoutingDecision(value.routingDecision)
      : undefined;
  const responseUnmasking = sanitizeResponseUnmasking(value.responseUnmasking);
  const usage = sanitizeUsage(value.usage);

  if (requestedMode) message.requestedMode = requestedMode;
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

export function createPersistedChatHistory(
  input: unknown,
): PersistedChatHistory {
  if (!isRecord(input)) {
    return { version: CHAT_HISTORY_VERSION, sessions: {} };
  }

  const sessions: PersistedChatHistory['sessions'] = {};

  for (const [workspaceId, rawMessages] of Object.entries(input)) {
    if (!isKnownWorkspaceId(workspaceId) || !Array.isArray(rawMessages)) {
      continue;
    }

    const messages = rawMessages
      .map(sanitizePersistedMessage)
      .filter((message): message is PersistedChatMessage => message !== null);

    if (messages.length === 0) {
      continue;
    }

    sessions[workspaceId] = {
      workspaceId,
      messages,
      updatedAt: messages.at(-1)?.createdAt ?? new Date(0).toISOString(),
    };
  }

  return { version: CHAT_HISTORY_VERSION, sessions };
}

export function parsePersistedChatHistory(input: unknown): PersistedChatHistory {
  if (
    !isRecord(input) ||
    input.version !== CHAT_HISTORY_VERSION ||
    !isRecord(input.sessions)
  ) {
    throw new Error('INVALID_CHAT_HISTORY');
  }

  const sessions: ChatSessions = {};

  for (const [workspaceId, workspaceChat] of Object.entries(input.sessions)) {
    if (
      !isRecord(workspaceChat) ||
      !isKnownWorkspaceId(workspaceId) ||
      workspaceChat.workspaceId !== workspaceId ||
      !Array.isArray(workspaceChat.messages) ||
      typeof workspaceChat.updatedAt !== 'string'
    ) {
      throw new Error('INVALID_CHAT_HISTORY');
    }

    const messages = workspaceChat.messages.map(sanitizePersistedMessage);

    if (messages.some((message) => message === null)) {
      throw new Error('INVALID_CHAT_HISTORY');
    }

    if (messages.length > 0) {
      sessions[workspaceId] = messages as PersistedChatMessage[];
    }
  }

  return createPersistedChatHistory(sessions);
}

export function restoreChatSessions(history: PersistedChatHistory): ChatSessions {
  return Object.fromEntries(
    Object.entries(history.sessions).map(([workspaceId, session]) => [
      workspaceId,
      session.messages.map((message) => ({ ...message })),
    ]),
  );
}

export function countPersistedMessages(history: PersistedChatHistory): number {
  return Object.values(history.sessions).reduce(
    (total, session) => total + session.messages.length,
    0,
  );
}
