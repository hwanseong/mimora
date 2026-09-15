import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatIssueDelayStatus,
  hasMissingDueRisk,
  isCanonicalIssueCompleted,
  type CanonicalIssue,
} from '../src/issue';

function issue(overrides: Partial<CanonicalIssue>): CanonicalIssue {
  return {
    itemId: 'ISS-1',
    itemType: 'issue',
    issueId: 'ISS-1',
    sourceRow: 2,
    issueArea: null,
    issueCategory: null,
    phase: null,
    title: 'Issue',
    issueEvent: 'Issue',
    description: null,
    reportedDate: null,
    occurredDate: null,
    riskAnalysisId: null,
    riskId: null,
    probability: null,
    impact: null,
    severity: null,
    riskLevel: null,
    rootCause: null,
    actionPlan: null,
    responsePlan: null,
    resolution: null,
    owner: null,
    actionOwner: null,
    targetDate: null,
    dueDate: null,
    organizationSupportRequired: null,
    rawStatus: null,
    progressStatus: null,
    status: 'open',
    canonicalStatus: 'open',
    priority: null,
    effortMh: null,
    actionDate: null,
    resolvedDate: null,
    completedDate: null,
    remarks: null,
    noteTimeline: null,
    latestNoteDate: null,
    sourceHash: 'hash',
    dataQualityFlags: [],
    derivedMetrics: {
      openAgeDays: null,
      issueAgeDays: null,
      overdueDays: null,
      daysSinceLastUpdate: null,
      resolutionDays: null,
      completedLateDays: null,
      derivedRiskScore: null,
      riskFlags: [],
    },
    ...overrides,
  };
}

assert.equal(
  formatIssueDelayStatus(
    issue({
      dueDate: '2026-09-10',
      targetDate: '2026-09-10',
      derivedMetrics: {
        openAgeDays: 10,
        issueAgeDays: 10,
        overdueDays: 3,
        daysSinceLastUpdate: 1,
        resolutionDays: null,
        completedLateDays: null,
        derivedRiskScore: null,
        riskFlags: ['overdue'],
      },
    }),
  ),
  '+3일',
);

const missingDueIssue = issue({
  dataQualityFlags: ['missing_due_date'],
  derivedMetrics: {
    openAgeDays: 10,
    issueAgeDays: 10,
    overdueDays: null,
    daysSinceLastUpdate: 20,
    resolutionDays: null,
    completedLateDays: null,
    derivedRiskScore: null,
    riskFlags: ['missing_due'],
  },
});
assert.equal(formatIssueDelayStatus(missingDueIssue), '예정일 없음');
assert.equal(hasMissingDueRisk(missingDueIssue), true);

assert.equal(
  formatIssueDelayStatus(
    issue({
      status: 'resolved',
      canonicalStatus: 'resolved',
      dueDate: '2026-09-10',
      targetDate: '2026-09-10',
      completedDate: '2026-09-12',
      resolvedDate: '2026-09-12',
      derivedMetrics: {
        openAgeDays: null,
        issueAgeDays: 12,
        overdueDays: null,
        daysSinceLastUpdate: null,
        resolutionDays: 12,
        completedLateDays: 2,
        derivedRiskScore: null,
        riskFlags: [],
      },
    }),
  ),
  '지연완료 +2일',
);

assert.equal(
  formatIssueDelayStatus(
    issue({
      status: 'closed',
      canonicalStatus: 'closed',
      dueDate: '2026-09-10',
      targetDate: '2026-09-10',
      completedDate: '2026-09-10',
      resolvedDate: '2026-09-10',
      derivedMetrics: {
        openAgeDays: null,
        issueAgeDays: 10,
        overdueDays: null,
        daysSinceLastUpdate: null,
        resolutionDays: 10,
        completedLateDays: 0,
        derivedRiskScore: null,
        riskFlags: [],
      },
    }),
  ),
  '정시완료',
);

const openIssues = [
  issue({ sourceRow: 10, status: 'open', canonicalStatus: 'open' }),
  issue({ sourceRow: 32, status: 'in_progress', canonicalStatus: 'in_progress' }),
  issue({ sourceRow: 37, status: 'open', canonicalStatus: 'open' }),
];
const completedIssues = Array.from({ length: 30 }, (_, index) =>
  issue({
    sourceRow: 100 + index,
    status: 'resolved',
    canonicalStatus: 'resolved',
    completedDate: '2026-09-10',
    resolvedDate: '2026-09-10',
  }),
);
const mixedIssues = [...openIssues, ...completedIssues];

assert.equal(
  mixedIssues.filter((item) => !isCanonicalIssueCompleted(item)).length,
  3,
);
assert.equal(
  mixedIssues.filter((item) => isCanonicalIssueCompleted(item)).length,
  30,
);

const issueDocumentsView = readFileSync(
  'src/components/IssueDocumentsView.tsx',
  'utf8',
);
assert.match(issueDocumentsView, /진행중\/미해결 이슈/u);
assert.match(issueDocumentsView, /완료 이력/u);
assert.match(issueDocumentsView, /showCompletedHistory/u);
assert.match(issueDocumentsView, /isCanonicalIssueCompleted/u);

console.log('issue-ui-tests passed');
