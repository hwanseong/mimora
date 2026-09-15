import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  WeeklyReportData,
  WeeklyReportRenderResult,
} from '../src/weeklyReport';
import { runPythonWorker } from './pythonRuntime';

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

    return runPythonWorker<T>({
      command,
      input,
      getAppRoot: options.getAppRoot,
      serviceName: 'Weekly report',
    });
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
