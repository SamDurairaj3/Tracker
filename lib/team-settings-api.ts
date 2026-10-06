import {
  TeamSettingsError,
  type createTeamSettingsRepository,
} from '../db/team-settings';
import type { AuthenticateWorkItemRequest } from './work-items-api';
import {
  NO_STORE_HEADERS,
  authorizeWorkItemRequest,
  jsonError,
  readJson,
  validateMutationRequest,
} from './work-items-api';

type Operations = Pick<
  ReturnType<typeof createTeamSettingsRepository>,
  'listTeams' | 'createTeam' | 'updateTeam' | 'deleteTeam'
>;

function idFrom(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function createTeamSettingsHandlers(
  operations: Operations,
  authenticate: AuthenticateWorkItemRequest,
) {
  async function access(request: Request) {
    const authorization = await authorizeWorkItemRequest(request, authenticate);
    if (!authorization.ok) return authorization;
    if (authorization.actor.role !== 'admin') {
      return { ok: false as const, response: jsonError('Administrator access required.', 403) };
    }
    return authorization;
  }

  function failure(error: unknown) {
    if (error instanceof TeamSettingsError) return jsonError(error.message, error.status);
    console.error('Team settings request failed', error);
    return jsonError('Team settings are temporarily unavailable.', 500);
  }

  async function mutationBody(request: Request) {
    const rejected = validateMutationRequest(request);
    if (rejected) return { ok: false as const, response: rejected };
    return readJson(request);
  }

  return {
    async GET(request: Request) {
      const authorization = await access(request);
      if (!authorization.ok) return authorization.response;
      try {
        return Response.json({ teams: await operations.listTeams() }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        return failure(error);
      }
    },

    async POST(request: Request) {
      const authorization = await access(request);
      if (!authorization.ok) return authorization.response;
      const payload = await mutationBody(request);
      if (!payload.ok) return payload.response;
      const value = payload.value && typeof payload.value === 'object' && !Array.isArray(payload.value)
        ? payload.value as Record<string, unknown>
        : null;
      if (!value) return jsonError('A team name is required.', 400);
      try {
        return Response.json(
          { team: await operations.createTeam(value.name) },
          { status: 201, headers: NO_STORE_HEADERS },
        );
      } catch (error) {
        return failure(error);
      }
    },

    async PATCH(request: Request) {
      const authorization = await access(request);
      if (!authorization.ok) return authorization.response;
      const payload = await mutationBody(request);
      if (!payload.ok) return payload.response;
      const value = payload.value && typeof payload.value === 'object' && !Array.isArray(payload.value)
        ? payload.value as Record<string, unknown>
        : null;
      const id = value ? idFrom(value.id) : null;
      if (!value || !id) return jsonError('A valid team is required.', 400);
      try {
        return Response.json({
          team: await operations.updateTeam(id, {
            ...(Object.prototype.hasOwnProperty.call(value, 'name') ? { name: value.name } : {}),
            ...(Object.prototype.hasOwnProperty.call(value, 'active') ? { active: value.active } : {}),
          }),
        }, { headers: NO_STORE_HEADERS });
      } catch (error) {
        return failure(error);
      }
    },

    async DELETE(request: Request) {
      const authorization = await access(request);
      if (!authorization.ok) return authorization.response;
      const payload = await mutationBody(request);
      if (!payload.ok) return payload.response;
      const value = payload.value && typeof payload.value === 'object' && !Array.isArray(payload.value)
        ? payload.value as Record<string, unknown>
        : null;
      const id = value ? idFrom(value.id) : null;
      if (!id) return jsonError('A valid team is required.', 400);
      try {
        return Response.json(
          { deleted: await operations.deleteTeam(id) },
          { headers: NO_STORE_HEADERS },
        );
      } catch (error) {
        return failure(error);
      }
    },
  };
}
