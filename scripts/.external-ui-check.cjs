const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const TEMP_DIRECTORY_PREFIX = 'mimora-external-ui-';
const CHILD_ENVIRONMENT_FLAG = 'MIMORA_EXTERNAL_UI_CHILD';
const USER_DATA_ENVIRONMENT_KEY = 'MIMORA_EXTERNAL_UI_USER_DATA';
const CHILD_TIMEOUT_MS = 30_000;
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
  let testPassed = false;

  try {
    const electronExecutable = require('electron');
    const childEnvironment = {
      ...process.env,
      [CHILD_ENVIRONMENT_FLAG]: '1',
      [USER_DATA_ENVIRONMENT_KEY]: temporaryUserData,
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

  if (
    process.env[CHILD_ENVIRONMENT_FLAG] !== '1' ||
    !temporaryUserData ||
    !isOwnedTemporaryDirectory(temporaryUserData)
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
  }, 20_000);

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
            valueSetter.call(messageInput, 'External UI test');
            messageInput.dispatchEvent(new Event('input', { bubbles: true }));
            messageInput.form.requestSubmit();

            await waitFor(() =>
              document.body.textContent.includes('API Key가 설정되지 않았습니다.'),
            );

            return {
              hasExternalOption,
              missingApiKeyHandled: true,
            };
          })()
        `);

        if (
          !result.hasExternalOption ||
          !result.missingApiKeyHandled
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
