export type SecretRuleSource = 'builtin' | 'custom';
export type SecretRuleKind = 'keyword-value' | 'regex' | 'structured';
export type SecretSeverity = 'hard-block';

export type SecretRule = {
  id: string;
  name: string;
  source: SecretRuleSource;
  kind: SecretRuleKind;
  enabled: boolean;
  severity: SecretSeverity;
  category: string;
  protected?: boolean;
  keywords?: string[];
  pattern?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomSecretRule = SecretRule & {
  source: 'custom';
  kind: 'keyword-value' | 'regex';
  protected?: false;
  createdAt: string;
  updatedAt: string;
};

export type SecretDetectionSettings = {
  customRules: CustomSecretRule[];
};

export type AddSecretRuleInput = {
  name: string;
  kind: 'keyword-value' | 'regex';
  enabled?: boolean;
  keywords?: string[];
  pattern?: string;
};

export type UpdateSecretRuleInput = AddSecretRuleInput & {
  id: string;
};

export type SecretDetection = {
  ruleId: string;
  ruleName: string;
  source: SecretRuleSource;
  category: string;
  documentId?: string;
  count: number;
};

export type SecretDetectionResult = {
  detected: boolean;
  detections: SecretDetection[];
  totalCount: number;
};

export type SecretTextScanResult = SecretDetectionResult & {
  redactedText: string;
};

export const MAX_CUSTOM_SECRET_RULE_NAME_CHARS = 100;
export const MAX_CUSTOM_SECRET_KEYWORDS = 20;
export const MAX_CUSTOM_SECRET_KEYWORD_CHARS = 80;
export const MAX_CUSTOM_SECRET_REGEX_CHARS = 500;
export const REDACTED_SECRET = '[REDACTED_SECRET]';

export const builtInSecretRules: readonly SecretRule[] = [
  {
    id: 'builtin-password',
    name: 'Password / 비밀번호 / 패스워드',
    source: 'builtin',
    kind: 'keyword-value',
    enabled: true,
    severity: 'hard-block',
    category: 'password',
    protected: true,
    keywords: [
      'password',
      'passwd',
      'pwd',
      'passphrase',
      '패스워드',
      '비밀번호',
      '암호',
      '접속 비밀번호',
      '로그인 비밀번호',
      '기본 패스워드',
      '변경 패스워드',
      '초기 패스워드',
      'pw',
    ],
  },
  {
    id: 'builtin-credential-pair',
    name: 'Credential Pair · Account / 사용자 ID',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'credential-pair',
    protected: true,
  },
  {
    id: 'builtin-api-key',
    name: 'API Key',
    source: 'builtin',
    kind: 'keyword-value',
    enabled: true,
    severity: 'hard-block',
    category: 'api-key',
    protected: true,
    keywords: ['api_key', 'api-key', 'apikey', 'api key'],
  },
  {
    id: 'builtin-secret-key',
    name: 'Secret Key',
    source: 'builtin',
    kind: 'keyword-value',
    enabled: true,
    severity: 'hard-block',
    category: 'secret-key',
    protected: true,
    keywords: [
      'secret',
      'secret_key',
      'secret-key',
      'client_secret',
      'client-secret',
    ],
  },
  {
    id: 'builtin-access-token',
    name: 'Access / Refresh Token',
    source: 'builtin',
    kind: 'keyword-value',
    enabled: true,
    severity: 'hard-block',
    category: 'access-token',
    protected: true,
    keywords: [
      'access_token',
      'access-token',
      'refresh_token',
      'refresh-token',
    ],
  },
  {
    id: 'builtin-authorization-bearer',
    name: 'Authorization Bearer',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'bearer-token',
    protected: true,
  },
  {
    id: 'builtin-jwt',
    name: 'JWT',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'jwt',
    protected: true,
  },
  {
    id: 'builtin-private-key',
    name: 'Private Key',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'private-key',
    protected: true,
  },
  {
    id: 'builtin-db-credential',
    name: 'DB Credential',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'database-credential',
    protected: true,
  },
  {
    id: 'builtin-aws-access-key',
    name: 'AWS Access Key',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'aws-access-key',
    protected: true,
  },
  {
    id: 'builtin-aws-secret-key',
    name: 'AWS Secret Access Key',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'aws-secret-key',
    protected: true,
  },
  {
    id: 'builtin-openai-api-key',
    name: 'OpenAI API Key',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'provider-api-key',
    protected: true,
  },
  {
    id: 'builtin-anthropic-api-key',
    name: 'Anthropic API Key',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'provider-api-key',
    protected: true,
  },
  {
    id: 'builtin-cookie-session',
    name: 'Cookie / Session Token',
    source: 'builtin',
    kind: 'keyword-value',
    enabled: true,
    severity: 'hard-block',
    category: 'session-token',
    protected: true,
    keywords: ['cookie', 'session', 'session_id', 'sessionid', 'auth_token'],
  },
  {
    id: 'builtin-env-secret',
    name: '.env Secret',
    source: 'builtin',
    kind: 'structured',
    enabled: true,
    severity: 'hard-block',
    category: 'environment-secret',
    protected: true,
  },
] as const;

export function createDefaultSecretDetectionSettings(): SecretDetectionSettings {
  return { customRules: [] };
}

export function getSecretRules(
  customRules: CustomSecretRule[],
): SecretRule[] {
  return [
    ...builtInSecretRules.map((rule) => ({ ...rule })),
    ...customRules.map((rule) => ({ ...rule })),
  ];
}

export function validateCustomSecretRuleInput(
  input: unknown,
): AddSecretRuleInput | UpdateSecretRuleInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Secret Rule 입력값이 올바르지 않습니다.');
  }

  const candidate = input as Partial<UpdateSecretRuleInput>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';

  if (!name) {
    throw new Error('Rule Name을 입력하세요.');
  }

  if (name.length > MAX_CUSTOM_SECRET_RULE_NAME_CHARS) {
    throw new Error(`Rule Name은 ${MAX_CUSTOM_SECRET_RULE_NAME_CHARS}자 이하여야 합니다.`);
  }

  if (candidate.kind !== 'keyword-value' && candidate.kind !== 'regex') {
    throw new Error('지원하지 않는 Secret Detection Type입니다.');
  }

  if (
    ('id' in candidate &&
      (typeof candidate.id !== 'string' || !candidate.id.trim())) ||
    ('enabled' in candidate && typeof candidate.enabled !== 'boolean')
  ) {
    throw new Error('Secret Rule 입력값이 올바르지 않습니다.');
  }

  const base = {
    ...('id' in candidate ? { id: candidate.id?.trim() } : {}),
    name,
    kind: candidate.kind,
    enabled: candidate.enabled ?? true,
  };

  if (candidate.kind === 'keyword-value') {
    const keywords = Array.isArray(candidate.keywords)
      ? [...new Set(candidate.keywords.map((keyword) => keyword.trim()).filter(Boolean))]
      : [];

    if (keywords.length === 0) {
      throw new Error('탐지할 Keyword를 하나 이상 입력하세요.');
    }

    if (keywords.length > MAX_CUSTOM_SECRET_KEYWORDS) {
      throw new Error(`Keyword는 최대 ${MAX_CUSTOM_SECRET_KEYWORDS}개까지 등록할 수 있습니다.`);
    }

    if (keywords.some((keyword) => keyword.length > MAX_CUSTOM_SECRET_KEYWORD_CHARS)) {
      throw new Error(`각 Keyword는 ${MAX_CUSTOM_SECRET_KEYWORD_CHARS}자 이하여야 합니다.`);
    }

    return { ...base, kind: 'keyword-value', keywords } as
      | AddSecretRuleInput
      | UpdateSecretRuleInput;
  }

  const pattern = typeof candidate.pattern === 'string' ? candidate.pattern.trim() : '';

  if (!pattern) {
    throw new Error('Regex Pattern을 입력하세요.');
  }

  if (pattern.length > MAX_CUSTOM_SECRET_REGEX_CHARS) {
    throw new Error(`Regex Pattern은 ${MAX_CUSTOM_SECRET_REGEX_CHARS}자 이하여야 합니다.`);
  }

  try {
    new RegExp(pattern, 'giu');
  } catch {
    throw new Error('Regex Pattern 문법이 올바르지 않습니다.');
  }

  return { ...base, kind: 'regex', pattern } as
    | AddSecretRuleInput
    | UpdateSecretRuleInput;
}

type MatchRange = { start: number; end: number };
type NormalizedDetectionText = {
  text: string;
  sourceIndices: number[];
};

function isMarkdownUnderscore(text: string, index: number): boolean {
  const previous = text[index - 1] ?? '';
  const next = text[index + 1] ?? '';
  const wordCharacter = /[\p{L}\p{N}]/u;

  return !(wordCharacter.test(previous) && wordCharacter.test(next));
}

function isLinePrefixWhitespace(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;

  return /^\s*$/u.test(text.slice(lineStart, index));
}

function isMarkdownHeadingMarker(text: string, index: number): boolean {
  if (text[index] !== '#') {
    return false;
  }

  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  const remainingLine = text.slice(index).match(/^#+(?=\s)/u)?.[0];

  return /^\s*#*$/u.test(prefix) && Boolean(remainingLine);
}

function isMarkdownQuoteMarker(text: string, index: number): boolean {
  if (text[index] !== '>') {
    return false;
  }

  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return /^\s*(?:>\s*)*$/u.test(text.slice(lineStart, index));
}

export function normalizeMarkdownForSecretDetection(
  text: string,
): NormalizedDetectionText {
  const normalizedCharacters: string[] = [];
  const sourceIndices: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const atLinePrefix = isLinePrefixWhitespace(text, index);
    const isHeadingOrQuoteMarker =
      isMarkdownQuoteMarker(text, index) ||
      isMarkdownHeadingMarker(text, index);
    const isListMarker =
      atLinePrefix &&
      (character === '-' || character === '+') &&
      /\s/u.test(text[index + 1] ?? '');
    const isFormattingMarker =
      character === '`' ||
      character === '*' ||
      (character === '_' && isMarkdownUnderscore(text, index));

    if (isHeadingOrQuoteMarker || isListMarker || isFormattingMarker) {
      continue;
    }

    normalizedCharacters.push(character);
    sourceIndices.push(index);
  }

  return {
    text: normalizedCharacters.join(''),
    sourceIndices,
  };
}

function toOriginalRange(
  normalizedRange: MatchRange,
  normalized: NormalizedDetectionText,
  originalText: string,
): MatchRange | null {
  const firstSourceIndex = normalized.sourceIndices[normalizedRange.start];
  const lastSourceIndex = normalized.sourceIndices[normalizedRange.end - 1];

  if (firstSourceIndex === undefined || lastSourceIndex === undefined) {
    return null;
  }

  let start = firstSourceIndex;
  let end = lastSourceIndex + 1;
  const openingWrapper = originalText[start - 1];
  const closingWrapper = originalText[end];

  if (
    (openingWrapper === '`' || openingWrapper === '"' || openingWrapper === "'") &&
    closingWrapper === openingWrapper
  ) {
    start -= 1;
    end += 1;
  }

  return { start, end };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectRegularExpressionMatches(
  text: string,
  expression: RegExp,
  captureGroup = 0,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  let match: RegExpExecArray | null;

  while ((match = expression.exec(text))) {
    const captured = match[captureGroup];

    if (captured) {
      const relativeStart = match[0].lastIndexOf(captured);
      const start = match.index + Math.max(relativeStart, 0);

      ranges.push({ start, end: start + captured.length });
    }

    if (match[0].length === 0) {
      expression.lastIndex += 1;
    }
  }

  return ranges;
}

function collectKeywordValueMatches(
  text: string,
  keywords: string[],
): MatchRange[] {
  if (keywords.length === 0) {
    return [];
  }

  const keywordPattern = keywords
    .map(escapeRegularExpression)
    .sort((left, right) => right.length - left.length)
    .join('|');
  const expression = new RegExp(
    `(?:^|[\\s;,|])(?:${keywordPattern})(?:\\s*\\([^\\r\\n|)]{1,30}\\))?(?:\\s*[:=|]\\s*|\\s+-\\s+)("[^"\\r\\n]+"|'[^'\\r\\n]+'|[^\\s,;|]+)`,
    'gimu',
  );

  return collectRegularExpressionMatches(text, expression, 1);
}

const accountKeywords = [
  'username',
  'user',
  'login',
  'login_id',
  '아이디',
  'id',
  '사용자 id',
  '사용자id',
  '계정',
  '계정명',
  '로그인 id',
  '로그인id',
  '사용자명',
];

const passwordKeywords = [
  'password',
  'passwd',
  'pwd',
  'passphrase',
  '패스워드',
  '비밀번호',
  '암호',
  '접속 비밀번호',
  '로그인 비밀번호',
  '기본 패스워드',
  '변경 패스워드',
  '초기 패스워드',
  'pw',
];

type MarkdownTableCell = {
  text: string;
  start: number;
  end: number;
};

function parseMarkdownTableCells(
  line: string,
  lineStart: number,
): MarkdownTableCell[] {
  const cells: MarkdownTableCell[] = [];
  let cellStart = 0;

  for (let index = 0; index <= line.length; index += 1) {
    if (index < line.length && line[index] !== '|') {
      continue;
    }

    const rawCell = line.slice(cellStart, index);
    const leadingWhitespace = rawCell.match(/^\s*/u)?.[0].length ?? 0;
    const trailingWhitespace = rawCell.match(/\s*$/u)?.[0].length ?? 0;
    const start = lineStart + cellStart + leadingWhitespace;
    const end = lineStart + index - trailingWhitespace;

    if (rawCell.trim()) {
      cells.push({ text: rawCell.trim(), start, end });
    }

    cellStart = index + 1;
  }

  return cells;
}

function normalizeTableLabel(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[\s()\[\]{}_-]+/gu, '');
}

function isLabelFrom(value: string, keywords: string[]): boolean {
  const normalizedValue = normalizeTableLabel(value);

  return keywords.some((keyword) =>
    normalizedValue.includes(normalizeTableLabel(keyword)),
  );
}

function isMarkdownTableSeparator(cells: MarkdownTableCell[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.text))
  );
}

function collectMarkdownTablePasswordMatches(text: string): MatchRange[] {
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;

  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const ranges: MatchRange[] = [];

  for (let lineIndex = 0; lineIndex < lines.length - 2; lineIndex += 1) {
    if (!lines[lineIndex].includes('|')) {
      continue;
    }

    const headerCells = parseMarkdownTableCells(
      lines[lineIndex],
      lineStarts[lineIndex],
    );
    const separatorCells = parseMarkdownTableCells(
      lines[lineIndex + 1],
      lineStarts[lineIndex + 1],
    );

    if (
      headerCells.length === 0 ||
      separatorCells.length !== headerCells.length ||
      !isMarkdownTableSeparator(separatorCells)
    ) {
      continue;
    }

    const passwordColumn = headerCells.findIndex((cell) =>
      isLabelFrom(cell.text, passwordKeywords),
    );

    if (passwordColumn < 0) {
      continue;
    }

    for (
      let rowIndex = lineIndex + 2;
      rowIndex < lines.length && lines[rowIndex].includes('|');
      rowIndex += 1
    ) {
      const rowCells = parseMarkdownTableCells(
        lines[rowIndex],
        lineStarts[rowIndex],
      );
      const passwordCell = rowCells[passwordColumn];

      if (passwordCell?.text) {
        ranges.push({ start: passwordCell.start, end: passwordCell.end });
      }
    }
  }

  return ranges;
}

function collectMarkdownTableCredentialPairMatches(
  text: string,
): MatchRange[] {
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;

  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const ranges: MatchRange[] = [];

  for (let lineIndex = 0; lineIndex < lines.length - 2; lineIndex += 1) {
    const headerCells = parseMarkdownTableCells(
      lines[lineIndex],
      lineStarts[lineIndex],
    );
    const separatorCells = parseMarkdownTableCells(
      lines[lineIndex + 1],
      lineStarts[lineIndex + 1],
    );
    const accountColumn = headerCells.findIndex((cell) =>
      isLabelFrom(cell.text, accountKeywords),
    );
    const passwordColumn = headerCells.findIndex((cell) =>
      isLabelFrom(cell.text, passwordKeywords),
    );

    if (
      accountColumn < 0 ||
      passwordColumn < 0 ||
      separatorCells.length !== headerCells.length ||
      !isMarkdownTableSeparator(separatorCells)
    ) {
      continue;
    }

    for (
      let rowIndex = lineIndex + 2;
      rowIndex < lines.length && lines[rowIndex].includes('|');
      rowIndex += 1
    ) {
      const rowCells = parseMarkdownTableCells(
        lines[rowIndex],
        lineStarts[rowIndex],
      );
      const accountCell = rowCells[accountColumn];
      const passwordCell = rowCells[passwordColumn];

      if (accountCell?.text && passwordCell?.text) {
        ranges.push({ start: passwordCell.start, end: passwordCell.end });
      }
    }
  }

  return ranges;
}

function collectCredentialPairMatches(text: string): MatchRange[] {
  const usernames = collectKeywordValueMatches(text, accountKeywords);
  const passwords = collectKeywordValueMatches(text, passwordKeywords);

  return [
    ...passwords.filter((password) =>
      usernames.some(
        (username) =>
          Math.abs(username.start - password.start) <= 300,
      ),
    ),
    ...collectMarkdownTableCredentialPairMatches(text),
  ];
}

function collectStructuredMatches(text: string, ruleId: string): MatchRange[] {
  switch (ruleId) {
    case 'builtin-credential-pair':
      return collectCredentialPairMatches(text);
    case 'builtin-authorization-bearer':
      return collectRegularExpressionMatches(
        text,
        /\b(?:Authorization\s*:\s*)?Bearer\s+([A-Za-z0-9._~+/=-]{16,})/giu,
        1,
      );
    case 'builtin-jwt':
      return collectRegularExpressionMatches(
        text,
        /\b([A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/gu,
        1,
      );
    case 'builtin-private-key':
      return collectRegularExpressionMatches(
        text,
        /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|$)/giu,
      );
    case 'builtin-db-credential':
      return collectRegularExpressionMatches(
        text,
        /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/giu,
      );
    case 'builtin-aws-access-key':
      return collectRegularExpressionMatches(text, /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/gu, 1);
    case 'builtin-aws-secret-key':
      return collectRegularExpressionMatches(
        text,
        /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*("[A-Za-z0-9/+=]{40}"|'[A-Za-z0-9/+=]{40}'|[A-Za-z0-9/+=]{40})/gu,
        1,
      );
    case 'builtin-openai-api-key':
      return collectRegularExpressionMatches(
        text,
        /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,})\b/gu,
        1,
      );
    case 'builtin-anthropic-api-key':
      return collectRegularExpressionMatches(
        text,
        /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/gu,
        1,
      );
    case 'builtin-env-secret':
      return collectRegularExpressionMatches(
        text,
        /(?:^|[\r\n])\s*[A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|SECRET|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN)\s*=\s*("[^"\r\n]+"|'[^'\r\n]+'|[^\s#;]+)/gmu,
        1,
      );
    default:
      return [];
  }
}

function collectRuleMatches(text: string, rule: SecretRule): MatchRange[] {
  if (!rule.enabled) {
    return [];
  }

  if (rule.kind === 'keyword-value') {
    return [
      ...collectKeywordValueMatches(text, rule.keywords ?? []),
      ...(rule.id === 'builtin-password'
        ? collectMarkdownTablePasswordMatches(text)
        : []),
    ];
  }

  if (rule.kind === 'structured') {
    return collectStructuredMatches(text, rule.id);
  }

  if (!rule.pattern) {
    return [];
  }

  try {
    return collectRegularExpressionMatches(
      text,
      new RegExp(rule.pattern, 'giu'),
    );
  } catch {
    return [];
  }
}

function redactRanges(text: string, ranges: MatchRange[]): string {
  const orderedRanges = [...ranges]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce<MatchRange[]>((merged, range) => {
      const previous = merged.at(-1);

      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }

      return merged;
    }, []);
  let cursor = 0;
  let redactedText = '';

  for (const range of orderedRanges) {
    redactedText += `${text.slice(cursor, range.start)}${REDACTED_SECRET}`;
    cursor = range.end;
  }

  return redactedText + text.slice(cursor);
}

export function scanSecrets(
  text: string,
  rules: SecretRule[],
  documentId?: string,
): SecretTextScanResult {
  const detections: SecretDetection[] = [];
  const ranges: MatchRange[] = [];
  const normalized = normalizeMarkdownForSecretDetection(text);

  for (const rule of rules) {
    const normalizedRuleRanges = collectRuleMatches(normalized.text, rule);
    const ruleRanges = normalizedRuleRanges.flatMap((range) => {
      const originalRange = toOriginalRange(range, normalized, text);

      return originalRange ? [originalRange] : [];
    });

    if (ruleRanges.length === 0) {
      continue;
    }

    ranges.push(...ruleRanges);
    detections.push({
      ruleId: rule.id,
      ruleName: rule.name,
      source: rule.source,
      category: rule.category,
      ...(documentId ? { documentId } : {}),
      count: ruleRanges.length,
    });
  }

  const totalCount = detections.reduce(
    (total, detection) => total + detection.count,
    0,
  );

  return {
    detected: detections.length > 0,
    detections,
    totalCount,
    redactedText: redactRanges(text, ranges),
  };
}

export function detectSecrets(
  text: string,
  rules: SecretRule[],
  documentId?: string,
): SecretDetectionResult {
  const { redactedText: _redactedText, ...result } = scanSecrets(
    text,
    rules,
    documentId,
  );

  return result;
}

export function testSecretRule(text: string, rule: SecretRule): number {
  return detectSecrets(text, [rule]).totalCount;
}
