import assert from 'node:assert/strict';
import { before, after, beforeEach, describe, it } from 'node:test';
import type { Database } from '../../db/database';
import { migrate } from '../../db/migrate';
import { seedDemo } from '../../db/seed';
import { createWorkItemRepository } from '../../db/work-items';
import { createWorkItemHandlers } from '../../lib/work-items-api';
import type { CreateWorkItemInput, WorkItem, WorkItemEditInput } from '../../lib/work-items';

export const input: CreateWorkItemInput = {
  title: '  Test pressure model  ', team: 'Propulsion', owner: 'Arjun Menon',
  status: 'captured', priority: 'High', start: '2026-09-17', due: '2026-09-21',
  createdBy: 'Meera Shah', type: 'Task', purpose: '  Test evidence  ',
  expectedResult: '  Reviewed result  ', linkedGoal: '  Flight readiness  ',
  progressMethod: 'checklist-count',
  checklist: [
    { title: '  Measure  ', assignee: 'Arjun Menon', weight: 2, due: '2026-09-19' },
    { title: '   ', assignee: 'Meera Shah', due: null },
    { title: 'Review', assignee: 'Meera Shah', due: null },
  ],
};

const demoEnvironment = { NODE_ENV: 'development', ALLOW_DEMO_SEED: 'true' } as const;
function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/work-items', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function databaseContract(name: string, setup: () => Promise<{ db: Database; close: () => Promise<void> }>) {
  describe(name, { concurrency: false }, () => {
    let db: Database;
    let close: () => Promise<void>;
    let repository: ReturnType<typeof createWorkItemRepository>;
    before(async () => {
      ({ db, close } = await setup());
      await migrate(db);
      repository = createWorkItemRepository(db);
    });
    after(async () => { await close?.(); });
    beforeEach(async () => {
      await db.query('TRUNCATE work_item_activity, checklist_steps, work_items, work_item_counters');
    });

    it('migrates repeatably without seeding or losing records', async () => {
      assert.deepEqual(await repository.listWorkItems(), []);
      const item = await repository.insertWorkItem(input);
      assert.deepEqual(await migrate(db), []);
      assert.deepEqual(await repository.getWorkItem(item.id), item);
    });

    it('detects edited migration history', async () => {
      const migrationName = '0004_checklist_due_dates.sql';
      const { rows } = await db.query<{ checksum: string }>(
        'SELECT checksum FROM tracker_schema_migrations WHERE name = $1',
        [migrationName],
      );
      await db.query(
        "UPDATE tracker_schema_migrations SET checksum = 'changed' WHERE name = $1",
        [migrationName],
      );
      await assert.rejects(migrate(db), /Applied migration was changed/);
      await db.query(
        'UPDATE tracker_schema_migrations SET checksum = $1 WHERE name = $2',
        [rows[0].checksum, migrationName],
      );
    });

    it('preserves complete JSON contract, trimming, nulls, dates, and checklist ordering', async () => {
      const item = await repository.insertWorkItem(input);
      assert.deepEqual(item, {
        id: 'PROP-001', title: 'Test pressure model', team: input.team, owner: input.owner,
        status: 'captured', health: 'on-track', priority: 'High', progress: 0,
        start: '2026-09-17', due: '2026-09-21', dueLabel: '21 Sept', createdBy: 'Meera Shah',
        type: 'Task', purpose: 'Test evidence', expectedResult: 'Reviewed result',
        linkedGoal: 'Flight readiness', progressMethod: 'checklist-count', blocker: null,
        createdAt: item.createdAt, updatedAt: item.createdAt,
        archivedAt: null, archivedByName: null,
        activityCount: 1, latestActivityAt: item.latestActivityAt,
        checklist: [
          { id: item.checklist[0].id, workItemId: item.id, title: 'Measure', assignee: 'Arjun Menon', status: 'open', weight: 2, position: 0, due: '2026-09-19' },
          { id: item.checklist[1].id, workItemId: item.id, title: 'Review', assignee: 'Meera Shah', status: 'open', weight: 1, position: 1, due: null },
        ],
      });
      assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.deepEqual(await repository.listWorkItems(), [item]);
    });

    it('round-trips checklist deadlines and preserves explicit deadline activity after step deletion', async () => {
      const actor = { id: null, name: 'Arjun Menon', role: 'admin' as const };
      let item = await repository.insertWorkItem(input, actor);
      const editPayload = (candidate: WorkItem): WorkItemEditInput => ({
        id: candidate.id,
        title: candidate.title,
        type: candidate.type,
        team: candidate.team,
        owner: candidate.owner,
        priority: candidate.priority,
        purpose: candidate.purpose,
        expectedResult: candidate.expectedResult,
        linkedGoal: candidate.linkedGoal ?? '',
        start: candidate.start,
        due: candidate.due,
        progressMethod: candidate.progressMethod,
        progress: candidate.progress,
        checklist: candidate.checklist.map((step) => ({
          id: step.id,
          title: step.title,
          assignee: step.assignee,
          due: step.due,
          weight: step.weight,
        })),
      });

      item = await repository.editWorkItem({
        ...editPayload(item),
        due: '2026-09-23',
        checklist: item.checklist.map((step) => ({
          id: step.id,
          title: step.title,
          assignee: step.assignee,
          weight: step.weight,
          due: step.title === 'Measure' ? '2026-09-20' : '2026-09-22',
        })),
      }, actor);
      assert.deepEqual(item.checklist.map((step) => step.due), ['2026-09-20', '2026-09-22']);

      let activity = await repository.listWorkItemActivity(item.id);
      const deadlineBodies = activity.map((entry) => entry.body);
      assert.ok(deadlineBodies.includes('Changed work-card due date from 2026-09-21 to 2026-09-23.'));
      assert.ok(deadlineBodies.includes('Changed due date for checklist item “Measure” from 2026-09-19 to 2026-09-20.'));
      assert.ok(deadlineBodies.includes('Set due date for checklist item “Review” to 2026-09-22.'));
      assert.equal(activity.filter((entry) => entry.body.startsWith('Edited ')).length, 0);

      item = await repository.editWorkItem({
        ...editPayload(item),
        checklist: item.checklist.map((step) => ({
          id: step.id,
          title: step.title,
          assignee: step.assignee,
          weight: step.weight,
          due: step.title === 'Review' ? null : step.due,
        })),
      }, actor);
      activity = await repository.listWorkItemActivity(item.id);
      assert.ok(activity.some((entry) => (
        entry.body === 'Cleared due date for checklist item “Review” (was 2026-09-22).'
      )));

      item = await repository.editWorkItem({
        ...editPayload(item),
        checklist: item.checklist.filter((step) => step.title !== 'Review').map((step) => ({
          id: step.id,
          title: step.title,
          assignee: step.assignee,
          due: step.due,
          weight: step.weight,
        })),
      }, actor);
      assert.equal(item.checklist.length, 1);
      activity = await repository.listWorkItemActivity(item.id);
      const reviewDeadlineEvents = activity.filter((entry) => (
        entry.type === 'checklist' && entry.checklistTitle === 'Review'
      ));
      assert.ok(reviewDeadlineEvents.length >= 2);
      assert.ok(reviewDeadlineEvents.every((entry) => entry.checklistStepId === null));
    });

    it('sorts by creation date and ID descending, and handles absent records', async () => {
      await repository.insertWorkItem(input);
      await repository.insertWorkItem(input);
      await db.query("UPDATE work_items SET created_at = '2026-09-17T00:00:00.000Z'");
      assert.deepEqual((await repository.listWorkItems()).map((item) => item.id), ['PROP-002', 'PROP-001']);
      assert.equal(await repository.getWorkItem('missing'), null);
      assert.equal(await repository.patchWorkItem({ id: 'missing', progress: 30 }), null);
    });

    it('rolls back both the card and ID allocation when a checklist insert fails', async () => {
      await assert.rejects(repository.insertWorkItem({ ...input, checklist: [input.checklist[0], { title: 'Invalid', assignee: undefined as unknown as string, due: null }] }));
      assert.deepEqual(await repository.listWorkItems(), []);
      assert.equal((await repository.insertWorkItem(input)).id, 'PROP-001');
    });

    it('uses independent team prefixes and continues imported IDs beyond 999', async () => {
      const first = await repository.insertWorkItem(input);
      await db.query('DELETE FROM work_item_activity WHERE work_item_id = $1', [first.id]);
      await db.query('DELETE FROM checklist_steps WHERE work_item_id = $1', [first.id]);
      await db.query("UPDATE work_items SET id = 'PROP-1000' WHERE id = $1", [first.id]);
      assert.equal((await repository.insertWorkItem(input)).id, 'PROP-1001');
      assert.equal((await repository.insertWorkItem({ ...input, team: 'Avionics' })).id, 'AVN-001');
      assert.equal((await repository.insertWorkItem({ ...input, team: 'Other' })).id, 'WORK-001');
    });

    it('allocates unique IDs for simultaneous creates', async () => {
      const items = await Promise.all(Array.from({ length: 20 }, () => repository.insertWorkItem(input)));
      assert.equal(new Set(items.map((item) => item.id)).size, 20);
      assert.equal((await repository.listWorkItems()).length, 20);
    });

    it('counts completed steps, clamps manual progress, and forces done to 100', async () => {
      const item = await repository.insertWorkItem(input);
      const patch = await repository.patchWorkItem({ id: item.id, checklistStep: { id: item.checklist[0].id, status: 'done' } });
      assert.equal(patch?.progress, 50);
      assert.equal(patch?.checklist[0].status, 'done');
      assert.equal((await repository.patchWorkItem({ id: item.id, progress: -10 }))?.progress, 0);
      assert.equal((await repository.patchWorkItem({ id: item.id, progress: 150 }))?.progress, 100);
      assert.equal((await repository.patchWorkItem({ id: item.id, status: 'done', progress: 4 }))?.progress, 100);
    });

    it('preserves existing weighted-checklist behavior instead of adding a new calculation', async () => {
      const item = await repository.insertWorkItem({ ...input, progressMethod: 'weighted-checklist' });
      await repository.patchWorkItem({ id: item.id, progress: 23 });
      assert.equal((await repository.patchWorkItem({ id: item.id, checklistStep: { id: item.checklist[0].id, status: 'done' } }))?.progress, 23);
    });

    it('keeps simultaneous partial edits and checklist updates', async () => {
      const item = await repository.insertWorkItem(input);
      await Promise.all([
        repository.patchWorkItem({ id: item.id, health: 'blocked', blocker: 'Waiting for evidence' }),
        repository.patchWorkItem({ id: item.id, status: 'active' }),
        ...item.checklist.map((step) => repository.patchWorkItem({ id: item.id, checklistStep: { id: step.id, status: 'done' } })),
      ]);
      const result = await repository.getWorkItem(item.id);
      assert.equal(result?.progress, 100);
      assert.equal(result?.health, 'blocked');
      assert.equal(result?.status, 'active');
      assert.equal(result?.blocker, 'Waiting for evidence');
      assert.equal((await repository.patchWorkItem({ id: item.id, blocker: null }))?.blocker, null);
    });

    it('rolls back a checklist edit when the parent update fails', async () => {
      const item = await repository.insertWorkItem({ ...input, progressMethod: 'manual-estimate' });
      await assert.rejects(repository.patchWorkItem({ id: item.id, progress: NaN, checklistStep: { id: item.checklist[0].id, status: 'done' } }));
      assert.deepEqual(await repository.getWorkItem(item.id), item);
    });

    it('does not update another card’s step; cascades deletion and rejects orphan steps', async () => {
      const a = await repository.insertWorkItem(input);
      const b = await repository.insertWorkItem(input);
      await assert.rejects(repository.patchWorkItem({ id: a.id, checklistStep: { id: b.checklist[0].id, status: 'done' } }), /Checklist action not found/);
      assert.deepEqual(await repository.getWorkItem(b.id), b);
      await db.query('DELETE FROM work_items WHERE id = $1', [a.id]);
      assert.deepEqual((await db.query('SELECT * FROM checklist_steps WHERE work_item_id = $1', [a.id])).rows, []);
      await assert.rejects(db.query("INSERT INTO checklist_steps (id, work_item_id, title, assignee, status) VALUES ('orphan','absent','x','y','open')"));
    });

    it('stores SQL-like input as data', async () => {
      const title = "Robert'); DROP TABLE work_items; --";
      const item = await repository.insertWorkItem({ ...input, title });
      assert.equal(item.title, title);
      assert.equal((await repository.listWorkItems()).length, 1);
    });

    it('seeds only explicitly into an empty development database', async () => {
      await assert.rejects(seedDemo(db, { ...demoEnvironment, NODE_ENV: 'production' }, true), /requires/);
      await assert.rejects(seedDemo(db, demoEnvironment, false), /requires/);
      await assert.rejects(seedDemo(db, { NODE_ENV: 'development' }, true), /requires/);
      assert.equal(await seedDemo(db, demoEnvironment, true), 15);
      assert.equal((await repository.listWorkItems()).length, 15);
      assert.equal((await repository.insertWorkItem(input)).id, 'PROP-149');
      await assert.rejects(seedDemo(db, demoEnvironment, true), /refuses/);
      assert.equal((await repository.listWorkItems()).length, 16);
    });

    it('preserves HTTP envelopes, validation, status codes, and mutations', async () => {
      const api = createWorkItemHandlers(
        repository,
        async () => ({ id: null, name: 'Authenticated Engineer', role: 'admin' }),
      );
      assert.deepEqual(await (await api.GET(request('GET'))).json(), { items: [] });
      const created = await api.POST(request('POST', input));
      assert.equal(created.status, 201);
      const { item } = await created.json() as { item: WorkItem };
      assert.equal(item.createdBy, 'Authenticated Engineer');
      const updated = await api.PATCH(request('PATCH', { id: item.id, status: 'done' }));
      assert.equal(updated.status, 200);
      assert.equal((await updated.json() as { item: WorkItem }).item.progress, 100);
      const missing = await api.PATCH(request('PATCH', { id: 'absent', status: 'active' }));
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: 'Work item not found.' });
      assert.equal((await api.PATCH(request('PATCH', {}))).status, 400);
      assert.equal((await api.POST(request('POST', { ...input, title: '' }))).status, 400);
      assert.equal((await api.POST(request('POST', { ...input, due: '2026-01-01' }))).status, 400);
    });
  });
}
