import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../chat';
import { AutoContextPanel } from './AutoContextPanel';
import { SourcesList } from './SourcesList';
import { RoutingStatus } from './RoutingStatus';

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
            <div
              className={`message-content${
                message.generationStatus === 'loading' ? ' is-loading' : ''
              }${message.generationStatus === 'error' ? ' is-error' : ''}`}
            >
              {message.role === 'assistant' ? (
                <span className="message-label">Mimora</span>
              ) : null}
              <p>{message.content}</p>
              {message.generationErrorDetail ? (
                <small className="message-error-detail">
                  {message.generationErrorDetail}
                </small>
              ) : null}
              {message.role === 'user' && message.autoContextStatus ? (
                <AutoContextPanel
                  contexts={message.autoContext ?? []}
                  error={message.autoContextError}
                  status={message.autoContextStatus}
                />
              ) : null}
              {message.role === 'assistant' && message.sources ? (
                <SourcesList sources={message.sources} />
              ) : null}
              {message.role === 'assistant' && message.routingDecision ? (
                <RoutingStatus decision={message.routingDecision} />
              ) : null}
              {import.meta.env.DEV &&
              message.role === 'assistant' &&
              message.performance ? (
                <small className="message-performance">
                  <strong>Performance</strong>
                  <span>
                    {(message.performance.totalElapsedMs / 1_000).toFixed(1)}s
                    {' · '}Prompt{' '}
                    {message.performance.ollama?.promptEvalMs === undefined
                      ? '—'
                      : `${(
                          message.performance.ollama.promptEvalMs / 1_000
                        ).toFixed(1)}s`}
                    {' · '}Generate{' '}
                    {message.performance.ollama?.evalMs === undefined
                      ? '—'
                      : `${(
                          message.performance.ollama.evalMs / 1_000
                        ).toFixed(1)}s`}
                  </span>
                </small>
              ) : null}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
