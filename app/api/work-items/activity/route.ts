import { addWorkItemComment, listWorkItemActivity } from '../../../../db/work-items';
import { identityFromHeaders } from '../../../../lib/auth-session';
import { createWorkItemActivityHandlers } from '../../../../lib/work-item-activity-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST } = createWorkItemActivityHandlers(
  { addWorkItemComment, listWorkItemActivity },
  (request) => identityFromHeaders(request.headers),
);
