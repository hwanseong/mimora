import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
} from '../../src/externalAI';
import type { LLMProvider } from './LLMProvider';

export const OPENAI_CONNECTION_TIMEOUT_MS = 10_000;
export const OPENAI_CHAT_TIMEOUT_MS = 60_000;
// Every Responses API request must use this policy value instead of relying on
// the API default. Callers cannot supply or override the storage policy.
export const OPENAI_STORE_RESPONSES = false;

export type OpenAIResponsesRequest = {
  model: string;
  input: string;
  instructions: string;
  store: false;
  stream: false;
};

export const MIMORA_OPENAI_INSTRUCTIONS = `You are Mimora, an AI assistant for IT project managers.
Analyze only the information provided in the project context.
Do not infer the real identities behind anonymized placeholders such as [PERSON_001] or [CLIENT_001].
Do not invent missing project facts.
If the provided context is insufficient, state that clearly.
Answer in the same language as the user's question.`;

type OpenAIModelRecord = {
  id: string;
};

type OpenAIModelsClient = {
  models: {
    list: () => Promise<{ data: OpenAIModelRecord[] }>;
  };
  responses: {
    create: (
      request: OpenAIResponsesRequest,
      options: { timeout: number },
    ) => Promise<{
      output_text?: string;
      model?: string;
      usage?: {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
      } | null;
    }>;
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

function getOpenAIErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

export function getOpenAIChatErrorMessage(error: unknown): string {
  const errorCode = getOpenAIErrorCode(error);

  if (
    errorCode === 'insufficient_quota' ||
    errorCode === 'billing_hard_limit_reached'
  ) {
    return 'OpenAI 사용 한도 또는 결제 상태를 확인하세요.';
  }

  if (
    error instanceof AuthenticationError ||
    (typeof error === 'object' && error !== null && 'status' in error && error.status === 401)
  ) {
    return 'OpenAI API Key를 확인하세요.';
  }

  if (error instanceof PermissionDeniedError) {
    return '이 API Key에는 선택한 OpenAI 모델을 사용할 권한이 없습니다.';
  }

  if (error instanceof RateLimitError) {
    return 'OpenAI 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.';
  }

  if (error instanceof APIConnectionTimeoutError) {
    return 'OpenAI 응답 시간이 초과되었습니다.';
  }

  if (error instanceof APIConnectionError) {
    return 'OpenAI에 연결할 수 없습니다. 네트워크 상태를 확인하세요.';
  }

  if (error instanceof NotFoundError || errorCode === 'model_not_found') {
    return '선택된 OpenAI 모델을 사용할 수 없습니다.';
  }

  if (error instanceof BadRequestError) {
    return 'OpenAI 요청을 처리할 수 없습니다. 모델 설정을 확인하세요.';
  }

  return 'OpenAI API 요청을 처리하지 못했습니다.';
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
    instructions: MIMORA_OPENAI_INSTRUCTIONS,
    store: OPENAI_STORE_RESPONSES,
    stream: false,
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

  async chat(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    try {
      const response = await this.client.responses.create(
        this.prepareResponseRequest(request.model, request.input),
        { timeout: OPENAI_CHAT_TIMEOUT_MS },
      );
      const content = response.output_text?.trim();

      if (!content) {
        throw new Error('empty_openai_response');
      }

      const usage = response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      return {
        content,
        ...(typeof response.model === 'string' && response.model.trim()
          ? { model: response.model.trim() }
          : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      throw new Error(getOpenAIChatErrorMessage(error));
    }
  }
}
