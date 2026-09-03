import { forwardRef } from 'react';

export const ChatInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
  }
>(function ChatInput({ value, onChange }, ref) {
  return (
    <form className="chat-input-bar" aria-label="메시지 입력">
      <textarea
        aria-label="메시지"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder="메시지를 입력하세요"
        ref={ref}
        rows={1}
        value={value}
      />
      <button aria-label="전송" type="button">
        전송
      </button>
    </form>
  );
});
