import assert from 'node:assert/strict';
import {
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

console.log('schedule-ux-tests passed');
