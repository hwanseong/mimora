import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';

export interface LLMProvider {
  listModels(): Promise<LLMModel[]>;
  testConnection(): Promise<ConnectionTestResult>;
}
