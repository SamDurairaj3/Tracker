import {
  deleteWorkItem,
  editWorkItem,
  getWorkItem,
  insertWorkItem,
  listWorkItems,
  patchWorkItem,
} from '../../../db/work-items';
import { identityFromHeaders } from '../../../lib/auth-session';
import { createWorkItemHandlers } from '../../../lib/work-items-api';
import { workItemNotifier } from '../../../lib/work-item-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, PATCH, PUT, DELETE } = createWorkItemHandlers(
  {
    deleteWorkItem,
    editWorkItem,
    getWorkItem,
    insertWorkItem,
    listWorkItems,
    patchWorkItem,
  },
  (request) => identityFromHeaders(request.headers),
  workItemNotifier,
);
