import type {
  CreateWorkItemInput,
  WorkItem,
  WorkItemEditInput,
  WorkItemPatch,
} from './work-items';
import {
  TEAMS,
  canAccessWorkItem,
  isChecklistStatus,
  isWorkHealth,
  isWorkStatus,
} from './work-items';
import type { createWorkItemRepository, WorkItemActor } from '../db/work-items';
import { parseLocalDate } from './local-time';
import { WorkItemMutationError } from '../db/work-items';

type WorkItemApiRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'listWorkItems' | 'getWorkItem' | 'insertWorkItem' | 'patchWorkItem'
> & Partial<Pick<
  ReturnType<typeof createWorkItemRepository>,
  'editWorkItem' | 'deleteWorkItem'
>>;

export type AuthenticateWorkItemRequest = (
  request: Request,
) => Promise<WorkItemActor | null>;

export type WorkItemMutationNotifications = {
  created(item: WorkItem, actor: WorkItemActor): Promise<void>;
  updated(before: WorkItem, after: WorkItem, actor: WorkItemActor): Promise<void>;
};

export const AUTHENTICATION_REQUIRED = 'Authentication required.';
export const ACCESS_DENIED = 'Access denied.';
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, private' };

const priorities = ['Critical', 'High', 'Medium'] as const;
const workTypes = ['Task', 'Experiment', 'Investigation', 'Review'] as const;
const progressMethods = [
  'status-only',
  'zero-or-hundred',
  'checklist-count',
  'weighted-checklist',
  'quantity',
  'manual-estimate',
] as const;

function own(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function authorizeWorkItemRequest(
  request: Request,
  authenticate: AuthenticateWorkItemRequest,
) {
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

function firstHeaderValue(value: string | null) {
  return value?.split(',', 1)[0]?.trim() ?? '';
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const expectedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
      || firstHeaderValue(request.headers.get('host'))
      || requestUrl.host;
    const expectedProtocol = (
      firstHeaderValue(request.headers.get('x-forwarded-proto'))
      || requestUrl.protocol.slice(0, -1)
    ).toLowerCase();
    if (!expectedHost || (expectedProtocol !== 'http' && expectedProtocol !== 'https')) {
      return false;
    }
    const expectedOrigin = new URL(`${expectedProtocol}://${expectedHost}`).origin;
    return new URL(origin).origin.toLowerCase() === expectedOrigin.toLowerCase();
  } catch {
    return false;
  }
}

export function validateMutationRequest(request: Request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return jsonError('Content-Type must be application/json.', 415);
  }
  if (!isSameOrigin(request)) return jsonError(ACCESS_DENIED, 403);
  return null;
}

export async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonError('A valid JSON body is required.', 400),
    };
  }
}

export function mutationErrorResponse(error: unknown) {
  if (!(error instanceof WorkItemMutationError)) return null;
  const status = {
    'not-found': 404,
    forbidden: 403,
    archived: 409,
    invalid: 400,
    conflict: 409,
  }[error.code];
  return jsonError(error.message, status);
}

export function isWorkItemId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 100
    && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isChecklistStepId(value: unknown): value is string {
  return isUuid(value)
    || (typeof value === 'string'
      && value.length <= 100
      && /^STEP-[A-Za-z0-9-]+$/.test(value));
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && parseLocalDate(value) !== null;
}

function optionalDate(value: unknown) {
  if (value === undefined || value === null) return { valid: true, value: null } as const;
  if (typeof value !== 'string') return { valid: false } as const;
  const normalized = value.trim();
  if (!normalized) return { valid: true, value: null } as const;
  if (!validDate(normalized)) return { valid: false } as const;
  return { valid: true, value: normalized } as const;
}

function requiredText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function validateChecklistInput(value: unknown, allowIds: boolean) {
  if (!Array.isArray(value) || value.length > 100) return null;
  const checklist: WorkItemEditInput['checklist'] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const step = candidate as Record<string, unknown>;
    if (!requiredText(step.title, 500)) {
      if (!allowIds && typeof step.title === 'string' && !step.title.trim()) continue;
      return null;
    }
    if (!requiredText(step.assignee, 200)) return null;
    const due = optionalDate(step.due);
    if (!due.valid) return null;
    if (step.weight !== undefined && (
      typeof step.weight !== 'number'
      || !Number.isInteger(step.weight)
      || step.weight < 1
      || step.weight > 100
    )) return null;
    if (step.id !== undefined && (!allowIds || !isChecklistStepId(step.id))) return null;
    checklist.push({
      ...(typeof step.id === 'string' ? { id: step.id } : {}),
      title: step.title.trim(),
      assignee: step.assignee.trim(),
      due: due.value,
      ...(typeof step.weight === 'number' ? { weight: step.weight } : {}),
    });
  }
  return checklist;
}

export function validateCreateWorkItem(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Complete the required work-item fields.' } as const;
  }
  const input = value as Record<string, unknown>;
  const checklist = validateChecklistInput(input.checklist, false);
  if (
    !requiredText(input.title, 500)
    || !oneOf(input.team, TEAMS)
    || !requiredText(input.owner, 200)
    || (input.status !== 'captured' && input.status !== 'ready')
    || !oneOf(input.priority, priorities)
    || !validDate(input.start)
    || !validDate(input.due)
    || !oneOf(input.type, workTypes)
    || !requiredText(input.purpose, 4000)
    || !requiredText(input.expectedResult, 4000)
    || !oneOf(input.progressMethod, progressMethods)
    || checklist === null
    || (input.linkedGoal !== undefined && typeof input.linkedGoal !== 'string')
  ) {
    return { error: 'Complete the required work-item fields.' } as const;
  }
  if (input.due < input.start) {
    return { error: 'Due date must be on or after the start date.' } as const;
  }
  return {
    input: {
      title: input.title.trim(),
      team: input.team,
      owner: input.owner.trim(),
      status: input.status,
      priority: input.priority,
      start: input.start,
      due: input.due,
      createdBy: '',
      type: input.type,
      purpose: input.purpose.trim(),
      expectedResult: input.expectedResult.trim(),
      linkedGoal: typeof input.linkedGoal === 'string' ? input.linkedGoal.trim() : undefined,
      progressMethod: input.progressMethod,
      checklist,
    } satisfies CreateWorkItemInput,
  } as const;
}

export function validateWorkItemEdit(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'A valid work-item edit is required.' } as const;
  }
  const input = value as Record<string, unknown>;
  const checklist = validateChecklistInput(input.checklist, true);
  if (
    !isWorkItemId(input.id)
    || !requiredText(input.title, 500)
    || !oneOf(input.type, workTypes)
    || !oneOf(input.team, TEAMS)
    || !requiredText(input.owner, 200)
    || !oneOf(input.priority, priorities)
    || !requiredText(input.purpose, 4000)
    || !requiredText(input.expectedResult, 4000)
    || !validDate(input.start)
    || !validDate(input.due)
    || !oneOf(input.progressMethod, progressMethods)
    || checklist === null
    || (input.linkedGoal !== undefined && typeof input.linkedGoal !== 'string')
    || (input.progress !== undefined && (
      typeof input.progress !== 'number'
      || !Number.isFinite(input.progress)
      || input.progress < 0
      || input.progress > 100
    ))
  ) {
    return { error: 'Complete every required edit field with valid values.' } as const;
  }
  if (input.due < input.start) {
    return { error: 'Due date must be on or after the start date.' } as const;
  }
  return {
    input: {
      id: input.id,
      title: input.title.trim(),
      type: input.type,
      team: input.team,
      owner: input.owner.trim(),
      priority: input.priority,
      purpose: input.purpose.trim(),
      expectedResult: input.expectedResult.trim(),
      linkedGoal: typeof input.linkedGoal === 'string' ? input.linkedGoal.trim() : undefined,
      start: input.start,
      due: input.due,
      progressMethod: input.progressMethod,
      ...(typeof input.progress === 'number' ? { progress: input.progress } : {}),
      checklist,
    } satisfies WorkItemEditInput,
  } as const;
}

export function validateWorkItemPatch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'A valid work-item update is required.' } as const;
  }
  const input = value as Record<string, unknown>;
  if (!isWorkItemId(input.id)) {
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
    if (input.blocker !== null && (typeof input.blocker !== 'string' || input.blocker.length > 4000)) {
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
  notifications?: WorkItemMutationNotifications,
) {
  async function GET(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    try {
      const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
      const items = await repository.listWorkItems(includeArchived);
      return Response.json(
        {
          items: access.actor.role === 'admin'
            ? items
            : items.filter((item) => canAccessWorkItem(item, access.actor)),
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      console.error('Unable to list work items', error);
      return jsonError('Work items could not be loaded.', 500);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = validateCreateWorkItem(body.value);
    if ('error' in parsed) return jsonError(parsed.error ?? 'Invalid work-item input.', 400);

    try {
      const item = await repository.insertWorkItem(parsed.input, access.actor);
      await notifications?.created(item, access.actor);
      return Response.json({ item }, { status: 201, headers: NO_STORE_HEADERS });
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to create work item', error);
      return jsonError('The work item could not be created.', 500);
    }
  }

  async function PATCH(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = validateWorkItemPatch(body.value);
    if ('error' in parsed) return jsonError(parsed.error ?? 'Invalid work-item input.', 400);

    try {
      const existing = await repository.getWorkItem(parsed.patch.id);
      if (!existing) return jsonError('Work item not found.', 404);
      const changesCard = parsed.patch.status !== undefined
        || parsed.patch.health !== undefined
        || parsed.patch.progress !== undefined
        || parsed.patch.blocker !== undefined;
      if (
        access.actor.role === 'engineer'
        && changesCard
        && existing.owner !== access.actor.name
      ) {
        return jsonError(ACCESS_DENIED, 403);
      }
      if (parsed.patch.checklistStep) {
        const step = existing.checklist.find(
          (candidate) => candidate.id === parsed.patch.checklistStep?.id,
        );
        if (!step) return jsonError('Checklist action not found.', 404);
        if (access.actor.role === 'engineer' && step.assignee !== access.actor.name) {
          return jsonError(ACCESS_DENIED, 403);
        }
      }

      const item = await repository.patchWorkItem(parsed.patch, access.actor);
      if (!item) return jsonError('Work item not found.', 404);
      if (item.updatedAt !== existing.updatedAt) {
        await notifications?.updated(existing, item, access.actor);
      }
      return Response.json({ item }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to update work item', error);
      return jsonError('The work item could not be updated.', 500);
    }
  }

  async function PUT(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = validateWorkItemEdit(body.value);
    if ('error' in parsed) return jsonError(parsed.error ?? 'Invalid work-item input.', 400);

    try {
      const existing = await repository.getWorkItem(parsed.input.id);
      if (!existing) return jsonError('Work item not found.', 404);
      if (
        access.actor.role !== 'admin'
        && existing.owner !== access.actor.name
      ) {
        return jsonError(ACCESS_DENIED, 403);
      }
      if (!repository.editWorkItem) {
        return jsonError('The work item could not be edited.', 500);
      }
      const item = await repository.editWorkItem(parsed.input, access.actor);
      if (item.updatedAt !== existing.updatedAt) {
        await notifications?.updated(existing, item, access.actor);
      }
      return Response.json({ item }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to edit work item', error);
      return jsonError('The work item could not be edited.', 500);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    if (access.actor.role !== 'admin') return jsonError(ACCESS_DENIED, 403);
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const payload = body.value as Record<string, unknown>;
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)
      || !isWorkItemId(payload.id) || typeof payload.confirmation !== 'string') {
      return jsonError('A work-item ID and confirmation are required.', 400);
    }
    try {
      if (!repository.deleteWorkItem) {
        return jsonError('The work item could not be deleted.', 500);
      }
      const deleted = await repository.deleteWorkItem(
        payload.id,
        payload.confirmation,
        access.actor,
      );
      return Response.json({ deleted }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to delete work item', error);
      return jsonError('The work item could not be deleted.', 500);
    }
  }

  return { GET, POST, PATCH, PUT, DELETE };
}
