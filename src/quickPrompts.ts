export type QuickPrompt = {
  label: string;
  prompt: string;
};

export const quickPrompts: QuickPrompt[] = [
  {
    label: '현재 업무 상태',
    prompt: '현재 선택된 업무영역의 전반적인 상태를 요약해줘.',
  },
  {
    label: '주요 리스크',
    prompt: '현재 선택된 업무영역의 주요 리스크를 분석해줘.',
  },
  {
    label: '이번 주 변화',
    prompt: '현재 선택된 업무영역에서 이번 주에 발생한 주요 변화를 정리해줘.',
  },
  {
    label: '미해결 이슈',
    prompt: '현재 선택된 업무영역의 주요 미해결 이슈를 정리해줘.',
  },
  {
    label: '다음 주 계획',
    prompt:
      '현재 선택된 업무영역에서 다음 주에 우선적으로 확인해야 할 사항을 정리해줘.',
  },
  {
    label: '의사결정 필요사항',
    prompt: '현재 선택된 업무영역에서 PM의 의사결정이 필요한 사항을 정리해줘.',
  },
];
