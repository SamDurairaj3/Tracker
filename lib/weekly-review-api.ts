import type { createWeeklyReviewRepository } from '../db/weekly-review';
import type { AuthenticateWorkItemRequest } from './work-items-api';
import { NO_STORE_HEADERS, authorizeWorkItemRequest, jsonError } from './work-items-api';
import { isoWeekRange } from './weekly-review';

type Operations = Pick<ReturnType<typeof createWeeklyReviewRepository>, 'listBetween'>;

export function createWeeklyReviewHandlers(
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

      const url = new URL(request.url);
      const week = url.searchParams.get('week') ?? '';
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const range = isoWeekRange(week, offset);
      if (!range) return jsonError('Select a valid ISO week.', 400);

      try {
        const result = await operations.listBetween(range.start, range.end, 2001);
        return Response.json({
          review: {
            week,
            ...range,
            events: result.slice(0, 2000),
            truncated: result.length > 2000,
          },
        }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        console.error('Unable to load weekly integration review', error);
        return jsonError('The weekly integration review could not be loaded.', 500);
      }
    },
  };
}
