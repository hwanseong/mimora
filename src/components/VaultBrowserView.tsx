import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  createAttachedContextId,
  type AttachedContext,
} from '../attachedContext';
import {
  defaultSettings,
  vaultSecurityLabels,
  vaultTypeLabels,
  type MimoraSettings,
} from '../settings';
import type {
  VaultFile,
  VaultFileContent,
  VaultSearchResult,
  VaultSearchScope,
} from '../vaultFiles';
import type { Workspace } from '../workspaces';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function VaultBrowserView({
  currentWorkspace,
  onAttachContext,
  onOpenSettings,
}: {
  currentWorkspace: Workspace;
  onAttachContext: (context: AttachedContext) => boolean;
  onOpenSettings: () => void;
}) {
  const [settings, setSettings] = useState<MimoraSettings>(defaultSettings);
  const [selectedVaultId, setSelectedVaultId] = useState('');
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [selectedFileVaultId, setSelectedFileVaultId] = useState('');
  const [fileContent, setFileContent] = useState<VaultFileContent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] =
    useState<VaultSearchScope>('current');
  const [activeSearchQuery, setActiveSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VaultSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [attachmentFeedback, setAttachmentFeedback] = useState<{
    kind: 'success' | 'duplicate';
    message: string;
  } | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const previewRequestSequence = useRef(0);
  const searchRequestSequence = useRef(0);
  const pendingSearchSelection = useRef<{
    vaultId: string;
    relativePath: string;
  } | null>(null);

  const selectedVault =
    settings.vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  const shouldRecommendLocalOnly = Boolean(
    selectedVault?.type === 'private' || selectedVault?.security === 'sensitive',
  );
  const selectedFileVault =
    settings.vaults.find((vault) => vault.id === selectedFileVaultId) ?? null;
  const canAttachSelectedFile = Boolean(
    selectedFile &&
      selectedFileVault &&
      fileContent &&
      fileContent.relativePath === selectedFile.relativePath &&
      !isLoadingPreview &&
      !previewError,
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
      searchRequestSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    const pendingSelection = pendingSearchSelection.current;
    const shouldPreservePreview =
      pendingSelection?.vaultId === selectedVaultId;

    if (shouldPreservePreview) {
      pendingSearchSelection.current = null;
    } else {
      previewRequestSequence.current += 1;
      setSelectedFile(null);
      setSelectedFileVaultId('');
      setFileContent(null);
      setPreviewError(null);
      setAttachmentFeedback(null);
      setIsLoadingPreview(false);
    }

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

  async function openFile(
    file: VaultFile,
    vaultId = selectedVaultId,
  ): Promise<void> {
    if (!vaultId) {
      return;
    }

    const requestSequence = previewRequestSequence.current + 1;
    previewRequestSequence.current = requestSequence;
    setSelectedFile(file);
    setSelectedFileVaultId(vaultId);
    setFileContent(null);
    setPreviewError(null);
    setAttachmentFeedback(null);
    setIsLoadingPreview(true);

    try {
      const loadedContent = await window.mimora.readVaultFile(
        vaultId,
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

  function clearSearchResults(): void {
    searchRequestSequence.current += 1;
    setActiveSearchQuery(null);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(false);
  }

  function resetSearch(): void {
    setSearchQuery('');
    clearSearchResults();
  }

  async function searchVaultFiles(query = searchQuery): Promise<void> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      resetSearch();
      return;
    }

    const requestSequence = searchRequestSequence.current + 1;
    searchRequestSequence.current = requestSequence;
    setActiveSearchQuery(trimmedQuery);
    setSearchError(null);
    setIsSearching(true);

    try {
      const results = await window.mimora.searchVaultFiles({
        query: trimmedQuery,
        scope: searchScope,
        ...(searchScope === 'current' ? { vaultId: selectedVaultId } : {}),
      });

      if (searchRequestSequence.current === requestSequence) {
        setSearchResults(results);
      }
    } catch (error) {
      if (searchRequestSequence.current === requestSequence) {
        setSearchResults([]);
        setSearchError(
          getErrorMessage(error, 'Vault 검색을 완료하지 못했습니다.'),
        );
      }
    } finally {
      if (searchRequestSequence.current === requestSequence) {
        setIsSearching(false);
      }
    }
  }

  function openSearchResult(result: VaultSearchResult): void {
    const file: VaultFile = {
      relativePath: result.relativePath,
      name: result.fileName,
      folder: result.relativePath.includes('/')
        ? result.relativePath.slice(0, result.relativePath.lastIndexOf('/'))
        : '',
    };

    if (result.vaultId !== selectedVaultId) {
      pendingSearchSelection.current = {
        vaultId: result.vaultId,
        relativePath: result.relativePath,
      };
      setSelectedVaultId(result.vaultId);
    }

    void openFile(file, result.vaultId);
  }

  function attachSelectedFile(): void {
    if (
      !selectedFile ||
      !selectedFileVault ||
      !fileContent ||
      fileContent.relativePath !== selectedFile.relativePath
    ) {
      return;
    }

    const wasAdded = onAttachContext({
      id: createAttachedContextId(
        selectedFileVault.id,
        selectedFile.relativePath,
      ),
      vaultId: selectedFileVault.id,
      vaultName: selectedFileVault.name,
      vaultType: selectedFileVault.type,
      security: selectedFileVault.security,
      relativePath: selectedFile.relativePath,
      fileName: selectedFile.name,
      content: fileContent.content,
    });

    setAttachmentFeedback(
      wasAdded
        ? {
            kind: 'success',
            message: `${selectedFile.name}가 ${currentWorkspace.label} Context에 추가되었습니다.`,
          }
        : {
            kind: 'duplicate',
            message: '이미 현재 대화 Context에 추가된 문서입니다.',
          },
    );
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
          disabled={isLoadingFiles || isSearching}
          onClick={() => {
            if (activeSearchQuery) {
              void searchVaultFiles(activeSearchQuery);
            } else {
              setRefreshSequence((sequence) => sequence + 1);
            }
          }}
          type="button"
        >
          {isLoadingFiles || isSearching ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      <div className="vault-browser-toolbar">
        <label className="vault-selector">
          <span>Vault</span>
          <select
            onChange={(event) => {
              clearSearchResults();
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

      <form
        className="vault-search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void searchVaultFiles();
        }}
      >
        <input
          aria-label="Vault 검색어"
          onChange={(event) => {
            const nextQuery = event.target.value;
            setSearchQuery(nextQuery);

            if (!nextQuery.trim()) {
              clearSearchResults();
            }
          }}
          placeholder="검색어를 입력하세요..."
          type="search"
          value={searchQuery}
        />
        <select
          aria-label="Vault 검색 범위"
          onChange={(event) => {
            setSearchScope(event.target.value as VaultSearchScope);
            clearSearchResults();
          }}
          value={searchScope}
        >
          <option value="current">현재 Vault</option>
          <option value="all">전체 Vault</option>
        </select>
        <button className="primary-button" disabled={isSearching} type="submit">
          {isSearching ? '검색 중' : '검색'}
        </button>
        {activeSearchQuery ? (
          <button className="secondary-button" onClick={resetSearch} type="button">
            초기화
          </button>
        ) : null}
      </form>

      <div className="vault-browser-columns">
        <section className="vault-file-panel" aria-labelledby="vault-file-list-heading">
          <div className="vault-panel-heading">
            <h2 id="vault-file-list-heading">
              {activeSearchQuery ? 'Search Results' : 'File List'}
            </h2>
            {activeSearchQuery ? (
              !isSearching && !searchError ? <span>{searchResults.length}건</span> : null
            ) : !isLoadingFiles && !listError ? (
              <span>{files.length}</span>
            ) : null}
          </div>
          <div className="vault-file-list">
            {activeSearchQuery && isSearching ? (
              <p className="vault-panel-message">Vault를 검색하는 중입니다.</p>
            ) : null}
            {activeSearchQuery && !isSearching && searchError ? (
              <p className="vault-panel-error" role="alert">
                {searchError}
              </p>
            ) : null}
            {activeSearchQuery &&
            !isSearching &&
            !searchError &&
            searchResults.length === 0 ? (
              <p className="vault-panel-message">
                '{activeSearchQuery}' 검색 결과가 없습니다.
              </p>
            ) : null}
            {activeSearchQuery && !isSearching && !searchError
              ? searchResults.map((result) => {
                  const isSensitive =
                    result.vaultType === 'private' || result.security === 'sensitive';
                  const isSelected =
                    selectedFileVaultId === result.vaultId &&
                    selectedFile?.relativePath === result.relativePath;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`vault-search-result${isSelected ? ' active' : ''}`}
                      key={`${result.vaultId}:${result.relativePath}`}
                      onClick={() => {
                        openSearchResult(result);
                      }}
                      type="button"
                    >
                      <span className="vault-search-result-meta">
                        {result.vaultName} · {vaultTypeLabels[result.vaultType]} ·{' '}
                        {vaultSecurityLabels[result.security]}
                      </span>
                      <strong>{result.relativePath}</strong>
                      {result.snippet ? (
                        <span className="vault-search-snippet">“{result.snippet}”</span>
                      ) : null}
                      <span className="vault-search-result-footer">
                        <span>
                          {result.matchType === 'filename'
                            ? '파일명 일치'
                            : result.matchType === 'path'
                              ? '경로 일치'
                              : '본문 일치'}
                        </span>
                        {isSensitive ? (
                          <span className="vault-search-sensitive">
                            🔒 {result.security === 'sensitive' ? 'Sensitive' : 'Private'}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              : null}
            {!activeSearchQuery && isLoadingFiles ? (
              <p className="vault-panel-message">파일 목록을 불러오는 중입니다.</p>
            ) : null}
            {!activeSearchQuery && !isLoadingFiles && listError ? (
              <p className="vault-panel-error" role="alert">
                {listError}
              </p>
            ) : null}
            {!activeSearchQuery && !isLoadingFiles && !listError && files.length === 0 ? (
              <p className="vault-panel-message">Markdown 파일이 없습니다.</p>
            ) : null}
            {!activeSearchQuery && !isLoadingFiles && !listError
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
            <div className="vault-preview-actions">
              {selectedFile ? (
                <span title={selectedFile.relativePath}>{selectedFile.name}</span>
              ) : null}
              <span className="vault-attachment-target">
                첨부 대상: {currentWorkspace.label}
              </span>
              <button
                className="secondary-button vault-attach-button"
                disabled={!canAttachSelectedFile}
                onClick={attachSelectedFile}
                type="button"
              >
                Chat에 추가
              </button>
            </div>
          </div>
          <div className="vault-preview-content">
            {attachmentFeedback ? (
              <p
                className={`vault-attachment-feedback ${attachmentFeedback.kind}`}
                role="status"
              >
                {attachmentFeedback.message}
              </p>
            ) : null}
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
