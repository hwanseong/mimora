export const llmProviderOptions = ['ollama', 'openai', 'gemini'] as const;

export type LLMProviderType = (typeof llmProviderOptions)[number];
export type LocalAIProviderType = Extract<LLMProviderType, 'ollama'>;

export type LocalAISettings = {
  provider: LocalAIProviderType;
  endpoint: string;
  model: string | null;
};

export type LocalAIConnectionInput = Pick<
  LocalAISettings,
  'provider' | 'endpoint'
>;

export type LLMModel = {
  name: string;
  model: string;
  size?: number;
  parameterSize?: string;
  quantizationLevel?: string;
};

export type ConnectionTestResult = {
  connected: boolean;
  modelCount?: number;
  message: string;
};

export const defaultLocalAISettings: LocalAISettings = {
  provider: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  model: null,
};
