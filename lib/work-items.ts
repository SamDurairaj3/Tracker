/**
 * Shared work-item contracts used by both product surfaces and the server API.
 * Keeping these types independent of storage lets the on-prem API replace the
 * current site database without changing the management or engineering UI.
 */

export type WorkStatus = 'captured' | 'ready' | 'active' | 'review' | 'done';
export type WorkHealth = 'on-track' | 'at-risk' | 'blocked';
export type WorkPriority = 'Critical' | 'High' | 'Medium';
export type WorkItemType = 'Task' | 'Experiment' | 'Investigation' | 'Review';
export type ProgressMethod =
  | 'status-only'
  | 'zero-or-hundred'
  | 'checklist-count'
  | 'weighted-checklist'
  | 'quantity'
  | 'manual-estimate';
export type ChecklistStatus = 'open' | 'in-progress' | 'done' | 'blocked';
export type WorkItemActivityType =
  | 'comment'
  | 'created'
  | 'edited'
  | 'workflow'
  | 'checklist'
  | 'archived'
  | 'restored';

export const WORK_STATUSES = ['captured', 'ready', 'active', 'review', 'done'] as const;
export const WORK_HEALTH_VALUES = ['on-track', 'at-risk', 'blocked'] as const;
export const CHECKLIST_STATUSES = ['open', 'in-progress', 'done', 'blocked'] as const;

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === 'string' && WORK_STATUSES.includes(value as WorkStatus);
}

export function isWorkHealth(value: unknown): value is WorkHealth {
  return typeof value === 'string' && WORK_HEALTH_VALUES.includes(value as WorkHealth);
}

export function isChecklistStatus(value: unknown): value is ChecklistStatus {
  return typeof value === 'string' && CHECKLIST_STATUSES.includes(value as ChecklistStatus);
}

export type ChecklistStep = {
  id: string;
  workItemId: string;
  title: string;
  assignee: string;
  status: ChecklistStatus;
  weight: number;
  position: number;
};

export type WorkItem = {
  id: string;
  title: string;
  team: string;
  owner: string;
  status: WorkStatus;
  health: WorkHealth;
  priority: WorkPriority;
  progress: number;
  start: string;
  due: string;
  dueLabel: string;
  createdBy: string;
  type: WorkItemType;
  purpose: string;
  expectedResult: string;
  linkedGoal: string | null;
  progressMethod: ProgressMethod;
  blocker: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedByName: string | null;
  activityCount: number;
  latestActivityAt: string | null;
  checklist: ChecklistStep[];
};

export function canAccessWorkItem(
  item: WorkItem,
  actor: { name: string; role: string },
) {
  return actor.role === 'admin'
    || item.owner === actor.name
    || item.createdBy === actor.name
    || item.checklist.some((step) => step.assignee === actor.name);
}

export type WorkItemActivity = {
  id: string;
  workItemId: string;
  type: WorkItemActivityType;
  authorUserId: string | null;
  authorName: string;
  body: string;
  checklistStepId: string | null;
  checklistTitle: string | null;
  createdAt: string;
};

export type ChecklistStepInput = {
  title: string;
  assignee: string;
  weight?: number;
};

export type CreateWorkItemInput = {
  title: string;
  team: string;
  owner: string;
  status: 'captured' | 'ready';
  priority: WorkPriority;
  start: string;
  due: string;
  createdBy: string;
  type: WorkItemType;
  purpose: string;
  expectedResult: string;
  linkedGoal?: string;
  progressMethod: ProgressMethod;
  checklist: ChecklistStepInput[];
};

export type WorkItemPatch = {
  id: string;
  status?: WorkStatus;
  health?: WorkHealth;
  progress?: number;
  blocker?: string | null;
  checklistStep?: {
    id: string;
    status: ChecklistStatus;
  };
};

export type WorkItemEditChecklistInput = {
  id?: string;
  title: string;
  assignee: string;
  weight?: number;
};

export type WorkItemEditInput = {
  id: string;
  title: string;
  type: WorkItemType;
  team: string;
  owner: string;
  priority: WorkPriority;
  purpose: string;
  expectedResult: string;
  linkedGoal?: string;
  start: string;
  due: string;
  progressMethod: ProgressMethod;
  progress?: number;
  checklist: WorkItemEditChecklistInput[];
};

export const TEAMS = [
  'Propulsion',
  'Ground Systems',
  'Avionics',
  'Structures',
  'GNC',
  'Flight Software',
] as const;

export const STATUS_LABELS: Record<WorkStatus, string> = {
  captured: 'Captured',
  ready: 'Ready',
  active: 'Active',
  review: 'Review',
  done: 'Done',
};

export const PROGRESS_METHOD_LABELS: Record<ProgressMethod, string> = {
  'status-only': 'Status only',
  'zero-or-hundred': '0 / 100',
  'checklist-count': 'Checklist completion',
  'weighted-checklist': 'Weighted checklist',
  quantity: 'Quantity completed',
  'manual-estimate': 'Manual estimate (subjective)',
};

export function formatDueLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}
