import { insertWorkItem, listWorkItems, patchWorkItem } from '../../../db/work-items';
import { createWorkItemHandlers } from '../../../lib/work-items-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, PATCH } = createWorkItemHandlers({
  insertWorkItem, listWorkItems, patchWorkItem,
});
