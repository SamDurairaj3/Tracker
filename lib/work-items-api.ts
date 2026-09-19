import type { CreateWorkItemInput, WorkItemPatch } from './work-items';
import {
  isChecklistStatus,
  isWorkHealth,
  isWorkStatus,
} from './work-items';
import type { createWorkItemRepository } from '../db/work-items';

type WorkItemApiRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'listWorkItems' | 'getWorkItem' | 'insertWorkItem' | 'patchWorkItem'
>;

type WorkItemActor = {
  name: string;
  role: string;
};

type AuthenticateWorkItemRequest = (
  request: Request,
) => Promise<WorkItemActor | null>;

export const AUTHENTICATION_REQUIRED = 'Authentication required.';
export const ACCESS_DENIED = 'Access denied.';

function own(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function validateWorkItemPatch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'A valid work-item update is required.' } as const;
  }
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return { error: 'A work-item ID is required.' } as const;
  }

  const patch: WorkItemPatch = { id: input.id.trim() };
  let changes = 0;

  if (own(input, 'status')) {
    if (!isWorkStatus(input.status)) return { error: 'Invalid workflow status.' } as const;
    patch.status = input.status;
    changes += 1;
  }
  if (own(input, 'health')) {
    if (!isWorkHealth(input.health)) return { error: 'Invalid work health.' } as const;
    patch.health = input.health;
    changes += 1;
  }
  if (own(input, 'progress')) {
    if (typeof input.progress !== 'number' || !Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100) {
      return { error: 'Progress must be a number from 0 to 100.' } as const;
    }
    patch.progress = input.progress;
    changes += 1;
  }
  if (own(input, 'blocker')) {
    if (input.blocker !== null && typeof input.blocker !== 'string') {
      return { error: 'Blocker must be text or null.' } as const;
    }
    patch.blocker = input.blocker as string | null;
    changes += 1;
  }
  if (own(input, 'checklistStep')) {
    if (!input.checklistStep || typeof input.checklistStep !== 'object' || Array.isArray(input.checklistStep)) {
      return { error: 'A valid checklist update is required.' } as const;
    }
    const step = input.checklistStep as Record<string, unknown>;
    if (typeof step.id !== 'string' || !step.id.trim() || !isChecklistStatus(step.status)) {
      return { error: 'A valid checklist action and status are required.' } as const;
    }
    patch.checklistStep = { id: step.id.trim(), status: step.status };
    changes += 1;
  }

  if (!changes) return { error: 'No supported work-item changes were supplied.' } as const;
  return { patch } as const;
}

export function createWorkItemHandlers(
  repository: WorkItemApiRepository,
  authenticate: AuthenticateWorkItemRequest,
) {
  const { listWorkItems, getWorkItem, insertWorkItem, patchWorkItem } = repository;
  function jsonError(message: string, status: number) {
    return Response.json({ error: message }, {
      status,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }

  async function authorize(request: Request) {
    try {
      const actor = await authenticate(request);
      if (!actor) return { ok: false, response: jsonError(AUTHENTICATION_REQUIRED, 401) } as const;
      if (actor.role !== 'admin' && actor.role !== 'engineer') {
        return { ok: false, response: jsonError(ACCESS_DENIED, 403) } as const;
      }
      return { ok: true, actor } as const;
    } catch (error) {
      console.error('Unable to verify authentication', error);
      return { ok: false, response: jsonError(AUTHENTICATION_REQUIRED, 401) } as const;
    }
  }

  async function GET(request: Request) {
    const access = await authorize(request);
    if (!access.ok) return access.response;
    try {
      return Response.json(
        { items: await listWorkItems() },
        { headers: { 'Cache-Control': 'no-store, private' } },
      );
    } catch (error) {
      console.error('Unable to list work items', error);
      return jsonError('Work items could not be loaded.', 500);
    }
  }

  async function POST(request: Request) {
    const access = await authorize(request);
    if (!access.ok) return access.response;
    try {
      const input = (await request.json()) as CreateWorkItemInput;
      if (
        !input.title?.trim() ||
        !input.team ||
        !input.owner ||
        !input.purpose?.trim() ||
        !input.expectedResult?.trim() ||
        !input.start ||
        !input.due
      ) {
        return jsonError('Complete the required work-item fields.', 400);
      }
      if (input.due < input.start) {
        return jsonError('Due date must be on or after the start date.', 400);
      }

      const item = await insertWorkItem({
        ...input,
        createdBy: access.actor.name,
      });
      return Response.json(
        { item },
        { status: 201, headers: { 'Cache-Control': 'no-store, private' } },
      );
    } catch (error) {
      console.error('Unable to create work item', error);
      return jsonError('The work item could not be created.', 500);
    }
  }

  async function PATCH(request: Request) {
    const access = await authorize(request);
    if (!access.ok) return access.response;
    try {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return jsonError('A valid work-item update is required.', 400);
      }
      const parsed = validateWorkItemPatch(payload);
      if ('error' in parsed) return jsonError(parsed.error ?? 'Invalid work-item update.', 400);
      const { patch } = parsed;
      const existing = await getWorkItem(patch.id);
      if (!existing) return jsonError('Work item not found.', 404);

      const changesCard = patch.status !== undefined || patch.health !== undefined ||
        patch.progress !== undefined || patch.blocker !== undefined;
      if (
        access.actor.role === 'engineer' &&
        changesCard &&
        existing.owner !== access.actor.name
      ) {
        return jsonError(ACCESS_DENIED, 403);
      }

      if (patch.checklistStep) {
        const step = existing.checklist.find((candidate) => candidate.id === patch.checklistStep?.id);
        if (!step) return jsonError('Checklist action not found.', 404);
        if (access.actor.role === 'engineer' && step.assignee !== access.actor.name) {
          return jsonError(ACCESS_DENIED, 403);
        }
      }

      const item = await patchWorkItem(patch);
      if (!item) return jsonError('Work item not found.', 404);
      return Response.json(
        { item },
        { headers: { 'Cache-Control': 'no-store, private' } },
      );
    } catch (error) {
      console.error('Unable to update work item', error);
      return jsonError('The work item could not be updated.', 500);
    }
  }

  return { GET, POST, PATCH };
}
