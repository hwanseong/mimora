import { useEffect, useState } from 'react';
import type { WorkspaceRegistryParseResult } from '../registry/workspaceRegistryTypes';
import { ScheduleIntelligenceSection } from './SettingsView';

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Schedule Documents could not be loaded.';
}

export function ScheduleDocumentsView() {
  const [workspaceRegistry, setWorkspaceRegistry] =
    useState<WorkspaceRegistryParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void window.mimora
      .loadWorkspaceRegistry()
      .then((loadedWorkspaceRegistry) => {
        if (isMounted) {
          setWorkspaceRegistry(loadedWorkspaceRegistry);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="settings-view">
        <p className="settings-error">Loading Schedule Documents...</p>
      </section>
    );
  }

  return (
    <section className="settings-view" aria-labelledby="schedule-documents-heading">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Schedule Intelligence</p>
          <h1 id="schedule-documents-heading">Schedule Documents</h1>
        </div>
      </div>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <ScheduleIntelligenceSection workspaceRegistry={workspaceRegistry} />
    </section>
  );
}
