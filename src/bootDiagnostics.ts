export type MimoraBootDiagnostics = {
  phase: string;
  bridgeExists: boolean;
  reactEntryLoaded: boolean;
  reactMounted: boolean;
  appRendered: boolean;
  workspaceLoadStatus: string;
  sessionLoadStatus: string;
  rendererConsoleErrorCount: number;
  lastError: string | null;
  updatedAt: string;
};

export const mimoraBootDiagnosticsEvent =
  'mimora-boot-diagnostics-changed';

declare global {
  interface Window {
    __mimoraBootDiagnostics?: MimoraBootDiagnostics;
    __mimoraBootDiagnosticsEnabled?: boolean;
  }
}

export function isBootDiagnosticsEnabled(): boolean {
  if (import.meta.env.VITE_MIMORA_BOOT_DIAGNOSTICS === '1') {
    return true;
  }

  if (new URLSearchParams(window.location.search).get('bootDiagnostics') === '1') {
    return true;
  }

  try {
    return window.localStorage.getItem('mimora.bootDiagnostics') === '1';
  } catch {
    return Boolean(window.__mimoraBootDiagnosticsEnabled);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getDefaultBootDiagnostics(): MimoraBootDiagnostics {
  return {
    phase: 'HTML loaded',
    bridgeExists: Boolean(window.mimora),
    reactEntryLoaded: false,
    reactMounted: false,
    appRendered: false,
    workspaceLoadStatus: 'pending',
    sessionLoadStatus: 'pending',
    rendererConsoleErrorCount: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

export function formatBootErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack].filter(Boolean).join('\n\n');
  }

  return String(error);
}

export function readBootDiagnostics(): MimoraBootDiagnostics {
  if (!window.__mimoraBootDiagnostics) {
    window.__mimoraBootDiagnostics = getDefaultBootDiagnostics();
  }

  return {
    ...window.__mimoraBootDiagnostics,
    bridgeExists: Boolean(window.mimora),
  };
}

function renderStaticBootMarker(state: MimoraBootDiagnostics): void {
  const marker = document.getElementById('mimora-boot-diagnostics');

  if (!marker) {
    return;
  }

  const enabled = isBootDiagnosticsEnabled();
  window.__mimoraBootDiagnosticsEnabled = enabled;
  document.documentElement.dataset.mimoraBootDiagnostics = enabled ? '1' : '0';

  if (!enabled) {
    return;
  }

  marker.innerHTML = `
    <strong>Mimora boot diagnostics</strong>
    <span>phase: ${escapeHtml(state.phase)}</span>
    <span>window.mimora: ${state.bridgeExists ? 'true' : 'false'}</span>
    <span>react: ${
      state.reactMounted
        ? 'mounted'
        : state.reactEntryLoaded
          ? 'entry loaded'
          : 'not loaded'
    }</span>
    <span>app: ${state.appRendered ? 'rendered' : 'not rendered'}</span>
    <span>workspace: ${escapeHtml(state.workspaceLoadStatus)}</span>
    <span>session: ${escapeHtml(state.sessionLoadStatus)}</span>
    <span>console errors: ${state.rendererConsoleErrorCount}</span>
    ${
      state.lastError
        ? `<span class="mimora-boot-error">last error: ${escapeHtml(
            state.lastError.slice(0, 240),
          )}</span>`
        : ''
    }
  `;
}

export function updateBootDiagnostics(
  patch: Partial<Omit<MimoraBootDiagnostics, 'updatedAt'>>,
): MimoraBootDiagnostics {
  const next = {
    ...readBootDiagnostics(),
    ...patch,
    bridgeExists: Boolean(window.mimora),
    updatedAt: new Date().toISOString(),
  };

  window.__mimoraBootDiagnostics = next;
  renderStaticBootMarker(next);
  window.dispatchEvent(new CustomEvent(mimoraBootDiagnosticsEvent));

  return next;
}

export function noteBootError(phase: string, error: unknown): void {
  const current = readBootDiagnostics();

  updateBootDiagnostics({
    phase,
    lastError: formatBootErrorDetail(error),
    rendererConsoleErrorCount: current.rendererConsoleErrorCount + 1,
  });
}
