import { forwardRef } from 'react';
import {
  isChatRequestBusy,
  type ChatRequestStatus,
} from '../chat';

export const ChatInput = forwardRef<
  HTMLTextAreaElement,
  {
    requestStatus?: ChatRequestStatus;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  }
>(function ChatInput(
  { requestStatus = 'idle', value, onChange, onSubmit },
  ref,
) {
  const disabled = isChatRequestBusy(requestStatus);
  const placeholder =
    requestStatus === 'retrieving-context'
      ? '참고 문서를 찾는 중입니다...'
      : requestStatus === 'calling-external'
        ? 'OpenAI가 분석 중입니다...'
        : requestStatus === 'calling-local'
          ? 'Local AI가 분석 중입니다...'
          : requestStatus === 'review-required'
            ? '외부 전송 검토가 필요합니다.'
            : '메시지를 입력하세요';
  const buttonLabel =
    requestStatus === 'retrieving-context'
      ? '검색 중'
      : requestStatus === 'calling-external' ||
          requestStatus === 'calling-local'
        ? '분석 중'
        : '전송';

  return (
    <form
      className="chat-input-bar"
      aria-label="메시지 입력"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        aria-label="메시지"
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        ref={ref}
        rows={1}
        value={value}
      />
      <button aria-label="전송" disabled={disabled} type="submit">
        {buttonLabel}
      </button>
    </form>
  );
});
