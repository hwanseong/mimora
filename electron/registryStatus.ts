import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  registryFileRelativePaths,
  type RegistryFileKey,
  type RegistryFileStatus,
  type RegistryStatus,
} from '../src/registry/types';
import { parseKnowledgeDomainRegistry } from '../src/registry/knowledgeDomainRegistryParser';
import type {
  KnowledgeDomainRegistryParseResult,
  KnowledgeRegistryValidationIssue,
} from '../src/registry/knowledgeDomainRegistryTypes';
import { parseKnowledgeTypeRegistry } from '../src/registry/knowledgeTypeRegistryParser';
import type {
  KnowledgeTypeRegistryParseResult,
  KnowledgeTypeRegistryValidationIssue,
} from '../src/registry/knowledgeTypeRegistryTypes';
import { parseWorkspaceRegistry } from '../src/registry/workspaceRegistryParser';
import type {
  WorkspaceRegistryParseResult,
  WorkspaceRegistryValidationIssue,
} from '../src/registry/workspaceRegistryTypes';
import type { MimoraSettings } from '../src/settings';

type SettingsReader = {
  getSettings: () => Promise<MimoraSettings>;
};

type DecodedRegistryMarkdown =
  | {
      ok: true;
      text: string;
      encoding: 'utf8' | 'utf8-bom' | 'utf16-le';
    }
  | {
      ok: false;
      encoding: 'utf16-be' | 'unknown';
      message: string;
    };

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createMissingFileStatuses(): RegistryFileStatus[] {
  return Object.entries(registryFileRelativePaths).map(
    ([key, relativePath]) => ({
      key: key as RegistryFileKey,
      relativePath,
      exists: false,
    }),
  );
}

function createWorkspaceRegistryResult(
  state: WorkspaceRegistryParseResult['state'],
  message: string,
  issue?: WorkspaceRegistryValidationIssue,
): WorkspaceRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    workspaces: [],
    issues,
    valid: false,
    message,
  };
}

function createKnowledgeDomainRegistryResult(
  state: KnowledgeDomainRegistryParseResult['state'],
  message: string,
  issue?: KnowledgeRegistryValidationIssue,
): KnowledgeDomainRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    registry: null,
    domains: [],
    issues,
    valid: false,
    message,
  };
}

function createKnowledgeTypeRegistryResult(
  state: KnowledgeTypeRegistryParseResult['state'],
  message: string,
  issue?: KnowledgeTypeRegistryValidationIssue,
): KnowledgeTypeRegistryParseResult {
  const issues = issue ? [issue] : [];

  return {
    state,
    registryVersion: null,
    registry: null,
    types: [],
    issues,
    valid: false,
    message,
  };
}

function hasUtf16LePattern(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }

  const sampleLength = Math.min(buffer.length, 256);
  let oddNullBytes = 0;

  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0x00) {
      oddNullBytes += 1;
    }
  }

  return oddNullBytes >= Math.floor(sampleLength / 4);
}

function decodeRegistryMarkdown(buffer: Buffer): DecodedRegistryMarkdown {
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      ok: false,
      encoding: 'utf16-be',
      message: 'UTF-16 BE 인코딩은 현재 지원하지 않습니다.',
    };
  }

  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    hasUtf16LePattern(buffer)
  ) {
    return {
      ok: true,
      text: buffer.toString('utf16le'),
      encoding: 'utf16-le',
    };
  }

  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      ok: true,
      text: buffer.toString('utf8'),
      encoding: 'utf8-bom',
    };
  }

  return {
    ok: true,
    text: buffer.toString('utf8'),
    encoding: 'utf8',
  };
}

export function createRegistryStatusService(settingsReader: SettingsReader) {
  return {
    getRegistryStatus: async (): Promise<RegistryStatus> => {
      const settings = await settingsReader.getSettings();
      const homeVaultId = settings.registry.homeVaultId;

      if (!homeVaultId) {
        return {
          homeVaultId: null,
          homeVaultAvailable: false,
          files: createMissingFileStatuses(),
        };
      }

      const homeVault = settings.vaults.find((vault) => vault.id === homeVaultId);

      if (!homeVault || !(await exists(homeVault.path))) {
        return {
          homeVaultId,
          homeVaultAvailable: false,
          files: createMissingFileStatuses(),
        };
      }

      const files = await Promise.all(
        Object.entries(registryFileRelativePaths).map(
          async ([key, relativePath]) => ({
            key: key as RegistryFileKey,
            relativePath,
            exists: await exists(path.resolve(homeVault.path, relativePath)),
          }),
        ),
      );

      return {
        homeVaultId,
        homeVaultAvailable: true,
        files,
      };
    },

    loadWorkspaceRegistry: async (): Promise<WorkspaceRegistryParseResult> => {
      const settings = await settingsReader.getSettings();
      const homeVaultId = settings.registry.homeVaultId;

      if (!homeVaultId) {
        return createWorkspaceRegistryResult(
          'unavailable',
          'Registry Home Vault가 지정되지 않았습니다.',
        );
      }

      const homeVault = settings.vaults.find((vault) => vault.id === homeVaultId);

      if (!homeVault || !(await exists(homeVault.path))) {
        return createWorkspaceRegistryResult(
          'inaccessible',
          'Registry Home Vault에 접근할 수 없습니다.',
        );
      }

      const registryPath = path.resolve(
        homeVault.path,
        registryFileRelativePaths.workspaces,
      );

      if (!(await exists(registryPath))) {
        return createWorkspaceRegistryResult(
          'not-found',
          'Workspace Registry 파일을 찾을 수 없습니다.',
          {
            severity: 'error',
            code: 'workspace-registry-not-found',
            message: 'Workspace Registry 파일을 찾을 수 없습니다.',
          },
        );
      }

      try {
        const decoded = decodeRegistryMarkdown(await readFile(registryPath));

        if (!decoded.ok) {
          return createWorkspaceRegistryResult(
            'loaded-with-errors',
            decoded.message,
            {
              severity: 'error',
              code: 'workspace-registry-unsupported-encoding',
              message: decoded.message,
            },
          );
        }

        return parseWorkspaceRegistry(decoded.text);
      } catch {
        return createWorkspaceRegistryResult(
          'loaded-with-errors',
          'Workspace Registry 파일을 읽거나 파싱할 수 없습니다.',
          {
            severity: 'error',
            code: 'workspace-registry-read-failed',
            message: 'Workspace Registry 파일을 읽거나 파싱할 수 없습니다.',
          },
        );
      }
    },

    loadKnowledgeDomainRegistry:
      async (): Promise<KnowledgeDomainRegistryParseResult> => {
        const settings = await settingsReader.getSettings();
        const homeVaultId = settings.registry.homeVaultId;

        if (!homeVaultId) {
          return createKnowledgeDomainRegistryResult(
            'unavailable',
            'Registry Home Vault가 지정되지 않았습니다.',
          );
        }

        const homeVault = settings.vaults.find(
          (vault) => vault.id === homeVaultId,
        );

        if (!homeVault || !(await exists(homeVault.path))) {
          return createKnowledgeDomainRegistryResult(
            'inaccessible',
            'Registry Home Vault에 접근할 수 없습니다.',
          );
        }

        const registryPath = path.resolve(
          homeVault.path,
          registryFileRelativePaths['knowledge-domains'],
        );

        if (!(await exists(registryPath))) {
          return createKnowledgeDomainRegistryResult(
            'not-found',
            'Knowledge Domain Registry 파일을 찾을 수 없습니다.',
            {
              severity: 'error',
              code: 'knowledge-domain-registry-not-found',
              message: 'Knowledge Domain Registry 파일을 찾을 수 없습니다.',
            },
          );
        }

        try {
          const decoded = decodeRegistryMarkdown(await readFile(registryPath));

          if (!decoded.ok) {
            return createKnowledgeDomainRegistryResult(
              'loaded-with-errors',
              decoded.message,
              {
                severity: 'error',
                code: 'knowledge-domain-registry-unsupported-encoding',
                message: decoded.message,
              },
            );
          }

          return parseKnowledgeDomainRegistry(decoded.text);
        } catch {
          return createKnowledgeDomainRegistryResult(
            'loaded-with-errors',
            'Knowledge Domain Registry 파일을 읽거나 파싱할 수 없습니다.',
            {
              severity: 'error',
              code: 'knowledge-domain-registry-read-failed',
              message: 'Knowledge Domain Registry 파일을 읽거나 파싱할 수 없습니다.',
            },
          );
        }
      },

    loadKnowledgeTypeRegistry:
      async (): Promise<KnowledgeTypeRegistryParseResult> => {
        const settings = await settingsReader.getSettings();
        const homeVaultId = settings.registry.homeVaultId;

        if (!homeVaultId) {
          return createKnowledgeTypeRegistryResult(
            'unavailable',
            'Registry Home Vault가 지정되지 않았습니다.',
          );
        }

        const homeVault = settings.vaults.find(
          (vault) => vault.id === homeVaultId,
        );

        if (!homeVault || !(await exists(homeVault.path))) {
          return createKnowledgeTypeRegistryResult(
            'inaccessible',
            'Registry Home Vault에 접근할 수 없습니다.',
          );
        }

        const registryPath = path.resolve(
          homeVault.path,
          registryFileRelativePaths['knowledge-types'],
        );

        if (!(await exists(registryPath))) {
          return createKnowledgeTypeRegistryResult(
            'not-found',
            'Knowledge Type Registry 파일을 찾을 수 없습니다.',
            {
              severity: 'error',
              code: 'knowledge-type-registry-not-found',
              message: 'Knowledge Type Registry 파일을 찾을 수 없습니다.',
            },
          );
        }

        try {
          const decoded = decodeRegistryMarkdown(await readFile(registryPath));

          if (!decoded.ok) {
            return createKnowledgeTypeRegistryResult(
              'loaded-with-errors',
              decoded.message,
              {
                severity: 'error',
                code: 'knowledge-type-registry-unsupported-encoding',
                message: decoded.message,
              },
            );
          }

          return parseKnowledgeTypeRegistry(decoded.text);
        } catch {
          return createKnowledgeTypeRegistryResult(
            'loaded-with-errors',
            'Knowledge Type Registry 파일을 읽거나 파싱할 수 없습니다.',
            {
              severity: 'error',
              code: 'knowledge-type-registry-read-failed',
              message: 'Knowledge Type Registry 파일을 읽거나 파싱할 수 없습니다.',
            },
          );
        }
      },
  };
}
