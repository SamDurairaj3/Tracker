import type { AuthRole } from './auth-config';
import {
  UserManagementError,
  parseCreateManagedUser,
  parseManagedUserMutation,
  type createUserManagementService,
} from '../db/user-management';

type UserManagementOperations = Pick<
  ReturnType<typeof createUserManagementService>,
  'listUsers' | 'createUser' | 'updateProfile' | 'resetPassword' | 'setDisabled'
>;

type UserManagementActor = {
  id: string;
  role: AuthRole | string;
};

type AuthenticateUserManagementRequest = (
  request: Request,
) => Promise<UserManagementActor | null>;

export const USER_MANAGEMENT_AUTH_REQUIRED = 'Authentication required.';
export const USER_MANAGEMENT_ACCESS_DENIED = 'Administrator access required.';

function firstHeaderValue(value: string | null) {
  return value?.split(',', 1)[0]?.trim() ?? '';
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const expectedHost = firstHeaderValue(request.headers.get('x-forwarded-host')) ||
      firstHeaderValue(request.headers.get('host')) || requestUrl.host;
    const expectedProtocol = firstHeaderValue(request.headers.get('x-forwarded-proto')) ||
      requestUrl.protocol.slice(0, -1);
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === expectedHost.toLowerCase() &&
      originUrl.protocol.toLowerCase() === `${expectedProtocol.toLowerCase()}:`;
  } catch {
    return false;
  }
}

function isJson(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
    'application/json';
}

export function createUserManagementHandlers(
  operations: UserManagementOperations,
  authenticate: AuthenticateUserManagementRequest,
) {
  const responseHeaders = {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
  };

  function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: responseHeaders });
  }

  async function authorize(request: Request): Promise<
    { ok: false; response: Response } | { ok: true; actor: UserManagementActor }
  > {
    let actor: UserManagementActor | null;
    try {
      actor = await authenticate(request);
    } catch {
      console.error('User management authentication failed.');
      return { ok: false, response: json({ error: 'User management is temporarily unavailable.' }, 500) };
    }
    if (!actor) return { ok: false, response: json({ error: USER_MANAGEMENT_AUTH_REQUIRED }, 401) };
    if (actor.role !== 'admin') {
      return { ok: false, response: json({ error: USER_MANAGEMENT_ACCESS_DENIED }, 403) };
    }
    return { ok: true, actor };
  }

  function mutationGate(request: Request) {
    if (!isSameOrigin(request)) return json({ error: 'A same-origin request is required.' }, 403);
    if (!isJson(request)) return json({ error: 'Content-Type must be application/json.' }, 415);
    return null;
  }

  async function body(request: Request): Promise<
    { ok: false; response: Response } | { ok: true; value: unknown }
  > {
    try {
      return { ok: true, value: await request.json() };
    } catch {
      return { ok: false, response: json({ error: 'A valid JSON object is required.' }, 400) };
    }
  }

  function failure(error: unknown): Response {
    if (error instanceof UserManagementError) return json({ error: error.message }, error.status);
    console.error('User management request failed.');
    return json({ error: 'User management is temporarily unavailable.' }, 500);
  }

  return {
    async GET(request: Request): Promise<Response> {
      const access = await authorize(request);
      if (!access.ok) return access.response;
      try {
        return json({ users: await operations.listUsers() });
      } catch (error) {
        return failure(error);
      }
    },

    async POST(request: Request): Promise<Response> {
      const access = await authorize(request);
      if (!access.ok) return access.response;
      const rejected = mutationGate(request);
      if (rejected) return rejected;
      const payload = await body(request);
      if (!payload.ok) return payload.response;
      try {
        const user = await operations.createUser(parseCreateManagedUser(payload.value));
        return json({ user, signOutCurrent: false }, 201);
      } catch (error) {
        return failure(error);
      }
    },

    async PATCH(request: Request): Promise<Response> {
      const access = await authorize(request);
      if (!access.ok) return access.response;
      const rejected = mutationGate(request);
      if (rejected) return rejected;
      const payload = await body(request);
      if (!payload.ok) return payload.response;
      try {
        const mutation = parseManagedUserMutation(payload.value);
        const result = mutation.action === 'profile'
          ? await operations.updateProfile(mutation, access.actor.id)
          : mutation.action === 'password'
            ? await operations.resetPassword(mutation, access.actor.id)
            : await operations.setDisabled(mutation, access.actor.id);
        return json(result);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
