import assert from 'node:assert/strict';
import { access, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScheduleService } from '../electron/scheduleService';
import type {
  CanonicalSchedule,
  ScheduleParseResult,
  ScheduleQueryResult,
  ScheduleSource,
  ScheduleSummary,
} from '../src/schedule';

const root = await mkdtemp(path.join(os.tmpdir(), 'mimora-schedule-scope-'));
const sourceAPath = path.join(root, 'Schedule_A.xlsx');
const sourceBPath = path.join(root, 'Schedule_B.xlsx');
await writeFile(sourceAPath, Buffer.from('schedule-a'));
await writeFile(sourceBPath, Buffer.from('schedule-b'));

const commands: string[] = [];

function summary(source: ScheduleSource, schedule: CanonicalSchedule): ScheduleSummary {
  return {
    workspaceId: schedule.workspaceId,
    filename: schedule.filename,
    modifiedAt: source.modifiedAt,
    lastParsedAt: source.lastParsedAt ?? '2026-09-10T00:00:00.000Z',
    parseStatus: source.parseStatus,
    taskCount: schedule.tasks.length,
    leafTaskCount: schedule.tasks.filter((task) => task.isLeaf).length,
    activeTaskCount: 1,
    activeLeafTaskCount: 1,
    delayedTaskCount: 0,
    delayedWbsNodeCount: 0,
    plannedProgress: 0.5,
    actualProgress: 0.4,
    progressAsOfDate: '2026-09-10',
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    parsedSheets: schedule.parsedSheets,
    source,
  };
}

function scheduleFor(workspaceId: string, sourcePath: string): CanonicalSchedule {
  return {
    workspaceId,
    sourceFile: sourcePath,
    filename: path.basename(sourcePath),
    projectStart: '2026-09-01',
    projectFinish: '2026-12-31',
    parsedSheets: ['Schedule'],
    columnMapping: { wbs: 'WBS', name: 'Task Name' },
    calendars: [],
    progressSeries: [],
    settings: {},
    tasks: [
      {
        taskId: `${workspaceId}:1.1`,
        wbs: '1.1',
        level: 2,
        name: `${workspaceId} 전용 작업`,
        parentWbs: '1',
        isLeaf: true,
        plannedStart: '2026-09-01',
        plannedFinish: '2026-09-30',
        actualStart: '2026-09-01',
        actualFinish: null,
        plannedWorkload: null,
        actualWorkload: null,
        plannedDuration: null,
        actualDuration: null,
        plannedProgress: 0.5,
        actualProgress: 0.2,
        resource: [],
        deliverable: null,
        calendar: null,
      },
    ],
  };
}

const service = createScheduleService({
  getUserDataPath: () => root,
  getAppRoot: () => process.cwd(),
  runWorker: async <T>(command: string, input: unknown): Promise<T> => {
    commands.push(command);
    if (command.startsWith('rag-')) {
      throw new Error('Schedule service must not call RAG commands.');
    }

    const payload = input as {
      workspace_id?: string;
      source_path?: string;
      source?: ScheduleSource;
      schedule?: CanonicalSchedule;
      query?: string;
    };

    if (command === 'schedule-parse') {
      assert.ok(payload.workspace_id);
      assert.ok(payload.source_path);
      const stats = await stat(payload.source_path);
      const source: ScheduleSource = {
        workspaceId: payload.workspace_id,
        sourcePath: payload.source_path,
        filename: path.basename(payload.source_path),
        fileSize: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        lastParsedAt: '2026-09-10T00:00:00.000Z',
        parseStatus: 'parsed',
      };
      const schedule = scheduleFor(payload.workspace_id, payload.source_path);

      return {
        source,
        schedule,
        summary: summary(source, schedule),
        fromCache: false,
      } satisfies ScheduleParseResult as T;
    }

    if (command === 'schedule-summary') {
      assert.ok(payload.source);
      assert.ok(payload.schedule);
      assert.equal(payload.source.workspaceId, payload.schedule.workspaceId);
      return summary(payload.source, payload.schedule) as T;
    }

    if (command === 'schedule-query') {
      assert.ok(payload.source);
      assert.ok(payload.schedule);
      assert.equal(payload.source.workspaceId, payload.schedule.workspaceId);
      assert.equal(payload.query, '현재 진행중인 작업은?');
      return {
        kind: 'active_tasks',
        workspaceId: payload.schedule.workspaceId,
        filename: payload.schedule.filename,
        lastParsedAt: payload.source.lastParsedAt ?? '',
        asOfDate: '2026-09-10',
        summary: summary(payload.source, payload.schedule),
        tasks: payload.schedule.tasks,
        contextText: '[SCHEDULE CONTEXT]\n[/SCHEDULE CONTEXT]',
      } satisfies ScheduleQueryResult as T;
    }

    throw new Error(`Unexpected command: ${command}`);
  },
});

const sourceA = await service.registerSource({
  workspaceId: 'WS-2026-0001',
  sourcePath: sourceAPath,
});
const sourceB = await service.registerSource({
  workspaceId: 'WS-2026-0002',
  sourcePath: sourceBPath,
});
assert.notEqual(sourceA.managedFilePath, sourceB.managedFilePath);
await access(sourceA.managedFilePath ?? sourceA.sourcePath);
await access(sourceB.managedFilePath ?? sourceB.sourcePath);

await service.refresh('WS-2026-0001');
await service.refresh('WS-2026-0002');

const queryA = await service.query({
  workspaceId: 'WS-2026-0001',
  query: '현재 진행중인 작업은?',
});
const queryB = await service.query({
  workspaceId: 'WS-2026-0002',
  query: '현재 진행중인 작업은?',
});

assert.equal(queryA.workspaceId, 'WS-2026-0001');
assert.equal(queryB.workspaceId, 'WS-2026-0002');
assert.match(queryA.tasks[0]?.name ?? '', /WS-2026-0001/u);
assert.match(queryB.tasks[0]?.name ?? '', /WS-2026-0002/u);
assert.deepEqual(
  commands.filter((command) => command.startsWith('rag-')),
  [],
);

console.log('schedule-scoping-tests passed');
