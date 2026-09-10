import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
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

const root = await mkdtemp(path.join(os.tmpdir(), 'mimora-schedule-service-'));
const sourcePath = path.join(root, 'XLGantt_sample.xlsm');
await writeFile(sourcePath, Buffer.from('schedule-source'));

const commands: string[] = [];
let parseCount = 0;

function createSummary(
  source: ScheduleSource,
  schedule: CanonicalSchedule,
): ScheduleSummary {
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
    delayedTaskCount: 1,
    delayedWbsNodeCount: 1,
    plannedProgress: 0.88,
    actualProgress: 0.84,
    progressAsOfDate: '2026-09-10',
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    parsedSheets: schedule.parsedSheets,
    source,
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
      parseCount += 1;
      assert.equal(payload.workspace_id, 'WS-2026-0001');
      assert.equal(payload.source_path, sourcePath);
      const stats = await stat(sourcePath);
      const source: ScheduleSource = {
        workspaceId: 'WS-2026-0001',
        sourcePath,
        filename: path.basename(sourcePath),
        fileSize: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        lastParsedAt: `2026-09-10T00:00:0${parseCount}.000Z`,
        parseStatus: 'parsed',
      };
      const schedule: CanonicalSchedule = {
        workspaceId: 'WS-2026-0001',
        sourceFile: sourcePath,
        filename: path.basename(sourcePath),
        projectStart: '2026-09-01',
        projectFinish: '2026-12-31',
        parsedSheets: ['Schedule', 'Calendar', 'Progress', 'Settings'],
        columnMapping: {
          wbs: 'WBS',
          name: 'Task Name',
        },
        calendars: [],
        progressSeries: [],
        settings: {},
        tasks: [
          {
            taskId: 'WS-2026-0001:1.1',
            wbs: '1.1',
            level: 2,
            name: '외부기관 심사',
            parentWbs: '1',
            isLeaf: true,
            plannedStart: '2026-09-01',
            plannedFinish: '2026-09-09',
            actualStart: '2026-09-01',
            actualFinish: null,
            plannedWorkload: 5,
            actualWorkload: 4,
            plannedDuration: 5,
            actualDuration: null,
            plannedProgress: 1,
            actualProgress: 0.7,
            resource: [{ name: 'PM', allocation: 1 }],
            deliverable: '심사결과',
            calendar: 'Default',
          },
        ],
      };

      return {
        source,
        schedule,
        summary: createSummary(source, schedule),
        fromCache: false,
      } satisfies ScheduleParseResult as T;
    }

    if (command === 'schedule-summary') {
      assert.ok(payload.source);
      assert.ok(payload.schedule);
      return createSummary(payload.source, payload.schedule) as T;
    }

    if (command === 'schedule-query') {
      assert.ok(payload.source);
      assert.ok(payload.schedule);
      assert.equal(payload.query, '현재 지연 작업은?');
      return {
        kind: 'delayed_tasks',
        workspaceId: payload.schedule.workspaceId,
        filename: payload.schedule.filename,
        lastParsedAt: payload.source.lastParsedAt ?? '',
        asOfDate: '2026-09-10',
        summary: createSummary(payload.source, payload.schedule),
        tasks: payload.schedule.tasks,
        contextText:
          '[SCHEDULE CONTEXT]\nDelayed Tasks\n1. WBS: 1.1 | Task: 외부기관 심사\n[/SCHEDULE CONTEXT]',
      } satisfies ScheduleQueryResult as T;
    }

    throw new Error(`Unexpected command: ${command}`);
  },
});

const registered = await service.registerSource({
  workspaceId: 'WS-2026-0001',
  sourcePath,
});
assert.equal(registered.filename, 'XLGantt_sample.xlsm');
assert.equal(registered.sourcePath, sourcePath);

const firstParse = await service.refresh('WS-2026-0001');
assert.equal(firstParse.fromCache, false);
assert.equal(firstParse.summary.taskCount, 1);
assert.equal(parseCount, 1);

const cachedSummary = await service.getSummary('WS-2026-0001');
assert.equal(cachedSummary.taskCount, 1);
assert.equal(parseCount, 1);
assert.ok(commands.includes('schedule-summary'));

const forcedParse = await service.refresh('WS-2026-0001', { force: true });
assert.equal(forcedParse.fromCache, false);
assert.equal(parseCount, 2);

const queryResult = await service.query({
  workspaceId: 'WS-2026-0001',
  query: '현재 지연 작업은?',
});
assert.equal(queryResult.kind, 'delayed_tasks');
assert.match(queryResult.contextText, /\[SCHEDULE CONTEXT\]/u);

const cachePath = path.join(root, 'schedule', 'cache', 'WS-2026-0001.json');
const cacheText = await readFile(cachePath, 'utf8');
assert.match(cacheText, /외부기관 심사/u);

const nextTime = new Date(Date.now() + 60_000);
await utimes(sourcePath, nextTime, nextTime);
await service.refresh('WS-2026-0001');
assert.equal(parseCount, 3);

const removed = await service.removeSource('WS-2026-0001');
assert.equal(removed.removed, true);
assert.equal(removed.source?.sourcePath, sourcePath);
await access(sourcePath);
const removedAgain = await service.removeSource('WS-2026-0001');
assert.equal(removedAgain.removed, false);

await service.registerSource({
  workspaceId: 'WS-2026-0001',
  sourcePath,
});
await service.refresh('WS-2026-0001');
assert.equal(parseCount, 4);
assert.deepEqual(
  commands.filter((command) => command.startsWith('rag-')),
  [],
);

const failingRoot = await mkdtemp(path.join(os.tmpdir(), 'mimora-schedule-failure-'));
const failingSourcePath = path.join(failingRoot, 'broken.xlsm');
await writeFile(failingSourcePath, Buffer.from('broken-schedule-source'));
const failingService = createScheduleService({
  getUserDataPath: () => failingRoot,
  getAppRoot: () => process.cwd(),
  runWorker: async () => {
    throw new Error('Schedule workbook parsing failed.');
  },
});
await failingService.registerSource({
  workspaceId: 'WS-2026-0001',
  sourcePath: failingSourcePath,
});
await assert.rejects(
  failingService.refresh('WS-2026-0001', { force: true }),
  /Schedule workbook parsing failed/u,
);
const failedSource = await failingService.getSource('WS-2026-0001');
assert.equal(failedSource?.parseStatus, 'failed');
assert.match(failedSource?.parseError ?? '', /Schedule workbook parsing failed/u);

console.log('schedule-service-tests passed');
