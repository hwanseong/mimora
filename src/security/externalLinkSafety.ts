export type ExternalLinkDecision =
  | {
      allowed: true;
      normalizedUrl: string;
      protocol: string;
    }
  | {
      allowed: false;
      reason: 'invalid-url' | 'blocked-protocol';
      protocol?: string;
    };

export const allowedExternalProtocols = new Set(['https:', 'mailto:']);

export function validateExternalLinkUrl(url: string): ExternalLinkDecision {
  if (typeof url !== 'string' || !url.trim()) {
    return {
      allowed: false,
      reason: 'invalid-url',
    };
  }

  try {
    const parsed = new URL(url.trim());

    if (!allowedExternalProtocols.has(parsed.protocol)) {
      return {
        allowed: false,
        reason: 'blocked-protocol',
        protocol: parsed.protocol,
      };
    }

    return {
      allowed: true,
      normalizedUrl: parsed.toString(),
      protocol: parsed.protocol,
    };
  } catch {
    return {
      allowed: false,
      reason: 'invalid-url',
    };
  }
}
