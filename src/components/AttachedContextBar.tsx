import type { AttachedContext } from '../attachedContext';
import { vaultSecurityLabels } from '../settings';

export function AttachedContextBar({
  contexts,
  onRemove,
}: {
  contexts: AttachedContext[];
  onRemove: (contextId: string) => void;
}) {
  if (contexts.length === 0) {
    return null;
  }

  const containsSensitive = contexts.some(
    (context) => context.security === 'sensitive',
  );
  const containsPrivate = contexts.some(
    (context) => context.vaultType === 'private',
  );
  const securityNotice = containsSensitive
    ? '🔒 Sensitive Context 포함'
    : containsPrivate
      ? '🔒 Private Context 포함'
      : null;

  return (
    <section className="attached-context-bar" aria-label="Attached Context">
      <div className="attached-context-heading">
        <strong>Attached Context {contexts.length}</strong>
        {securityNotice ? <span>{securityNotice}</span> : null}
      </div>
      <div className="attached-context-chips">
        {contexts.map((context) => (
          <div
            className="attached-context-chip"
            key={context.id}
            title={`${context.vaultName} · ${context.relativePath} · ${vaultSecurityLabels[context.security]}`}
          >
            <span>{context.fileName}</span>
            <button
              aria-label={`${context.fileName} Context 제거`}
              onClick={() => {
                onRemove(context.id);
              }}
              title={`${context.fileName} 제거`}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
