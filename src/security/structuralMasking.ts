export type FilePathMaskingReplacement = {
  entryId: string;
  type: 'file-path';
  original: string;
  alias: string;
  count: number;
};

export type InternalIpMaskingReplacement = {
  entryId: string;
  type: 'internal-ip';
  original: string;
  alias: string;
  count: number;
};

export type StructuralMaskingReplacement =
  | FilePathMaskingReplacement
  | InternalIpMaskingReplacement;

export type StructuralMaskingResult = {
  maskedText: string;
  replacementCount: number;
};

const windowsAbsolutePathCheckPattern = /\b[A-Za-z]:[\\/]/u;
const unixHomeAbsolutePathCheckPattern =
  /(?:^|[^\p{L}\p{N}._-])\/(?:Users|home)\/[\p{L}\p{N}._~%+@-]+/u;
const quotedAbsolutePathPattern =
  /(["'`])((?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^"'`\r\n]+)\1/gu;
const windowsAbsolutePathMaskPattern =
  /\b[A-Za-z]:[\\/][^\s:*?"<>|'`]+/gu;
const unixHomeAbsolutePathMaskPattern =
  /(?<![\p{L}\p{N}._-])\/(?:Users|home)\/[^\s<>"'`|]+/gu;
const trailingPathPunctuationPattern = /[),.;:!?\]}，。！？]+$/u;
const internalIpv4Pattern =
  /(?<!\d)(10\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))(?::\d{1,5})?(?!\d)/gu;

function splitTrailingPunctuation(value: string): {
  path: string;
  suffix: string;
} {
  const match = value.match(trailingPathPunctuationPattern);
  const suffix = match?.[0] ?? '';

  return {
    path: suffix ? value.slice(0, -suffix.length) : value,
    suffix,
  };
}

function normalizePathKey(value: string): string {
  return windowsAbsolutePathCheckPattern.test(value)
    ? value.replaceAll('/', '\\').toLocaleLowerCase('en-US')
    : value;
}

export function containsAbsoluteFilesystemPath(text: string): boolean {
  return (
    windowsAbsolutePathCheckPattern.test(text) ||
    unixHomeAbsolutePathCheckPattern.test(text)
  );
}

export function containsInternalNetworkAddress(text: string): boolean {
  internalIpv4Pattern.lastIndex = 0;
  return internalIpv4Pattern.test(text);
}

export function createStructuralSensitiveDataMasker(): {
  maskText: (text: string) => StructuralMaskingResult;
  getReplacements: () => StructuralMaskingReplacement[];
} {
  const aliasesByPath = new Map<string, string>();
  const replacementsByAlias = new Map<string, FilePathMaskingReplacement>();
  const internalIpAliases = new Map<string, string>();
  const internalIpReplacements = new Map<
    string,
    InternalIpMaskingReplacement
  >();

  function replacePath(value: string): string {
    const { path, suffix } = splitTrailingPunctuation(value);

    if (!path) {
      return value;
    }

    const pathKey = normalizePathKey(path);
    let alias = aliasesByPath.get(pathKey);

    if (!alias) {
      alias = `FILE_PATH_${String(aliasesByPath.size + 1).padStart(3, '0')}`;
      aliasesByPath.set(pathKey, alias);
      replacementsByAlias.set(alias, {
        entryId: `structural:${alias}`,
        type: 'file-path',
        original: path,
        alias,
        count: 0,
      });
    }

    const replacement = replacementsByAlias.get(alias);

    if (replacement) {
      replacement.count += 1;
    }

    return `[${alias}]${suffix}`;
  }

  function replaceInternalIp(value: string): string {
    const ip = value.split(':', 1)[0];
    let alias = internalIpAliases.get(ip);

    if (!alias) {
      alias = `INTERNAL_IP_${String(internalIpAliases.size + 1).padStart(3, '0')}`;
      internalIpAliases.set(ip, alias);
      internalIpReplacements.set(alias, {
        entryId: `structural:${alias}`,
        type: 'internal-ip',
        original: ip,
        alias,
        count: 0,
      });
    }

    const replacement = internalIpReplacements.get(alias);

    if (replacement) {
      replacement.count += 1;
    }

    return `[${alias}]`;
  }

  return {
    maskText: (text) => {
      let replacementCount = 0;
      const replaceMatch = (value: string): string => {
        replacementCount += 1;
        return replacePath(value);
      };
      const maskedQuotedPaths = text.replace(
        quotedAbsolutePathPattern,
        (_match, quote: string, pathValue: string) =>
          `${quote}${replaceMatch(pathValue)}${quote}`,
      );
      const maskedWindowsPaths = maskedQuotedPaths.replace(
        windowsAbsolutePathMaskPattern,
        replaceMatch,
      );
      const maskedPaths = maskedWindowsPaths.replace(
        unixHomeAbsolutePathMaskPattern,
        replaceMatch,
      );
      const maskedText = maskedPaths.replace(internalIpv4Pattern, (value) => {
        replacementCount += 1;
        return replaceInternalIp(value);
      });

      return { maskedText, replacementCount };
    },
    getReplacements: () =>
      [
        ...replacementsByAlias.values(),
        ...internalIpReplacements.values(),
      ].map((replacement) => ({ ...replacement })),
  };
}
