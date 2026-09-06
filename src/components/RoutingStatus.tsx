import {
  effectiveSecurityLabels,
  routingReasonLabels,
  type RoutingDecision,
} from '../security/securityRouter';

export function RoutingStatus({
  decision,
  model,
}: {
  decision: RoutingDecision;
  model?: string;
}) {
  const providerLabel = decision.provider === 'local' ? 'Local AI' : 'OpenAI';
  const routeLabel =
    decision.reason === 'user-selected-local'
      ? 'External · Local fallback'
      : decision.mode === 'auto'
      ? 'Auto'
      : decision.mode === 'external'
        ? 'External'
        : 'Local';
  const safetyLabel =
    decision.safetyStatus === 'not-evaluated'
      ? null
      : `Safety ${decision.safetyStatus === 'review-required'
          ? 'REVIEW REQUIRED'
          : decision.safetyStatus.toUpperCase()}`;

  return (
    <small className="message-routing">
      <strong>
        {providerLabel} · {routeLabel}
        {decision.approved ? ' · User Approved' : ''}
      </strong>
      <span className={`routing-security ${decision.security}`}>
        {effectiveSecurityLabels[decision.security]}
        {safetyLabel ? ` · ${safetyLabel}` : ''}
        {decision.provider === 'local' &&
        (decision.mode === 'auto' || decision.reason === 'user-selected-local')
          ? ` · ${routingReasonLabels[decision.reason]}`
          : ''}
        {model ? ` · Model: ${model}` : ''}
      </span>
    </small>
  );
}
