import type { AutoRetrievedContext } from './autoContext';
import type {
  LLMContextSource,
  LocalAIPerformanceMetrics,
} from './llmChat';

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
};

export type ChatSessions = Record<string, ChatMessage[]>;
