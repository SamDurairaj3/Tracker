import type { ChecklistStatus, ProgressMethod, WorkHealth, WorkItemType, WorkPriority, WorkStatus } from '../lib/work-items';
export type WorkItemRow = {
  id: string;
  title: string;
  team: string;
  owner: string;
  status: WorkStatus;
  health: WorkHealth;
  priority: WorkPriority;
  progress: number;
  start_date: string;
  due_date: string;
  due_label: string;
  created_by: string;
  work_type: WorkItemType;
  purpose: string;
  expected_result: string;
  linked_goal: string | null;
  progress_method: ProgressMethod;
  blocker: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistRow = {
  id: string;
  work_item_id: string;
  title: string;
  assignee: string;
  status: ChecklistStatus;
  weight: number;
  position: number;
};


