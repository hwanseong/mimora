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
import type { SecretDetection } from './security/secretDetector';
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

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  autoContext?: AutoRetrievedContext[];
  autoContextStatus?: 'loading' | 'complete' | 'error';
  autoContextError?: string;
  requestStatus?: ChatRequestStatus;
  requestedMode?: AIMode;
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

export type ChatSessions = Record<string, ChatMessage[]>;
