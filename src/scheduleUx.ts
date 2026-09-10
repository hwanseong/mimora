export type ScheduleOperationStage =
  | 'idle'
  | 'registering'
  | 'parsing'
  | 'building_cache'
  | 'parsed'
  | 'failed';

export function isScheduleOperationBusy(
  stage: ScheduleOperationStage,
): boolean {
  return (
    stage === 'registering' ||
    stage === 'parsing' ||
    stage === 'building_cache'
  );
}

export function getScheduleStageLabel(
  stage: ScheduleOperationStage,
): string | null {
  switch (stage) {
    case 'registering':
      return 'registering';
    case 'parsing':
      return 'parsing';
    case 'building_cache':
      return 'building cache';
    case 'parsed':
      return 'parsed';
    case 'failed':
      return 'failed';
    case 'idle':
      return null;
  }
}

export function getScheduleRegisterButtonLabel(
  stage: ScheduleOperationStage,
): string {
  switch (stage) {
    case 'registering':
      return 'Registering...';
    case 'parsing':
      return 'Parsing...';
    case 'building_cache':
      return 'Building cache...';
    default:
      return 'Register';
  }
}

export function getScheduleReparseButtonLabel(
  stage: ScheduleOperationStage,
): string {
  switch (stage) {
    case 'parsing':
      return 'Parsing...';
    case 'building_cache':
      return 'Building cache...';
    default:
      return 'Re-parse';
  }
}

export type ScheduleQueryResultDisplayState = {
  showFormattedResult: boolean;
  showRawJson: boolean;
};

export function getScheduleQueryResultDisplayState(
  showRawJson: boolean,
): ScheduleQueryResultDisplayState {
  return {
    showFormattedResult: true,
    showRawJson,
  };
}
