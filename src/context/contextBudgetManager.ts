import type { LLMChatMessage } from '../llmChat';

export type ContextProvider = 'local' | 'openai';

export type ContextProfile = {
  provider: ContextProvider;
  model: string;
  contextWindowTokens: number;
  reservedSystemTokens: number;
  reservedHistoryTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
};

export type ContextBudgetDocumentInput = {
  documentKey: string;
  source: 'manual' | 'auto';
  content: string;
  snippet?: string;
  relevanceScore?: number;
};

export type ContextBudgetDocumentResult = {
  documentKey: string;
  source: 'manual' | 'auto';
  relevanceScore?: number;
  allocatedTokens: number;
  usedTokens: number;
  estimatedOriginalTokens: number;
  truncated: boolean;
  includedText: string;
};

export type ContextBudgetResult = {
  profile: ContextProfile;
  estimatedQuestionTokens: number;
  estimatedSystemTokens: number;
  estimatedHistoryTokens: number;
  availableDocumentTokens: number;
  historyMessages: LLMChatMessage[];
  documents: ContextBudgetDocumentResult[];
  totalEstimatedInputTokens: number;
};

const localModelProfiles = [
  { pattern: /exaone3\.5/iu, contextWindowTokens: 8192 },
  { pattern: /qwen3/iu, contextWindowTokens: 32768 },
  { pattern: /llama3\.1/iu, contextWindowTokens: 128000 },
  { pattern: /llama3\.2/iu, contextWindowTokens: 8192 },
  { pattern: /mistral/iu, contextWindowTokens: 32768 },
];

const openAIModelProfiles = [
  { pattern: /^gpt-4\.1(?:-|$)/iu, contextWindowTokens: 1_047_576 },
  { pattern: /^gpt-4o(?:-|$)/iu, contextWindowTokens: 128_000 },
  { pattern: /^gpt-5(?:-|$)/iu, contextWindowTokens: 400_000 },
];

const fallbackContextWindowTokens: Record<ContextProvider, number> = {
  local: 4096,
  openai: 128_000,
};

export function createContextProfile(
  provider: ContextProvider,
  model: string | null | undefined,
): ContextProfile {
  const normalizedModel = model?.trim() || `${provider}-default`;
  const registry =
    provider === 'local' ? localModelProfiles : openAIModelProfiles;
  const matchedProfile = registry.find((profile) =>
    profile.pattern.test(normalizedModel),
  );
  const contextWindowTokens =
    matchedProfile?.contextWindowTokens ??
    fallbackContextWindowTokens[provider];

  return provider === 'local'
    ? {
        provider,
        model: normalizedModel,
        contextWindowTokens,
        reservedSystemTokens: 450,
        reservedHistoryTokens: Math.min(900, Math.floor(contextWindowTokens * 0.18)),
        reservedOutputTokens: Math.min(900, Math.floor(contextWindowTokens * 0.2)),
        safetyMarginTokens: Math.min(350, Math.floor(contextWindowTokens * 0.08)),
      }
    : {
        provider,
        model: normalizedModel,
        contextWindowTokens,
        reservedSystemTokens: 700,
        reservedHistoryTokens: Math.min(6_000, Math.floor(contextWindowTokens * 0.08)),
        reservedOutputTokens: Math.min(4_000, Math.floor(contextWindowTokens * 0.12)),
        safetyMarginTokens: Math.min(2_000, Math.floor(contextWindowTokens * 0.04)),
      };
}

export function estimateTokens(text: string): number {
  const normalizedText = text.replace(/\s+/gu, ' ').trim();

  if (!normalizedText) {
    return 0;
  }

  const cjkChars = normalizedText.match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const nonCjkText = normalizedText.replace(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, '');
  const nonCjkTokens = Math.ceil(nonCjkText.length / 4);

  return Math.max(1, cjkChars + nonCjkTokens);
}

function trimToTokenBudget(text: string, budgetTokens: number): string {
  const trimmedText = text.trim();

  if (!trimmedText || budgetTokens <= 0) {
    return '';
  }

  if (estimateTokens(trimmedText) <= budgetTokens) {
    return trimmedText;
  }

  const truncationMarker = '\n...[truncated]';
  const contentBudgetTokens = Math.max(
    1,
    budgetTokens - estimateTokens(truncationMarker),
  );
  let low = 0;
  let high = trimmedText.length;

  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);

    if (estimateTokens(trimmedText.slice(0, midpoint)) <= contentBudgetTokens) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }

  const result = trimmedText.slice(0, low).trimEnd();

  return result ? `${result}${truncationMarker}` : '';
}

function normalizeRetrievalText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getQueryTokens(question: string): string[] {
  return [
    ...new Set(
      normalizeRetrievalText(question)
        .split(' ')
        .filter((token) => token.length >= 2),
    ),
  ];
}

function splitMarkdownSections(content: string): string[] {
  const sections: string[] = [];
  const lines = content.split(/\n/u);
  let currentSection: string[] = [];

  for (const line of lines) {
    if (/^\s*#{1,3}\s+/u.test(line) && currentSection.length > 0) {
      sections.push(currentSection.join('\n').trim());
      currentSection = [];
    }

    currentSection.push(line);
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n').trim());
  }

  return sections.filter(Boolean);
}

function findRelevantSections(content: string, queryTokens: string[]): string[] {
  if (queryTokens.length === 0) {
    return [];
  }

  return splitMarkdownSections(content)
    .map((section, index) => {
      const normalizedSection = normalizeRetrievalText(section);
      const matchCount = queryTokens.filter((token) =>
        normalizedSection.includes(token),
      ).length;

      return { section, index, matchCount };
    })
    .filter((item) => item.matchCount > 0)
    .sort(
      (left, right) =>
        right.matchCount - left.matchCount || left.index - right.index,
    )
    .map((item) => item.section);
}

function appendUniquePart(parts: string[], candidate: string): void {
  const normalizedCandidate = candidate.trim();

  if (!normalizedCandidate) {
    return;
  }

  if (
    parts.some(
      (part) =>
        part.includes(normalizedCandidate) ||
        normalizedCandidate.includes(part),
    )
  ) {
    return;
  }

  parts.push(normalizedCandidate);
}

function extractDocumentText(input: {
  content: string;
  snippet?: string;
  query: string;
  budgetTokens: number;
}): string {
  const content = input.content.trim();
  const queryTokens = getQueryTokens(input.query);
  const parts: string[] = [];

  if (estimateTokens(content) <= input.budgetTokens) {
    return content;
  }

  if (input.snippet?.trim()) {
    appendUniquePart(parts, `Relevant excerpt:\n${input.snippet.trim()}`);
  }

  for (const section of findRelevantSections(content, queryTokens)) {
    appendUniquePart(parts, section);
  }

  appendUniquePart(parts, content);

  return trimToTokenBudget(parts.join('\n\n'), input.budgetTokens);
}

function selectRecentHistory(
  history: LLMChatMessage[],
  budgetTokens: number,
): {
  messages: LLMChatMessage[];
  tokens: number;
} {
  const selectedMessages: LLMChatMessage[] = [];
  let usedTokens = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageTokens = estimateTokens(message.content);

    if (selectedMessages.length > 0 && usedTokens + messageTokens > budgetTokens) {
      break;
    }

    if (messageTokens > budgetTokens && selectedMessages.length === 0) {
      selectedMessages.unshift({
        ...message,
        content: trimToTokenBudget(message.content, budgetTokens),
      });
      usedTokens = budgetTokens;
      break;
    }

    selectedMessages.unshift(message);
    usedTokens += messageTokens;
  }

  return { messages: selectedMessages, tokens: usedTokens };
}

function getMinimumAllocation(
  profile: ContextProfile,
  source: ContextBudgetDocumentInput['source'],
  documentCount: number,
  budgetTokens: number,
): number {
  const preferredMinimum =
    profile.provider === 'local'
      ? source === 'manual'
        ? 420
        : 320
      : source === 'manual'
        ? 1_200
        : 900;
  const fairMinimum = Math.floor(budgetTokens / Math.max(documentCount, 1));

  return Math.max(80, Math.min(preferredMinimum, fairMinimum));
}

function allocateGroup(input: {
  profile: ContextProfile;
  documents: ContextBudgetDocumentInput[];
  budgetTokens: number;
  totalDocumentBudgetTokens: number;
  query: string;
}): {
  results: ContextBudgetDocumentResult[];
  usedTokens: number;
} {
  const documents = input.documents.filter((document) =>
    document.content.trim(),
  );

  if (documents.length === 0 || input.budgetTokens <= 0) {
    return { results: [], usedTokens: 0 };
  }

  const minimumAllocation = getMinimumAllocation(
    input.profile,
    documents[0].source,
    documents.length,
    input.budgetTokens,
  );
  const maxSingleDocumentTokens = Math.max(
    minimumAllocation,
    Math.floor(
      input.totalDocumentBudgetTokens *
        (documents[0].source === 'manual' ? 0.6 : 0.5),
    ),
  );
  const estimatedOriginalTokens = documents.map((document) =>
    estimateTokens(document.content),
  );
  const allocations = documents.map((document, index) =>
    Math.min(
      estimatedOriginalTokens[index],
      minimumAllocation,
      maxSingleDocumentTokens,
    ),
  );
  let remainingBudget =
    input.budgetTokens - allocations.reduce((total, value) => total + value, 0);

  while (remainingBudget > 0) {
    const expandableDocuments = documents
      .map((document, index) => ({
        document,
        index,
        remainingNeed: Math.min(
          estimatedOriginalTokens[index],
          maxSingleDocumentTokens,
        ) - allocations[index],
        weight:
          document.source === 'manual'
            ? 1
            : Math.max(document.relevanceScore ?? 1, 1),
      }))
      .filter((item) => item.remainingNeed > 0);

    if (expandableDocuments.length === 0) {
      break;
    }

    const totalWeight = expandableDocuments.reduce(
      (total, item) => total + item.weight,
      0,
    );
    let distributedThisRound = 0;

    for (const item of expandableDocuments) {
      const weightedShare = Math.max(
        1,
        Math.floor((remainingBudget * item.weight) / totalWeight),
      );
      const extraTokens = Math.min(item.remainingNeed, weightedShare);

      allocations[item.index] += extraTokens;
      distributedThisRound += extraTokens;
    }

    if (distributedThisRound === 0) {
      break;
    }

    remainingBudget -= distributedThisRound;
  }

  const results = documents.flatMap((document, index) => {
    const allocatedTokens = allocations[index];

    if (allocatedTokens <= 0) {
      return [];
    }

    const includedText = extractDocumentText({
      content: document.content,
      snippet: document.snippet,
      query: input.query,
      budgetTokens: allocatedTokens,
    });
    const usedTokens = estimateTokens(includedText);

    if (!includedText) {
      return [];
    }

    return [
      {
        documentKey: document.documentKey,
        source: document.source,
        relevanceScore: document.relevanceScore,
        allocatedTokens,
        usedTokens,
        estimatedOriginalTokens: estimatedOriginalTokens[index],
        truncated: usedTokens < estimatedOriginalTokens[index],
        includedText,
      },
    ];
  });

  return {
    results,
    usedTokens: results.reduce((total, result) => total + result.usedTokens, 0),
  };
}

function deduplicateBudgetDocuments(
  manualDocuments: ContextBudgetDocumentInput[],
  autoDocuments: ContextBudgetDocumentInput[],
): {
  manualDocuments: ContextBudgetDocumentInput[];
  autoDocuments: ContextBudgetDocumentInput[];
} {
  const seenKeys = new Set<string>();
  const uniqueManualDocuments = manualDocuments.filter((document) => {
    if (seenKeys.has(document.documentKey)) {
      return false;
    }

    seenKeys.add(document.documentKey);
    return Boolean(document.content.trim());
  });
  const uniqueAutoDocuments = autoDocuments.filter((document) => {
    if (seenKeys.has(document.documentKey)) {
      return false;
    }

    seenKeys.add(document.documentKey);
    return Boolean(document.content.trim());
  });

  return {
    manualDocuments: uniqueManualDocuments,
    autoDocuments: uniqueAutoDocuments,
  };
}

export function buildContextBudget(input: {
  profile: ContextProfile;
  systemPrompt: string;
  question: string;
  historyMessages?: LLMChatMessage[];
  manualDocuments: ContextBudgetDocumentInput[];
  autoDocuments: ContextBudgetDocumentInput[];
}): ContextBudgetResult {
  const history = selectRecentHistory(
    input.historyMessages ?? [],
    input.profile.reservedHistoryTokens,
  );
  const estimatedQuestionTokens = estimateTokens(input.question);
  const estimatedSystemTokens = estimateTokens(input.systemPrompt);
  const estimatedSystemReserve = Math.max(
    estimatedSystemTokens,
    input.profile.reservedSystemTokens,
  );
  const fixedTokens =
    estimatedSystemReserve +
    history.tokens +
    estimatedQuestionTokens +
    input.profile.reservedOutputTokens +
    input.profile.safetyMarginTokens;
  const availableDocumentTokens = Math.max(
    0,
    input.profile.contextWindowTokens - fixedTokens,
  );
  const deduplicatedDocuments = deduplicateBudgetDocuments(
    input.manualDocuments,
    input.autoDocuments,
  );
  const autoMinimumReserve =
    deduplicatedDocuments.manualDocuments.length > 0 &&
    deduplicatedDocuments.autoDocuments.length > 0
      ? Math.min(
          Math.floor(availableDocumentTokens * 0.35),
          deduplicatedDocuments.autoDocuments.length *
            getMinimumAllocation(
              input.profile,
              'auto',
              deduplicatedDocuments.autoDocuments.length,
              availableDocumentTokens,
            ),
        )
      : 0;
  const manualBudget = Math.max(
    0,
    availableDocumentTokens - autoMinimumReserve,
  );
  const manualAllocation = allocateGroup({
    profile: input.profile,
    documents: deduplicatedDocuments.manualDocuments,
    budgetTokens: manualBudget,
    totalDocumentBudgetTokens: availableDocumentTokens,
    query: input.question,
  });
  const autoBudget = Math.max(
    0,
    availableDocumentTokens - manualAllocation.usedTokens,
  );
  const autoAllocation = allocateGroup({
    profile: input.profile,
    documents: deduplicatedDocuments.autoDocuments,
    budgetTokens: autoBudget,
    totalDocumentBudgetTokens: availableDocumentTokens,
    query: input.question,
  });
  const documents = [...manualAllocation.results, ...autoAllocation.results];
  const documentTokens = documents.reduce(
    (total, document) => total + document.usedTokens,
    0,
  );

  return {
    profile: input.profile,
    estimatedQuestionTokens,
    estimatedSystemTokens,
    estimatedHistoryTokens: history.tokens,
    availableDocumentTokens,
    historyMessages: history.messages,
    documents,
    totalEstimatedInputTokens:
      estimatedSystemTokens +
      history.tokens +
      estimatedQuestionTokens +
      documentTokens,
  };
}

export function createContextBudgetSummary(result: ContextBudgetResult): {
  model: string;
  provider: ContextProvider;
  contextWindowTokens: number;
  availableDocumentTokens: number;
  estimatedQuestionTokens: number;
  estimatedSystemTokens: number;
  estimatedHistoryTokens: number;
  deliveredDocuments: Array<{
    documentKey: string;
    source: 'manual' | 'auto';
    relevanceScore?: number;
    allocatedTokens: number;
    usedTokens: number;
    estimatedOriginalTokens: number;
    truncated: boolean;
  }>;
  totalEstimatedInputTokens: number;
} {
  return {
    model: result.profile.model,
    provider: result.profile.provider,
    contextWindowTokens: result.profile.contextWindowTokens,
    availableDocumentTokens: result.availableDocumentTokens,
    estimatedQuestionTokens: result.estimatedQuestionTokens,
    estimatedSystemTokens: result.estimatedSystemTokens,
    estimatedHistoryTokens: result.estimatedHistoryTokens,
    deliveredDocuments: result.documents.map(
      ({ includedText: _includedText, ...document }) => document,
    ),
    totalEstimatedInputTokens: result.totalEstimatedInputTokens,
  };
}
