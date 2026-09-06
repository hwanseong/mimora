import {
  effectiveSecurityLabels,
  routingReasonLabels,
  type RoutingDecision,
} from '../security/securityRouter';
import type { ExternalApprovalInfo } from '../chat';

export function RoutingStatus({
  decision,
  model,
  externalApproval,
}: {
  decision: RoutingDecision;
  model?: string;
  externalApproval?: ExternalApprovalInfo;
}) {
  const providerLabel = decision.provider === 'local' ? 'Local AI' : 'OpenAI';
  const userApproved = externalApproval?.approved ?? decision.approved;
  const routeLabel =
    decision.reason === 'user-selected-local-fallback'
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
        {userApproved ? ' · User Approved' : ''}
      </strong>
      <span className={`routing-security ${decision.security}`}>
        {effectiveSecurityLabels[decision.security]}
        {safetyLabel ? ` · ${safetyLabel}` : ''}
        {decision.provider === 'local' &&
        (decision.mode === 'auto' ||
          decision.reason === 'user-selected-local-fallback')
          ? ` · ${routingReasonLabels[decision.reason]}`
          : ''}
        {model ? ` · Model: ${model}` : ''}
      </span>
    </small>
  );
}
