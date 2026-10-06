import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAdminNotificationRepository } from '../db/admin-notifications';
import { migrate } from '../db/migrate';
import { createTeamSettingsRepository, TeamSettingsError } from '../db/team-settings';
import { createWorkItemRepository } from '../db/work-items';
import { createTeamSettingsHandlers } from '../lib/team-settings-api';
import { input } from './helpers/contract';
import { memoryPostgres } from './helpers/pglite';

function request(method = 'GET', body?: unknown) {
  return new Request('http://localhost/api/admin/teams', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('team settings rename existing work safely and attention changes appear in management activity', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    const teams = createTeamSettingsRepository(db);
    const work = createWorkItemRepository(db);
    const notifications = createAdminNotificationRepository(db);
    assert.deepEqual(await teams.listActiveNames(), [
      'Propulsion', 'Ground Systems', 'Avionics', 'Structures', 'GNC', 'Flight Software',
    ]);

    const createdTeam = await teams.createTeam('Thermal Systems');
    const card = await work.insertWorkItem(
      { ...input, team: createdTeam.name },
      { id: null, name: 'Admin User', role: 'admin' },
    );
    const flagged = await work.patchWorkItem(
      { id: card.id, needsAttention: true },
      { id: null, name: 'Admin User', role: 'admin' },
    );
    assert.equal(flagged?.needsAttention, true);

    const renamed = await teams.updateTeam(createdTeam.id, { name: 'Thermal & Fluids' });
    assert.equal(renamed.usageCount, 1);
    assert.equal((await work.getWorkItem(card.id))?.team, 'Thermal & Fluids');

    await teams.updateTeam(createdTeam.id, { active: false });
    assert.doesNotMatch((await teams.listActiveNames()).join(','), /Thermal/);
    await assert.rejects(
      () => teams.deleteTeam(createdTeam.id),
      (error: unknown) => error instanceof TeamSettingsError && error.status === 409,
    );

    const recent = await notifications.listRecent();
    assert.ok(recent.some((entry) => entry.workItemId === card.id && /needing attention/.test(entry.body)));
  } finally {
    await close();
  }
});

test('team settings API is admin-only and validates same-origin mutations', async () => {
  const operations = {
    async listTeams() { return []; },
    async createTeam() { throw new Error('not called'); },
    async updateTeam() { throw new Error('not called'); },
    async deleteTeam() { throw new Error('not called'); },
  };
  const anonymous = createTeamSettingsHandlers(operations, async () => null);
  assert.equal((await anonymous.GET(request())).status, 401);
  const engineer = createTeamSettingsHandlers(operations, async () => ({ id: null, name: 'Engineer', role: 'engineer' }));
  assert.equal((await engineer.GET(request())).status, 403);
  const admin = createTeamSettingsHandlers(operations, async () => ({ id: null, name: 'Admin', role: 'admin' }));
  const crossOrigin = new Request('http://localhost/api/admin/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://elsewhere.example' },
    body: JSON.stringify({ name: 'Test' }),
  });
  assert.equal((await admin.POST(crossOrigin)).status, 403);
});

test('management migration imports each legacy team once', async () => {
  const { db, close } = memoryPostgres();
  try {
    await db.query(readFileSync(new URL('../db/migrations/0001_work_items.sql', import.meta.url), 'utf8'));
    const values = (id: string) => [
      id, 'Legacy card', 'Legacy Systems', 'Engineer', 'captured', 'on-track', 'High', 0,
      '2026-10-01', '2026-10-02', '02 Oct', 'Admin', 'Task', 'Purpose', 'Result',
      'checklist-count', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
    ];
    const sql = `INSERT INTO work_items (
      id,title,team,owner,status,health,priority,progress,start_date,due_date,due_label,
      created_by,work_type,purpose,expected_result,progress_method,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`;
    await db.query(sql, values('LEGACY-001'));
    await db.query(sql, values('LEGACY-002'));
    await db.query(readFileSync(new URL('../db/migrations/0006_management_controls.sql', import.meta.url), 'utf8'));
    const { rows } = await db.query<{ count: number | string }>(
      "SELECT COUNT(*)::integer AS count FROM work_item_teams WHERE name = 'Legacy Systems'",
    );
    assert.equal(Number(rows[0].count), 1);
  } finally {
    await close();
  }
});
