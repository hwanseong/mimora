export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export const assistantTestResponse =
  '현재 AI 모델이 연결되지 않았습니다.\n이 메시지는 Mimora Chat UI 동작 확인을 위한 테스트 응답입니다.';
