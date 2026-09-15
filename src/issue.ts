export const issueSupportedExtensions = ['.xlsx', '.xlsm'] as const;

export type ProjectDocumentStatus = 'active' | 'disconnected' | 'archived';
export type ProjectDocumentSecurity = 'internal' | 'private';
export type IssueParseStatus = 'registered' | 'parsed' | 'failed' | 'missing';

export type IssueFileSelection = {
  selectionId: string;
  name: string;
};

export type IssueDocument = {
  id: string;
  workspaceId: string;
  originalFileName: string;
  managedFilePath: string;
  sourceHash: string;
  registeredAt: string;
  registeredBy: string;
  status: ProjectDocumentStatus;
  disconnectedAt: string | null;
  lastAnalyzedAt: string | null;
  parserType: 'issue_excel';
  security: ProjectDocumentSecurity;
  notes: string | null;
  fileSize: number;
  modifiedAt: string;
  parseStatus: IssueParseStatus;
  parseError?: string;
};

export type IssueRegisterInput = {
  workspaceId: string;
  selectionId: string;
  security?: ProjectDocumentSecurity;
  notes?: string | null;
};

export type IssueRemoveResult = {
  removed: boolean;
  document: IssueDocument | null;
};

export type IssueRefreshOptions = {
  force?: boolean;
};

export type IssueQueryInput = {
  workspaceId: string;
  query: string;
  asOfDate?: string;
};

export type IssueParseWarning = {
  row: number;
  reason: string;
};

export type CanonicalIssue = {
  itemId: string;
  itemType: 'risk' | 'issue';
  issueId: string;
  sourceRow: number;
  issueArea: string | null;
  issueCategory: string | null;
  phase: string | null;
  title: string;
  issueEvent: string;
  description: string | null;
  reportedDate: string | null;
  occurredDate: string | null;
  riskAnalysisId: string | null;
  riskId: string | null;
  probability: number | null;
  impact: number | null;
  severity: string | null;
  riskLevel: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  responsePlan: string | null;
  resolution: string | null;
  owner: string | null;
  actionOwner: string | null;
  targetDate: string | null;
  dueDate: string | null;
  organizationSupportRequired: boolean | null;
  rawStatus: string | null;
  progressStatus: string | null;
  status: string | null;
  canonicalStatus: string | null;
  priority: string | null;
  effortMh: number | null;
  actionDate: string | null;
  resolvedDate: string | null;
  completedDate: string | null;
  remarks: string | null;
  noteTimeline: string | null;
  latestNoteDate: string | null;
  sourceHash: string;
  dataQualityFlags: string[];
  derivedMetrics: {
    openAgeDays: number | null;
    issueAgeDays: number | null;
    overdueDays: number | null;
    daysSinceLastUpdate: number | null;
    resolutionDays: number | null;
    completedLateDays: number | null;
    derivedRiskScore: number | null;
    riskFlags: string[];
  };
};

export type CanonicalIssueBook = {
  workspaceId: string;
  sourceFile: string;
  filename: string;
  parsedSheets: string[];
  headerRow?: number;
  detectedColumns?: string[];
  columnMapping: Record<string, string>;
  parseWarnings?: IssueParseWarning[];
  issues: CanonicalIssue[];
};

export type IssueSummary = {
  workspaceId: string;
  filename: string;
  modifiedAt: string;
  lastAnalyzedAt: string;
  parseStatus: IssueParseStatus;
  totalIssues: number;
  issueCount?: number;
  riskCount?: number;
  openIssues: number;
  completedIssues: number;
  resolvedIssues?: number;
  openInProgressIssues?: number;
  completionRate: number | null;
  overdueOpenIssues: number;
  longOpenIssues30d: number;
  longOpenIssues60d: number;
  longOpenIssues90d: number;
  missingDueOpenIssues: number;
  staleUpdateIssues: number;
  organizationSupportRequiredOpen: number;
  averageResolutionDays: number | null;
  medianResolutionDays: number | null;
  dueDateAdherenceRate: number | null;
  statusCounts?: Record<string, number>;
  rawStatusCounts?: Record<string, number>;
  rawStatusValues?: string[];
  skippedRows?: number;
  parseWarnings?: IssueParseWarning[];
  source: IssueDocument;
};

export type IssueAssigneeSummary = {
  owner: string;
  totalAssigned: number;
  openAssigned: number;
  overdueAssigned: number;
  missingDueAssigned?: number;
  staleUpdateAssigned?: number;
  longOpenAssigned: number;
  averageResolutionDays: number | null;
  bottleneckScore: number;
};

export type IssueCluster = {
  key: string;
  count: number;
  issueIds: string[];
  sampleTitles: string[];
};

export type IssueTemporalScope =
  | 'CURRENT_OPEN'
  | 'HISTORICAL_ALL'
  | 'RESOLVED_ONLY';

export type IssueStatusScope = 'unresolved' | 'resolved' | 'all';

export type IssueQueryIntent =
  | 'issue_list'
  | 'issue_lookup'
  | 'open_issues'
  | 'unresolved_issues'
  | 'owner_bottleneck'
  | 'overdue_issues'
  | 'organization_support'
  | 'risk_candidates'
  | 'resolved_cases'
  | 'issue_status';

export type IssueQuerySort =
  | 'overdue_desc'
  | 'missing_due_desc'
  | 'issue_age_desc'
  | 'open_count_desc'
  | 'latest_note_date_asc_null_first'
  | 'organization_support_desc'
  | 'target_date_urgency_asc'
  | 'status_desc'
  | 'severity_priority_desc'
  | 'source_row_asc';

export type IssueQueryGroupBy =
  | 'action_owner'
  | 'issue_area'
  | 'issue_category'
  | 'phase'
  | 'status';

export type IssueQueryFilters = {
  owner?: string | null;
  issue_area?: string | null;
  issue_category?: string | null;
  phase?: string | null;
  organization_support_required?: boolean | null;
  overdue_only?: boolean;
};

export type StructuredIssueQuery = {
  intent: IssueQueryIntent;
  status_scope: IssueStatusScope;
  filters: IssueQueryFilters;
  group_by?: IssueQueryGroupBy | null;
  sort: IssueQuerySort[];
  limit: number;
};

export type IssueQueryPlan = {
  temporalScope: IssueTemporalScope;
  detectedIntent: string;
  statusFilter: string;
  additionalFilters: string[];
  sortOrder: string[];
  structuredQuery?: StructuredIssueQuery;
  filteredIssueCount?: number;
};

export type IssueQueryKind =
  | 'summary'
  | 'open_issues'
  | 'completed_issues'
  | 'overdue_issues'
  | 'long_open_issues'
  | 'owner_bottlenecks'
  | 'organization_support'
  | 'risk_issues'
  | 'repeated_issues'
  | 'issue_lookup'
  | 'unsupported';

export type IssueQueryResult = {
  kind: IssueQueryKind;
  target?: string | null;
  workspaceId: string;
  filename: string;
  lastAnalyzedAt: string;
  asOfDate: string;
  summary: IssueSummary;
  issues: CanonicalIssue[];
  assignees?: IssueAssigneeSummary[];
  clusters?: IssueCluster[];
  queryPlan?: IssueQueryPlan;
  structuredQuery?: StructuredIssueQuery;
  contextText: string;
};

export type IssueParseResult = {
  document: IssueDocument;
  issueBook: CanonicalIssueBook;
  summary: IssueSummary;
  fromCache: boolean;
};

export function isCanonicalIssueCompleted(issue: CanonicalIssue): boolean {
  return (
    issue.status === 'resolved' ||
    issue.status === 'closed' ||
    issue.status === 'completed' ||
    Boolean(issue.completedDate || issue.resolvedDate)
  );
}

export function formatIssueDelayStatus(issue: CanonicalIssue): string {
  const completed = isCanonicalIssueCompleted(issue);
  const dueDate = issue.dueDate ?? issue.targetDate;

  if (!dueDate) {
    return '예정일 없음';
  }

  if (completed) {
    if (!issue.completedDate && !issue.resolvedDate && !issue.actionDate) {
      return '완료일 없음';
    }

    const completedLateDays = issue.derivedMetrics.completedLateDays;

    if (typeof completedLateDays !== 'number') {
      return '완료일 없음';
    }

    return completedLateDays > 0
      ? `지연완료 +${completedLateDays}일`
      : '정시완료';
  }

  const overdueDays = issue.derivedMetrics.overdueDays;

  if (typeof overdueDays !== 'number') {
    return '정상';
  }

  return overdueDays > 0 ? `+${overdueDays}일` : '정상';
}

export function hasMissingDueRisk(issue: CanonicalIssue): boolean {
  return (
    !isCanonicalIssueCompleted(issue) &&
    !issue.dueDate &&
    (issue.dataQualityFlags.includes('missing_due_date') ||
      issue.derivedMetrics.riskFlags.includes('missing_due'))
  );
}
