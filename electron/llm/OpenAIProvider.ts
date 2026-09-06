import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type { LLMProvider } from './LLMProvider';

export const OPENAI_CONNECTION_TIMEOUT_MS = 10_000;
// External inference is intentionally not connected yet. Future Responses API
// requests must use this policy value instead of relying on the API default.
export const OPENAI_STORE_RESPONSES = false;

export type OpenAIResponsesRequest = {
  model: string;
  input: string;
  store: false;
};

type OpenAIModelRecord = {
  id: string;
};

type OpenAIModelsClient = {
  models: {
    list: () => Promise<{ data: OpenAIModelRecord[] }>;
  };
};

type OpenAIClientFactory = (
  apiKey: string,
  timeoutMs: number,
) => OpenAIModelsClient;

const excludedModelNameParts = [
  'audio',
  'dall-e',
  'embedding',
  'image',
  'moderation',
  'realtime',
  'search',
  'sora',
  'transcribe',
  'tts',
  'whisper',
];

function isTextGenerationModel(modelId: string): boolean {
  const normalizedId = modelId.toLocaleLowerCase('en-US');
  const familyId = normalizedId.startsWith('ft:')
    ? normalizedId.slice(3)
    : normalizedId;
  const hasSupportedFamily =
    familyId.startsWith('gpt-') ||
    familyId.startsWith('chatgpt-') ||
    /^o\d+(?:-|$)/.test(familyId);

  return (
    hasSupportedFamily &&
    !excludedModelNameParts.some((part) => normalizedId.includes(part))
  );
}

function createDefaultClient(
  apiKey: string,
  timeoutMs: number,
): OpenAIModelsClient {
  return new OpenAI({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 0,
  });
}

export function getOpenAIConnectionErrorMessage(error: unknown): string {
  if (
    error instanceof AuthenticationError ||
    (typeof error === 'object' && error !== null && 'status' in error && error.status === 401)
  ) {
    return 'API Key가 유효하지 않습니다.';
  }

  if (error instanceof PermissionDeniedError) {
    return '이 API Key에는 모델 목록을 조회할 권한이 없습니다.';
  }

  if (error instanceof RateLimitError) {
    return 'OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.';
  }

  if (error instanceof APIConnectionTimeoutError) {
    return 'OpenAI 연결 시간이 초과되었습니다.';
  }

  if (error instanceof APIConnectionError) {
    return 'OpenAI에 연결할 수 없습니다. 네트워크 상태를 확인하세요.';
  }

  return 'OpenAI에 연결할 수 없습니다.';
}

export function createOpenAIResponsesRequest(
  model: string,
  input: string,
): OpenAIResponsesRequest {
  const normalizedModel = model.trim();

  if (!normalizedModel) {
    throw new Error('OpenAI 모델이 선택되지 않았습니다.');
  }

  return {
    model: normalizedModel,
    input,
    store: OPENAI_STORE_RESPONSES,
  };
}

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAIModelsClient;

  constructor(
    apiKey: string,
    timeoutMs = OPENAI_CONNECTION_TIMEOUT_MS,
    createClient: OpenAIClientFactory = createDefaultClient,
  ) {
    const normalizedApiKey = apiKey.trim();

    if (!normalizedApiKey) {
      throw new Error('API Key가 설정되지 않았습니다.');
    }

    this.client = createClient(normalizedApiKey, timeoutMs);
  }

  async listModels(): Promise<LLMModel[]> {
    try {
      const page = await this.client.models.list();
      const seenModelIds = new Set<string>();

      return page.data
        .flatMap((model) => {
          const modelId = model.id.trim();

          if (
            !modelId ||
            seenModelIds.has(modelId) ||
            !isTextGenerationModel(modelId)
          ) {
            return [];
          }

          seenModelIds.add(modelId);
          return [{ name: modelId, model: modelId }];
        })
        .sort((left, right) => left.model.localeCompare(right.model));
    } catch (error) {
      throw new Error(getOpenAIConnectionErrorMessage(error));
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const models = await this.listModels();

      return {
        connected: true,
        modelCount: models.length,
        message: `OpenAI 연결 성공 · 사용 가능한 텍스트 모델 ${models.length}개`,
      };
    } catch (error) {
      return {
        connected: false,
        message:
          error instanceof Error
            ? error.message
            : 'OpenAI에 연결할 수 없습니다.',
      };
    }
  }

  prepareResponseRequest(model: string, input: string): OpenAIResponsesRequest {
    return createOpenAIResponsesRequest(model, input);
  }
}
