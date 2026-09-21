import { userManagementService } from '../../../../db/user-management';
import { identityFromHeaders } from '../../../../lib/auth-session';
import { createUserManagementHandlers } from '../../../../lib/user-management-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, PATCH } = createUserManagementHandlers(
  userManagementService,
  (request) => identityFromHeaders(request.headers),
);
