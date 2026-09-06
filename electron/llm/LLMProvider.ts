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
}

export interface ChatLLMProvider extends LLMProvider {
  chat(request: LLMChatRequest): Promise<LLMChatResponse>;
}
