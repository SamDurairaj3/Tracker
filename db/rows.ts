import type { ChecklistStatus, ProgressMethod, WorkHealth, WorkItemActivityType, WorkItemType, WorkPriority, WorkStatus } from '../lib/work-items';
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
  archived_at: string | null;
  archived_by_user_id: string | null;
  archived_by_name: string | null;
  activity_count: number;
  latest_activity_at: string | null;
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



export type WorkItemActivityRow = {
  id: string;
  work_item_id: string;
  entry_type: WorkItemActivityType;
  author_user_id: string | null;
  author_name: string;
  body: string;
  checklist_step_id: string | null;
  checklist_title: string | null;
  created_at: string;
};
