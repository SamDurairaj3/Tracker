import type { CreateWorkItemInput, WorkItemPatch } from './work-items';
import type { createWorkItemRepository } from '../db/work-items';

type WorkItemApiRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'listWorkItems' | 'insertWorkItem' | 'patchWorkItem'
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

export function createWorkItemHandlers(
  repository: WorkItemApiRepository,
  authenticate: AuthenticateWorkItemRequest,
) {
  const { listWorkItems, insertWorkItem, patchWorkItem } = repository;
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
      const patch = (await request.json()) as WorkItemPatch;
      if (!patch.id) return jsonError('A work-item ID is required.', 400);

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
