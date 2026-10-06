import type {
  CreateWorkItemInput,
  WorkItem,
  WorkItemActivity,
  WorkItemEditInput,
  WorkItemPatch,
} from './work-items';
import type { ManagementNotification } from './management-notifications';

type ListResponse = { items: WorkItem[]; error?: string };
type ItemResponse = { item: WorkItem; error?: string };
type ActivityResponse = { activity: WorkItemActivity[]; error?: string };
type ActivityItemResponse = { activity: WorkItemActivity; error?: string };
type DeleteResponse = { deleted: { id: string }; error?: string };
type ManagementNotificationsResponse = { notifications: ManagementNotification[]; error?: string };

async function parseResponse<T extends { error?: string }>(response: Response) {
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    throw new Error('The server returned an invalid response.');
  }
  if (!response.ok) throw new Error(body.error ?? 'The request failed.');
  return body;
}

export async function fetchWorkItems(includeArchived = false) {
  const query = includeArchived ? '?includeArchived=true' : '';
  const response = await fetch(`/api/work-items${query}`, { cache: 'no-store' });
  return (await parseResponse<ListResponse>(response)).items;
}

export async function createWorkItem(input: CreateWorkItemInput) {
  const response = await fetch('/api/work-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<ItemResponse>(response)).item;
}

export async function updateWorkItem(patch: WorkItemPatch) {
  const response = await fetch('/api/work-items', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return (await parseResponse<ItemResponse>(response)).item;
}

export async function editWorkItem(input: WorkItemEditInput) {
  const response = await fetch('/api/work-items', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<ItemResponse>(response)).item;
}

export async function setWorkItemArchived(id: string, archived: boolean) {
  const response = await fetch('/api/work-items/lifecycle', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, archived }),
  });
  return (await parseResponse<ItemResponse>(response)).item;
}

export async function deleteWorkItem(id: string, confirmation: string) {
  const response = await fetch('/api/work-items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, confirmation }),
  });
  return (await parseResponse<DeleteResponse>(response)).deleted;
}

export async function fetchWorkItemActivity(id: string) {
  const response = await fetch(
    `/api/work-items/activity?id=${encodeURIComponent(id)}`,
    { cache: 'no-store' },
  );
  return (await parseResponse<ActivityResponse>(response)).activity;
}

export async function addWorkItemComment(
  id: string,
  body: string,
  checklistStepId?: string,
) {
  const response = await fetch('/api/work-items/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, body, checklistStepId: checklistStepId || null }),
  });
  return (await parseResponse<ActivityItemResponse>(response)).activity;
}

export async function fetchManagementNotifications(limit = 20) {
  const response = await fetch(
    `/api/admin/notifications?limit=${encodeURIComponent(limit)}`,
    { cache: 'no-store' },
  );
  return (await parseResponse<ManagementNotificationsResponse>(response)).notifications;
}
