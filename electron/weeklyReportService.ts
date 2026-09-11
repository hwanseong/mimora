import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  WeeklyReportData,
  WeeklyReportRenderResult,
} from '../src/weeklyReport';

type WorkerSuccess<T> = {
  ok: true;
  data: T;
};

type WorkerFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type WorkerResult<T> = WorkerSuccess<T> | WorkerFailure;

type WeeklyReportServiceOptions = {
  getUserDataPath: () => string;
  getAppRoot?: () => string;
  runWorker?: <T>(command: string, input: unknown) => Promise<T>;
};

export type WeeklyReportRenderServiceInput = {
  data: WeeklyReportData;
  outputPath: string;
  templatePath?: string | null;
};

const pythonExecutableCandidates =
  process.platform === 'win32'
    ? [
        { executable: 'python', args: [] as string[] },
        { executable: 'py', args: ['-3'] },
      ]
    : [{ executable: 'python3', args: [] as string[] }];

function getWorkerPath(getAppRoot?: () => string): string {
  return path.resolve(getAppRoot?.() ?? process.cwd(), 'python', 'mimora_worker.py');
}

function getReportRoot(userDataPath: string): string {
  return path.join(userDataPath, 'report');
}

function getTemplatePath(reportRoot: string): string {
  return path.join(reportRoot, 'templates', 'weekly_report_template.docx');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRenderInput(input: unknown): WeeklyReportRenderServiceInput {
  if (!isRecord(input) || !isRecord(input.data)) {
    throw new Error('Weekly report data is required.');
  }

  const outputPath = String(input.outputPath ?? '').trim();
  if (!outputPath || !path.isAbsolute(outputPath)) {
    throw new Error('Weekly report output path must be absolute.');
  }

  if (path.extname(outputPath).toLocaleLowerCase() !== '.docx') {
    throw new Error('Weekly report output must be a .docx file.');
  }

  return {
    data: input.data as WeeklyReportData,
    outputPath: path.resolve(outputPath),
    templatePath:
      typeof input.templatePath === 'string' && input.templatePath.trim()
        ? path.resolve(input.templatePath)
        : null,
  };
}

export function createWeeklyReportService(options: WeeklyReportServiceOptions) {
  const reportRoot = getReportRoot(options.getUserDataPath());

  async function runWorker<T>(command: string, input: unknown): Promise<T> {
    if (options.runWorker) {
      return options.runWorker<T>(command, input);
    }

    const workerPath = getWorkerPath(options.getAppRoot);
    let lastError: unknown;

    for (const candidate of pythonExecutableCandidates) {
      try {
        return await new Promise<T>((resolve, reject) => {
          const child = spawn(
            candidate.executable,
            [...candidate.args, workerPath, command],
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
          child.on('error', reject);
          child.on('close', (code) => {
            if (code !== 0 && !stdout.trim()) {
              reject(new Error(stderr.trim() || 'Weekly report worker failed.'));
              return;
            }

            try {
              const parsed = JSON.parse(stdout.trim()) as WorkerResult<T>;
              if (parsed.ok) {
                resolve(parsed.data);
              } else {
                reject(new Error(parsed.error.message));
              }
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(JSON.stringify(input));
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Weekly report Python worker is unavailable.');
  }

  return {
    getReportRoot: async (): Promise<string> => reportRoot,

    getDefaultTemplatePath: async (): Promise<string> => getTemplatePath(reportRoot),

    renderWeeklyReport: async (
      input: unknown,
    ): Promise<WeeklyReportRenderResult> => {
      const renderInput = validateRenderInput(input);

      await mkdir(path.dirname(renderInput.outputPath), { recursive: true });

      const result = await runWorker<WeeklyReportRenderResult>(
        'weekly-report-render',
        {
          report_data: renderInput.data,
          output_path: renderInput.outputPath,
          template_path: renderInput.templatePath,
        },
      );

      return {
        ...result,
        canceled: false,
        templatePath: renderInput.templatePath,
      };
    },
  };
}
