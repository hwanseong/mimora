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
import type { RoutingDecision } from './security/securityRouter';

export type ExternalSafetyAction = {
  status: 'review-required' | 'block';
  requestMessageId: string;
  reasons: string[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  autoContext?: AutoRetrievedContext[];
  autoContextStatus?: 'loading' | 'complete' | 'error';
  autoContextError?: string;
  generationStatus?: 'loading' | 'complete' | 'error';
  generationErrorDetail?: string;
  sources?: LLMContextSource[];
  performance?: LocalAIPerformanceMetrics;
  externalPerformance?: ExternalAIPerformanceMetrics;
  routingDecision?: RoutingDecision;
  manualContext?: AttachedContext[];
  externalPayloadPreview?: ExternalPayloadPreview;
  externalSafetyAction?: ExternalSafetyAction;
  model?: string;
  usage?: OpenAIUsage;
};

export type ChatSessions = Record<string, ChatMessage[]>;
