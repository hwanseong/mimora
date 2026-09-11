import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExternalCredentialStore } from '../electron/externalCredentialStore';
import { GeminiProvider } from '../electron/llm/GeminiProvider';
import type { SafeStorageAdapter } from '../electron/openAICredentialStore';
import { createSettingsStore } from '../electron/settingsStore';

const safeStorage: SafeStorageAdapter = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plainText) => Buffer.from(`safe:${plainText}`),
  decryptStringAsync: async (encrypted) => ({
    result: encrypted.toString('utf8').replace(/^safe:/u, ''),
    shouldReEncrypt: false,
  }),
};

async function withTempDir<T>(
  name: string,
  callback: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${name}-`));

  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempDir('mimora-external-provider', async (dir) => {
  const store = createExternalCredentialStore({
    getCredentialPath: (providerId) =>
      path.join(dir, 'credentials', `${providerId}.safe`),
    safeStorage,
  });

  assert.equal(await store.hasApiKey('openai'), false);
  assert.equal(await store.hasApiKey('gemini'), false);

  await store.saveApiKey('openai', 'sk-openai');
  await store.saveApiKey('gemini', 'gemini-key');

  assert.equal(await store.hasApiKey('openai'), true);
  assert.equal(await store.hasApiKey('gemini'), true);
  assert.equal(await store.readApiKeyForMainProcess('openai'), 'sk-openai');
  assert.equal(await store.readApiKeyForMainProcess('gemini'), 'gemini-key');
  assert.equal(
    await readFile(path.join(dir, 'credentials', 'openai.safe'), 'utf8'),
    'safe:sk-openai',
  );
  assert.equal(
    await readFile(path.join(dir, 'credentials', 'gemini.safe'), 'utf8'),
    'safe:gemini-key',
  );

  const restartedStore = createExternalCredentialStore({
    getCredentialPath: (providerId) =>
      path.join(dir, 'credentials', `${providerId}.safe`),
    safeStorage,
  });

  assert.equal(
    await restartedStore.readApiKeyForMainProcess('gemini'),
    'gemini-key',
  );
});

await withTempDir('mimora-external-provider-legacy', async (dir) => {
  const legacyStore = createExternalCredentialStore({
    getCredentialPath: (providerId) =>
      path.join(dir, 'credentials', `${providerId}.safe`),
    getLegacyOpenAICredentialPath: () =>
      path.join(dir, 'openai-api-key.safe'),
    safeStorage,
  });

  await legacyStore.saveApiKey('openai', 'legacy-compatible-openai');

  const migratedReader = createExternalCredentialStore({
    getCredentialPath: (providerId) =>
      path.join(dir, 'missing-new-root', `${providerId}.safe`),
    getLegacyOpenAICredentialPath: () =>
      path.join(dir, 'credentials', 'openai.safe'),
    safeStorage,
  });

  assert.equal(
    await migratedReader.readApiKeyForMainProcess('openai'),
    'legacy-compatible-openai',
  );
});

await withTempDir('mimora-external-provider-settings', async (dir) => {
  const settingsPath = path.join(dir, 'settings.json');
  const store = createSettingsStore({
    getSettingsPath: () => settingsPath,
  });
  const settings = await store.updateExternalAISettings({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
  });

  assert.equal(settings.externalAI.provider, 'gemini');
  assert.equal(settings.externalAI.model, 'gemini-2.5-flash');

  const restartedStore = createSettingsStore({
    getSettingsPath: () => settingsPath,
  });
  const restartedSettings = await restartedStore.getSettings();

  assert.equal(restartedSettings.externalAI.provider, 'gemini');
  assert.equal(restartedSettings.externalAI.model, 'gemini-2.5-flash');
});

{
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlText = String(url);
    calls.push({ url: urlText, init });
    assert.equal(
      (init?.headers as Record<string, string>)['x-goog-api-key'],
      'gemini-key',
    );

    if (urlText.includes('/models?')) {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-embedding-001',
              displayName: 'Gemini Embedding',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        modelVersion: 'gemini-2.5-flash',
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini response' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
      { status: 200 },
    );
  };
  const provider = new GeminiProvider('gemini-key', fakeFetch);
  const models = await provider.listModels();

  assert.deepEqual(models, [
    { name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash' },
  ]);

  const chat = await provider.chat({
    model: 'gemini-2.5-flash',
    input: 'hello',
  });

  assert.equal(chat.content, 'Gemini response');
  assert.equal(chat.model, 'gemini-2.5-flash');
  assert.equal(chat.usage?.totalTokens, 15);
  assert.equal(
    calls.some((call) => call.url.includes(':generateContent')),
    true,
  );
}

{
  const preloadSource = await readFile(
    path.resolve('electron', 'preload.ts'),
    'utf8',
  );

  assert.equal(preloadSource.includes('readExternalCredential'), false);
  assert.equal(preloadSource.includes('readApiKeyForMainProcess'), false);
  assert.equal(preloadSource.includes('hasExternalCredential'), true);
  assert.equal(preloadSource.includes('saveExternalCredential'), true);
  assert.equal(preloadSource.includes('deleteExternalCredential'), true);
}

{
  const externalAISettingsSource = await readFile(
    path.resolve('src', 'components', 'ExternalAISettingsSection.tsx'),
    'utf8',
  );
  const externalProviderSources = [
    externalAISettingsSource,
    await readFile(path.resolve('electron', 'llm', 'OpenAIProvider.ts'), 'utf8'),
    await readFile(path.resolve('electron', 'llm', 'GeminiProvider.ts'), 'utf8'),
  ].join('\n');
  const chatInputSource = await readFile(
    path.resolve('src', 'components', 'ChatInput.tsx'),
    'utf8',
  );
  const appSource = await readFile(path.resolve('src', 'App.tsx'), 'utf8');
  const previewModalSource = await readFile(
    path.resolve('src', 'components', 'ExternalPayloadPreviewModal.tsx'),
    'utf8',
  );

  assert.equal(externalAISettingsSource.includes('??Connected'), false);
  assert.equal(externalAISettingsSource.includes('??Not connected'), false);
  assert.equal(externalAISettingsSource.includes('External AI ?'), false);
  assert.equal(chatInputSource.includes('OpenAI가 분석 중입니다'), false);
  assert.equal(appSource.includes("content: 'OpenAI"), false);
  assert.equal(previewModalSource.includes('승인 후 OpenAI 전송'), false);
  assert.equal(externalProviderSources.includes('�'), false);
  assert.equal(/ì|ë|ê/u.test(externalProviderSources), false);
  assert.equal(
    /紐|媛|몃|꾩|ㅼ|곌|쒓|좏|삵|뒿/u.test(externalProviderSources),
    false,
  );
  assert.equal(externalAISettingsSource.includes('연결됨'), true);
  assert.equal(externalAISettingsSource.includes('미연결'), true);
  assert.equal(externalAISettingsSource.includes('API Key 저장됨'), true);
  assert.equal(chatInputSource.includes('activeProviderLabel'), true);
  assert.equal(
    chatInputSource.includes('${activeProviderLabel}가 분석 중입니다...'),
    true,
  );
  assert.equal(appSource.includes('getAIProviderDisplayName('), true);
}

console.log('external-provider-tests passed');
