import type { VaultSecurity, VaultType } from './settings';
import type { MimoraDocumentMetadata } from './metadata/types';
import type { ContextBudgetResult } from './context/contextBudgetManager';

export const RECENT_HISTORY_MESSAGE_LIMIT = 4;

export type LLMChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMChatRequest = {
  messages: LLMChatMessage[];
};

export type LLMChatResponse = {
  content: string;
  model?: string;
  done?: boolean;
  performance?: OllamaResponsePerformance;
};

export type OllamaResponsePerformance = {
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalCount?: number;
  promptEvalDurationNs?: number;
  evalCount?: number;
  evalDurationNs?: number;
};

export type OllamaPerformanceMetrics = {
  totalMs?: number;
  loadMs?: number;
  promptEvalCount?: number;
  promptEvalMs?: number;
  promptTokensPerSecond?: number;
  evalCount?: number;
  evalMs?: number;
  generationTokensPerSecond?: number;
};

export type LocalAIExecutionMetrics = {
  contextBuildMs: number;
  ollamaRoundTripMs: number;
  queryChars: number;
  manualContextCount: number;
  autoContextCount: number;
  ragContextCount?: number;
  ragRetrievalMs?: number;
  ragRetrievalError?: string;
  documentCount: number;
  deduplicatedDocumentCount: number;
  rawContextChars: number;
  finalContextChars: number;
  historyMessageCount: number;
  historyChars: number;
  systemPromptChars: number;
  finalPromptChars: number;
  requestChars: number;
  responseChars: number;
  ollamaRequestStartedAt: string;
  ollamaResponseCompletedAt: string;
  ollama?: OllamaPerformanceMetrics;
};

export type LocalAIPerformanceMetrics = LocalAIExecutionMetrics & {
  retrievalMs: number;
  totalElapsedMs: number;
};

export type LLMContextDocument = {
  sourceType?: 'vault' | 'rag' | 'schedule' | 'issue';
  vaultId: string;
  vaultName: string;
  vaultType: VaultType;
  security: VaultSecurity;
  documentSecurity?: MimoraDocumentMetadata['security'];
  relativePath: string;
  fileName: string;
  metadata?: MimoraDocumentMetadata;
  ragDocumentId?: string;
  page?: number | null;
  heading?: string | null;
  relevanceScore?: number;
  snippet?: string;
  content: string;
};

export type LLMContextSource = Omit<
  LLMContextDocument,
  'content' | 'snippet'
>;

export type LLMChatDiagnostics = {
  queryChars: number;
  manualDocumentCount: number;
  autoDocumentCount: number;
  ragDocumentCount: number;
  deduplicatedDocumentCount: number;
  deliveredDocumentCount: number;
  manualRawChars: number;
  autoRawChars: number;
  rawContextChars: number;
  deduplicatedRawChars: number;
  finalContextChars: number;
  historyMessageCount: number;
  historyChars: number;
  systemPromptChars: number;
  finalUserPromptChars: number;
  totalRequestChars: number;
  requestMessageCount: number;
  contextBudget?: ContextBudgetResult;
};

export type LocalAIChatInput = {
  workspaceId: string;
  question: string;
  history: LLMChatMessage[];
  manualContexts: LLMContextDocument[];
  autoContexts: LLMContextDocument[];
};

export type LocalAIChatResult = Omit<LLMChatResponse, 'performance'> & {
  sources: LLMContextSource[];
  performance: LocalAIExecutionMetrics;
};
