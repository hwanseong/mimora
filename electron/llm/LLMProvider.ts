import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type {
  LLMChatRequest,
  LLMChatResponse,
} from '../../src/llmChat';

export interface LLMProvider {
  listModels(): Promise<LLMModel[]>;
  testConnection(): Promise<ConnectionTestResult>;
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
}
