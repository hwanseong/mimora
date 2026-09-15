import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serviceFiles = [
  'electron/scheduleService.ts',
  'electron/issueService.ts',
  'electron/ragService.ts',
  'electron/weeklyReportService.ts',
];

for (const file of serviceFiles) {
  const source = await readFile(file, 'utf8');

  assert.match(source, /runPythonWorker/u, `${file} must use common Python resolver`);
  assert.doesNotMatch(
    source,
    /pythonExecutableCandidates/u,
    `${file} must not define service-local Python candidates`,
  );
  assert.doesNotMatch(
    source,
    /executable:\s*'py'|executable:\s*'python'|executable:\s*'python3'/u,
    `${file} must not hardcode Python executables`,
  );
}

const runtimeSource = await readFile('electron/pythonRuntime.ts', 'utf8');
assert.match(runtimeSource, /MIMORA_PYTHON_PATH/u);
assert.match(runtimeSource, /resourcesPath/u);
assert.match(runtimeSource, /runtime_not_found/u);
assert.match(runtimeSource, /shell:\s*false/u);

console.log('python-runtime-service-tests passed');
