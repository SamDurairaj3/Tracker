import type { WorkItemActivityType } from './work-items';

export type ManagementNotification = {
  id: string;
  workItemId: string;
  workItemTitle: string;
  type: WorkItemActivityType;
  authorName: string;
  body: string;
  createdAt: string;
};
