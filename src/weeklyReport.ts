import type { AutoRetrievedContext } from './autoContext';
import type { CanonicalScheduleTask, ScheduleSummary } from './schedule';

export type WeeklyReportTask = {
  wbs: string;
  name: string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  actual_progress: number | null;
  status?: string;
};

export type WeeklyReportSource = {
  source_type: 'vault' | 'rag' | 'schedule' | 'issue';
  document_id?: string;
  rag_document_id?: string;
  filename: string;
  path: string;
  excerpt?: string;
  security?: string;
};

export type WeeklyReportData = {
  workspace_id: string;
  workspace_name: string;
  generated_at: string;
  report_period: {
    start: string;
    end: string;
  };
  next_week_period: {
    start: string;
    end: string;
  };
  schedule: {
    source_filename: string;
    as_of_date: string;
    planned_progress: number | null;
    actual_progress: number | null;
    delayed_task_count: number;
    delayed_tasks: WeeklyReportTask[];
    forecast: Record<string, unknown> | null;
    performance: Record<string, unknown> | null;
  };
  this_week: {
    completed: WeeklyReportTask[];
    in_progress: WeeklyReportTask[];
    key_activities: string[];
  };
  next_week: {
    planned_tasks: WeeklyReportTask[];
  };
  issues: WeeklyReportSource[];
  risks: WeeklyReportSource[];
  decisions: WeeklyReportSource[];
  source_document_ids: string[];
  source_rag_ids: string[];
  schedule_source: WeeklyReportSource;
  security: {
    contains_sensitive_context: boolean;
    note: string | null;
  };
  summary: string;
};

export type WeeklyReportRenderInput = {
  data: WeeklyReportData;
  defaultFileName: string;
  templatePath?: string | null;
};

export type WeeklyReportRenderResult = {
  canceled: boolean;
  outputPath?: string;
  templatePath?: string | null;
};

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function shiftDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

export function getWeeklyReportPeriods(asOfDate: string): {
  reportPeriod: WeeklyReportData['report_period'];
  nextWeekPeriod: WeeklyReportData['next_week_period'];
} {
  const parsedAsOfDate = parseDate(asOfDate) ?? new Date();
  const dayOfWeek = parsedAsOfDate.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const weekStart = shiftDays(parsedAsOfDate, -daysFromMonday);
  const weekEnd = shiftDays(weekStart, 6);
  const nextWeekStart = shiftDays(weekStart, 7);
  const nextWeekEnd = shiftDays(nextWeekStart, 6);

  return {
    reportPeriod: {
      start: toDateOnly(weekStart),
      end: toDateOnly(weekEnd),
    },
    nextWeekPeriod: {
      start: toDateOnly(nextWeekStart),
      end: toDateOnly(nextWeekEnd),
    },
  };
}

function isWithinPeriod(
  value: string | null | undefined,
  period: { start: string; end: string },
): boolean {
  return Boolean(value && value >= period.start && value <= period.end);
}

export function toWeeklyReportTask(task: CanonicalScheduleTask): WeeklyReportTask {
  const isCompleted = Boolean(task.actualFinish) || (task.actualProgress ?? 0) >= 1;
  const isActive = Boolean(task.actualStart) && !isCompleted;

  return {
    wbs: task.wbs,
    name: task.name,
    planned_start: task.plannedStart,
    planned_finish: task.plannedFinish,
    actual_start: task.actualStart,
    actual_finish: task.actualFinish,
    actual_progress: task.actualProgress,
    status: isCompleted ? 'completed' : isActive ? 'active' : 'not_started',
  };
}

function isDelayedLeafTask(task: CanonicalScheduleTask, asOfDate: string): boolean {
  const isCompleted = Boolean(task.actualFinish) || (task.actualProgress ?? 0) >= 1;

  return Boolean(
    task.isLeaf &&
      task.plannedFinish &&
      task.plannedFinish < asOfDate &&
      !isCompleted,
  );
}

export function selectWeeklyScheduleTasks(input: {
  tasks: CanonicalScheduleTask[];
  reportPeriod: WeeklyReportData['report_period'];
  nextWeekPeriod: WeeklyReportData['next_week_period'];
  asOfDate: string;
  delayedLimit?: number;
}): {
  completed: WeeklyReportTask[];
  inProgress: WeeklyReportTask[];
  delayed: WeeklyReportTask[];
  nextWeekPlanned: WeeklyReportTask[];
} {
  const leafTasks = input.tasks.filter((task) => task.isLeaf);
  const delayedLimit = input.delayedLimit ?? 12;

  return {
    completed: leafTasks
      .filter((task) => isWithinPeriod(task.actualFinish, input.reportPeriod))
      .map(toWeeklyReportTask),
    inProgress: leafTasks
      .filter((task) => task.actualStart && !task.actualFinish)
      .map(toWeeklyReportTask),
    delayed: leafTasks
      .filter((task) => isDelayedLeafTask(task, input.asOfDate))
      .slice(0, delayedLimit)
      .map(toWeeklyReportTask),
    nextWeekPlanned: leafTasks
      .filter(
        (task) =>
          isWithinPeriod(task.plannedStart, input.nextWeekPeriod) ||
          isWithinPeriod(task.plannedFinish, input.nextWeekPeriod),
      )
      .map(toWeeklyReportTask),
  };
}

export function createWeeklyReportDefaultFileName(input: {
  asOfDate: string;
  workspaceName: string;
}): string {
  const safeWorkspaceName = input.workspaceName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/\s+/gu, '_')
    .slice(0, 40);

  return `${input.asOfDate}_${safeWorkspaceName}_주간보고서.docx`;
}

export function toWeeklyReportSource(
  context: AutoRetrievedContext,
): WeeklyReportSource {
  return {
    source_type:
      context.sourceType === 'rag'
        ? 'rag'
        : context.sourceType === 'schedule'
          ? 'schedule'
          : context.sourceType === 'issue'
            ? 'issue'
          : 'vault',
    document_id: context.mimoraDocumentId ?? context.documentId,
    rag_document_id: context.ragDocumentId,
    filename: context.fileName,
    path: context.relativePath,
    excerpt: context.snippet || context.content.slice(0, 500),
    security: context.documentSecurity ?? context.security,
  };
}

export function createWeeklyReportScheduleSource(input: {
  summary: ScheduleSummary;
}): WeeklyReportSource {
  return {
    source_type: 'schedule',
    filename: input.summary.source.filename,
    path: input.summary.source.sourcePath,
    security: 'internal',
  };
}
