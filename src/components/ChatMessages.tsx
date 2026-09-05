import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../chat';
import { AutoContextPanel } from './AutoContextPanel';

export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <section className="chat-messages" aria-label="대화 메시지">
      <div className="message-list">
        {messages.map((message) => (
          <article
            className={`message-row ${message.role}`}
            key={message.id}
          >
            <div className="message-content">
              {message.role === 'assistant' ? (
                <span className="message-label">Mimora</span>
              ) : null}
              <p>{message.content}</p>
              {message.role === 'user' && message.autoContextStatus ? (
                <AutoContextPanel
                  contexts={message.autoContext ?? []}
                  error={message.autoContextError}
                  status={message.autoContextStatus}
                />
              ) : null}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
