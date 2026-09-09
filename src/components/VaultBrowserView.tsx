import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  emptyKnowledgeSearchFilters,
  hasActiveKnowledgeSearchFilters,
  type KnowledgeSearchFilters,
} from '../knowledgeSearch';
import {
  contentOriginSearchScopeLabels,
  contentOriginSearchScopes,
  getEffectiveContentOrigin,
  isAiDerivedDocument,
  type ContentOriginSearchScope,
} from '../contentOrigin';
import { parseMimoraDocumentMetadata } from '../metadata/mimoraMetadataParser';
import type { MimoraMetadataParseResult } from '../metadata/types';
import type { KnowledgeDomainRegistryParseResult } from '../registry/knowledgeDomainRegistryTypes';
import type { KnowledgeTypeRegistryParseResult } from '../registry/knowledgeTypeRegistryTypes';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  documentIdValidationStatusLabels,
  getDocumentIdFormatStatus,
  type DocumentIdValidationDocument,
  type DocumentIdValidationSummary,
} from '../documentIdValidation';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function hasDifferentNormalizedValues(
  rawValues: string[] | undefined,
  normalizedValues: string[],
): boolean {
  if (!rawValues || rawValues.length !== normalizedValues.length) {
    return Boolean(rawValues?.length || normalizedValues.length);
  }

  return rawValues.some((rawValue, index) => rawValue !== normalizedValues[index]);
}

function renderMetadataChips(values: string[]) {
  if (values.length === 0) {
    return <span className="vault-metadata-empty">None</span>;
  }

  return values.map((value) => (
    <span className="vault-metadata-chip" key={value}>
      {value}
    </span>
  ));
}

function createSearchLabel(
  query: string,
  knowledgeFilters: KnowledgeSearchFilters,
  contentOriginScope: ContentOriginSearchScope,
): string | null {
  if (query) {
    return query;
  }

  if (hasActiveKnowledgeSearchFilters(knowledgeFilters)) {
    return 'Knowledge filters';
  }

  return contentOriginScope !== 'all'
    ? `Source: ${contentOriginSearchScopeLabels[contentOriginScope]}`
    : null;
}

function stripLegacyFrontmatter(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');

  if (!normalizedMarkdown.trimStart().startsWith('---')) {
    return markdown;
  }

  const leadingWhitespaceLength =
    normalizedMarkdown.length - normalizedMarkdown.trimStart().length;
  const lines = normalizedMarkdown.slice(leadingWhitespaceLength).split('\n');
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );

  if (closingIndex === -1) {
    return markdown;
  }

  return lines.slice(closingIndex + 1).join('\n').trimStart();
}

function createPreviewMarkdownContent(
  fileContent: VaultFileContent,
  metadataResult: MimoraMetadataParseResult | null,
): string {
  if (metadataResult?.hasMetadata) {
    return metadataResult.body.trimStart();
  }

  return stripLegacyFrontmatter(fileContent.content);
}

function createDocumentValidationKey(vaultId: string, relativePath: string): string {
  return `${vaultId}:${relativePath}`;
}

function renderDocumentIdStatusBadge(
  document: DocumentIdValidationDocument | null | undefined,
) {
  if (!document) {
    return null;
  }

  return (
    <span className={`document-id-status-badge ${document.status}`}>
      {documentIdValidationStatusLabels[document.status]}
    </span>
  );
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
  const [knowledgeDomainRegistry, setKnowledgeDomainRegistry] =
    useState<KnowledgeDomainRegistryParseResult | null>(null);
  const [knowledgeTypeRegistry, setKnowledgeTypeRegistry] =
    useState<KnowledgeTypeRegistryParseResult | null>(null);
  const [documentIdValidation, setDocumentIdValidation] =
    useState<DocumentIdValidationSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] =
    useState<VaultSearchScope>('current');
  const [contentOriginScope, setContentOriginScope] =
    useState<ContentOriginSearchScope>('all');
  const [knowledgeSearchFilters, setKnowledgeSearchFilters] =
    useState<KnowledgeSearchFilters>(emptyKnowledgeSearchFilters);
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
  const [isRefreshingVaultBrowser, setIsRefreshingVaultBrowser] =
    useState(false);
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
  const selectedFileMetadata = useMemo<MimoraMetadataParseResult | null>(() => {
    if (!fileContent) {
      return null;
    }

    return parseMimoraDocumentMetadata(fileContent.content, {
      knowledgeDomainRegistry: knowledgeDomainRegistry?.registry ?? null,
      knowledgeTypeRegistry: knowledgeTypeRegistry?.registry ?? null,
      knowledgeDomainRegistryUnavailable:
        knowledgeDomainRegistry !== null && !knowledgeDomainRegistry.registry,
      knowledgeTypeRegistryUnavailable:
        knowledgeTypeRegistry !== null && !knowledgeTypeRegistry.registry,
    });
  }, [fileContent, knowledgeDomainRegistry, knowledgeTypeRegistry]);
  const metadataWarnings =
    selectedFileMetadata?.issues.filter(
      (issue) =>
        issue.severity === 'warning' &&
        (issue.field === 'knowledge_domains' ||
          issue.field === 'knowledge_type'),
    ) ?? [];
  const hasKnowledgeMetadata = Boolean(
    selectedFileMetadata &&
      (selectedFileMetadata.metadata.rawKnowledgeDomains?.length ||
        selectedFileMetadata.metadata.knowledgeDomains.length ||
        selectedFileMetadata.metadata.rawKnowledgeTypes?.length ||
        selectedFileMetadata.metadata.knowledgeTypes.length ||
        metadataWarnings.length),
  );
  const previewMarkdownContent = fileContent
    ? createPreviewMarkdownContent(fileContent, selectedFileMetadata)
    : '';
  const documentIdValidationByFile = useMemo(() => {
    const validations = new Map<string, DocumentIdValidationDocument>();

    for (const document of documentIdValidation?.documents ?? []) {
      validations.set(
        createDocumentValidationKey(document.vaultId, document.relativePath),
        document,
      );
    }

    return validations;
  }, [documentIdValidation]);
  const selectedDocumentIdValidation =
    selectedFile && selectedFileVaultId
      ? documentIdValidationByFile.get(
          createDocumentValidationKey(
            selectedFileVaultId,
            selectedFile.relativePath,
          ),
        ) ?? null
      : null;
  const selectedDocumentIdFormatStatus = selectedFileMetadata
    ? getDocumentIdFormatStatus(selectedFileMetadata.metadata.documentId)
    : null;
  const effectiveSelectedDocumentIdValidation =
    selectedFile &&
    selectedFileVault &&
    selectedDocumentIdFormatStatus &&
    selectedDocumentIdFormatStatus !== 'valid'
      ? {
          documentKey: createDocumentValidationKey(
            selectedFileVault.id,
            selectedFile.relativePath,
          ),
          vaultId: selectedFileVault.id,
          vaultName: selectedFileVault.name,
          vaultType: selectedFileVault.type,
          vaultSecurity: selectedFileVault.security,
          relativePath: selectedFile.relativePath,
          fileName: selectedFile.name,
          documentId: selectedFileMetadata?.metadata.documentId ?? null,
          status: selectedDocumentIdFormatStatus,
        }
      : selectedDocumentIdValidation;
  const hasMimoraMetadataCard = Boolean(
    selectedFileMetadata?.hasMetadata ||
      hasKnowledgeMetadata ||
      effectiveSelectedDocumentIdValidation,
  );

  useEffect(() => {
    let isActive = true;

    async function loadSettings(): Promise<void> {
      try {
        const [
          loadedSettings,
          loadedKnowledgeDomainRegistry,
          loadedKnowledgeTypeRegistry,
          loadedDocumentIdValidation,
        ] = await Promise.all([
          window.mimora.getSettings(),
          window.mimora.loadKnowledgeDomainRegistry(),
          window.mimora.loadKnowledgeTypeRegistry(),
          window.mimora.validateDocumentIds(),
        ]);

        if (!isActive) {
          return;
        }

        setSettings(loadedSettings);
        setKnowledgeDomainRegistry(loadedKnowledgeDomainRegistry);
        setKnowledgeTypeRegistry(loadedKnowledgeTypeRegistry);
        setDocumentIdValidation(loadedDocumentIdValidation);
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
    setContentOriginScope('all');
    setKnowledgeSearchFilters(emptyKnowledgeSearchFilters);
    clearSearchResults();
  }

  function clearPreviewSelection(): void {
    previewRequestSequence.current += 1;
    setSelectedFile(null);
    setSelectedFileVaultId('');
    setFileContent(null);
    setPreviewError(null);
    setAttachmentFeedback(null);
    setIsLoadingPreview(false);
  }

  async function searchVaultFiles({
    query = searchQuery,
    scope = searchScope,
    knowledgeFilters = knowledgeSearchFilters,
    sourceScope = contentOriginScope,
    vaultId = selectedVaultId,
  }: {
    query?: string;
    scope?: VaultSearchScope;
    knowledgeFilters?: KnowledgeSearchFilters;
    sourceScope?: ContentOriginSearchScope;
    vaultId?: string;
  } = {}): Promise<void> {
    const trimmedQuery = query.trim();
    const normalizedKnowledgeFilters = {
      domains: knowledgeFilters.domains,
      types: knowledgeFilters.types,
    };

    if (
      !trimmedQuery &&
      !hasActiveKnowledgeSearchFilters(normalizedKnowledgeFilters) &&
      sourceScope === 'all'
    ) {
      resetSearch();
      return;
    }

    const requestSequence = searchRequestSequence.current + 1;
    searchRequestSequence.current = requestSequence;
    setActiveSearchQuery(
      createSearchLabel(trimmedQuery, normalizedKnowledgeFilters, sourceScope),
    );
    setSearchError(null);
    setIsSearching(true);

    if (import.meta.env.DEV) {
      console.info('[Mimora Knowledge Filter]', {
        selectedDomain: normalizedKnowledgeFilters.domains[0] ?? '',
        selectedType: normalizedKnowledgeFilters.types[0] ?? '',
        requestDomains: normalizedKnowledgeFilters.domains,
        requestTypes: normalizedKnowledgeFilters.types,
        contentOriginScope: sourceScope,
      });
    }

    try {
      const results = await window.mimora.searchVaultFiles({
        query: trimmedQuery,
        scope,
        knowledgeFilters: normalizedKnowledgeFilters,
        contentOriginScope: sourceScope,
        ...(scope === 'current' ? { vaultId } : {}),
      });

      if (searchRequestSequence.current === requestSequence) {
        setSearchResults(results);

        if (
          selectedFile &&
          !results.some(
            (result) =>
              result.vaultId === selectedFileVaultId &&
              result.relativePath === selectedFile.relativePath,
          )
        ) {
          clearPreviewSelection();
        }
      }
    } catch (error) {
      if (searchRequestSequence.current === requestSequence) {
        setSearchResults([]);
        clearPreviewSelection();
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

  function updateKnowledgeSearchFilters(
    nextFilters: KnowledgeSearchFilters,
  ): void {
    setKnowledgeSearchFilters(nextFilters);

    if (
      searchQuery.trim() ||
      hasActiveKnowledgeSearchFilters(nextFilters) ||
      contentOriginScope !== 'all'
    ) {
      void searchVaultFiles({ knowledgeFilters: nextFilters });
    } else {
      resetSearch();
    }
  }

  function updateContentOriginScope(
    nextContentOriginScope: ContentOriginSearchScope,
  ): void {
    setContentOriginScope(nextContentOriginScope);

    if (
      searchQuery.trim() ||
      hasActiveKnowledgeSearchFilters(knowledgeSearchFilters) ||
      nextContentOriginScope !== 'all'
    ) {
      void searchVaultFiles({ sourceScope: nextContentOriginScope });
    } else {
      clearSearchResults();
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

  async function refreshVaultBrowser(): Promise<void> {
    if (isRefreshingVaultBrowser) {
      return;
    }

    const selectedPreview =
      selectedFile && selectedFileVaultId
        ? {
            file: selectedFile,
            vaultId: selectedFileVaultId,
          }
        : null;

    setIsRefreshingVaultBrowser(true);
    setListError(null);
    setSearchError(null);

    try {
      const nextDocumentIdValidation =
        await window.mimora.validateDocumentIds();
      setDocumentIdValidation(nextDocumentIdValidation);

      if (selectedVaultId) {
        setIsLoadingFiles(true);

        try {
          const loadedFiles = await window.mimora.listVaultFiles(
            selectedVaultId,
          );
          setFiles(loadedFiles);
        } catch (error) {
          setFiles([]);
          setListError(
            getErrorMessage(error, 'Markdown ?뚯씪 紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??'),
          );
        } finally {
          setIsLoadingFiles(false);
        }
      }

      if (selectedPreview) {
        await openFile(selectedPreview.file, selectedPreview.vaultId);
      }

      if (activeSearchQuery) {
        await searchVaultFiles();
      }
    } catch (error) {
      setPreviewError(
        getErrorMessage(error, 'Vault Browser瑜??덈줈怨좎묠?섏? 紐삵뻽?듬땲??'),
      );
    } finally {
      setIsRefreshingVaultBrowser(false);
    }
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
      documentSecurity: selectedFileMetadata?.metadata.security,
      ...(selectedFileMetadata?.metadata
        ? { metadata: selectedFileMetadata.metadata }
        : {}),
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
          disabled={isLoadingFiles || isSearching || isRefreshingVaultBrowser}
          onClick={() => {
            void refreshVaultBrowser();
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

            if (
              !nextQuery.trim() &&
              !hasActiveKnowledgeSearchFilters(knowledgeSearchFilters) &&
              contentOriginScope === 'all'
            ) {
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
            const nextScope = event.target.value as VaultSearchScope;
            setSearchScope(nextScope);

            if (
              searchQuery.trim() ||
              hasActiveKnowledgeSearchFilters(knowledgeSearchFilters) ||
              contentOriginScope !== 'all'
            ) {
              void searchVaultFiles({ scope: nextScope });
            } else {
              clearSearchResults();
            }
          }}
          value={searchScope}
        >
          <option value="current">현재 Vault</option>
          <option value="all">전체 Vault</option>
        </select>
        <select
          aria-label="Content Origin filter"
          onChange={(event) => {
            updateContentOriginScope(
              event.target.value as ContentOriginSearchScope,
            );
          }}
          value={contentOriginScope}
        >
          {contentOriginSearchScopes.map((scope) => (
            <option key={scope} value={scope}>
              Source {contentOriginSearchScopeLabels[scope]}
            </option>
          ))}
        </select>
        <select
          aria-label="Knowledge Domain filter"
          onChange={(event) => {
            updateKnowledgeSearchFilters({
              domains: event.target.value ? [event.target.value] : [],
              types: knowledgeSearchFilters.types,
            });
          }}
          value={knowledgeSearchFilters.domains[0] ?? ''}
        >
          <option value="">Domain 전체</option>
          {(knowledgeDomainRegistry?.domains ?? []).map((domain) => (
            <option key={domain.canonicalName} value={domain.canonicalName}>
              {domain.canonicalName}
            </option>
          ))}
        </select>
        <select
          aria-label="Knowledge Type filter"
          onChange={(event) => {
            updateKnowledgeSearchFilters({
              domains: knowledgeSearchFilters.domains,
              types: event.target.value ? [event.target.value] : [],
            });
          }}
          value={knowledgeSearchFilters.types[0] ?? ''}
        >
          <option value="">Type 전체</option>
          {(knowledgeTypeRegistry?.types ?? []).map((type) => (
            <option key={type.canonicalName} value={type.canonicalName}>
              {type.canonicalName}
            </option>
          ))}
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
                  const isAiDerived = isAiDerivedDocument(result.metadata);
                  const isSelected =
                    selectedFileVaultId === result.vaultId &&
                    selectedFile?.relativePath === result.relativePath;
                  const resultDocumentIdValidation =
                    documentIdValidationByFile.get(
                      createDocumentValidationKey(
                        result.vaultId,
                        result.relativePath,
                      ),
                    ) ?? null;

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
                      <strong>
                        {result.relativePath}
                        {isAiDerived ? (
                          <span className="ai-derived-source-badge">AI Wiki</span>
                        ) : null}
                        {resultDocumentIdValidation?.status !== 'valid'
                          ? renderDocumentIdStatusBadge(
                              resultDocumentIdValidation,
                            )
                          : null}
                      </strong>
                      {result.snippet ? (
                        <span className="vault-search-snippet">“{result.snippet}”</span>
                      ) : null}
                      {result.metadata &&
                      (result.metadata.knowledgeDomains.length > 0 ||
                        result.metadata.knowledgeTypes.length > 0) ? (
                        <span className="vault-search-knowledge-tags">
                          {[
                            ...result.metadata.knowledgeDomains,
                            ...result.metadata.knowledgeTypes,
                          ].map((value) => (
                            <span key={value}>{value}</span>
                          ))}
                        </span>
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
              <>
                {hasMimoraMetadataCard && selectedFileMetadata ? (
                  <section
                    aria-label="Normalized Mimora Metadata"
                    className="vault-metadata-summary"
                  >
                    <div className="vault-metadata-title">Mimora Metadata</div>
                    <div className="vault-metadata-row">
                      <span>Document ID</span>
                      <div>
                        {selectedFileMetadata.metadata.documentId ? (
                          <span className="vault-metadata-value">
                            {selectedFileMetadata.metadata.documentId}
                          </span>
                        ) : (
                          <span className="vault-metadata-empty">None</span>
                        )}
                        {renderDocumentIdStatusBadge(
                          effectiveSelectedDocumentIdValidation,
                        )}
                      </div>
                    </div>
                    <div className="vault-metadata-row">
                      <span>Workspace</span>
                      <div>
                        {renderMetadataChips(
                          selectedFileMetadata.metadata.workspaceIds,
                        )}
                      </div>
                    </div>
                    <div className="vault-metadata-row">
                      <span>Domains</span>
                      <div>
                        {renderMetadataChips(
                          selectedFileMetadata.metadata.knowledgeDomains,
                        )}
                      </div>
                    </div>
                    {hasDifferentNormalizedValues(
                      selectedFileMetadata.metadata.rawKnowledgeDomains,
                      selectedFileMetadata.metadata.knowledgeDomains,
                    ) ? (
                      <div className="vault-metadata-row muted">
                        <span>Raw</span>
                        <div>
                          {renderMetadataChips(
                            selectedFileMetadata.metadata.rawKnowledgeDomains ??
                              [],
                          )}
                        </div>
                      </div>
                    ) : null}
                    <div className="vault-metadata-row">
                      <span>Type</span>
                      <div>
                        {renderMetadataChips(
                          selectedFileMetadata.metadata.knowledgeTypes,
                        )}
                      </div>
                    </div>
                    <div className="vault-metadata-row">
                      <span>Security</span>
                      <div>
                        {selectedFileMetadata.metadata.security ? (
                          <span className="vault-metadata-value">
                            {selectedFileMetadata.metadata.security}
                          </span>
                        ) : (
                          <span className="vault-metadata-empty">None</span>
                        )}
                      </div>
                    </div>
                    <div className="vault-metadata-row">
                      <span>Content Origin</span>
                      <div>
                        <span className="vault-metadata-value">
                          {getEffectiveContentOrigin(
                            selectedFileMetadata.metadata,
                          ) === 'ai-derived'
                            ? 'AI Derived'
                            : 'Original'}
                        </span>
                      </div>
                    </div>
                    <div className="vault-metadata-row">
                      <span>Origin Workspace</span>
                      <div>
                        {selectedFileMetadata.metadata.originWorkspaceId ? (
                          <span className="vault-metadata-value">
                            {selectedFileMetadata.metadata.originWorkspaceId}
                          </span>
                        ) : (
                          <span className="vault-metadata-empty">None</span>
                        )}
                      </div>
                    </div>
                    {hasDifferentNormalizedValues(
                      selectedFileMetadata.metadata.rawKnowledgeTypes,
                      selectedFileMetadata.metadata.knowledgeTypes,
                    ) ? (
                      <div className="vault-metadata-row muted">
                        <span>Raw</span>
                        <div>
                          {renderMetadataChips(
                            selectedFileMetadata.metadata.rawKnowledgeTypes ??
                              [],
                          )}
                        </div>
                      </div>
                    ) : null}
                    {metadataWarnings.length > 0 ? (
                      <div className="vault-metadata-warnings">
                        <strong>Metadata warnings</strong>
                        <ul>
                          {metadataWarnings.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <MarkdownRenderer
                  className="vault-preview-markdown"
                  content={previewMarkdownContent}
                />
              </>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
