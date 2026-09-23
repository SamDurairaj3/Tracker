import { getWorkItem, setWorkItemArchived } from '../../../../db/work-items';
import { identityFromHeaders } from '../../../../lib/auth-session';
import { createWorkItemLifecycleHandlers } from '../../../../lib/work-item-activity-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { PATCH } = createWorkItemLifecycleHandlers(
  { getWorkItem, setWorkItemArchived },
  (request) => identityFromHeaders(request.headers),
);
