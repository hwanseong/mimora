import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyWorkspaceChatQueryRoute,
  getScheduleQueryResultDisplayState,
  getScheduleQuerySuccessMessage,
  getScheduleRegisterButtonLabel,
  getScheduleReparseButtonLabel,
  getScheduleStageLabel,
  getScheduleSourceStatusLabel,
  formatScheduleDateTime,
  formatScheduleDisplayList,
  formatScheduleDisplayValue,
  isScheduleOperationBusy,
  isScheduleOnlyChatQuestion,
  type ScheduleOperationStage,
} from '../src/scheduleUx';

const busyStages: ScheduleOperationStage[] = [
  'registering',
  'parsing',
  'building_cache',
];

for (const stage of busyStages) {
  assert.equal(isScheduleOperationBusy(stage), true);
}

assert.equal(isScheduleOperationBusy('idle'), false);
assert.equal(isScheduleOperationBusy('parsed'), false);
assert.equal(isScheduleOperationBusy('failed'), false);

assert.equal(getScheduleStageLabel('idle'), null);
assert.equal(getScheduleStageLabel('registering'), '등록 중');
assert.equal(getScheduleStageLabel('parsing'), '분석 중');
assert.equal(getScheduleStageLabel('building_cache'), '캐시 생성 중');
assert.equal(getScheduleStageLabel('parsed'), '정상');
assert.equal(getScheduleStageLabel('failed'), '분석 실패');

assert.equal(getScheduleSourceStatusLabel('registered'), '등록됨');
assert.equal(getScheduleSourceStatusLabel('parsing'), '분석 중');
assert.equal(getScheduleSourceStatusLabel('parsed'), '정상');
assert.equal(getScheduleSourceStatusLabel('failed'), '분석 실패');
assert.equal(getScheduleSourceStatusLabel(undefined), '미등록');

assert.equal(getScheduleRegisterButtonLabel('idle'), '등록');
assert.equal(getScheduleRegisterButtonLabel('registering'), '등록 중...');
assert.equal(getScheduleRegisterButtonLabel('parsing'), '분석 중...');
assert.equal(getScheduleRegisterButtonLabel('building_cache'), '캐시 생성 중...');
assert.equal(getScheduleRegisterButtonLabel('failed'), '등록');

assert.equal(getScheduleReparseButtonLabel('idle'), '다시 읽기');
assert.equal(getScheduleReparseButtonLabel('parsing'), '분석 중...');
assert.equal(getScheduleReparseButtonLabel('building_cache'), '캐시 생성 중...');

assert.match(
  formatScheduleDateTime('2026-09-10T13:19:08'),
  /^2026-09-10 13:19$/u,
);
assert.equal(formatScheduleDateTime(null), '-');

assert.deepEqual(getScheduleQueryResultDisplayState(false), {
  showFormattedResult: true,
  showRawJson: false,
});
assert.deepEqual(getScheduleQueryResultDisplayState(true), {
  showFormattedResult: true,
  showRawJson: true,
});

assert.equal(
  getScheduleQuerySuccessMessage({
    kind: 'schedule_performance',
    taskCount: 0,
  }),
  '일정 성과를 계산했습니다.',
);
assert.equal(
  getScheduleQuerySuccessMessage({
    kind: 'forecast',
    taskCount: 0,
  }),
  '일정 예측을 계산했습니다.',
);
assert.equal(
  getScheduleQuerySuccessMessage({
    kind: 'delayed_tasks',
    taskCount: 3,
  }),
  '3개 작업을 찾았습니다.',
);

assert.equal(
  formatScheduleDisplayValue('earned_schedule'),
  '누적 일정성과 시나리오',
);
assert.equal(
  formatScheduleDisplayValue('remaining_tasks'),
  '잔여 작업 기준 추정',
);
assert.equal(
  formatScheduleDisplayValue('recent_velocity_unavailable'),
  '최근 진척속도 기준 예측 불가',
);
assert.equal(
  formatScheduleDisplayValue(
    'No positive actual progress in the recent 4-week window.',
  ),
  '최근 4주 동안 실제 진척률의 증가가 없어 진척속도 기반 예측을 계산할 수 없습니다.',
);
assert.equal(
  formatScheduleDisplayList([
    'Dependency relationships unavailable.',
    'Resource leveling and dependency propagation are not applied.',
  ]),
  '현재 일정 파일에 선후행 관계 정보가 없어 Dependency 기반 일정 영향 계산은 수행하지 않습니다. / 리소스 평준화와 선후행 전파는 반영하지 않았습니다.',
);
assert.equal(formatScheduleDisplayValue('what_if'), 'What-if 분석');
assert.equal(
  formatScheduleDisplayValue('what_if_task_delay'),
  '작업 지연 What-if',
);
assert.equal(
  formatScheduleDisplayValue('what_if_dependency_missing'),
  '선후행 관계 정보가 없어 후행 영향 계산 불가',
);
assert.equal(
  formatScheduleDisplayValue(
    'Schedule what-if delays are interpreted as working days.',
  ),
  'Schedule What-if의 지연 기간은 영업일 기준으로 해석합니다.',
);

assert.equal(isScheduleOnlyChatQuestion('현재 일정 성과는?'), true);
assert.equal(isScheduleOnlyChatQuestion('현재 일정이 얼마나 늦었어?'), true);
assert.equal(isScheduleOnlyChatQuestion('프로그램B 일정은?'), true);
assert.equal(isScheduleOnlyChatQuestion('프로그램B가 5영업일 늦어지면?'), true);
assert.equal(isScheduleOnlyChatQuestion('이번 주 종료 예정 작업은?'), true);
assert.equal(
  isScheduleOnlyChatQuestion('박피엠 작업은 잘 진행되고 있나?'),
  true,
);
assert.equal(isScheduleOnlyChatQuestion('현재 추세면 프로젝트 언제 끝나?'), true);
assert.equal(isScheduleOnlyChatQuestion('왜 일정이 늦었어?'), false);
assert.equal(isScheduleOnlyChatQuestion('취업규칙상 휴게시간은?'), false);

assert.equal(
  classifyWorkspaceChatQueryRoute('현재 일정 성과는?'),
  'schedule_only',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('외부기관 관련 이슈가 뭐야?'),
  'issue_only',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('왜 일정이 이렇게 늦어진 것 같아?'),
  'combined',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('프로그램B가 왜 늦었어?'),
  'combined',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('현재 지연 작업과 관련된 주요 이슈를 알려줘'),
  'schedule_issue',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('이 이슈와 관련된 회의 결정은?'),
  'issue_document',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('조직지원이 필요한 이슈는?'),
  'issue_only',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('해결된 이슈 중 조직지원이 필요했던 것은?'),
  'issue_only',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('누가 맡은 이슈가 오래 지연되고 있어?'),
  'issue_only',
);
assert.equal(
  classifyWorkspaceChatQueryRoute('해결안된이슈는'),
  'issue_only',
);

const settingsView = readFileSync('src/components/SettingsView.tsx', 'utf8');
const scheduleTypes = readFileSync('src/schedule.ts', 'utf8');
const worker = readFileSync('python/mimora_worker.py', 'utf8');

assert.match(settingsView, /renderScheduleParseWarnings/u);
assert.match(settingsView, /Skipped rows/u);
assert.match(settingsView, /<th>Row<\/th>/u);
assert.match(scheduleTypes, /ScheduleParseWarning/u);
assert.match(scheduleTypes, /parseWarnings\?: ScheduleParseWarning\[\]/u);
assert.match(worker, /parseWarnings/u);
assert.match(worker, /missing_wbs_and_task_name/u);

console.log('schedule-ux-tests passed');
