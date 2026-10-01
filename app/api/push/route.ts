import { pushSubscriptions } from '../../../db/push-subscriptions';
import { identityFromHeaders } from '../../../lib/auth-session';
import { createPushHandlers } from '../../../lib/push-api';
import { readVapidConfig } from '../../../lib/push-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, DELETE } = createPushHandlers(
  pushSubscriptions,
  (request) => identityFromHeaders(request.headers),
  () => readVapidConfig(),
);
