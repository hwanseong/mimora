import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type {
  LLMChatRequest,
  LLMChatResponse,
} from '../../src/llmChat';
import type { ChatLLMProvider } from './LLMProvider';

const defaultTimeoutMs = 5_000;
export const CHAT_TIMEOUT_MS = 120_000;
export const MAX_RESPONSE_TOKENS = 256;

type OllamaModelResponse = {
  name?: unknown;
  model?: unknown;
  size?: unknown;
  details?: {
    parameter_size?: unknown;
    quantization_level?: unknown;
  } | null;
};

function createApiUrl(endpoint: string, apiPath: string): string {
  const trimmedEndpoint = endpoint.trim();

  if (!trimmedEndpoint) {
    throw new Error('Ollama Endpoint를 입력하세요.');
  }

  let endpointUrl: URL;

  try {
    endpointUrl = new URL(trimmedEndpoint);
  } catch {
    throw new Error('Ollama Endpoint 주소 형식이 올바르지 않습니다.');
  }

  if (!['http:', 'https:'].includes(endpointUrl.protocol)) {
    throw new Error('Ollama Endpoint는 HTTP 또는 HTTPS 주소여야 합니다.');
  }

  if (endpointUrl.username || endpointUrl.password) {
    throw new Error('Ollama Endpoint에 인증 정보를 포함할 수 없습니다.');
  }

  endpointUrl.search = '';
  endpointUrl.hash = '';
  endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, '')}${apiPath}`;

  return endpointUrl.toString();
}

function createTagsUrl(endpoint: string): string {
  return createApiUrl(endpoint, '/api/tags');
}

function createChatUrl(endpoint: string): string {
  return createApiUrl(endpoint, '/api/chat');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parseModels(value: unknown): LLMModel[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { models?: unknown }).models)
  ) {
    throw new Error('Ollama 응답에서 설치 모델 목록을 확인할 수 없습니다.');
  }

  const models = (value as { models: OllamaModelResponse[] }).models;
  const seenModels = new Set<string>();

  return models.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const name = optionalString(entry.name) ?? optionalString(entry.model);
    const model = optionalString(entry.model) ?? name;

    if (!name || !model || seenModels.has(model)) {
      return [];
    }

    seenModels.add(model);

    return [
      {
        name,
        model,
        ...(typeof entry.size === 'number' && Number.isFinite(entry.size)
          ? { size: entry.size }
          : {}),
        ...(optionalString(entry.details?.parameter_size)
          ? { parameterSize: optionalString(entry.details?.parameter_size) }
          : {}),
        ...(optionalString(entry.details?.quantization_level)
          ? {
              quantizationLevel: optionalString(
                entry.details?.quantization_level,
              ),
            }
          : {}),
      },
    ];
  });
}

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Ollama 연결 시간이 초과되었습니다.';
  }

  if (error instanceof TypeError) {
    return 'Ollama에 연결할 수 없습니다. Endpoint와 실행 상태를 확인하세요.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Ollama 연결 중 알 수 없는 오류가 발생했습니다.';
}

function getChatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Local AI 응답 시간이 초과되었습니다.';
  }

  if (error instanceof TypeError) {
    return 'Local AI에 연결할 수 없습니다. 설정에서 Ollama 연결 상태를 확인하세요.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Local AI 응답을 생성하지 못했습니다.';
}

function parseChatResponse(value: unknown): LLMChatResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Local AI 응답 형식이 올바르지 않습니다.');
  }

  const response = value as {
    model?: unknown;
    done?: unknown;
    message?: { content?: unknown } | null;
    total_duration?: unknown;
    load_duration?: unknown;
    prompt_eval_count?: unknown;
    prompt_eval_duration?: unknown;
    eval_count?: unknown;
    eval_duration?: unknown;
  };
  const content = optionalString(response.message?.content);

  if (!content) {
    throw new Error('Local AI가 빈 응답을 반환했습니다.');
  }

  const performance = {
    totalDurationNs: optionalNonNegativeNumber(response.total_duration),
    loadDurationNs: optionalNonNegativeNumber(response.load_duration),
    promptEvalCount: optionalNonNegativeNumber(response.prompt_eval_count),
    promptEvalDurationNs: optionalNonNegativeNumber(
      response.prompt_eval_duration,
    ),
    evalCount: optionalNonNegativeNumber(response.eval_count),
    evalDurationNs: optionalNonNegativeNumber(response.eval_duration),
  };
  const hasPerformance = Object.values(performance).some(
    (metric) => metric !== undefined,
  );

  return {
    content,
    ...(optionalString(response.model)
      ? { model: optionalString(response.model) }
      : {}),
    ...(typeof response.done === 'boolean' ? { done: response.done } : {}),
    ...(hasPerformance ? { performance } : {}),
  };
}

function extractOllamaError(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const errorText = value.trim();

    if (!errorText) {
      return undefined;
    }

    try {
      return extractOllamaError(JSON.parse(errorText)) ?? errorText;
    } catch {
      return errorText;
    }
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const errorResponse = value as Record<string, unknown>;

  return (
    extractOllamaError(errorResponse.error) ??
    extractOllamaError(errorResponse.message)
  );
}

async function readOllamaError(response: Response): Promise<string | undefined> {
  try {
    return extractOllamaError(await response.text());
  } catch {
    return undefined;
  }
}

function isContextLimitError(errorMessage: string | undefined): boolean {
  return Boolean(
    errorMessage &&
      (/exceed_context_size/i.test(errorMessage) ||
        /exceeds? the available context/i.test(errorMessage) ||
        /context (?:size|length|limit)/i.test(errorMessage)),
  );
}

export class OllamaProvider implements ChatLLMProvider {
  constructor(
    private readonly endpoint: string,
    private readonly model: string | null = null,
    private readonly timeoutMs = defaultTimeoutMs,
    private readonly responseTimeoutMs = CHAT_TIMEOUT_MS,
  ) {}

  async listModels(): Promise<LLMModel[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(createTagsUrl(this.endpoint), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Ollama가 오류 응답을 반환했습니다. (HTTP ${response.status})`,
        );
      }

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch {
        throw new Error('Ollama 응답 형식이 올바르지 않습니다.');
      }

      return parseModels(responseBody);
    } catch (error) {
      throw new Error(getConnectionErrorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const models = await this.listModels();

      return {
        connected: true,
        modelCount: models.length,
        message: `연결 성공 · 설치 모델 ${models.length}개`,
      };
    } catch (error) {
      return {
        connected: false,
        message: `연결 실패: ${getConnectionErrorMessage(error)}`,
      };
    }
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResponse> {
    if (!this.model) {
      throw new Error(
        'Local AI 모델이 선택되지 않았습니다. Settings에서 모델을 선택하세요.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.responseTimeoutMs,
    );

    try {
      const response = await fetch(createChatUrl(this.endpoint), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: false,
          options: {
            num_predict: MAX_RESPONSE_TOKENS,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const ollamaError = await readOllamaError(response);

        console.error('Ollama chat request failed.', {
          httpStatus: response.status,
          ollamaError: ollamaError ?? 'Ollama error body was unavailable.',
          model: this.model,
          endpoint: this.endpoint,
          requestMessageCount: request.messages.length,
        });

        if (response.status === 404) {
          throw new Error('선택된 Local AI 모델을 사용할 수 없습니다.');
        }

        if (isContextLimitError(ollamaError)) {
          throw new Error(
            '참고 문서의 내용이 너무 많아 Local AI의 Context 한도를 초과했습니다.',
          );
        }

        if (response.status === 400) {
          throw new Error('Local AI 요청 형식에 문제가 발생했습니다.');
        }

        throw new Error(
          `Local AI가 요청을 처리하지 못했습니다. (HTTP ${response.status})`,
        );
      }

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch {
        throw new Error('Local AI 응답 형식이 올바르지 않습니다.');
      }

      return parseChatResponse(responseBody);
    } catch (error) {
      throw new Error(getChatErrorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}
