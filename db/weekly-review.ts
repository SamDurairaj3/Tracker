import { database } from './postgres';
import type { Database } from './database';
import type { WeeklyReviewEvent } from '../lib/weekly-review';
import type {
  WorkHealth,
  WorkItemActivityType,
  WorkPriority,
  WorkStatus,
} from '../lib/work-items';

type WeeklyReviewRow = {
  id: string;
  work_item_id: string;
  work_item_title: string;
  entry_type: WorkItemActivityType;
  author_user_id: string | null;
  author_name: string;
  body: string;
  checklist_step_id: string | null;
  checklist_title: string | null;
  created_at: string;
  team: string;
  owner: string;
  priority: WorkPriority;
  status: WorkStatus;
  health: WorkHealth;
  progress: number;
  archived_at: string | null;
};

function hydrate(row: WeeklyReviewRow): WeeklyReviewEvent {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    workItemTitle: row.work_item_title,
    type: row.entry_type,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    body: row.body,
    checklistStepId: row.checklist_step_id,
    checklistTitle: row.checklist_title,
    createdAt: row.created_at,
    team: row.team,
    owner: row.owner,
    priority: row.priority,
    status: row.status,
    health: row.health,
    progress: Number(row.progress),
    archivedAt: row.archived_at,
  };
}

export function createWeeklyReviewRepository(db: Database) {
  return {
    async listBetween(start: string, end: string, limit = 2001) {
      const safeLimit = Math.max(1, Math.min(2001, Math.round(limit)));
      const { rows } = await db.query<WeeklyReviewRow>(`
        SELECT activity.id,
               activity.work_item_id,
               item.title AS work_item_title,
               activity.entry_type,
               activity.author_user_id,
               activity.author_name,
               activity.body,
               activity.checklist_step_id,
               activity.checklist_title,
               activity.created_at,
               item.team,
               item.owner,
               item.priority,
               item.status,
               item.health,
               item.progress,
               item.archived_at
          FROM work_item_activity activity
          JOIN work_items item ON item.id = activity.work_item_id
         WHERE activity.created_at >= $1
           AND activity.created_at < $2
         ORDER BY activity.created_at ASC, activity.id ASC
         LIMIT $3
      `, [start, end, safeLimit]);
      return rows.map(hydrate);
    },
  };
}

export const weeklyReview = {
  listBetween: (start: string, end: string, limit?: number) =>
    createWeeklyReviewRepository(database()).listBetween(start, end, limit),
};
