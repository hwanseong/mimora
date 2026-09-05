import type { AutoRetrievedContext } from './autoContext';
import type { AttachedContext } from './attachedContext';
import type {
  LLMContextSource,
  LocalAIPerformanceMetrics,
} from './llmChat';
import type { RoutingDecision } from './security/securityRouter';

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
  routingDecision?: RoutingDecision;
  manualContext?: AttachedContext[];
};

export type ChatSessions = Record<string, ChatMessage[]>;
