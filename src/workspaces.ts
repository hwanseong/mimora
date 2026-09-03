export type WorkspaceType =
  | 'all'
  | 'project'
  | 'operation'
  | 'incident'
  | 'private';

export type Workspace = {
  id: string;
  label: string;
  type: WorkspaceType;
};

export type WorkspaceSection = {
  title: string;
  items: Workspace[];
};

export const workspaceSections: WorkspaceSection[] = [
  {
    title: 'Workspace',
    items: [{ id: 'all', label: '전체 업무', type: 'all' }],
  },
  {
    title: 'Projects',
    items: [
      { id: 'pjt-a', label: 'PJT-A', type: 'project' },
      { id: 'pjt-b', label: 'PJT-B', type: 'project' },
      { id: 'pjt-c', label: 'PJT-C', type: 'project' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'sys-a', label: 'SYS-A 운영', type: 'operation' },
      { id: 'sys-b', label: 'SYS-B 운영', type: 'operation' },
    ],
  },
  {
    title: '기타',
    items: [
      { id: 'incident', label: '장애 / 긴급', type: 'incident' },
      { id: 'private', label: 'PM Private', type: 'private' },
    ],
  },
];

export const defaultWorkspace = workspaceSections[0].items[0];
