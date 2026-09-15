import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  formatBootErrorDetail,
  noteBootError,
  updateBootDiagnostics,
} from './bootDiagnostics';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  updateBootDiagnostics({
    phase: 'Root element missing',
    lastError: 'Root element was not found.',
  });
  throw new Error('Root element was not found.');
}

const appRoot = rootElement;

updateBootDiagnostics({
  phase: 'React entry loaded',
  reactEntryLoaded: true,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderBootError(title: string, error: unknown): void {
  const detail = import.meta.env.DEV
    ? `<pre style="margin: 16px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #344054;">${escapeHtml(
        formatBootErrorDetail(error),
      )}</pre>`
    : '';

  appRoot.innerHTML = `
    <main style="font-family: system-ui, sans-serif; min-height: 100vh; padding: 32px; color: #111827; background: #f8fafc;">
      <section style="max-width: 760px; border: 1px solid #d0d5dd; border-radius: 8px; background: #ffffff; padding: 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);">
        <h1 style="margin: 0 0 8px; font-size: 20px;">${escapeHtml(title)}</h1>
        <p style="margin: 0; color: #667085;">Mimora renderer boot failed. Check the Electron console for the matching diagnostic log.</p>
        ${detail}
      </section>
    </main>
  `;
}

const originalConsoleError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const current = window.__mimoraBootDiagnostics?.rendererConsoleErrorCount ?? 0;

  updateBootDiagnostics({
    rendererConsoleErrorCount: current + 1,
    lastError: args.map(formatBootErrorDetail).join('\n'),
  });
  originalConsoleError(...args);
};

class BootErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    noteBootError('React render failed', error);
    console.error('[Mimora Boot] React render failed', {
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="boot-error-screen">
          <section className="boot-error-card">
            <h1>Mimora 초기화 실패</h1>
            <p>Renderer render 단계에서 오류가 발생했습니다.</p>
            {import.meta.env.DEV ? (
              <pre>{formatBootErrorDetail(this.state.error)}</pre>
            ) : null}
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

window.addEventListener('error', (event) => {
  noteBootError('Uncaught renderer error', event.error ?? event.message);
  console.error('[Mimora Boot] uncaught error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  noteBootError('Unhandled renderer rejection', event.reason);
  console.error('[Mimora Boot] unhandled rejection', event.reason);
});

if (!window.mimora) {
  updateBootDiagnostics({
    phase: 'Desktop bridge unavailable',
    lastError:
      'Run Mimora through Electron dev mode. The browser-only Vite page does not expose window.mimora.',
  });
  renderBootError(
    'Mimora desktop bridge unavailable',
    'Run Mimora through Electron dev mode. The browser-only Vite page does not expose window.mimora.',
  );
} else {
  updateBootDiagnostics({
    phase: 'React mount scheduled',
  });
  createRoot(appRoot).render(
    <StrictMode>
      <BootErrorBoundary>
        <App />
      </BootErrorBoundary>
    </StrictMode>,
  );
  requestAnimationFrame(() => {
    updateBootDiagnostics({
      phase: 'React mounted',
      reactMounted: true,
    });
  });
}
