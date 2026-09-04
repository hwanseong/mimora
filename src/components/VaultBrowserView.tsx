import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  defaultSettings,
  vaultSecurityLabels,
  vaultTypeLabels,
  type MimoraSettings,
} from '../settings';
import type { VaultFile, VaultFileContent } from '../vaultFiles';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function VaultBrowserView({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const [settings, setSettings] = useState<MimoraSettings>(defaultSettings);
  const [selectedVaultId, setSelectedVaultId] = useState('');
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [fileContent, setFileContent] = useState<VaultFileContent | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const previewRequestSequence = useRef(0);

  const selectedVault =
    settings.vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  const shouldRecommendLocalOnly = Boolean(
    selectedVault?.type === 'private' || selectedVault?.security === 'sensitive',
  );

  useEffect(() => {
    let isActive = true;

    async function loadSettings(): Promise<void> {
      try {
        const loadedSettings = await window.mimora.getSettings();

        if (!isActive) {
          return;
        }

        setSettings(loadedSettings);
        setSelectedVaultId((currentVaultId) => {
          if (loadedSettings.vaults.some((vault) => vault.id === currentVaultId)) {
            return currentVaultId;
          }

          return loadedSettings.vaults[0]?.id ?? '';
        });
      } catch (error) {
        if (isActive) {
          setSettingsError(
            getErrorMessage(error, 'Vault 설정을 불러오지 못했습니다.'),
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingSettings(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    previewRequestSequence.current += 1;
    setSelectedFile(null);
    setFileContent(null);
    setPreviewError(null);
    setIsLoadingPreview(false);

    if (!selectedVaultId) {
      setFiles([]);
      setListError(null);
      setIsLoadingFiles(false);
      return;
    }

    let isActive = true;

    async function loadFiles(): Promise<void> {
      setIsLoadingFiles(true);
      setListError(null);

      try {
        const loadedFiles = await window.mimora.listVaultFiles(selectedVaultId);

        if (isActive) {
          setFiles(loadedFiles);
        }
      } catch (error) {
        if (isActive) {
          setFiles([]);
          setListError(
            getErrorMessage(error, 'Markdown 파일 목록을 불러오지 못했습니다.'),
          );
        }
      } finally {
        if (isActive) {
          setIsLoadingFiles(false);
        }
      }
    }

    void loadFiles();

    return () => {
      isActive = false;
    };
  }, [refreshSequence, selectedVaultId]);

  async function openFile(file: VaultFile): Promise<void> {
    if (!selectedVaultId) {
      return;
    }

    const requestSequence = previewRequestSequence.current + 1;
    previewRequestSequence.current = requestSequence;
    setSelectedFile(file);
    setFileContent(null);
    setPreviewError(null);
    setIsLoadingPreview(true);

    try {
      const loadedContent = await window.mimora.readVaultFile(
        selectedVaultId,
        file.relativePath,
      );

      if (previewRequestSequence.current === requestSequence) {
        setFileContent(loadedContent);
      }
    } catch (error) {
      if (previewRequestSequence.current === requestSequence) {
        setPreviewError(
          getErrorMessage(error, 'Markdown 파일을 읽지 못했습니다.'),
        );
      }
    } finally {
      if (previewRequestSequence.current === requestSequence) {
        setIsLoadingPreview(false);
      }
    }
  }

  if (isLoadingSettings) {
    return (
      <section className="vault-browser-view" aria-labelledby="vault-browser-heading">
        <div className="vault-browser-header">
          <div>
            <p className="eyebrow">Vault</p>
            <h1 id="vault-browser-heading">Vault Browser</h1>
          </div>
        </div>
        <p className="vault-browser-status">Vault 설정을 불러오는 중입니다.</p>
      </section>
    );
  }

  if (settingsError) {
    return (
      <section className="vault-browser-view" aria-labelledby="vault-browser-heading">
        <div className="vault-browser-header">
          <div>
            <p className="eyebrow">Vault</p>
            <h1 id="vault-browser-heading">Vault Browser</h1>
          </div>
        </div>
        <div className="vault-browser-empty" role="alert">
          <p>{settingsError}</p>
          <button className="secondary-button" onClick={onOpenSettings} type="button">
            설정으로 이동
          </button>
        </div>
      </section>
    );
  }

  if (settings.vaults.length === 0) {
    return (
      <section className="vault-browser-view" aria-labelledby="vault-browser-heading">
        <div className="vault-browser-header">
          <div>
            <p className="eyebrow">Vault</p>
            <h1 id="vault-browser-heading">Vault Browser</h1>
          </div>
        </div>
        <div className="vault-browser-empty">
          <p>
            등록된 Vault가 없습니다.
            <br />
            설정에서 Obsidian Vault를 먼저 추가하세요.
          </p>
          <button className="secondary-button" onClick={onOpenSettings} type="button">
            설정으로 이동
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="vault-browser-view" aria-labelledby="vault-browser-heading">
      <div className="vault-browser-header">
        <div>
          <p className="eyebrow">Vault</p>
          <h1 id="vault-browser-heading">Vault Browser</h1>
        </div>
        <button
          className="secondary-button"
          disabled={isLoadingFiles}
          onClick={() => {
            setRefreshSequence((sequence) => sequence + 1);
          }}
          type="button"
        >
          {isLoadingFiles ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      <div className="vault-browser-toolbar">
        <label className="vault-selector">
          <span>Vault</span>
          <select
            onChange={(event) => {
              setSelectedVaultId(event.target.value);
            }}
            value={selectedVaultId}
          >
            {settings.vaults.map((vault) => (
              <option key={vault.id} value={vault.id}>
                {vault.name} · {vaultTypeLabels[vault.type]} ·{' '}
                {vaultSecurityLabels[vault.security]}
              </option>
            ))}
          </select>
        </label>

        {selectedVault ? (
          <div className="selected-vault-meta">
            <strong>{selectedVault.name}</strong>
            <span>
              {vaultTypeLabels[selectedVault.type]} ·{' '}
              {vaultSecurityLabels[selectedVault.security]}
            </span>
            {shouldRecommendLocalOnly ? (
              <span className="local-only-badge">🔒 Local Only 권장</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="vault-browser-columns">
        <section className="vault-file-panel" aria-labelledby="vault-file-list-heading">
          <div className="vault-panel-heading">
            <h2 id="vault-file-list-heading">File List</h2>
            {!isLoadingFiles && !listError ? <span>{files.length}</span> : null}
          </div>
          <div className="vault-file-list">
            {isLoadingFiles ? (
              <p className="vault-panel-message">파일 목록을 불러오는 중입니다.</p>
            ) : null}
            {!isLoadingFiles && listError ? (
              <p className="vault-panel-error" role="alert">
                {listError}
              </p>
            ) : null}
            {!isLoadingFiles && !listError && files.length === 0 ? (
              <p className="vault-panel-message">Markdown 파일이 없습니다.</p>
            ) : null}
            {!isLoadingFiles && !listError
              ? files.map((file) => (
                  <button
                    aria-pressed={selectedFile?.relativePath === file.relativePath}
                    className={`vault-file-item${
                      selectedFile?.relativePath === file.relativePath ? ' active' : ''
                    }`}
                    key={file.relativePath}
                    onClick={() => {
                      void openFile(file);
                    }}
                    title={file.relativePath}
                    type="button"
                  >
                    {file.relativePath}
                  </button>
                ))
              : null}
          </div>
        </section>

        <section className="vault-preview-panel" aria-labelledby="vault-preview-heading">
          <div className="vault-panel-heading vault-preview-heading">
            <h2 id="vault-preview-heading">Preview</h2>
            {selectedFile ? <span title={selectedFile.relativePath}>{selectedFile.name}</span> : null}
          </div>
          <div className="vault-preview-content">
            {!selectedFile ? (
              <p className="vault-panel-message">미리볼 파일을 선택하세요.</p>
            ) : null}
            {selectedFile && isLoadingPreview ? (
              <p className="vault-panel-message">파일을 읽는 중입니다.</p>
            ) : null}
            {selectedFile && !isLoadingPreview && previewError ? (
              <p className="vault-panel-error" role="alert">
                {previewError}
              </p>
            ) : null}
            {selectedFile && !isLoadingPreview && !previewError && fileContent ? (
              <div className="vault-preview-markdown">
                <ReactMarkdown
                  components={{
                    a: ({ node: _node, ...props }) => (
                      <a {...props} rel="noreferrer noopener" target="_blank" />
                    ),
                    img: ({ node: _node, alt }) => (
                      <span className="markdown-image-placeholder">
                        {alt ? `[이미지: ${alt}]` : '[이미지]'}
                      </span>
                    ),
                    table: ({ node: _node, ...props }) => (
                      <div className="markdown-table-scroll">
                        <table {...props} />
                      </div>
                    ),
                  }}
                  remarkPlugins={[remarkGfm]}
                >
                  {fileContent.content}
                </ReactMarkdown>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
