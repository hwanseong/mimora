import {
  workspaceIdPattern,
  workspaceStatusOptions,
  type Workspace,
  type WorkspaceStatus,
} from '../workspace/types';
import type {
  WorkspaceRegistryFrontmatter,
  WorkspaceRegistryRow,
  WorkspaceRegistryValidationIssue,
} from './workspaceRegistryTypes';

function createIssue(
  issue: WorkspaceRegistryValidationIssue,
): WorkspaceRegistryValidationIssue {
  return issue;
}

function isWorkspaceStatus(value: string): value is WorkspaceStatus {
  return workspaceStatusOptions.includes(value as WorkspaceStatus);
}

function validateDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateWorkspaceRegistry({
  frontmatter,
  rows,
  validateFrontmatter = true,
}: {
  frontmatter: Partial<WorkspaceRegistryFrontmatter>;
  rows: WorkspaceRegistryRow[];
  validateFrontmatter?: boolean;
}): {
  registryVersion: number | null;
  workspaces: Workspace[];
  issues: WorkspaceRegistryValidationIssue[];
} {
  const issues: WorkspaceRegistryValidationIssue[] = [];
  const workspaces: Workspace[] = [];
  const seenWorkspaceIds = new Set<string>();

  if (validateFrontmatter && frontmatter.registryType !== 'workspaces') {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'invalid-registry-type',
        message: 'registry_type은 workspaces여야 합니다.',
        field: 'registry_type',
      }),
    );
  }

  if (validateFrontmatter && frontmatter.registryVersion !== 1) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'unsupported-version',
        message: '지원하지 않는 Workspace Registry version입니다.',
        field: 'registry_version',
      }),
    );
  }

  for (const row of rows) {
    const rowIssues: WorkspaceRegistryValidationIssue[] = [];
    const requiredFields = [
      ['id', row.id],
      ['name', row.name],
      ['type', row.type],
      ['status', row.status],
    ] as const;

    for (const [field, value] of requiredFields) {
      if (!value.trim()) {
        rowIssues.push(
          createIssue({
            severity: 'error',
            code: 'required-field-missing',
            message: `${field} 값은 필수입니다.`,
            row: row.rowNumber,
            workspaceId: row.id || undefined,
            field,
          }),
        );
      }
    }

    if (row.id.trim() && !workspaceIdPattern.test(row.id)) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-workspace-id',
          message: 'Workspace ID 형식은 WS-YYYY-NNNN이어야 합니다.',
          row: row.rowNumber,
          workspaceId: row.id,
          field: 'id',
        }),
      );
    }

    if (row.id.trim()) {
      if (seenWorkspaceIds.has(row.id)) {
        rowIssues.push(
          createIssue({
            severity: 'error',
            code: 'duplicate-workspace-id',
            message: 'Workspace ID가 중복되었습니다.',
            row: row.rowNumber,
            workspaceId: row.id,
            field: 'id',
          }),
        );
      } else {
        seenWorkspaceIds.add(row.id);
      }
    }

    if (row.status.trim() && !isWorkspaceStatus(row.status)) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-workspace-status',
          message: '지원하지 않는 Workspace status입니다.',
          row: row.rowNumber,
          workspaceId: row.id || undefined,
          field: 'status',
        }),
      );
    }

    if (row.startDate && !validateDate(row.startDate)) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-start-date',
          message: 'start_date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
          row: row.rowNumber,
          workspaceId: row.id || undefined,
          field: 'start_date',
        }),
      );
    }

    if (row.endDate && !validateDate(row.endDate)) {
      rowIssues.push(
        createIssue({
          severity: 'error',
          code: 'invalid-end-date',
          message: 'end_date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
          row: row.rowNumber,
          workspaceId: row.id || undefined,
          field: 'end_date',
        }),
      );
    }

    if (
      row.startDate &&
      row.endDate &&
      validateDate(row.startDate) &&
      validateDate(row.endDate) &&
      row.endDate < row.startDate
    ) {
      rowIssues.push(
        createIssue({
          severity: 'warning',
          code: 'end-date-before-start-date',
          message: 'end_date가 start_date보다 이릅니다.',
          row: row.rowNumber,
          workspaceId: row.id || undefined,
          field: 'end_date',
        }),
      );
    }

    issues.push(...rowIssues);

    if (!rowIssues.some((issue) => issue.severity === 'error')) {
      workspaces.push({
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status as WorkspaceStatus,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        description: row.description || null,
      });
    }
  }

  if (rows.length === 0) {
    issues.push(
      createIssue({
        severity: 'error',
        code: 'workspace-table-not-found',
        message: 'Workspace Registry Markdown table을 찾을 수 없습니다.',
      }),
    );
  }

  return {
    registryVersion:
      typeof frontmatter.registryVersion === 'number'
        ? frontmatter.registryVersion
        : null,
    workspaces,
    issues,
  };
}
