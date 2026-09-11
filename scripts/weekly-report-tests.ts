import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWeeklyReportService } from '../electron/weeklyReportService';
import {
  createWeeklyReportDefaultFileName,
  getWeeklyReportPeriods,
  selectWeeklyScheduleTasks,
  type WeeklyReportData,
} from '../src/weeklyReport';
import type { CanonicalScheduleTask } from '../src/schedule';

function makeTask(input: {
  wbs: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  actualStart?: string | null;
  actualFinish?: string | null;
  actualProgress: number;
}): CanonicalScheduleTask {
  return {
    taskId: input.wbs,
    wbs: input.wbs,
    level: input.wbs.split('.').length,
    name: input.name,
    parentWbs: null,
    isLeaf: true,
    plannedStart: input.plannedStart,
    plannedFinish: input.plannedFinish,
    actualStart: input.actualStart ?? null,
    actualFinish: input.actualFinish ?? null,
    plannedWorkload: null,
    actualWorkload: null,
    plannedDuration: null,
    actualDuration: null,
    plannedProgress: 1,
    actualProgress: input.actualProgress,
    resource: [],
    deliverable: null,
    calendar: null,
  };
}

const periods = getWeeklyReportPeriods('2026-09-10');
assert.deepEqual(periods.reportPeriod, {
  start: '2026-09-07',
  end: '2026-09-13',
});
assert.deepEqual(periods.nextWeekPeriod, {
  start: '2026-09-14',
  end: '2026-09-20',
});

const selected = selectWeeklyScheduleTasks({
  asOfDate: '2026-09-10',
  reportPeriod: periods.reportPeriod,
  nextWeekPeriod: periods.nextWeekPeriod,
  tasks: [
    makeTask({
      wbs: '1.1',
      name: '금주 완료',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-07',
      actualStart: '2026-09-01',
      actualFinish: '2026-09-09',
      actualProgress: 1,
    }),
    makeTask({
      wbs: '1.2',
      name: '진행 중',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-30',
      actualStart: '2026-09-01',
      actualProgress: 0.4,
    }),
    makeTask({
      wbs: '1.3',
      name: '지연 작업',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-09-01',
      actualStart: '2026-08-01',
      actualProgress: 0.8,
    }),
    makeTask({
      wbs: '1.4',
      name: '차주 계획',
      plannedStart: '2026-09-14',
      plannedFinish: '2026-09-18',
      actualProgress: 0,
    }),
  ],
});

assert.equal(selected.completed[0]?.name, '금주 완료');
assert.equal(selected.inProgress[0]?.name, '진행 중');
assert.equal(selected.delayed[0]?.name, '지연 작업');
assert.equal(selected.nextWeekPlanned[0]?.name, '차주 계획');
assert.equal(
  createWeeklyReportDefaultFileName({
    asOfDate: '2026-09-10',
    workspaceName: '모바일뱅킹 UX 고도화',
  }),
  '2026-09-10_모바일뱅킹_UX_고도화_주간보고서.docx',
);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mimora-weekly-report-'));
try {
  let workerCommand = '';
  let workerInput: unknown = null;
  const service = createWeeklyReportService({
    getUserDataPath: () => tempRoot,
    runWorker: async <T>(command: string, input: unknown): Promise<T> => {
      workerCommand = command;
      workerInput = input;
      return {
        canceled: false,
        outputPath: path.join(tempRoot, 'weekly.docx'),
        templatePath: null,
      } as T;
    },
  });
  const outputPath = path.join(tempRoot, 'weekly.docx');
  const data: WeeklyReportData = {
    workspace_id: 'WS-2026-0001',
    workspace_name: '모바일뱅킹 UX 고도화',
    generated_at: '2026-09-10T00:00:00.000Z',
    report_period: periods.reportPeriod,
    next_week_period: periods.nextWeekPeriod,
    schedule: {
      source_filename: 'WS-2026-0001_Schedule.xlsm',
      as_of_date: '2026-09-10',
      planned_progress: 1,
      actual_progress: 0.2344,
      delayed_task_count: 24,
      delayed_tasks: [],
      forecast: null,
      performance: null,
    },
    this_week: {
      completed: [],
      in_progress: [],
      key_activities: [],
    },
    next_week: {
      planned_tasks: [],
    },
    issues: [],
    risks: [],
    decisions: [],
    source_document_ids: [],
    source_rag_ids: [],
    schedule_source: {
      source_type: 'schedule',
      filename: 'WS-2026-0001_Schedule.xlsm',
      path: 'D:\\vault_test\\Schedule\\WS-2026-0001_Schedule.xlsm',
      security: 'internal',
    },
    security: {
      contains_sensitive_context: false,
      note: null,
    },
    summary: '요약',
  };

  const result = await service.renderWeeklyReport({
    data,
    outputPath,
  });

  assert.equal(result.canceled, false);
  assert.equal(workerCommand, 'weekly-report-render');
  assert.equal((workerInput as { output_path: string }).output_path, outputPath);
  assert.equal(
    (workerInput as { report_data: WeeklyReportData }).report_data.schedule
      .planned_progress,
    1,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('weekly-report-tests passed');
