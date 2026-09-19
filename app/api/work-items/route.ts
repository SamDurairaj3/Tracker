import { getWorkItem, insertWorkItem, listWorkItems, patchWorkItem } from '../../../db/work-items';
import { identityFromHeaders } from '../../../lib/auth-session';
import { createWorkItemHandlers } from '../../../lib/work-items-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, PATCH } = createWorkItemHandlers(
  { getWorkItem, insertWorkItem, listWorkItems, patchWorkItem },
  (request) => identityFromHeaders(request.headers),
);
