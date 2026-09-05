import type { AutoRetrievedContext } from './autoContext';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  autoContext?: AutoRetrievedContext[];
  autoContextStatus?: 'loading' | 'complete' | 'error';
  autoContextError?: string;
};

export type ChatSessions = Record<string, ChatMessage[]>;

export function getAssistantTestResponse(
  autoContextCount: number,
  retrievalFailed = false,
): string {
  if (retrievalFailed) {
    return (
      'AI 모델은 아직 연결되지 않았습니다.\n' +
      '이번 질문의 관련 문서 검색을 완료하지 못했습니다.'
    );
  }

  if (autoContextCount === 0) {
    return (
      'AI 모델은 아직 연결되지 않았습니다.\n' +
      '이번 질문과 관련된 문서를 찾지 못했습니다.'
    );
  }

  return (
    'AI 모델은 아직 연결되지 않았습니다.\n' +
    `이번 질문과 관련된 문서 ${autoContextCount}개를 자동으로 찾았습니다.`
  );
}
