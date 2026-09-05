import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type { LLMProvider } from './LLMProvider';

const defaultTimeoutMs = 5_000;

type OllamaModelResponse = {
  name?: unknown;
  model?: unknown;
  size?: unknown;
  details?: {
    parameter_size?: unknown;
    quantization_level?: unknown;
  } | null;
};

function createTagsUrl(endpoint: string): string {
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
  endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, '')}/api/tags`;

  return endpointUrl.toString();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = defaultTimeoutMs,
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
}
