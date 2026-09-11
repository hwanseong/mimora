import type { ExternalChatProviderId } from '../../src/externalAI';
import type { ExternalChatProvider } from './ExternalChatProvider';
import { GeminiProvider } from './GeminiProvider';
import { OpenAIProvider } from './OpenAIProvider';

export function createExternalChatProvider(
  providerId: ExternalChatProviderId,
  apiKey: string,
): ExternalChatProvider {
  switch (providerId) {
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'gemini':
      return new GeminiProvider(apiKey);
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unsupported external provider: ${exhaustive}`);
    }
  }
}
