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
      return '등록 중';
    case 'parsing':
      return '분석 중';
    case 'building_cache':
      return '캐시 생성 중';
    case 'parsed':
      return '정상';
    case 'failed':
      return '분석 실패';
    case 'idle':
      return null;
  }
}

export function getScheduleSourceStatusLabel(
  status: string | null | undefined,
): string {
  switch (status) {
    case 'registered':
      return '등록됨';
    case 'parsing':
      return '분석 중';
    case 'parsed':
      return '정상';
    case 'failed':
      return '분석 실패';
    default:
      return '미등록';
  }
}

export function formatScheduleDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function getScheduleRegisterButtonLabel(
  stage: ScheduleOperationStage,
): string {
  switch (stage) {
    case 'registering':
      return '등록 중...';
    case 'parsing':
      return '분석 중...';
    case 'building_cache':
      return '캐시 생성 중...';
    default:
      return '등록';
  }
}

export function getScheduleReparseButtonLabel(
  stage: ScheduleOperationStage,
): string {
  switch (stage) {
    case 'parsing':
      return '분석 중...';
    case 'building_cache':
      return '캐시 생성 중...';
    default:
      return '다시 읽기';
  }
}

export type ScheduleQueryResultDisplayState = {
  showFormattedResult: boolean;
  showRawJson: boolean;
};

export type WorkspaceChatQueryRoute =
  | 'schedule_only'
  | 'document_only'
  | 'combined';

const taskListQueryKinds = new Set([
  'active_tasks',
  'delayed_tasks',
  'starting_between',
  'finishing_between',
  'resource_lookup',
  'resource_status',
  'task_lookup',
  'task_status',
]);

export function isScheduleTaskListQueryKind(kind: string): boolean {
  return taskListQueryKinds.has(kind);
}

export function getScheduleQuerySuccessMessage(input: {
  kind: string;
  taskCount: number;
}): string {
  if (input.kind === 'schedule_performance') {
    return '일정 성과를 계산했습니다.';
  }

  if (input.kind === 'forecast') {
    return '일정 예측을 계산했습니다.';
  }

  if (!isScheduleTaskListQueryKind(input.kind)) {
    return '일정 쿼리를 완료했습니다.';
  }

  return `${input.taskCount.toLocaleString()}개 작업을 찾았습니다.`;
}

const scheduleDisplayLabels: Record<string, string> = {
  active_tasks: '진행 중 작업',
  delayed_tasks: '지연 작업',
  dependency_lookup: '선후행 관계 조회',
  earned_schedule: '누적 일정성과 시나리오',
  forecast: '일정 예측',
  forecast_partially_unavailable: '일부 예측 방식 계산 불가',
  forecast_unavailable: '일정 예측 계산 불가',
  heuristic: '휴리스틱 추정',
  impact_analysis: '일정 영향 분석',
  insufficient: '데이터 부족',
  limited: '제한적',
  recent_velocity: '최근 4주 진척속도',
  recent_velocity_unavailable: '최근 진척속도 기준 예측 불가',
  remaining_tasks: '잔여 작업 기준 추정',
  resource_lookup: '담당자 작업 조회',
  resource_status: '담당자 작업 상태',
  schedule_performance: '일정 성과',
  stale: '최근 데이터 부족',
  task_lookup: '작업 조회',
  task_status: '작업 상태',
  unavailable: '계산 불가',
  dependency_relationships_unavailable: '선후행 관계 정보 없음',
  what_if: 'What-if 분석',
  what_if_task_delay: '작업 지연 What-if',
  working_day: '영업일',
  what_if_dependency_missing: '선후행 관계 정보가 없어 후행 영향 계산 불가',
  dependency_not_available: '선후행 관계 정보 없음',
  what_if_unavailable: 'What-if 계산 불가',
  task_not_found: '작업을 찾을 수 없음',
  what_if_delay_missing: '지연 기간 입력 필요',
  simulated_task_finish_after_project_finish:
    '가정 완료일이 계획 프로젝트 종료일을 초과',
};

const scheduleReasonLabels: Record<string, string> = {
  'No positive actual progress in the recent 4-week window.':
    '최근 4주 동안 실제 진척률의 증가가 없어 진척속도 기반 예측을 계산할 수 없습니다.',
  'If cumulative SPI(t) stays at the current level, this is the extrapolated finish scenario.':
    '현재 누적 일정성과 지수 SPI(t)가 앞으로도 동일하게 유지된다는 가정으로 계산한 장기 시나리오입니다.',
  'Heuristic based on remaining duration of incomplete leaf tasks; dependencies are not inferred.':
    '미완료 Leaf Task의 잔여 기간을 기준으로 추정했습니다. 선후행 관계는 추정하지 않습니다.',
  'Remaining-task heuristic is used as the primary operational estimate because dependency relationships are unavailable and recent velocity is unavailable.':
    '선후행 관계 정보가 없고 최근 진척속도 기준 예측도 불가하므로, 잔여 작업 기준 휴리스틱을 현실적 운영 추정으로 사용합니다.',
  'Dependency relationships unavailable.':
    '현재 일정 파일에 선후행 관계 정보가 없어 Dependency 기반 일정 영향 계산은 수행하지 않습니다.',
  'Resource leveling and dependency propagation are not applied.':
    '리소스 평준화와 선후행 전파는 반영하지 않았습니다.',
  'Remaining leaf tasks use planned duration multiplied by remaining progress.':
    '잔여 Leaf Task는 계획 기간과 남은 진척률을 기준으로 계산했습니다.',
  'Recent progress velocity uses the latest 4-week window.':
    '최근 4주 구간의 진척률 변화량을 기준으로 계산합니다.',
  'A positive actual progress delta is required.':
    '실제 진척률 증가분이 있어야 계산할 수 있습니다.',
  'Cumulative schedule performance remains unchanged.':
    '현재 누적 일정성과가 앞으로도 동일하게 유지된다고 가정합니다.',
  'This is a performance scenario, not the primary operational estimate.':
    '현실적 운영 추정이 아니라 성과지수 기반 장기 시나리오입니다.',
  'Remaining-task heuristic / dependency 미반영':
    '잔여 작업 기준 휴리스틱이며 선후행 관계는 반영하지 않았습니다.',
  'Schedule what-if delays are interpreted as working days.':
    'Schedule What-if의 지연 기간은 영업일 기준으로 해석합니다.',
};

export function formatScheduleDisplayValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '-';
  }

  const currentSpiMatch = value.match(/^Current SPI\(t\) = ([0-9.]+)\.$/u);
  if (currentSpiMatch) {
    return `현재 SPI(t) = ${currentSpiMatch[1]}입니다.`;
  }

  if (value.startsWith('Requires SPI(t)')) {
    return 'SPI(t)와 계획 영업일 기간이 필요합니다.';
  }

  if (value.startsWith('Requires planned duration')) {
    return '미완료 Leaf Task의 계획 기간 정보가 필요합니다.';
  }

  return scheduleDisplayLabels[value] ?? scheduleReasonLabels[value] ?? value;
}

export function formatScheduleDisplayList(values: unknown): string {
  if (!Array.isArray(values)) {
    return '-';
  }

  const formatted = values
    .filter((value): value is string => typeof value === 'string')
    .map(formatScheduleDisplayValue);

  return formatted.length > 0 ? formatted.join(' / ') : '-';
}

export function getScheduleQueryResultDisplayState(
  showRawJson: boolean,
): ScheduleQueryResultDisplayState {
  return {
    showFormattedResult: true,
    showRawJson,
  };
}

function normalizeChatQuery(query: string): string {
  return query.trim().replace(/\s+/gu, ' ');
}

export function hasScheduleChatSignal(query: string): boolean {
  const normalizedQuery = normalizeChatQuery(query);

  if (!normalizedQuery) {
    return false;
  }

  return /일정|진척|진도|진행|지연|지체|늦|밀렸|착수|완료\s*예정|종료\s*예정|계획보다|계획\s*종료일|지킬\s*수|wbs|담당자|담당|작업|선행|후행|의존성|영향|성과|추세|예상|언제\s*(끝|완료)|프로그램[가-힣A-Za-z0-9]*|schedule|progress|delay|delayed|task|resource|dependency|impact|forecast|estimate|earned\s*schedule|spi|sv\(t\)|sv/iu.test(
    normalizedQuery,
  );
}

export function hasDocumentExplanationSignal(query: string): boolean {
  const normalizedQuery = normalizeChatQuery(query);

  if (!normalizedQuery) {
    return false;
  }

  return /왜|원인|이유|이슈|리스크|회의|결정|변경|문제|근거|관련|설명|영향|관찰|사인|issue|risk|decision|change|reason|cause|evidence/iu.test(
    normalizedQuery,
  );
}

export function classifyWorkspaceChatQueryRoute(
  query: string,
): WorkspaceChatQueryRoute {
  const hasScheduleSignal = hasScheduleChatSignal(query);
  const hasExplanationSignal = hasDocumentExplanationSignal(query);

  if (hasScheduleSignal && hasExplanationSignal) {
    return 'combined';
  }

  if (hasScheduleSignal) {
    return 'schedule_only';
  }

  return 'document_only';
}

export function isScheduleOnlyChatQuestion(query: string): boolean {
  return classifyWorkspaceChatQueryRoute(query) === 'schedule_only';
}

export function isCombinedScheduleDocumentQuestion(query: string): boolean {
  return classifyWorkspaceChatQueryRoute(query) === 'combined';
}

export function isDocumentOnlyChatQuestion(query: string): boolean {
  return classifyWorkspaceChatQueryRoute(query) === 'document_only';
}
