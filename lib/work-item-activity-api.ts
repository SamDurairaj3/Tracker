import type { createWorkItemRepository } from '../db/work-items';
import { canAccessWorkItem } from './work-items';
import type { AuthenticateWorkItemRequest } from './work-items-api';
import {
  ACCESS_DENIED,
  NO_STORE_HEADERS,
  authorizeWorkItemRequest,
  isChecklistStepId,
  isWorkItemId,
  jsonError,
  mutationErrorResponse,
  readJson,
  validateMutationRequest,
} from './work-items-api';

type ActivityRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'getWorkItem' | 'listWorkItemActivity' | 'addWorkItemComment'
>;

type LifecycleRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'getWorkItem' | 'setWorkItemArchived'
>;

export function createWorkItemActivityHandlers(
  repository: ActivityRepository,
  authenticate: AuthenticateWorkItemRequest,
) {
  async function GET(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const id = new URL(request.url).searchParams.get('id');
    if (!isWorkItemId(id)) return jsonError('A valid work-item ID is required.', 400);
    try {
      const item = await repository.getWorkItem(id);
      if (!item) return jsonError('Work item not found.', 404);
      if (!canAccessWorkItem(item, access.actor)) return jsonError(ACCESS_DENIED, 403);
      return Response.json(
        { activity: await repository.listWorkItemActivity(id) },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to list work-item activity', error);
      return jsonError('Activity could not be loaded.', 500);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return jsonError('A valid comment is required.', 400);
    }
    const payload = body.value as Record<string, unknown>;
    if (!isWorkItemId(payload.id)) {
      return jsonError('A valid work-item ID is required.', 400);
    }
    if (
      typeof payload.body !== 'string'
      || payload.body.trim().length < 1
      || payload.body.trim().length > 2000
    ) {
      return jsonError('Comment text must be between 1 and 2000 characters.', 400);
    }
    if (
      payload.checklistStepId !== undefined
      && payload.checklistStepId !== null
      && !isChecklistStepId(payload.checklistStepId)
    ) {
      return jsonError('A valid checklist action ID is required.', 400);
    }
    try {
      const item = await repository.getWorkItem(payload.id);
      if (!item) return jsonError('Work item not found.', 404);
      if (!canAccessWorkItem(item, access.actor)) return jsonError(ACCESS_DENIED, 403);
      const activity = await repository.addWorkItemComment(
        payload.id,
        payload.body.trim(),
        typeof payload.checklistStepId === 'string' ? payload.checklistStepId : null,
        access.actor,
      );
      return Response.json(
        { activity },
        { status: 201, headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to add work-item comment', error);
      return jsonError('The comment could not be saved.', 500);
    }
  }

  return { GET, POST };
}

export function createWorkItemLifecycleHandlers(
  repository: LifecycleRepository,
  authenticate: AuthenticateWorkItemRequest,
) {
  async function PATCH(request: Request): Promise<Response> {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return jsonError('A valid lifecycle update is required.', 400);
    }
    const payload = body.value as Record<string, unknown>;
    if (!isWorkItemId(payload.id) || typeof payload.archived !== 'boolean') {
      return jsonError('A valid work-item ID and archive state are required.', 400);
    }

    try {
      const existing = await repository.getWorkItem(payload.id);
      if (!existing) return jsonError('Work item not found.', 404);
      if (
        access.actor.role !== 'admin'
        && existing.owner !== access.actor.name
      ) {
        return jsonError(ACCESS_DENIED, 403);
      }
      const item = await repository.setWorkItemArchived(
        payload.id,
        payload.archived,
        access.actor,
      );
      return Response.json({ item }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      const known = mutationErrorResponse(error);
      if (known) return known;
      console.error('Unable to update work-item lifecycle', error);
      return jsonError('The work item lifecycle could not be updated.', 500);
    }
  }

  return { PATCH };
}
