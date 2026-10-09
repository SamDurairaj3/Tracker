import { weeklyReview } from '../../../../db/weekly-review';
import { identityFromHeaders } from '../../../../lib/auth-session';
import { createWeeklyReviewHandlers } from '../../../../lib/weekly-review-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET } = createWeeklyReviewHandlers(
  weeklyReview,
  (request) => identityFromHeaders(request.headers),
);
