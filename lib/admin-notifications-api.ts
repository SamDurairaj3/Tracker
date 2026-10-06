import type { createAdminNotificationRepository } from '../db/admin-notifications';
import type { AuthenticateWorkItemRequest } from './work-items-api';
import { NO_STORE_HEADERS, authorizeWorkItemRequest, jsonError } from './work-items-api';

type Operations = Pick<ReturnType<typeof createAdminNotificationRepository>, 'listRecent'>;

export function createAdminNotificationHandlers(
  operations: Operations,
  authenticate: AuthenticateWorkItemRequest,
) {
  return {
    async GET(request: Request) {
      const authorization = await authorizeWorkItemRequest(request, authenticate);
      if (!authorization.ok) return authorization.response;
      if (authorization.actor.role !== 'admin') {
        return jsonError('Administrator access required.', 403);
      }
      const requested = Number(new URL(request.url).searchParams.get('limit') ?? 20);
      const limit = Number.isFinite(requested) ? requested : 20;
      try {
        return Response.json(
          { notifications: await operations.listRecent(limit) },
          { headers: NO_STORE_HEADERS },
        );
      } catch (error) {
        console.error('Unable to list management notifications', error);
        return jsonError('Management notifications could not be loaded.', 500);
      }
    },
  };
}
