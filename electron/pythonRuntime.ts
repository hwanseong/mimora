import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

type PythonWorkerSuccess<T> = {
  ok: true;
  data: T;
};

type PythonWorkerFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type PythonWorkerResult<T> = PythonWorkerSuccess<T> | PythonWorkerFailure;

export type PythonRuntimeSource =
  | 'env'
  | 'packaged'
  | 'dev-bundled'
  | 'dev-fallback';

export type PythonRuntimeCandidate = {
  source: PythonRuntimeSource;
  executable: string;
  args: string[];
  displayPath: string;
};

export class PythonRuntimeError extends Error {
  code: string;
  checkedCandidates: string[];
  originalCode?: string;

  constructor(input: {
    code: string;
    message: string;
    checkedCandidates?: string[];
    originalCode?: string;
  }) {
    super(input.message);
    this.name = 'PythonRuntimeError';
    this.code = input.code;
    this.checkedCandidates = input.checkedCandidates ?? [];
    this.originalCode = input.originalCode;
  }
}

type ResolvePythonRuntimeOptions = {
  appRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  exists?: (candidatePath: string) => boolean;
  checkCandidate?: (candidate: PythonRuntimeCandidate) => Promise<boolean>;
  allowSystemFallback?: boolean;
};

type RunPythonWorkerOptions = {
  command: string;
  input: unknown;
  getAppRoot?: () => string;
  serviceName: string;
};

function getProcessResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function getDefaultPythonExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'python.exe' : 'python3';
}

function pushPathCandidate(
  candidates: PythonRuntimeCandidate[],
  source: PythonRuntimeSource,
  candidatePath: string,
): void {
  candidates.push({
    source,
    executable: candidatePath,
    args: [],
    displayPath: candidatePath,
  });
}

export function getPythonRuntimeCandidates(
  options: ResolvePythonRuntimeOptions = {},
): PythonRuntimeCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const appRoot = options.appRoot ?? process.cwd();
  const pythonExecutableName = getDefaultPythonExecutableName(platform);
  const candidates: PythonRuntimeCandidate[] = [];
  const envPythonPath = env.MIMORA_PYTHON_PATH?.trim();

  if (envPythonPath) {
    pushPathCandidate(candidates, 'env', path.resolve(envPythonPath));
  }

  const resourcesPath = options.resourcesPath ?? getProcessResourcesPath();
  if (resourcesPath) {
    pushPathCandidate(
      candidates,
      'packaged',
      path.join(resourcesPath, 'python', pythonExecutableName),
    );
  }

  for (const relativePath of [
    path.join('resources', 'python', pythonExecutableName),
    path.join('runtime', 'python', pythonExecutableName),
    path.join('buildResources', 'python', pythonExecutableName),
  ]) {
    pushPathCandidate(
      candidates,
      'dev-bundled',
      path.resolve(appRoot, relativePath),
    );
  }

  if (options.allowSystemFallback !== false) {
    if (platform === 'win32') {
      candidates.push({
        source: 'dev-fallback',
        executable: 'py',
        args: ['-3'],
        displayPath: 'py -3',
      });
      candidates.push({
        source: 'dev-fallback',
        executable: 'python',
        args: [],
        displayPath: 'python',
      });
    } else {
      candidates.push({
        source: 'dev-fallback',
        executable: 'python3',
        args: [],
        displayPath: 'python3',
      });
      candidates.push({
        source: 'dev-fallback',
        executable: 'python',
        args: [],
        displayPath: 'python',
      });
    }
  }

  return candidates;
}

function checkPythonCandidate(
  candidate: PythonRuntimeCandidate,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      candidate.executable,
      [...candidate.args, '--version'],
      {
        shell: false,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      },
    );

    child.on('error', () => {
      resolve(false);
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

export async function resolvePythonRuntime(
  options: ResolvePythonRuntimeOptions = {},
): Promise<PythonRuntimeCandidate> {
  const candidateExists = options.exists ?? existsSync;
  const checkCandidate = options.checkCandidate ?? checkPythonCandidate;
  const candidates = getPythonRuntimeCandidates(options);
  const checkedCandidates = candidates.map((candidate) => candidate.displayPath);

  for (const candidate of candidates) {
    if (
      candidate.source !== 'dev-fallback' &&
      !candidateExists(candidate.executable)
    ) {
      continue;
    }

    if (await checkCandidate(candidate)) {
      return candidate;
    }
  }

  console.warn('[Mimora Python Runtime] runtime_not_found', {
    checkedCandidates,
  });

  throw new PythonRuntimeError({
    code: 'runtime_not_found',
    message:
      'Mimora Python runtime\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.',
    checkedCandidates,
  });
}

export function resolvePythonWorkerPath(input: {
  getAppRoot?: () => string;
  resourcesPath?: string;
  exists?: (candidatePath: string) => boolean;
} = {}): string {
  const candidateExists = input.exists ?? existsSync;
  const resourcesPath = input.resourcesPath ?? getProcessResourcesPath();

  if (resourcesPath) {
    const packagedWorkerPath = path.join(
      resourcesPath,
      'python',
      'mimora_worker.py',
    );

    if (candidateExists(packagedWorkerPath)) {
      return packagedWorkerPath;
    }
  }

  return path.resolve(
    input.getAppRoot?.() ?? process.cwd(),
    'python',
    'mimora_worker.py',
  );
}

export function getPythonWorkerSpawnInput(input: {
  runtime: PythonRuntimeCandidate;
  workerPath: string;
  command: string;
}): { executable: string; args: string[] } {
  return {
    executable: input.runtime.executable,
    args: [...input.runtime.args, input.workerPath, input.command],
  };
}

function normalizeWorkerErrorCode(code: string): string {
  if (code.includes('source_not_found') || code === 'file_not_found') {
    return 'file_not_found';
  }

  if (code.includes('unsupported')) {
    return 'unsupported_workbook_format';
  }

  if (
    code.includes('parse_failed') ||
    code.includes('column_mapping_failed') ||
    code === 'worker_failed'
  ) {
    return 'parse_error';
  }

  return code;
}

export async function runPythonWorker<T>(
  options: RunPythonWorkerOptions,
): Promise<T> {
  const runtime = await resolvePythonRuntime({
    appRoot: options.getAppRoot?.(),
  });
  const workerPath = resolvePythonWorkerPath({
    getAppRoot: options.getAppRoot,
  });
  const spawnInput = getPythonWorkerSpawnInput({
    runtime,
    workerPath,
    command: options.command,
  });
  const payload = JSON.stringify(options.input);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(
      spawnInput.executable,
      spawnInput.args,
      {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new PythonRuntimeError({
          code: error.code === 'ENOENT' ? 'runtime_not_found' : 'parse_error',
          message:
            error.code === 'ENOENT'
              ? 'Mimora Python runtime\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.'
              : error.message,
          checkedCandidates: [runtime.displayPath],
        }),
      );
    });
    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();

      if (!trimmedStdout) {
        reject(
          new PythonRuntimeError({
            code: code === 0 ? 'parse_error' : 'worker_compile_error',
            message:
              stderr.trim() ||
              `${options.serviceName} Python worker failed.`,
            checkedCandidates: [runtime.displayPath],
          }),
        );
        return;
      }

      try {
        const parsed = JSON.parse(trimmedStdout) as PythonWorkerResult<T>;

        if (parsed.ok) {
          resolve(parsed.data);
          return;
        }

        reject(
          new PythonRuntimeError({
            code: normalizeWorkerErrorCode(parsed.error.code),
            originalCode: parsed.error.code,
            message: parsed.error.message,
            checkedCandidates: [runtime.displayPath],
          }),
        );
      } catch (error) {
        reject(
          new PythonRuntimeError({
            code: 'parse_error',
            message:
              error instanceof Error
                ? error.message
                : 'Python worker returned invalid JSON.',
            checkedCandidates: [runtime.displayPath],
          }),
        );
      }
    });
    child.stdin.end(Buffer.from(payload, 'utf8'));
  });
}
