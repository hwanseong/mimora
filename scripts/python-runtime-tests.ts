import assert from 'node:assert/strict';
import path from 'node:path';
import {
  getPythonRuntimeCandidates,
  getPythonWorkerSpawnInput,
  PythonRuntimeError,
  resolvePythonRuntime,
  resolvePythonWorkerPath,
  type PythonRuntimeCandidate,
} from '../electron/pythonRuntime';

const appRoot = 'D:\\mimora';
const resourcesPath = 'C:\\Program Files\\Mimora\\resources';

function normalizePath(value: string): string {
  return path.normalize(value);
}

function createCheckCandidate(available: Set<string>) {
  return async (candidate: PythonRuntimeCandidate): Promise<boolean> =>
    available.has(candidate.displayPath) ||
    available.has(candidate.executable);
}

const candidates = getPythonRuntimeCandidates({
  appRoot,
  env: {
    MIMORA_PYTHON_PATH: 'D:\\Python Env\\python.exe',
  },
  platform: 'win32',
  resourcesPath,
});

assert.equal(candidates[0]?.source, 'env');
assert.equal(normalizePath(candidates[0]?.executable ?? ''), normalizePath('D:\\Python Env\\python.exe'));
assert.equal(candidates[1]?.source, 'packaged');
assert.equal(
  normalizePath(candidates[1]?.executable ?? ''),
  normalizePath('C:\\Program Files\\Mimora\\resources\\python\\python.exe'),
);
assert.equal(candidates.at(-2)?.displayPath, 'py -3');
assert.deepEqual(candidates.at(-2)?.args, ['-3']);
assert.equal(candidates.at(-1)?.displayPath, 'python');
assert.deepEqual(candidates.at(-1)?.args, []);

const envRuntime = await resolvePythonRuntime({
  appRoot,
  env: { MIMORA_PYTHON_PATH: 'D:\\Python Env\\python.exe' },
  platform: 'win32',
  resourcesPath,
  exists: (candidatePath) => candidatePath === path.resolve('D:\\Python Env\\python.exe'),
  checkCandidate: createCheckCandidate(new Set([path.resolve('D:\\Python Env\\python.exe')])),
});
assert.equal(envRuntime.source, 'env');

const packagedRuntime = await resolvePythonRuntime({
  appRoot,
  env: {},
  platform: 'win32',
  resourcesPath,
  exists: (candidatePath) =>
    normalizePath(candidatePath) ===
    normalizePath('C:\\Program Files\\Mimora\\resources\\python\\python.exe'),
  checkCandidate: createCheckCandidate(
    new Set(['C:\\Program Files\\Mimora\\resources\\python\\python.exe']),
  ),
});
assert.equal(packagedRuntime.source, 'packaged');

const devBundledRuntime = await resolvePythonRuntime({
  appRoot,
  env: {},
  platform: 'win32',
  resourcesPath: undefined,
  exists: (candidatePath) =>
    normalizePath(candidatePath) === normalizePath('D:\\mimora\\resources\\python\\python.exe'),
  checkCandidate: createCheckCandidate(new Set(['D:\\mimora\\resources\\python\\python.exe'])),
});
assert.equal(devBundledRuntime.source, 'dev-bundled');

const fallbackRuntime = await resolvePythonRuntime({
  appRoot,
  env: {},
  platform: 'win32',
  resourcesPath: undefined,
  exists: () => false,
  checkCandidate: createCheckCandidate(new Set(['py -3'])),
});
assert.equal(fallbackRuntime.source, 'dev-fallback');
assert.equal(fallbackRuntime.executable, 'py');
assert.deepEqual(fallbackRuntime.args, ['-3']);

await assert.rejects(
  () =>
    resolvePythonRuntime({
      appRoot,
      env: {},
      platform: 'win32',
      resourcesPath: undefined,
      exists: () => false,
      checkCandidate: async () => false,
    }),
  (error) => {
    assert.ok(error instanceof PythonRuntimeError);
    assert.equal(error.code, 'runtime_not_found');
    assert.match(error.message, /Mimora Python runtime/u);
    assert.ok(error.checkedCandidates.includes('py -3'));
    assert.ok(error.checkedCandidates.includes('python'));
    return true;
  },
);

assert.equal(
  normalizePath(
    resolvePythonWorkerPath({
      getAppRoot: () => appRoot,
      resourcesPath,
      exists: (candidatePath) =>
        normalizePath(candidatePath) ===
        normalizePath('C:\\Program Files\\Mimora\\resources\\python\\mimora_worker.py'),
    }),
  ),
  normalizePath('C:\\Program Files\\Mimora\\resources\\python\\mimora_worker.py'),
);

const spawnInput = getPythonWorkerSpawnInput({
  runtime: {
    source: 'dev-fallback',
    executable: 'py',
    args: ['-3'],
    displayPath: 'py -3',
  },
  workerPath: 'D:\\mimora path\\python\\mimora_worker.py',
  command: 'issue-parse',
});
assert.equal(spawnInput.executable, 'py');
assert.deepEqual(spawnInput.args, [
  '-3',
  'D:\\mimora path\\python\\mimora_worker.py',
  'issue-parse',
]);

console.log('python-runtime-tests passed');
