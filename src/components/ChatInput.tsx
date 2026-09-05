import { forwardRef } from 'react';

export const ChatInput = forwardRef<
  HTMLTextAreaElement,
  {
    disabled?: boolean;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  }
>(function ChatInput({ disabled = false, value, onChange, onSubmit }, ref) {
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
        placeholder={disabled ? 'Mimora가 분석 중입니다...' : '메시지를 입력하세요'}
        ref={ref}
        rows={1}
        value={value}
      />
      <button aria-label="전송" disabled={disabled} type="submit">
        {disabled ? '분석 중' : '전송'}
      </button>
    </form>
  );
});
