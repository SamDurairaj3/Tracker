import { adminNotifications } from '../../../../db/admin-notifications';
import { createAdminNotificationHandlers } from '../../../../lib/admin-notifications-api';
import { identityFromHeaders } from '../../../../lib/auth-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET } = createAdminNotificationHandlers(
  adminNotifications,
  (request) => identityFromHeaders(request.headers),
);
