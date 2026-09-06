const { spawn } = require('node:child_process');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const TEMP_DIRECTORY_PREFIX = 'mimora-external-ui-';
const CHILD_ENVIRONMENT_FLAG = 'MIMORA_EXTERNAL_UI_CHILD';
const USER_DATA_ENVIRONMENT_KEY = 'MIMORA_EXTERNAL_UI_USER_DATA';
const REVIEW_VAULT_ENVIRONMENT_KEY = 'MIMORA_EXTERNAL_UI_REVIEW_VAULT';
const CHILD_TIMEOUT_MS = 150_000;
const CLEANUP_RETRY_DELAYS_MS = [100, 250, 500, 1_000];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isOwnedTemporaryDirectory(directoryPath) {
  const resolvedDirectory = path.resolve(directoryPath);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const relativePath = path.relative(resolvedTempRoot, resolvedDirectory);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath) &&
    path.basename(resolvedDirectory).startsWith(TEMP_DIRECTORY_PREFIX)
  );
}

async function removeTemporaryDirectory(directoryPath) {
  if (!isOwnedTemporaryDirectory(directoryPath)) {
    console.warn(
      `[external-ui-check] Refusing to remove an unexpected path: ${directoryPath}`,
    );
    return false;
  }

  for (let attempt = 0; attempt <= CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rm(directoryPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (attempt === CLEANUP_RETRY_DELAYS_MS.length) {
        const errorCode =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : 'UNKNOWN';
        console.warn(
          `[external-ui-check] Temporary directory cleanup failed (${errorCode}): ${directoryPath}`,
        );
        return false;
      }

      await delay(CLEANUP_RETRY_DELAYS_MS[attempt]);
    }
  }

  return false;
}

function waitForChildClose(childProcess) {
  return new Promise((resolve, reject) => {
    let exitCode = null;
    let exitSignal = null;
    let sawExit = false;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      console.warn(
        '[external-ui-check] Electron did not exit in time; terminating the test process.',
      );
      childProcess.kill();
    }, CHILD_TIMEOUT_MS);

    childProcess.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    childProcess.once('exit', (code, signal) => {
      sawExit = true;
      exitCode = code;
      exitSignal = signal;
    });

    childProcess.once('close', (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        code: exitCode ?? code,
        signal: exitSignal ?? signal,
        sawExit,
      });
    });
  });
}

async function runTestRunner() {
  const temporaryUserData = await mkdtemp(
    path.join(os.tmpdir(), TEMP_DIRECTORY_PREFIX),
  );
  const reviewVaultPath = path.join(temporaryUserData, 'review-vault');
  let testPassed = false;

  try {
    await mkdir(reviewVaultPath);
    await writeFile(
      path.join(reviewVaultPath, '검토대상-고객계획.md'),
      '# 검토대상 고객계획\n\n검토대상 고객계획의 범위와 담당 업무를 정리한다.',
      'utf8',
    );
    await writeFile(
      path.join(reviewVaultPath, '보안자격증명-점검문서.md'),
      '# 보안자격증명 점검문서\n\n---\nclient: 셀트리온\ntags:\n- 셀트리온\n- 이상익\n---\n**기본 로그인 패스워드**: `TestOnlyCredential123!`\n운영 토큰: INTERNAL-ABCD1234\n내부 서버: 10.20.30.40:12400\n이 값들은 Secret Detection 통합 테스트 전용이다.',
      'utf8',
    );
    const electronExecutable = require('electron');
    const childEnvironment = {
      ...process.env,
      [CHILD_ENVIRONMENT_FLAG]: '1',
      [USER_DATA_ENVIRONMENT_KEY]: temporaryUserData,
      [REVIEW_VAULT_ENVIRONMENT_KEY]: reviewVaultPath,
    };

    delete childEnvironment.ELECTRON_RUN_AS_NODE;

    const electronProcess = spawn(
      electronExecutable,
      ['--disable-gpu', '--disable-gpu-compositing', __filename],
      {
        cwd: path.resolve(__dirname, '..'),
        env: childEnvironment,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    const result = await waitForChildClose(electronProcess);

    if (!result.sawExit) {
      throw new Error('Electron close event arrived without an exit event.');
    }

    if (result.code !== 0) {
      throw new Error(
        `Electron UI check failed (code=${String(result.code)}, signal=${String(result.signal)}).`,
      );
    }

    console.info(
      '[external-ui-check] Electron exit and close events confirmed.',
    );
    testPassed = true;
  } catch (error) {
    console.error(
      '[external-ui-check] Test failed:',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    const cleanupSucceeded = await removeTemporaryDirectory(temporaryUserData);

    if (!cleanupSucceeded) {
      testPassed = false;
    } else {
      console.info('[external-ui-check] Temporary userData cleanup passed.');
    }
  }

  process.exitCode = testPassed ? 0 : 1;
}

function runElectronFixture() {
  const { app } = require('electron');
  const temporaryUserData = process.env[USER_DATA_ENVIRONMENT_KEY];
  const reviewVaultPath = process.env[REVIEW_VAULT_ENVIRONMENT_KEY];

  if (
    process.env[CHILD_ENVIRONMENT_FLAG] !== '1' ||
    !temporaryUserData ||
    !isOwnedTemporaryDirectory(temporaryUserData) ||
    !reviewVaultPath ||
    path.relative(temporaryUserData, reviewVaultPath).startsWith('..')
  ) {
    console.error('[external-ui-check] Invalid isolated userData directory.');
    app.exit(1);
    return;
  }

  app.setPath('userData', temporaryUserData);
  app.disableHardwareAcceleration();

  if (
    path.resolve(app.getPath('userData')) !== path.resolve(temporaryUserData)
  ) {
    console.error('[external-ui-check] Electron userData isolation failed.');
    app.exit(1);
    return;
  }

  let finished = false;
  const fixtureTimeout = setTimeout(() => {
    finish(1, 'External UI check timed out.');
  }, 140_000);

  function finish(exitCode, errorMessage) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(fixtureTimeout);

    if (errorMessage) {
      console.error(`[external-ui-check] ${errorMessage}`);
    }

    const { BrowserWindow } = require('electron');
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy();
    }

    if (exitCode === 0) {
      app.quit();
    } else {
      app.exit(exitCode);
    }
  }

  app.on('browser-window-created', (_event, browserWindow) => {
    browserWindow.hide();
    browserWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await browserWindow.webContents.executeJavaScript(`
          (async () => {
            const delay = (milliseconds) =>
              new Promise((resolve) => setTimeout(resolve, milliseconds));
            const waitFor = async (predicate, timeoutMs = 10_000) => {
              const deadline = Date.now() + timeoutMs;

              while (Date.now() < deadline) {
                const value = predicate();
                if (value) return value;
                await delay(50);
              }

              throw new Error('Timed out waiting for the External UI state.');
            };

            const recentChatsButton = await waitFor(() =>
              Array.from(document.querySelectorAll('button')).find(
                (button) => button.textContent.trim() === '최근 대화',
              ),
            );
            recentChatsButton.click();
            const recentChatsEmpty = Boolean(
              await waitFor(() =>
                document.body.textContent.includes('아직 대화 기록이 없습니다.'),
              ),
            );
            const allWorkspaceButton = await waitFor(() =>
              Array.from(document.querySelectorAll('button')).find(
                (button) => button.textContent.trim() === '전체 업무',
              ),
            );
            allWorkspaceButton.click();

            const modeSelect = await waitFor(() =>
              document.querySelector('select[aria-label="AI Mode"]'),
            );
            const hasExternalOption = Array.from(modeSelect.options).some(
              (option) => option.value === 'external' && option.textContent === 'External',
            );

            if (!hasExternalOption) {
              throw new Error('External AI Mode option was not rendered.');
            }

            await window.mimora.updateExternalAISettings({
              provider: 'openai',
              model: 'gpt-4.1-mini',
            });
            await window.mimora.updateLocalAISettings({
              provider: 'ollama',
              endpoint: 'http://127.0.0.1:11434',
              model: 'qwen3:4b-instruct',
            });
            await window.mimora.addSecretRule({
              name: 'UI Custom Secret Rule',
              kind: 'regex',
              pattern: 'INTERNAL-[A-Z0-9]{8}',
              enabled: true,
            });
            await window.mimora.addMaskingEntry({
              type: 'client',
              value: '셀트리온',
            });
            await window.mimora.addMaskingEntry({
              type: 'person',
              value: '이상익',
            });
            await window.mimora.addVault({
              name: 'Review Test Vault',
              type: 'work',
              security: 'personal',
              path: ${JSON.stringify(reviewVaultPath)},
            });

            modeSelect.value = 'external';
            modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await waitFor(() => modeSelect.value === 'external');

            const messageInput = await waitFor(() =>
              document.querySelector('textarea[aria-label="메시지"]'),
            );
            const valueSetter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype,
              'value',
            ).set;
            valueSetter.call(messageInput, '검토대상 고객계획');
            messageInput.dispatchEvent(new Event('input', { bubbles: true }));
            messageInput.form.requestSubmit();

            await waitFor(() =>
              document.body.textContent.includes('외부 AI 전송 전 검토가 필요합니다.'),
            );
            const composerIsReviewPending =
              !messageInput.disabled &&
              messageInput.placeholder === '외부 전송 검토가 필요합니다.' &&
              messageInput.form.querySelector('button[type="submit"]').textContent === '전송';

            if (!composerIsReviewPending) {
              throw new Error('Review state was incorrectly shown as LLM loading.');
            }

            const previewButton = await waitFor(() =>
              Array.from(document.querySelectorAll('button')).find(
                (button) => button.textContent.trim() === 'External Preview 확인',
              ),
            );
            previewButton.click();

            const previewDialog = await waitFor(() =>
              document.querySelector('[role="dialog"]'),
            );
            const previewText = previewDialog.textContent;
            const reviewActionsVisible =
              previewText.includes('Masked Question') &&
              previewText.includes('Masked Context') &&
              previewText.includes('External Payload Safety') &&
              previewText.includes('Local AI로 처리') &&
              previewText.includes('승인 후 OpenAI 전송');

            if (!reviewActionsVisible) {
              throw new Error('Review Preview actions were not rendered.');
            }

            previewDialog
              .querySelector('button[aria-label="External Payload Preview 닫기"]')
              .click();
            await waitFor(() => !document.querySelector('[role="dialog"]'));
            const reviewPersistedAfterClose =
              document.body.textContent.includes('외부 AI 전송 전 검토가 필요합니다.') &&
              Array.from(document.querySelectorAll('button')).some(
                (button) => button.textContent.trim() === 'External Preview 확인',
              );

            const localFallbackButton = Array.from(
              document.querySelectorAll('button'),
            ).find(
              (button) => button.textContent.trim() === 'Local AI로 처리',
            );

            if (!localFallbackButton) {
              throw new Error('Local fallback action was not available.');
            }

            localFallbackButton.click();
            const completedLocalFooter = await waitFor(() =>
              Array.from(document.querySelectorAll('.message-routing')).find(
                (footer) =>
                  footer.textContent.includes(
                    'Local AI · External · Local fallback',
                  ) &&
                  footer.textContent.includes(
                    'User selected Local fallback',
                  ) &&
                  footer.textContent.includes('Model: qwen3:4b-instruct'),
              ),
              120_000,
            );
            const localFallbackCompleted = Boolean(completedLocalFooter);

            const recentChatsAfterMessageButton = Array.from(
              document.querySelectorAll('button'),
            ).find((button) => button.textContent.trim() === '최근 대화');

            if (!recentChatsAfterMessageButton) {
              throw new Error('Recent Chats navigation was not available.');
            }

            recentChatsAfterMessageButton.click();
            const recentChatItem = await waitFor(() =>
              document.querySelector('.recent-chat-item'),
            );
            const recentChatSummaryVisible =
              recentChatItem.textContent.includes('전체 업무') &&
              recentChatItem.textContent.includes('검토대상 고객계획') &&
              recentChatItem.textContent.includes('2 messages') &&
              recentChatItem.textContent.includes('방금 전');

            if (!recentChatSummaryVisible) {
              throw new Error('Recent Chats summary was not rendered.');
            }

            recentChatItem.click();
            const resumedMessageInput = await waitFor(() =>
              document.querySelector('textarea[aria-label="메시지"]'),
            );
            const workspaceChatRestored =
              document.body.textContent.includes('검토대상 고객계획') &&
              document.body.textContent.includes(
                'Local AI · External · Local fallback',
              );

            valueSetter.call(resumedMessageInput, '보안자격증명 점검문서 설명해줘');
            resumedMessageInput.dispatchEvent(new Event('input', { bubbles: true }));
            resumedMessageInput.form.requestSubmit();

            await waitFor(() =>
              document.body.textContent.includes(
                'Secret / Credential 정보가 감지되었습니다.',
              ),
            );
            const secretPreviewButton = Array.from(
              document.querySelectorAll('button'),
            ).filter(
              (button) => button.textContent.trim() === 'External Preview 확인',
            ).at(-1);

            if (!secretPreviewButton) {
              throw new Error('Secret BLOCK Preview action was not available.');
            }

            secretPreviewButton.click();
            const secretPreviewDialog = await waitFor(() =>
              document.querySelector('[role="dialog"]'),
            );
            const secretPreviewText = secretPreviewDialog.textContent;
            const secretPreviewContent = Array.from(
              secretPreviewDialog.querySelectorAll('pre'),
            ).map((element) => element.textContent).join('\\n');
            const secretWasRedacted =
              secretPreviewContent.includes('[REDACTED_SECRET]') &&
              !secretPreviewContent.includes('TestOnlyCredential123!') &&
              !secretPreviewContent.includes('INTERNAL-ABCD1234') &&
              !secretPreviewContent.includes('10.20.30.40') &&
              !secretPreviewContent.includes('12400') &&
              !secretPreviewContent.includes('셀트리온') &&
              !secretPreviewContent.includes('이상익') &&
              secretPreviewContent.includes('[INTERNAL_IP_001]') &&
              secretPreviewContent.includes('client: [CLIENT_001]') &&
              secretPreviewContent.includes('- [PERSON_001]') &&
              secretPreviewText.includes('Password / 비밀번호 / 패스워드') &&
              secretPreviewText.includes('Custom Rule: UI Custom Secret Rule');
            const blockHasNoApproval = !Array.from(
              secretPreviewDialog.querySelectorAll('button'),
            ).some(
              (button) => button.textContent.includes('승인 후 OpenAI 전송'),
            );

            if (!secretWasRedacted || !blockHasNoApproval) {
              throw new Error('Secret BLOCK Preview policy did not pass.');
            }

            secretPreviewDialog
              .querySelector('button[aria-label="External Payload Preview 닫기"]')
              .click();
            await waitFor(() => !document.querySelector('[role="dialog"]'));
            const secretLocalFallbackButton = Array.from(
              document.querySelectorAll('button'),
            ).filter(
              (button) => button.textContent.trim() === 'Local AI로 처리',
            ).at(-1);

            if (!secretLocalFallbackButton) {
              throw new Error('Secret BLOCK Local fallback was not available.');
            }

            secretLocalFallbackButton.click();
            await waitFor(
              () =>
                Array.from(document.querySelectorAll('.message-routing')).filter(
                  (footer) =>
                    footer.textContent.includes(
                      'Local AI · External · Local fallback',
                    ) &&
                    footer.textContent.includes('Model: qwen3:4b-instruct'),
                ).length >= 2,
              120_000,
            );
            const secretLocalFallbackCompleted = true;

            return {
              hasExternalOption,
              recentChatsEmpty,
              recentChatSummaryVisible,
              workspaceChatRestored,
              composerIsReviewPending,
              reviewActionsVisible,
              reviewPersistedAfterClose,
              localFallbackCompleted,
              secretWasRedacted,
              blockHasNoApproval,
              secretLocalFallbackCompleted,
            };
          })()
        `);

        if (
          !result.hasExternalOption ||
          !result.recentChatsEmpty ||
          !result.recentChatSummaryVisible ||
          !result.workspaceChatRestored ||
          !result.composerIsReviewPending ||
          !result.reviewActionsVisible ||
          !result.reviewPersistedAfterClose ||
          !result.localFallbackCompleted ||
          !result.secretWasRedacted ||
          !result.blockHasNoApproval ||
          !result.secretLocalFallbackCompleted
        ) {
          throw new Error('External UI assertions did not pass.');
        }

        console.info('[external-ui-check] External UI assertions passed.');
        finish(0);
      } catch (error) {
        finish(1, error instanceof Error ? error.message : String(error));
      }
    });
  });

  try {
    require(path.resolve(__dirname, '..', 'dist-electron', 'main.cjs'));
  } catch (error) {
    finish(1, error instanceof Error ? error.message : String(error));
  }
}

if (process.versions.electron) {
  runElectronFixture();
} else {
  void runTestRunner().catch((error) => {
    console.error(
      '[external-ui-check] Unexpected runner failure:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
