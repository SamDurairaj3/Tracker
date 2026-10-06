import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from './database';
import { database } from './postgres';

export type ManagedTeam = {
  id: string;
  name: string;
  position: number;
  active: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type TeamRow = {
  id: string;
  name: string;
  position: number;
  active: boolean;
  usage_count: number | string;
  created_at: string;
  updated_at: string;
};

export class TeamSettingsError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'TeamSettingsError';
  }
}

export function normalizeTeamName(value: unknown) {
  if (typeof value !== 'string') throw new TeamSettingsError('Enter a team name.', 400);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) {
    throw new TeamSettingsError('Team names must contain 1 to 80 characters.', 400);
  }
  return name;
}

function hydrate(row: TeamRow): ManagedTeam {
  return {
    id: row.id,
    name: row.name,
    position: Number(row.position),
    active: row.active,
    usageCount: Number(row.usage_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function teamById(client: Queryable, id: string, lock = false) {
  const { rows } = await client.query<TeamRow>(`
    SELECT team.*,
           (SELECT COUNT(*)::integer FROM work_items item
             WHERE lower(item.team) = lower(team.name)) AS usage_count
      FROM work_item_teams team
     WHERE team.id = $1${lock ? ' FOR UPDATE OF team' : ''}
  `, [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

async function ensureUniqueName(client: Queryable, name: string, exceptId?: string) {
  const { rows } = await client.query<{ id: string }>(`
    SELECT id FROM work_item_teams
     WHERE lower(name) = lower($1)
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1
  `, [name, exceptId ?? null]);
  if (rows.length) throw new TeamSettingsError('A team with that name already exists.', 409);
}

async function ensureAnActiveTeamRemains(client: Queryable, id: string) {
  const { rows } = await client.query<{ count: number | string }>(
    'SELECT COUNT(*)::integer AS count FROM work_item_teams WHERE active = true AND id <> $1',
    [id],
  );
  if (Number(rows[0]?.count ?? 0) < 1) {
    throw new TeamSettingsError('At least one active team is required.', 409);
  }
}

export async function resolveActiveTeamName(client: Queryable, value: string) {
  const name = normalizeTeamName(value);
  const { rows } = await client.query<{ name: string }>(`
    SELECT name FROM work_item_teams
     WHERE active = true AND lower(name) = lower($1)
     LIMIT 1
  `, [name]);
  if (!rows.length) {
    throw new TeamSettingsError('Select an active team from the configured list.', 400);
  }
  return rows[0].name;
}

export function createTeamSettingsRepository(db: Database) {
  return {
    async listTeams() {
      const { rows } = await db.query<TeamRow>(`
        SELECT team.*,
               (SELECT COUNT(*)::integer FROM work_items item
                 WHERE lower(item.team) = lower(team.name)) AS usage_count
          FROM work_item_teams team
         ORDER BY team.active DESC, team.position ASC, lower(team.name) ASC
      `);
      return rows.map(hydrate);
    },

    async listActiveNames() {
      const { rows } = await db.query<{ name: string }>(`
        SELECT name FROM work_item_teams
         WHERE active = true
         ORDER BY position ASC, lower(name) ASC
      `);
      return rows.map((row) => row.name);
    },

    async resolveActiveName(client: Queryable, value: string) {
      return resolveActiveTeamName(client, value);
    },

    async createTeam(value: unknown) {
      const name = normalizeTeamName(value);
      return db.transaction(async (client) => {
        await ensureUniqueName(client, name);
        const { rows } = await client.query<{ position: number | string }>(
          'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM work_item_teams',
        );
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        await client.query(`
          INSERT INTO work_item_teams (id, name, position, active, created_at, updated_at)
          VALUES ($1,$2,$3,true,$4,$4)
        `, [id, name, Number(rows[0]?.position ?? 0), timestamp]);
        return (await teamById(client, id))!;
      });
    },

    async updateTeam(id: string, input: { name?: unknown; active?: unknown }) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new TeamSettingsError('A valid team is required.', 400);
      }
      if (input.name === undefined && input.active === undefined) {
        throw new TeamSettingsError('No team changes were supplied.', 400);
      }
      if (input.active !== undefined && typeof input.active !== 'boolean') {
        throw new TeamSettingsError('Team status must be true or false.', 400);
      }
      return db.transaction(async (client) => {
        const existing = await teamById(client, id, true);
        if (!existing) throw new TeamSettingsError('Team not found.', 404);
        const name = input.name === undefined ? existing.name : normalizeTeamName(input.name);
        const active = input.active === undefined ? existing.active : input.active;
        await ensureUniqueName(client, name, id);
        if (existing.active && !active) await ensureAnActiveTeamRemains(client, id);
        if (name !== existing.name) {
          await client.query(
            'UPDATE work_items SET team = $1 WHERE lower(team) = lower($2)',
            [name, existing.name],
          );
        }
        await client.query(
          'UPDATE work_item_teams SET name = $1, active = $2, updated_at = $3 WHERE id = $4',
          [name, active, new Date().toISOString(), id],
        );
        return (await teamById(client, id))!;
      });
    },

    async deleteTeam(id: string) {
      return db.transaction(async (client) => {
        const existing = await teamById(client, id, true);
        if (!existing) throw new TeamSettingsError('Team not found.', 404);
        if (existing.usageCount > 0) {
          throw new TeamSettingsError('Disable this team instead; existing work cards still use it.', 409);
        }
        if (existing.active) await ensureAnActiveTeamRemains(client, id);
        await client.query('DELETE FROM work_item_teams WHERE id = $1', [id]);
        return { id };
      });
    },
  };
}

export const teamSettings = {
  listTeams: () => createTeamSettingsRepository(database()).listTeams(),
  listActiveNames: () => createTeamSettingsRepository(database()).listActiveNames(),
  createTeam: (name: unknown) => createTeamSettingsRepository(database()).createTeam(name),
  updateTeam: (id: string, input: { name?: unknown; active?: unknown }) =>
    createTeamSettingsRepository(database()).updateTeam(id, input),
  deleteTeam: (id: string) => createTeamSettingsRepository(database()).deleteTeam(id),
};
export const listActiveTeamNames = () => teamSettings.listActiveNames();
