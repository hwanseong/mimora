import type { AutoRetrievedContext } from './autoContext';
import type { AttachedContext } from './attachedContext';
import type {
  LLMContextSource,
  LocalAIPerformanceMetrics,
} from './llmChat';
import type {
  ExternalAIPerformanceMetrics,
  OpenAIUsage,
} from './externalAI';
import type { ExternalPayloadPreview } from './security/externalPayloadPreview';
import type { SearchScopeSnapshot } from './searchScope';
import type { SecretDetection } from './security/secretDetector';
import type {
  ResponseUnmaskingSnapshotEntry,
  UnmaskingReplacement,
} from './security/responseUnmasking';
import type { AIMode, RoutingDecision } from './security/securityRouter';

export type ChatRequestStatus =
  | 'idle'
  | 'retrieving-context'
  | 'review-required'
  | 'calling-local'
  | 'calling-external'
  | 'completed'
  | 'error';

export type ExternalApprovalInfo = {
  required: boolean;
  approved: boolean;
  approvedAt?: string;
};

export type ExternalActionResult =
  | { ok: true }
  | { ok: false; error: string; preview?: ExternalPayloadPreview };

export function isChatRequestBusy(status: ChatRequestStatus): boolean {
  return (
    status === 'retrieving-context' ||
    status === 'calling-local' ||
    status === 'calling-external'
  );
}

export function tryBeginExternalAction(request: { inFlight: boolean }): boolean {
  if (request.inFlight) {
    return false;
  }

  request.inFlight = true;
  return true;
}

export type ExternalSafetyAction = {
  status: 'review-required' | 'block';
  requestMessageId: string;
  reasons: string[];
  secretDetections?: SecretDetection[];
};

export type ResponseUnmaskingInfo = {
  replacements: UnmaskingReplacement[];
  replacementCount: number;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  rawExternalResponse?: string;
  responseUnmaskingSnapshot?: ResponseUnmaskingSnapshotEntry[];
  responseUnmasking?: ResponseUnmaskingInfo;
  createdAt: string;
  autoContext?: AutoRetrievedContext[];
  autoContextStatus?: 'loading' | 'complete' | 'error';
  autoContextError?: string;
  requestStatus?: ChatRequestStatus;
  requestedMode?: AIMode;
  searchScopeSnapshot?: SearchScopeSnapshot;
  generationStatus?: 'loading' | 'complete' | 'error';
  generationErrorDetail?: string;
  sources?: LLMContextSource[];
  performance?: LocalAIPerformanceMetrics;
  externalPerformance?: ExternalAIPerformanceMetrics;
  routingDecision?: RoutingDecision;
  manualContext?: AttachedContext[];
  externalPayloadPreview?: ExternalPayloadPreview;
  externalSafetyAction?: ExternalSafetyAction;
  externalApproval?: ExternalApprovalInfo;
  model?: string;
  usage?: OpenAIUsage;
};

export type ChatSession = {
  sessionId: string;
  workspaceId: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatSessions = Record<string, ChatSession[]>;

export function createChatSession(input: {
  workspaceId: string;
  title?: string;
  sortOrder?: number;
  now?: string;
}): ChatSession {
  const now = input.now ?? new Date().toISOString();
  const title = input.title?.trim() || '새 대화';

  return {
    sessionId: `session-${Date.now()}-${crypto.randomUUID()}`,
    workspaceId: input.workspaceId,
    title,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function sortChatSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.title.localeCompare(right.title),
  );
}

export function getMostRecentChatSession(
  sessions: ChatSession[],
): ChatSession | undefined {
  return [...sessions].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.sortOrder - right.sortOrder,
  )[0];
}
