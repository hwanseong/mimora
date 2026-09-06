import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ExternalActionResult } from '../chat';
import { AutoContextPanel } from './AutoContextPanel';
import { SourcesList } from './SourcesList';
import { RoutingStatus } from './RoutingStatus';
import { ExternalPayloadPreviewModal } from './ExternalPayloadPreviewModal';
import {
  createExternalPayloadPreview,
  type ExternalPayloadPreview,
} from '../security/externalPayloadPreview';
import { MarkdownRenderer } from './MarkdownRenderer';
import { getSecretRules } from '../security/secretDetector';

export function ChatMessages({
  messages,
  workspaceId,
  onApproveExternal,
  onUseLocalAI,
}: {
  messages: ChatMessage[];
  workspaceId: string;
  onApproveExternal: (
    assistantMessageId: string,
  ) => Promise<ExternalActionResult>;
  onUseLocalAI: (assistantMessageId: string) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<ExternalPayloadPreview | null>(null);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewActionMessageId, setPreviewActionMessageId] = useState<
    string | null
  >(null);
  const [processingActionMessageId, setProcessingActionMessageId] =
    useState<string | null>(null);
  const processingActionMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  function beginProcessingAction(messageId: string): boolean {
    if (processingActionMessageIdRef.current) {
      return false;
    }

    processingActionMessageIdRef.current = messageId;
    setProcessingActionMessageId(messageId);
    return true;
  }

  function finishProcessingAction(messageId: string): void {
    if (processingActionMessageIdRef.current !== messageId) {
      return;
    }

    processingActionMessageIdRef.current = null;
    setProcessingActionMessageId(null);
  }

  async function openExternalPreview(
    message: ChatMessage,
    assistantMessageId?: string,
  ): Promise<void> {
    if (!message.routingDecision) {
      return;
    }

    setLoadingMessageId(message.id);
    setPreviewError(null);

    try {
      const settings = await window.mimora.getSettings();
      const nextPreview = message.externalPayloadPreview ??
        createExternalPayloadPreview({
          workspaceId,
          effectiveSecurity: message.routingDecision.security,
          question: message.content,
          manualContexts: message.manualContext ?? [],
          autoContexts: message.autoContext ?? [],
          maskingEntries: settings.masking.entries,
          secretRules: getSecretRules(
            settings.secretDetection.customRules,
          ),
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
      setPreviewActionMessageId(
        assistantMessageId &&
          (nextPreview.status === 'review-required' ||
            nextPreview.status === 'block')
          ? assistantMessageId
          : null,
      );
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
              {message.role === 'assistant' ? (
                <MarkdownRenderer
                  className="chat-markdown"
                  content={message.content}
                />
              ) : (
                <p>{message.content}</p>
              )}
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
                <RoutingStatus
                  decision={message.routingDecision}
                  externalApproval={message.externalApproval}
                  model={message.model}
                />
              ) : null}
              {message.role === 'assistant' &&
              message.routingDecision?.provider === 'openai' &&
              message.responseUnmasking &&
              message.responseUnmasking.replacementCount > 0 ? (
                <small className="message-unmasking">
                  로컬에서 익명화 명칭 복원
                </small>
              ) : null}
              {message.role === 'assistant' && message.externalSafetyAction ? (
                <div className={`external-safety-action ${message.externalSafetyAction.status}`}>
                  <strong>
                    {message.externalSafetyAction.status === 'block'
                      ? '외부 전송 차단 사유'
                      : '사용자 검토 필요'}
                  </strong>
                  <ul>
                    {message.externalSafetyAction.secretDetections?.map(
                      (detection) => (
                        <li
                          key={`${detection.ruleId}-${detection.documentId ?? 'question'}`}
                        >
                          {detection.source === 'custom' ? 'Custom Rule: ' : ''}
                          {detection.ruleName} ·{' '}
                          {detection.documentId ?? 'User Question'} ·{' '}
                          {detection.count} match
                        </li>
                      ),
                    )}
                    {message.externalSafetyAction.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <div>
                    <button
                      className="secondary-button"
                      disabled={processingActionMessageId !== null}
                      onClick={() => {
                        const requestMessage = messages.find(
                          (candidate) =>
                            candidate.id ===
                            message.externalSafetyAction?.requestMessageId,
                        );

                        if (requestMessage) {
                          void openExternalPreview(requestMessage, message.id);
                        }
                      }}
                      type="button"
                    >
                      External Preview 확인
                    </button>
                    <button
                      className="secondary-button"
                      disabled={processingActionMessageId !== null}
                      onClick={() => {
                        if (!beginProcessingAction(message.id)) {
                          return;
                        }

                        void onUseLocalAI(message.id).finally(() => {
                          finishProcessingAction(message.id);
                        });
                      }}
                      type="button"
                    >
                      {processingActionMessageId === message.id
                        ? '처리 중…'
                        : 'Local AI로 처리'}
                    </button>
                  </div>
                </div>
              ) : null}
              {message.role === 'assistant' && message.externalPerformance ? (
                <small className="message-performance external">
                  <strong>OpenAI</strong>
                  <span>
                    {(message.externalPerformance.openAIRoundTripMs / 1_000).toFixed(1)}s
                    {message.usage?.inputTokens === undefined
                      ? ''
                      : ` · Input ${message.usage.inputTokens.toLocaleString()} tokens`}
                    {message.usage?.outputTokens === undefined
                      ? ''
                      : ` · Output ${message.usage.outputTokens.toLocaleString()} tokens`}
                  </span>
                </small>
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
        {previewError && !preview ? (
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
            setPreviewActionMessageId(null);
            setPreviewError(null);
          }}
          onApprove={
            previewActionMessageId && preview.status === 'review-required'
              ? async () => {
                  const messageId = previewActionMessageId;

                  if (!beginProcessingAction(messageId)) {
                    return;
                  }

                  setPreviewError(null);

                  try {
                    const result = await onApproveExternal(messageId);

                    if (result.ok) {
                      setPreview(null);
                      setPreviewActionMessageId(null);
                    } else {
                      setPreviewError(result.error);
                      if (result.preview) {
                        setPreview(result.preview);
                      }
                    }
                  } finally {
                    finishProcessingAction(messageId);
                  }
                }
              : undefined
          }
          onUseLocalAI={
            previewActionMessageId &&
            (preview.status === 'review-required' || preview.status === 'block')
              ? async () => {
                  const messageId = previewActionMessageId;

                  if (!beginProcessingAction(messageId)) {
                    return;
                  }

                  setPreviewError(null);

                  try {
                    await onUseLocalAI(messageId);
                    setPreview(null);
                    setPreviewActionMessageId(null);
                  } finally {
                    finishProcessingAction(messageId);
                  }
                }
              : undefined
          }
          actionError={previewError}
          isProcessing={processingActionMessageId !== null}
          preview={preview}
        />
      ) : null}
    </section>
  );
}
