import { database } from './postgres';
import type { Database } from './database';
import type { WorkItemActivityType } from '../lib/work-items';
import type { ManagementNotification } from '../lib/management-notifications';

type NotificationRow = {
  id: string;
  work_item_id: string;
  work_item_title: string;
  entry_type: WorkItemActivityType;
  author_name: string;
  body: string;
  created_at: string;
};

export function createAdminNotificationRepository(db: Database) {
  return {
    async listRecent(limit = 20): Promise<ManagementNotification[]> {
      const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
      const { rows } = await db.query<NotificationRow>(`
        SELECT activity.id,
               activity.work_item_id,
               item.title AS work_item_title,
               activity.entry_type,
               activity.author_name,
               activity.body,
               activity.created_at
          FROM work_item_activity activity
          JOIN work_items item ON item.id = activity.work_item_id
         ORDER BY activity.created_at DESC, activity.id DESC
         LIMIT $1
      `, [safeLimit]);
      return rows.map((row) => ({
        id: row.id,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        type: row.entry_type,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at,
      }));
    },
  };
}

export const adminNotifications = {
  listRecent: (limit?: number) => createAdminNotificationRepository(database()).listRecent(limit),
};
