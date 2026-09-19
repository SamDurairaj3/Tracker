import type { CreateWorkItemInput, WorkItemPatch } from './work-items';
import type { createWorkItemRepository } from '../db/work-items';

type WorkItemApiRepository = Pick<
  ReturnType<typeof createWorkItemRepository>,
  'listWorkItems' | 'insertWorkItem' | 'patchWorkItem'
>;

export function createWorkItemHandlers(repository: WorkItemApiRepository) {
  const { listWorkItems, insertWorkItem, patchWorkItem } = repository;
  function jsonError(message: string, status: number) {
    return Response.json({ error: message }, { status });
  }

  async function GET() {
    try {
      return Response.json({ items: await listWorkItems() });
    } catch (error) {
      console.error('Unable to list work items', error);
      return jsonError('Work items could not be loaded.', 500);
    }
  }

  async function POST(request: Request) {
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

      const item = await insertWorkItem(input);
      return Response.json({ item }, { status: 201 });
    } catch (error) {
      console.error('Unable to create work item', error);
      return jsonError('The work item could not be created.', 500);
    }
  }

  async function PATCH(request: Request) {
    try {
      const patch = (await request.json()) as WorkItemPatch;
      if (!patch.id) return jsonError('A work-item ID is required.', 400);

      const item = await patchWorkItem(patch);
      if (!item) return jsonError('Work item not found.', 404);
      return Response.json({ item });
    } catch (error) {
      console.error('Unable to update work item', error);
      return jsonError('The work item could not be updated.', 500);
    }
  }

  return { GET, POST, PATCH };
}
