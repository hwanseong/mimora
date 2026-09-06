import type { ConnectionTestResult, LLMModel } from './localAI';

export type ExternalAISettings = {
  provider: 'openai';
  model: string | null;
};

export type ExternalAIStatus = {
  hasApiKey: boolean;
};

export type OpenAIModel = LLMModel;
export type OpenAIConnectionTestResult = ConnectionTestResult;

export const defaultExternalAISettings: ExternalAISettings = {
  provider: 'openai',
  model: null,
};
