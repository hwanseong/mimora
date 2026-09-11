import type { ConnectionTestResult, LLMModel } from './localAI';
import type { AIMode } from './security/securityRouter';
import type {
  OutboundPayloadDocumentMetadata,
  PayloadSafetyStatus,
} from './security/outboundPayloadSafety';
import type { ResponseUnmaskingSnapshotEntry } from './security/responseUnmasking';

export const externalChatProviderOptions = ['openai', 'gemini'] as const;
export type ExternalChatProviderId =
  (typeof externalChatProviderOptions)[number];
export type AIProviderId = 'ollama' | ExternalChatProviderId;
export type AIProviderType = 'local' | 'external';

export type AIProviderMetadata = {
  providerId: AIProviderId;
  providerType: AIProviderType;
  displayName: string;
  supportsChat: boolean;
  supportsEmbedding: boolean;
  apiKeyRequired: boolean;
  defaultChatModel?: string;
};

export const aiProviderCatalog: Record<AIProviderId, AIProviderMetadata> = {
  ollama: {
    providerId: 'ollama',
    providerType: 'local',
    displayName: 'Ollama',
    supportsChat: true,
    supportsEmbedding: true,
    apiKeyRequired: false,
  },
  openai: {
    providerId: 'openai',
    providerType: 'external',
    displayName: 'OpenAI',
    supportsChat: true,
    supportsEmbedding: true,
    apiKeyRequired: true,
  },
  gemini: {
    providerId: 'gemini',
    providerType: 'external',
    displayName: 'Google Gemini',
    supportsChat: true,
    supportsEmbedding: false,
    apiKeyRequired: true,
    defaultChatModel: 'gemini-2.5-flash',
  },
};

export type ExternalAISettings = {
  provider: ExternalChatProviderId;
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

export type ExternalAIUsage = OpenAIUsage;

export type ExternalAIChatRequest = {
  model: string;
  input: string;
};

export type ExternalAIChatResponse = {
  content: string;
  model?: string;
  usage?: ExternalAIUsage;
};

export type OpenAIChatRequest = ExternalAIChatRequest;
export type OpenAIChatResponse = ExternalAIChatResponse;

export type ExternalAIChatInput = {
  workspaceId: string;
  mode: Extract<AIMode, 'auto' | 'external'>;
  externalText: string;
  documents: OutboundPayloadDocumentMetadata[];
  maskingSnapshot: ResponseUnmaskingSnapshotEntry[];
  approved: boolean;
};

export type ExternalAIExecutionMetrics = {
  externalRoundTripMs: number;
  openAIRoundTripMs: number;
  providerId: ExternalChatProviderId;
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

export function getAIProviderType(providerId: AIProviderId): AIProviderType {
  return aiProviderCatalog[providerId]?.providerType ?? 'external';
}

export function getAIProviderDisplayName(providerId: AIProviderId): string {
  return aiProviderCatalog[providerId]?.displayName ?? providerId;
}

export function isExternalChatProviderId(
  value: unknown,
): value is ExternalChatProviderId {
  return (
    typeof value === 'string' &&
    externalChatProviderOptions.includes(value as ExternalChatProviderId)
  );
}
