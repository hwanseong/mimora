import { useEffect, useState } from 'react';
import { defaultSettings, type MimoraSettings } from '../settings';
import type { WorkspaceRegistryParseResult } from '../registry/workspaceRegistryTypes';
import { RagDocumentLibrarySection } from './SettingsView';

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'RAG 문서 화면을 불러오지 못했습니다.';
}

export function RagDocumentsView() {
  const [settings, setSettings] = useState<MimoraSettings>(defaultSettings);
  const [workspaceRegistry, setWorkspaceRegistry] =
    useState<WorkspaceRegistryParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadRagPageData(): Promise<void> {
      try {
        const [loadedSettings, loadedWorkspaceRegistry] = await Promise.all([
          window.mimora.getSettings(),
          window.mimora.loadWorkspaceRegistry(),
        ]);

        if (isMounted) {
          setSettings(loadedSettings);
          setWorkspaceRegistry(loadedWorkspaceRegistry);
          setError(null);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRagPageData();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="settings-view rag-documents-view">
        <p className="settings-error">RAG 문서 화면을 불러오는 중입니다...</p>
      </section>
    );
  }

  return (
    <section className="settings-view rag-documents-view" aria-labelledby="rag-documents-view-heading">
      <div className="settings-header">
        <div>
          <p className="eyebrow">RAG</p>
          <h1 id="rag-documents-view-heading">RAG 문서</h1>
        </div>
      </div>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <RagDocumentLibrarySection
        ragSettings={settings.rag}
        workspaceRegistry={workspaceRegistry}
      />
    </section>
  );
}
