import assert from 'node:assert/strict';
import { access, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIssueService } from '../electron/issueService';
import type {
  CanonicalIssueBook,
  IssueDocument,
  IssueParseResult,
  IssueQueryResult,
  IssueSummary,
} from '../src/issue';

const root = await mkdtemp(path.join(os.tmpdir(), 'mimora-issue-service-'));
const sourceAPath = path.join(root, 'ProjectA_Issues.xlsx');
const sourceBPath = path.join(root, 'ProjectB_Issues.xlsx');
await writeFile(sourceAPath, Buffer.from('issue-source-a'));
await writeFile(sourceBPath, Buffer.from('issue-source-b'));

const commands: string[] = [];
let parseCount = 0;

function createSummary(
  document: IssueDocument,
  issueBook: CanonicalIssueBook,
): IssueSummary {
  const completedIssues = issueBook.issues.filter(
    (issue) => issue.status === 'resolved' || issue.status === 'closed' || issue.status === 'completed',
  ).length;

  return {
    workspaceId: issueBook.workspaceId,
    filename: issueBook.filename,
    modifiedAt: document.modifiedAt,
    lastAnalyzedAt: document.lastAnalyzedAt ?? '2026-09-10T00:00:00.000Z',
    parseStatus: document.parseStatus,
    totalIssues: issueBook.issues.length,
    issueCount: issueBook.issues.filter((issue) => issue.itemType !== 'risk').length,
    riskCount: issueBook.issues.filter((issue) => issue.itemType === 'risk').length,
    openIssues: issueBook.issues.length - completedIssues,
    completedIssues,
    resolvedIssues: completedIssues,
    openInProgressIssues: issueBook.issues.filter(
      (issue) => issue.status === 'open' || issue.status === 'in_progress',
    ).length,
    completionRate: issueBook.issues.length
      ? completedIssues / issueBook.issues.length
      : null,
    overdueOpenIssues: 1,
    longOpenIssues30d: 1,
    longOpenIssues60d: 0,
    longOpenIssues90d: 0,
    missingDueOpenIssues: 0,
    staleUpdateIssues: 1,
    organizationSupportRequiredOpen: 1,
    averageResolutionDays: 4,
    medianResolutionDays: 4,
    dueDateAdherenceRate: 1,
    statusCounts: { open: issueBook.issues.length - completedIssues },
    rawStatusCounts: { Open: issueBook.issues.length - completedIssues },
    rawStatusValues: ['Open'],
    skippedRows: issueBook.parseWarnings?.length ?? 0,
    parseWarnings: issueBook.parseWarnings ?? [],
    source: document,
  };
}

const service = createIssueService({
  getUserDataPath: () => root,
  getAppRoot: () => process.cwd(),
  runWorker: async <T>(command: string, input: unknown): Promise<T> => {
    commands.push(command);
    if (command.startsWith('rag-')) {
      throw new Error('Issue service must not call RAG commands.');
    }

    const payload = input as {
      workspace_id?: string;
      source_path?: string;
      document?: IssueDocument;
      issue_book?: CanonicalIssueBook;
      query?: string;
    };

    if (command === 'issue-parse') {
      parseCount += 1;
      assert.ok(payload.workspace_id);
      assert.ok(payload.source_path);
      assert.match(payload.source_path, /issue[\\/]+documents/u);
      const stats = await stat(payload.source_path);
      const document: IssueDocument = {
        id: `issue-${payload.workspace_id}`,
        workspaceId: payload.workspace_id,
        originalFileName: path.basename(payload.source_path),
        managedFilePath: payload.source_path,
        sourceHash: `hash-${payload.workspace_id}`,
        registeredAt: '2026-09-10T00:00:00.000Z',
        registeredBy: 'local-user',
        status: 'active',
        disconnectedAt: null,
        lastAnalyzedAt: `2026-09-10T00:00:0${parseCount}.000Z`,
        parserType: 'issue_excel',
        security: 'internal',
        notes: null,
        fileSize: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        parseStatus: 'parsed',
      };
      const issueBook: CanonicalIssueBook = {
        workspaceId: payload.workspace_id,
        sourceFile: payload.source_path,
        filename: document.originalFileName,
        parsedSheets: ['Issues'],
        headerRow: 1,
        detectedColumns: ['Issue'],
        columnMapping: { title: 'Issue' },
        parseWarnings: [],
        issues: [
          {
            itemId: `${payload.workspace_id}:ISS-1`,
            itemType: 'issue',
            issueId: `${payload.workspace_id}:ISS-1`,
            sourceRow: 2,
            issueArea: 'Interface',
            issueCategory: 'Risk',
            phase: 'Build',
            title: `${payload.workspace_id} API delay`,
            issueEvent: `${payload.workspace_id} API delay`,
            description: null,
            reportedDate: '2026-08-01',
            occurredDate: '2026-08-01',
            riskAnalysisId: null,
            riskId: 'R-1',
            probability: 3,
            impact: 4,
            severity: 'high',
            riskLevel: 'high',
            rootCause: null,
            actionPlan: 'Escalate vendor',
            responsePlan: 'Escalate vendor',
            resolution: null,
            owner: 'PM',
            actionOwner: 'PM',
            targetDate: '2026-09-01',
            dueDate: '2026-09-01',
            organizationSupportRequired: true,
            rawStatus: 'Open',
            progressStatus: 'Open',
            status: 'open',
            canonicalStatus: 'open',
            priority: null,
            effortMh: 8,
            actionDate: null,
            resolvedDate: null,
            completedDate: null,
            remarks: '(2026.09.02) vendor follow-up',
            noteTimeline: '(2026.09.02) vendor follow-up',
            latestNoteDate: '2026-09-02',
            sourceHash: document.sourceHash,
            dataQualityFlags: [],
            derivedMetrics: {
              openAgeDays: 40,
              issueAgeDays: 40,
              overdueDays: 9,
              daysSinceLastUpdate: 8,
              resolutionDays: null,
              completedLateDays: null,
              derivedRiskScore: 12,
              riskFlags: ['overdue', 'organization_support_required'],
            },
          },
        ],
      };

      return {
        document,
        issueBook,
        summary: createSummary(document, issueBook),
        fromCache: false,
      } satisfies IssueParseResult as T;
    }

    if (command === 'issue-summary') {
      assert.ok(payload.document);
      assert.ok(payload.issue_book);
      return createSummary(payload.document, payload.issue_book) as T;
    }

    if (command === 'issue-query') {
      assert.ok(payload.document);
      assert.ok(payload.issue_book);
      assert.equal(payload.query, 'overdue open issues');
      return {
        kind: 'overdue_issues',
        workspaceId: payload.issue_book.workspaceId,
        filename: payload.issue_book.filename,
        lastAnalyzedAt: payload.document.lastAnalyzedAt ?? '',
        asOfDate: '2026-09-10',
        summary: createSummary(payload.document, payload.issue_book),
        issues: payload.issue_book.issues,
        queryPlan: {
          temporalScope: 'CURRENT_OPEN',
          detectedIntent: '지연 이슈',
          statusFilter: '미해결(open, in_progress, on_hold)',
          additionalFilters: ['overdueDays>0'],
          sortOrder: ['Overdue', 'Age'],
        },
        contextText: '[ISSUE SOURCE OF TRUTH]\n[/ISSUE SOURCE OF TRUTH]',
      } satisfies IssueQueryResult as T;
    }

    throw new Error(`Unexpected command: ${command}`);
  },
});

const registeredA = await service.registerDocument({
  workspaceId: 'WS-2026-0001',
  sourcePath: sourceAPath,
  security: 'internal',
});
const registeredB = await service.registerDocument({
  workspaceId: 'WS-2026-0002',
  sourcePath: sourceBPath,
  security: 'private',
});
assert.notEqual(registeredA.managedFilePath, sourceAPath);
assert.notEqual(registeredB.managedFilePath, sourceBPath);
await access(registeredA.managedFilePath);
await access(registeredB.managedFilePath);

const parsedA = await service.refresh('WS-2026-0001');
const parsedB = await service.refresh('WS-2026-0002');
assert.equal(parsedA.issueBook.workspaceId, 'WS-2026-0001');
assert.equal(parsedB.issueBook.workspaceId, 'WS-2026-0002');

const queryA = await service.query({
  workspaceId: 'WS-2026-0001',
  query: 'overdue open issues',
});
assert.equal(queryA.workspaceId, 'WS-2026-0001');
assert.match(queryA.contextText, /\[ISSUE SOURCE OF TRUTH\]/u);
assert.equal(queryA.issues[0]?.issueArea, 'Interface');
assert.equal(queryA.issues[0]?.issueCategory, 'Risk');
assert.equal(queryA.issues[0]?.phase, 'Build');
assert.equal(queryA.issues[0]?.issueEvent, 'WS-2026-0001 API delay');
assert.equal(queryA.issues[0]?.occurredDate, '2026-08-01');
assert.equal(queryA.issues[0]?.responsePlan, 'Escalate vendor');
assert.equal(queryA.issues[0]?.actionOwner, 'PM');
assert.equal(queryA.issues[0]?.targetDate, '2026-09-01');
assert.equal(queryA.issues[0]?.organizationSupportRequired, true);
assert.equal(queryA.issues[0]?.progressStatus, 'Open');
assert.equal(queryA.issues[0]?.actionDate, null);
assert.equal(queryA.issues[0]?.derivedMetrics.issueAgeDays, 40);
assert.equal(queryA.queryPlan?.temporalScope, 'CURRENT_OPEN');
assert.equal(queryA.queryPlan?.statusFilter, '미해결(open, in_progress, on_hold)');

const removedA = await service.removeDocument('WS-2026-0001');
assert.equal(removedA.removed, true);
assert.equal(await service.getDocument('WS-2026-0001'), null);
await access(registeredA.managedFilePath);

assert.deepEqual(
  commands.filter((command) => command.startsWith('rag-')),
  [],
);

console.log('issue-service-tests passed');
