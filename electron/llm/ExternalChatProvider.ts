import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type {
  ExternalAIChatRequest,
  ExternalAIChatResponse,
  ExternalChatProviderId,
} from '../../src/externalAI';

export type ExternalChatProviderMetadata = {
  providerId: ExternalChatProviderId;
  providerType: 'external';
  displayName: string;
  supportsChat: true;
  supportsEmbedding: boolean;
  apiKeyRequired: true;
};

export interface ExternalChatProvider {
  readonly metadata: ExternalChatProviderMetadata;
  listModels(): Promise<LLMModel[]>;
  testConnection(): Promise<ConnectionTestResult>;
  chat(request: ExternalAIChatRequest): Promise<ExternalAIChatResponse>;
}
