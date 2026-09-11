export const scheduleSupportedExtensions = ['.xlsx', '.xlsm'] as const;

export type ScheduleSourceStatus =
  | 'registered'
  | 'parsed'
  | 'failed'
  | 'missing';

export type ScheduleFileSelection = {
  selectionId: string;
  name: string;
};

export type ScheduleSource = {
  workspaceId: string;
  sourcePath: string;
  filename: string;
  fileSize: number;
  modifiedAt: string;
  lastParsedAt: string | null;
  parseStatus: ScheduleSourceStatus;
  parseError?: string;
};

export type ScheduleRegisterInput = {
  workspaceId: string;
  selectionId: string;
};

export type ScheduleRemoveResult = {
  removed: boolean;
  source: ScheduleSource | null;
};

export type ScheduleRefreshOptions = {
  force?: boolean;
};

export type ScheduleQueryInput = {
  workspaceId: string;
  query: string;
  asOfDate?: string;
};

export type ScheduleResourceAssignment = {
  name: string;
  allocation: number | null;
};

export type CanonicalScheduleTask = {
  taskId: string;
  wbs: string;
  level: number;
  name: string;
  parentWbs: string | null;
  isLeaf: boolean;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  plannedWorkload: number | null;
  actualWorkload: number | null;
  plannedDuration: number | null;
  actualDuration: number | null;
  plannedProgress: number | null;
  actualProgress: number | null;
  resource: ScheduleResourceAssignment[];
  predecessorsRaw?: string | null;
  deliverable: string | null;
  calendar: string | null;
};

export type ScheduleDependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export type ScheduleDependency = {
  predecessor_wbs: string;
  successor_wbs: string;
  type: ScheduleDependencyType;
  lag_days: number;
  depth?: number;
};

export type CanonicalCalendarDay = {
  date: string;
  type: 'working' | 'non-working' | 'holiday';
  calendar: string | null;
  name: string | null;
};

export type CanonicalProgressPoint = {
  date: string;
  plannedWorkload: number | null;
  cumulativePlannedWorkload: number | null;
  plannedProgress: number | null;
  earnedValue: number | null;
  cumulativeEarnedValue: number | null;
  actualProgress: number | null;
  actualWorkload: number | null;
  cumulativeActualWorkload: number | null;
};

export type CanonicalSchedule = {
  workspaceId: string;
  sourceFile: string;
  filename: string;
  projectStart: string | null;
  projectFinish: string | null;
  tasks: CanonicalScheduleTask[];
  calendars: CanonicalCalendarDay[];
  progressSeries: CanonicalProgressPoint[];
  settings: Record<string, string | number | boolean | null>;
  parsedSheets: string[];
  columnMapping: Record<string, string>;
  dependencies?: ScheduleDependency[];
};

export type ScheduleSummary = {
  workspaceId: string;
  filename: string;
  modifiedAt: string;
  lastParsedAt: string;
  parseStatus: ScheduleSourceStatus;
  taskCount: number;
  leafTaskCount: number;
  activeTaskCount: number;
  activeWbsNodeCount?: number;
  activeLeafTaskCount?: number;
  delayedTaskCount: number;
  delayedWbsNodeCount?: number;
  plannedProgress: number | null;
  actualProgress: number | null;
  progressAsOfDate: string;
  projectStart: string | null;
  projectFinish: string | null;
  parsedSheets: string[];
  source: ScheduleSource;
};

export type ScheduleQueryKind =
  | 'summary'
  | 'active_tasks'
  | 'delayed_tasks'
  | 'starting_between'
  | 'finishing_between'
  | 'resource_lookup'
  | 'resource_status'
  | 'task_lookup'
  | 'task_status'
  | 'dependency_lookup'
  | 'impact_analysis'
  | 'schedule_performance'
  | 'earned_schedule'
  | 'forecast'
  | 'what_if'
  | 'unsupported';

export type ScheduleEntityType = 'resource' | 'task' | 'wbs';

export type ScheduleTaskStatus =
  | 'completed'
  | 'active'
  | 'delayed'
  | 'not_started'
  | 'in_progress';

export type ScheduleTaskAnalysis = {
  taskId: string;
  wbs: string;
  name: string;
  allocation?: number | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  actualProgress: number | null;
  isActive: boolean;
  isDelayed: boolean;
  isCompleted: boolean;
  status: ScheduleTaskStatus;
};

export type ScheduleResourceStatusSummary = {
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  delayedTasks: number;
  notStartedTasks: number;
};

export type ScheduleAdvancedAnalysis = Record<string, unknown>;

export type ScheduleQueryResult = {
  kind: ScheduleQueryKind;
  target?: string | null;
  detectedEntityType?: ScheduleEntityType | null;
  detectedEntity?: string | null;
  detectedIntent?: ScheduleQueryKind;
  resourceStatusSummary?: ScheduleResourceStatusSummary | null;
  taskAnalyses?: ScheduleTaskAnalysis[];
  advancedAnalysis?: ScheduleAdvancedAnalysis | null;
  workspaceId: string;
  filename: string;
  lastParsedAt: string;
  asOfDate: string;
  summary: ScheduleSummary;
  tasks: CanonicalScheduleTask[];
  contextText: string;
};

export type ScheduleParseResult = {
  source: ScheduleSource;
  schedule: CanonicalSchedule;
  summary: ScheduleSummary;
  fromCache: boolean;
};
