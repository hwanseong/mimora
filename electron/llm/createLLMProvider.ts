import type { LocalAIConnectionInput } from '../../src/localAI';
import type { LLMProvider } from './LLMProvider';
import { OllamaProvider } from './OllamaProvider';

function isLocalAIConnectionInput(
  value: unknown,
): value is LocalAIConnectionInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as LocalAIConnectionInput).provider === 'ollama' &&
    typeof (value as LocalAIConnectionInput).endpoint === 'string'
  );
}

export function createLLMProvider(input: unknown): LLMProvider {
  if (!isLocalAIConnectionInput(input)) {
    throw new Error('지원하지 않는 Local AI Provider 설정입니다.');
  }

  return new OllamaProvider(input.endpoint);
}
