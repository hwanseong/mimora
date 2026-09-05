import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../chat';
import { AutoContextPanel } from './AutoContextPanel';
import { SourcesList } from './SourcesList';
import { RoutingStatus } from './RoutingStatus';
import { ExternalPayloadPreviewModal } from './ExternalPayloadPreviewModal';
import {
  createExternalPayloadPreview,
  type ExternalPayloadPreview,
} from '../security/externalPayloadPreview';

export function ChatMessages({
  messages,
  workspaceId,
}: {
  messages: ChatMessage[];
  workspaceId: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<ExternalPayloadPreview | null>(null);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function openExternalPreview(message: ChatMessage): Promise<void> {
    if (!message.routingDecision) {
      return;
    }

    setLoadingMessageId(message.id);
    setPreviewError(null);

    try {
      const settings = await window.mimora.getSettings();
      const nextPreview = createExternalPayloadPreview({
        workspaceId,
        effectiveSecurity: message.routingDecision.security,
        question: message.content,
        manualContexts: message.manualContext ?? [],
        autoContexts: message.autoContext ?? [],
        maskingEntries: settings.masking.entries,
      });

      console.info('[Mimora External Preview]', {
        workspace: nextPreview.workspaceId,
        security: nextPreview.effectiveSecurity,
        documents: nextPreview.documentCount,
        replacementCount: nextPreview.totalReplacementCount,
        maskedQuestionChars: nextPreview.maskedQuestion.length,
        maskedContextChars: nextPreview.maskedContextChars,
        status: nextPreview.status,
      });
      setPreview(nextPreview);
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'External Preview를 생성하지 못했습니다.',
      );
    } finally {
      setLoadingMessageId(null);
    }
  }

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
              {message.role === 'user' && message.routingDecision ? (
                <button
                  className="external-preview-trigger"
                  disabled={loadingMessageId !== null}
                  onClick={() => {
                    void openExternalPreview(message);
                  }}
                  type="button"
                >
                  {loadingMessageId === message.id
                    ? 'Preview 생성 중…'
                    : 'External Preview'}
                </button>
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
        {previewError ? (
          <p className="external-preview-error" role="alert">
            {previewError}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>
      {preview ? (
        <ExternalPayloadPreviewModal
          onClose={() => {
            setPreview(null);
          }}
          preview={preview}
        />
      ) : null}
    </section>
  );
}
