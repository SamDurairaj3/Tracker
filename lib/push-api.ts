import type { WorkItemActor } from '../db/work-items';
import type { PushSubscriptionInput } from '../db/push-subscriptions';
import type { VapidConfig } from './push-config';
import type { AuthenticateWorkItemRequest } from './work-items-api';
import {
  NO_STORE_HEADERS,
  authorizeWorkItemRequest,
  jsonError,
  readJson,
  validateMutationRequest,
} from './work-items-api';

type PushRepository = {
  upsert(userId: string, input: PushSubscriptionInput): Promise<void>;
  remove(userId: string, endpoint: string): Promise<void>;
};

function base64Url(value: unknown, expectedBytes: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === expectedBytes ? value : null;
}

function validEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' ? endpoint.toString() : null;
  } catch {
    return null;
  }
}

export function validatePushSubscription(value: unknown, userAgent: string | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const endpoint = validEndpoint(candidate.endpoint);
  const keys = candidate.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null;
  const keyRecord = keys as Record<string, unknown>;
  const p256dh = base64Url(keyRecord.p256dh, 65);
  const authSecret = base64Url(keyRecord.auth, 16);
  const expirationTime = candidate.expirationTime;
  if (
    !endpoint
    || !p256dh
    || Buffer.from(p256dh, 'base64url')[0] !== 0x04
    || !authSecret
    || (expirationTime !== null && expirationTime !== undefined
      && (typeof expirationTime !== 'number' || !Number.isFinite(expirationTime)))
  ) return null;
  return {
    endpoint,
    p256dh,
    authSecret,
    expirationTime: typeof expirationTime === 'number' ? Math.round(expirationTime) : null,
    userAgent: userAgent?.slice(0, 500) || null,
  } satisfies PushSubscriptionInput;
}

export function createPushHandlers(
  repository: PushRepository,
  authenticate: AuthenticateWorkItemRequest,
  getConfig: () => VapidConfig,
) {
  async function GET(request: Request) {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    try {
      return Response.json(
        { configured: true, publicKey: getConfig().publicKey },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      console.error('Web Push is not configured', error);
      return Response.json(
        { configured: false, publicKey: null },
        { headers: NO_STORE_HEADERS },
      );
    }
  }

  async function POST(request: Request) {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    if (!access.actor.id) return jsonError('Push notifications require a user account.', 403);
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const input = validatePushSubscription(body.value, request.headers.get('user-agent'));
    if (!input) return jsonError('A valid push subscription is required.', 400);
    try {
      getConfig();
      await repository.upsert(access.actor.id, input);
      return Response.json({ subscribed: true }, { status: 201, headers: NO_STORE_HEADERS });
    } catch (error) {
      console.error('Unable to save push subscription', error);
      return jsonError('Push notifications could not be enabled.', 500);
    }
  }

  async function DELETE(request: Request) {
    const access = await authorizeWorkItemRequest(request, authenticate);
    if (!access.ok) return access.response;
    if (!access.actor.id) return jsonError('Push notifications require a user account.', 403);
    const invalidRequest = validateMutationRequest(request);
    if (invalidRequest) return invalidRequest;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const endpoint = body.value && typeof body.value === 'object' && !Array.isArray(body.value)
      ? validEndpoint((body.value as Record<string, unknown>).endpoint)
      : null;
    if (!endpoint) return jsonError('A valid push endpoint is required.', 400);
    try {
      await repository.remove(access.actor.id, endpoint);
      return Response.json({ subscribed: false }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      console.error('Unable to remove push subscription', error);
      return jsonError('Push notifications could not be disabled.', 500);
    }
  }

  return { GET, POST, DELETE };
}

export type PushActor = WorkItemActor;
