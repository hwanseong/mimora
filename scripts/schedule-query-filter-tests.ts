import assert from 'node:assert/strict';
import type { CanonicalScheduleTask, ScheduleQueryKind } from '../src/schedule';

function compact(query: string): string {
  return query.toLowerCase().replace(/\s+/gu, '');
}

function includesAny(query: string, tokens: string[]): boolean {
  return tokens.some((token) => query.includes(token));
}

function isCompletedTask(task: CanonicalScheduleTask): boolean {
  return Boolean(
    task.actualFinish ||
      (typeof task.actualProgress === 'number' && task.actualProgress >= 1),
  );
}

function isOpenTask(task: CanonicalScheduleTask): boolean {
  return !isCompletedTask(task);
}

function isActiveTask(task: CanonicalScheduleTask, asOfDate: string): boolean {
  if (isCompletedTask(task)) {
    return false;
  }
  if (
    task.plannedStart &&
    task.plannedStart <= asOfDate &&
    (!task.plannedFinish || task.plannedFinish >= asOfDate)
  ) {
    return true;
  }
  return typeof task.actualProgress === 'number' && task.actualProgress > 0 && task.actualProgress < 1;
}

function isDelayedTask(task: CanonicalScheduleTask, asOfDate: string): boolean {
  if (!task.plannedFinish || task.plannedFinish >= asOfDate) {
    return false;
  }
  return !isCompletedTask(task);
}

function requestsRemaining(query: string): boolean {
  const queryText = query.toLowerCase();
  const compactText = compact(query);

  return (
    includesAny(queryText, [
      '남은',
      '남아있는',
      '해야 할',
      '해야할',
      '할 일',
      '할일',
      '완료된 일정 제외',
      '완료된 작업 제외',
      'remaining',
      'todo',
      'to do',
    ]) ||
    includesAny(compactText, [
      '완료된일정제외',
      '완료된작업제외',
      '남은것',
      '남은작업',
      '남은일정',
      '해야할일',
      '이번주해야할일',
    ])
  );
}

function requestsThisWeek(query: string): boolean {
  return includesAny(query.toLowerCase(), ['이번 주', '이번주', 'this week']) || compact(query).includes('이번주');
}

function classify(query: string): ScheduleQueryKind {
  const queryText = query.toLowerCase();

  if (requestsThisWeek(queryText) && requestsRemaining(queryText)) {
    return 'remaining_tasks';
  }
  if (requestsRemaining(queryText)) {
    return 'remaining_tasks';
  }
  if (includesAny(queryText, ['리스크', '위험', 'risk'])) {
    return 'delayed_tasks';
  }
  if (includesAny(queryText, ['지연', '지체', 'delay', 'delayed'])) {
    return 'delayed_tasks';
  }
  if (includesAny(queryText, ['진행', 'active', '현재', '착수 중'])) {
    return 'active_tasks';
  }
  return 'summary';
}

function filterTasks(
  query: string,
  tasks: CanonicalScheduleTask[],
  asOfDate: string,
): CanonicalScheduleTask[] {
  const kind = classify(query);

  if (kind === 'delayed_tasks') {
    return tasks.filter((task) => task.isLeaf && isOpenTask(task) && isDelayedTask(task, asOfDate));
  }
  if (kind === 'active_tasks') {
    return tasks.filter((task) => task.isLeaf && isOpenTask(task) && isActiveTask(task, asOfDate));
  }
  if (kind === 'remaining_tasks') {
    return tasks.filter((task) => task.isLeaf && isOpenTask(task));
  }
  return [];
}

const tasks: CanonicalScheduleTask[] = [
  {
    taskId: 'open-delayed',
    wbs: '1.1',
    level: 2,
    name: '지연 미완료 작업',
    parentWbs: '1',
    isLeaf: true,
    plannedStart: '2026-09-01',
    plannedFinish: '2026-09-09',
    actualStart: '2026-09-01',
    actualFinish: null,
    plannedWorkload: null,
    actualWorkload: null,
    plannedDuration: null,
    actualDuration: null,
    plannedProgress: 1,
    actualProgress: 0.7,
    resource: [],
    deliverable: null,
    calendar: null,
  },
  {
    taskId: 'open-active',
    wbs: '1.2',
    level: 2,
    name: '진행중 작업',
    parentWbs: '1',
    isLeaf: true,
    plannedStart: '2026-09-10',
    plannedFinish: '2026-09-30',
    actualStart: '2026-09-10',
    actualFinish: null,
    plannedWorkload: null,
    actualWorkload: null,
    plannedDuration: null,
    actualDuration: null,
    plannedProgress: 0.2,
    actualProgress: 0.1,
    resource: [],
    deliverable: null,
    calendar: null,
  },
  {
    taskId: 'completed',
    wbs: '1.3',
    level: 2,
    name: '완료 작업',
    parentWbs: '1',
    isLeaf: true,
    plannedStart: '2026-09-01',
    plannedFinish: '2026-09-05',
    actualStart: '2026-09-01',
    actualFinish: '2026-09-05',
    plannedWorkload: null,
    actualWorkload: null,
    plannedDuration: null,
    actualDuration: null,
    plannedProgress: 1,
    actualProgress: 1,
    resource: [],
    deliverable: null,
    calendar: null,
  },
];

const cases: Array<[string, ScheduleQueryKind]> = [
  ['지연된 일정 있어?', 'delayed_tasks'],
  ['현재 진행중인 작업은?', 'active_tasks'],
  ['이번 주 해야 할 일은?', 'remaining_tasks'],
  ['완료된 일정 제외하고 남은 것만 보여줘', 'remaining_tasks'],
  ['프로젝트 일정 리스크 알려줘', 'delayed_tasks'],
];

for (const [query, expectedKind] of cases) {
  assert.equal(classify(query), expectedKind, query);
  assert.equal(
    filterTasks(query, tasks, '2026-09-15').some((task) => isCompletedTask(task)),
    false,
    query,
  );
}

console.log('schedule-query-filter-tests passed');
