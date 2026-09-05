import {
  effectiveSecurityLabels,
  routingReasonLabels,
  type RoutingDecision,
} from '../security/securityRouter';

export function RoutingStatus({
  decision,
}: {
  decision: RoutingDecision;
}) {
  const providerLabel = decision.provider === 'local' ? 'Local AI' : '';
  const routeLabel =
    decision.reason === 'forced-local'
      ? routingReasonLabels[decision.reason]
      : decision.mode === 'auto'
        ? 'Auto'
        : 'Local';

  return (
    <small className="message-routing">
      <strong>
        {providerLabel} · {routeLabel}
      </strong>
      <span className={`routing-security ${decision.security}`}>
        {effectiveSecurityLabels[decision.security]}
        {decision.reason === 'forced-local'
          ? ''
          : ` · ${routingReasonLabels[decision.reason]}`}
      </span>
    </small>
  );
}
