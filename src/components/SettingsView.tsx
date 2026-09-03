import { useEffect, useMemo, useState } from 'react';
import {
  defaultSettings,
  vaultSecurityLabels,
  vaultSecurityOptions,
  vaultTypeLabels,
  vaultTypeOptions,
  type MimoraSettings,
  type UpdateVaultInput,
  type VaultConfig,
  type VaultSecurity,
  type VaultType,
} from '../settings';

type VaultFormState = {
  id?: string;
  name: string;
  autoSuggestedName: string | null;
  type: VaultType;
  security: VaultSecurity;
  path: string;
};

const emptyFormState: VaultFormState = {
  name: '',
  autoSuggestedName: null,
  type: 'work',
  security: 'internal',
  path: '',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '설정을 저장하지 못했습니다.';
}

export function SettingsView() {
  const [settings, setSettings] = useState<MimoraSettings>(defaultSettings);
  const [formState, setFormState] = useState<VaultFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isEditing = Boolean(formState?.id);
  const sortedVaults = useMemo(() => settings.vaults, [settings.vaults]);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const loadedSettings = await window.mimora.getSettings();

        if (isMounted) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(getErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  function openAddForm(): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState(emptyFormState);
  }

  function openEditForm(vault: VaultConfig): void {
    setErrorMessage(null);
    setDeleteTarget(null);
    setFormState({
      id: vault.id,
      name: vault.name,
      autoSuggestedName: null,
      type: vault.type,
      security: vault.security,
      path: vault.path,
    });
  }

  async function chooseFolder(): Promise<void> {
    const selection = await window.mimora.selectVaultDirectory();

    if (selection) {
      setFormState((currentFormState) =>
        currentFormState
          ? (() => {
              const shouldUseSuggestedName =
                !currentFormState.id &&
                (!currentFormState.name.trim() ||
                  currentFormState.name === currentFormState.autoSuggestedName);

              return {
                ...currentFormState,
                name: shouldUseSuggestedName
                  ? selection.suggestedName
                  : currentFormState.name,
                autoSuggestedName: shouldUseSuggestedName
                  ? selection.suggestedName
                  : currentFormState.autoSuggestedName,
                path: selection.path,
              };
            })()
          : currentFormState,
      );
    }
  }

  async function saveVault(): Promise<void> {
    if (!formState) {
      return;
    }

    setErrorMessage(null);

    try {
      const nextSettings = formState.id
        ? await window.mimora.updateVault({
            id: formState.id,
            name: formState.name,
            type: formState.type,
            security: formState.security,
            path: formState.path,
          } satisfies UpdateVaultInput)
        : await window.mimora.addVault({
            name: formState.name,
            type: formState.type,
            security: formState.security,
            path: formState.path,
          });

      setSettings(nextSettings);
      setFormState(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function deleteVault(vault: VaultConfig): Promise<void> {
    setErrorMessage(null);

    try {
      const nextSettings = await window.mimora.deleteVault(vault.id);
      setSettings(nextSettings);
      setDeleteTarget(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <section className="settings-view" aria-labelledby="settings-heading">
      <div className="settings-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 id="settings-heading">Obsidian Vaults</h1>
        </div>
        <button className="secondary-button" onClick={openAddForm} type="button">
          + Vault 추가
        </button>
      </div>

      {errorMessage ? (
        <p className="settings-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {formState ? (
        <form
          className="vault-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveVault();
          }}
        >
          <h2>{isEditing ? 'Vault 수정' : 'Vault 추가'}</h2>
          <label>
            <span>Vault 이름</span>
            <input
              onChange={(event) => {
                setFormState({ ...formState, name: event.target.value });
              }}
              value={formState.name}
            />
          </label>

          <label>
            <span>Vault 유형</span>
            <select
              onChange={(event) => {
                setFormState({
                  ...formState,
                  type: event.target.value as VaultType,
                });
              }}
              value={formState.type}
            >
              {vaultTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {vaultTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>보안등급</span>
            <select
              onChange={(event) => {
                setFormState({
                  ...formState,
                  security: event.target.value as VaultSecurity,
                });
              }}
              value={formState.security}
            >
              {vaultSecurityOptions.map((security) => (
                <option key={security} value={security}>
                  {vaultSecurityLabels[security]}
                </option>
              ))}
            </select>
          </label>

          <div className="vault-folder-field">
            <span>폴더</span>
            <div>
              <button
                className="secondary-button"
                onClick={() => {
                  void chooseFolder();
                }}
                type="button"
              >
                폴더 선택
              </button>
              <p>{formState.path || '선택된 폴더가 없습니다.'}</p>
            </div>
          </div>

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setFormState(null);
              }}
              type="button"
            >
              취소
            </button>
            <button className="primary-button" type="submit">
              저장
            </button>
          </div>
        </form>
      ) : null}

      {deleteTarget ? (
        <div className="delete-confirmation" role="alertdialog">
          <p>
            '{deleteTarget.name}' Vault 등록을 삭제하시겠습니까?
            <br />
            실제 Obsidian Vault 폴더나 파일은 삭제되지 않습니다.
          </p>
          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setDeleteTarget(null);
              }}
              type="button"
            >
              취소
            </button>
            <button
              className="danger-button"
              onClick={() => {
                void deleteVault(deleteTarget);
              }}
              type="button"
            >
              삭제
            </button>
          </div>
        </div>
      ) : null}

      <div className="vault-list">
        {isLoading ? <p className="empty-vaults">설정을 불러오는 중입니다.</p> : null}

        {!isLoading && sortedVaults.length === 0 ? (
          <p className="empty-vaults">
            등록된 Vault가 없습니다.
            <br />
            Mimora에서 사용할 Obsidian Vault를 추가하세요.
          </p>
        ) : null}

        {sortedVaults.map((vault) => (
          <article className="vault-card" key={vault.id}>
            <div className="vault-card-header">
              <h2>{vault.name}</h2>
              <div className="vault-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    openEditForm(vault);
                  }}
                  type="button"
                >
                  수정
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setErrorMessage(null);
                    setFormState(null);
                    setDeleteTarget(vault);
                  }}
                  type="button"
                >
                  삭제
                </button>
              </div>
            </div>

            <dl className="vault-details">
              <div>
                <dt>Type</dt>
                <dd>{vaultTypeLabels[vault.type]}</dd>
              </div>
              <div>
                <dt>Security</dt>
                <dd>{vaultSecurityLabels[vault.security]}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>{vault.path}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
