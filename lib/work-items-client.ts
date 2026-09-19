import type {
  CreateWorkItemInput,
  WorkItem,
  WorkItemPatch,
} from './work-items';

type ListResponse = { items: WorkItem[]; error?: string };
type ItemResponse = { item: WorkItem; error?: string };

async function parseResponse<T extends { error?: string }>(response: Response) {
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(body.error ?? 'The request failed.');
  return body;
}

export async function fetchWorkItems() {
  const response = await fetch('/api/work-items', { cache: 'no-store' });
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
