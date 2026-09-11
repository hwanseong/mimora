import type {
  ConnectionTestResult,
  LLMModel,
} from '../../src/localAI';
import type {
  ExternalAIChatRequest,
  ExternalAIChatResponse,
} from '../../src/externalAI';
import { aiProviderCatalog } from '../../src/externalAI';
import type { ExternalChatProvider } from './ExternalChatProvider';

export const GEMINI_API_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_CONNECTION_TIMEOUT_MS = 10_000;
export const GEMINI_CHAT_TIMEOUT_MS = 60_000;

const excludedModelNameParts = [
  'audio',
  'embedding',
  'image',
  'imagen',
  'live',
  'tts',
  'veo',
];

export type GeminiFetch = typeof fetch;

type GeminiModelRecord = {
  name?: string;
  baseModelId?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

type GeminiModelsResponse = {
  models?: GeminiModelRecord[];
};

type GeminiGenerateContentResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const MIMORA_GEMINI_SYSTEM_INSTRUCTION = `You are Mimora, an AI assistant for IT project managers.
Analyze only the information provided in the project context.
Do not infer the real identities behind anonymized placeholders such as [PERSON_001] or [CLIENT_001].
Do not invent missing project facts.
If the provided context is insufficient, state that clearly.
Answer in the same language as the user's question.`;

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function normalizeGeminiModelName(modelName: string): string {
  return modelName.replace(/^models\//u, '').trim();
}

function isGeminiChatModel(model: GeminiModelRecord): boolean {
  const modelId = normalizeGeminiModelName(model.name ?? model.baseModelId ?? '');
  const normalizedId = modelId.toLocaleLowerCase('en-US');

  return (
    Boolean(modelId) &&
    normalizedId.startsWith('gemini-') &&
    !excludedModelNameParts.some((part) => normalizedId.includes(part)) &&
    (model.supportedGenerationMethods ?? []).includes('generateContent')
  );
}

function getGeminiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'Gemini 연결 시간이 초과되었습니다.';
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

async function readErrorBody(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.text()).trim();
    return body ? body.slice(0, 400) : undefined;
  } catch {
    return undefined;
  }
}

export class GeminiProvider implements ExternalChatProvider {
  readonly metadata = {
    providerId: 'gemini',
    providerType: 'external',
    displayName: aiProviderCatalog.gemini.displayName,
    supportsChat: true,
    supportsEmbedding: false,
    apiKeyRequired: true,
  } as const;

  private readonly apiKey: string;
  private readonly fetchImpl: GeminiFetch;

  constructor(apiKey: string, fetchImpl: GeminiFetch = fetch) {
    const normalizedApiKey = apiKey.trim();

    if (!normalizedApiKey) {
      throw new Error('API Key가 설정되지 않았습니다.');
    }

    this.apiKey = normalizedApiKey;
    this.fetchImpl = fetchImpl;
  }

  async listModels(): Promise<LLMModel[]> {
    try {
      const response = await this.fetchImpl(
        `${GEMINI_API_BASE_URL}/models?pageSize=1000`,
        {
          headers: {
            'x-goog-api-key': this.apiKey,
          },
          signal: createTimeoutSignal(GEMINI_CONNECTION_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Gemini API Key 또는 권한을 확인하세요.'
            : `Gemini 모델 목록을 조회할 수 없습니다.${errorBody ? ` ${errorBody}` : ''}`,
        );
      }

      const payload = (await response.json()) as GeminiModelsResponse;

      return (payload.models ?? [])
        .filter(isGeminiChatModel)
        .map((model) => {
          const modelId = normalizeGeminiModelName(
            model.name ?? model.baseModelId ?? '',
          );

          return {
            name: model.displayName?.trim() || modelId,
            model: modelId,
          };
        })
        .sort((left, right) => left.model.localeCompare(right.model));
    } catch (error) {
      throw new Error(
        getGeminiErrorMessage(error, 'Gemini에 연결할 수 없습니다.'),
      );
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const models = await this.listModels();

      return {
        connected: true,
        modelCount: models.length,
        message: `Gemini 연결 성공 · 사용 가능한 텍스트 모델 ${models.length}개`,
      };
    } catch (error) {
      return {
        connected: false,
        message:
          error instanceof Error
            ? error.message
            : 'Gemini에 연결할 수 없습니다.',
      };
    }
  }

  async chat(
    request: ExternalAIChatRequest,
  ): Promise<ExternalAIChatResponse> {
    const model = request.model.trim();

    if (!model) {
      throw new Error('Gemini 모델을 선택하세요.');
    }

    try {
      const response = await this.fetchImpl(
        `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: MIMORA_GEMINI_SYSTEM_INSTRUCTION }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: request.input }],
              },
            ],
          }),
          signal: createTimeoutSignal(GEMINI_CHAT_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Gemini API Key 또는 모델 권한을 확인하세요.'
            : `Gemini 요청을 처리하지 못했습니다.${errorBody ? ` ${errorBody}` : ''}`,
        );
      }

      const payload = (await response.json()) as GeminiGenerateContentResponse;
      const content = (payload.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!content) {
        throw new Error('Gemini 응답이 비어 있습니다.');
      }

      return {
        content,
        model: payload.modelVersion ?? model,
        ...(payload.usageMetadata
          ? {
              usage: {
                inputTokens: payload.usageMetadata.promptTokenCount,
                outputTokens: payload.usageMetadata.candidatesTokenCount,
                totalTokens: payload.usageMetadata.totalTokenCount,
              },
            }
          : {}),
      };
    } catch (error) {
      throw new Error(
        getGeminiErrorMessage(error, 'Gemini 요청을 처리하지 못했습니다.'),
      );
    }
  }
}
