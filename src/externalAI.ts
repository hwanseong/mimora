import type { ConnectionTestResult, LLMModel } from './localAI';
import type { AIMode } from './security/securityRouter';
import type {
  OutboundPayloadDocumentMetadata,
  PayloadSafetyStatus,
} from './security/outboundPayloadSafety';
import type { ResponseUnmaskingSnapshotEntry } from './security/responseUnmasking';

export type ExternalAISettings = {
  provider: 'openai';
  model: string | null;
};

export type ExternalAIStatus = {
  hasApiKey: boolean;
};

export type OpenAIModel = LLMModel;
export type OpenAIConnectionTestResult = ConnectionTestResult;

export type OpenAIUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type OpenAIChatRequest = {
  model: string;
  input: string;
};

export type OpenAIChatResponse = {
  content: string;
  model?: string;
  usage?: OpenAIUsage;
};

export type ExternalAIChatInput = {
  workspaceId: string;
  mode: Extract<AIMode, 'auto' | 'external'>;
  externalText: string;
  documents: OutboundPayloadDocumentMetadata[];
  maskingSnapshot: ResponseUnmaskingSnapshotEntry[];
  approved: boolean;
};

export type ExternalAIExecutionMetrics = {
  openAIRoundTripMs: number;
  payloadChars: number;
  documentCount: number;
  responseChars: number;
  requestStartedAt: string;
  responseCompletedAt: string;
};

export type ExternalAIPerformanceMetrics = ExternalAIExecutionMetrics & {
  retrievalMs: number;
  totalElapsedMs: number;
};

export type ExternalAIChatResult = OpenAIChatResponse & {
  safetyStatus: PayloadSafetyStatus;
  performance: ExternalAIExecutionMetrics;
};

export const defaultExternalAISettings: ExternalAISettings = {
  provider: 'openai',
  model: null,
};
