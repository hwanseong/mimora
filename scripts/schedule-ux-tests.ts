import assert from 'node:assert/strict';
import {
  getScheduleQueryResultDisplayState,
  getScheduleRegisterButtonLabel,
  getScheduleReparseButtonLabel,
  getScheduleStageLabel,
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
assert.equal(getScheduleStageLabel('registering'), 'registering');
assert.equal(getScheduleStageLabel('parsing'), 'parsing');
assert.equal(getScheduleStageLabel('building_cache'), 'building cache');
assert.equal(getScheduleStageLabel('parsed'), 'parsed');
assert.equal(getScheduleStageLabel('failed'), 'failed');

assert.equal(getScheduleRegisterButtonLabel('idle'), 'Register');
assert.equal(getScheduleRegisterButtonLabel('registering'), 'Registering...');
assert.equal(getScheduleRegisterButtonLabel('parsing'), 'Parsing...');
assert.equal(getScheduleRegisterButtonLabel('building_cache'), 'Building cache...');
assert.equal(getScheduleRegisterButtonLabel('failed'), 'Register');

assert.equal(getScheduleReparseButtonLabel('idle'), 'Re-parse');
assert.equal(getScheduleReparseButtonLabel('parsing'), 'Parsing...');
assert.equal(getScheduleReparseButtonLabel('building_cache'), 'Building cache...');

assert.deepEqual(getScheduleQueryResultDisplayState(false), {
  showFormattedResult: true,
  showRawJson: false,
});
assert.deepEqual(getScheduleQueryResultDisplayState(true), {
  showFormattedResult: true,
  showRawJson: true,
});

console.log('schedule-ux-tests passed');
