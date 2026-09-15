import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build, createServer } from 'vite';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronConfig = resolve(rootDir, 'vite.electron.config.ts');
const rendererConfig = resolve(rootDir, 'vite.config.ts');

process.env.NODE_ENV = 'development';

await build({
  configFile: electronConfig,
  mode: 'development',
});

const viteServer = await createServer({
  configFile: rendererConfig,
  mode: 'development',
});

await viteServer.listen();
viteServer.printUrls();

const devServerUrl =
  viteServer.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';

const electronEnv = {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
};

delete electronEnv.ELECTRON_RUN_AS_NODE;

const electronArgs = ['.'];

if (process.env.MIMORA_ELECTRON_DEV_NO_SANDBOX !== '0') {
  electronArgs.push('--no-sandbox');
}

if (process.env.MIMORA_ELECTRON_DEV_IN_PROCESS_GPU === '1') {
  electronArgs.push('--in-process-gpu');
}

const electronProcess = spawn(
  electronPath,
  electronArgs,
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: electronEnv,
  },
);

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  electronProcess.kill();
  await viteServer.close();
  process.exit(exitCode);
}

electronProcess.on('exit', (code) => {
  void shutdown(code ?? 0);
});

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});
