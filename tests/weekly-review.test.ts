import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate } from '../db/migrate';
import { createWeeklyReviewRepository } from '../db/weekly-review';
import { createWorkItemRepository } from '../db/work-items';
import { createWeeklyReviewHandlers } from '../lib/weekly-review-api';
import {
  classifyWeeklyReviewEvent,
  formatIsoWeekRange,
  isoWeekCalendarRange,
  isoWeekRange,
  shiftIsoWeek,
  type WeeklyReviewEvent,
} from '../lib/weekly-review';
import { input } from './helpers/contract';
import { memoryPostgres } from './helpers/pglite';

test('ISO week helpers resolve Monday-to-Sunday ranges and timezone boundaries', () => {
  assert.deepEqual(isoWeekCalendarRange('2026-W40'), {
    startDate: '2026-09-28',
    endDate: '2026-10-05',
  });
  assert.deepEqual(isoWeekRange('2026-W40', -330), {
    start: '2026-09-27T18:30:00.000Z',
    end: '2026-10-04T18:30:00.000Z',
  });
  assert.equal(shiftIsoWeek('2026-W01', -1), '2025-W52');
  const label = formatIsoWeekRange('2026-W40');
  for (const part of ['28', 'Sep', '4', 'Oct', '2026']) assert.match(label, new RegExp(part));
  assert.equal(isoWeekRange('2026-W54', 0), null);
  assert.equal(isoWeekRange('2026-W40', 900), null);
});

test('weekly event classification highlights completions without hiding other checklist updates', () => {
  const event = {
    id: 'activity-1', workItemId: 'PROP-001', workItemTitle: 'Injector test',
    type: 'checklist', authorUserId: null, authorName: 'Engineer',
    body: 'Changed checklist item “Run cold flow” from in-progress to done.',
    checklistStepId: 'step-1', checklistTitle: 'Run cold flow',
    createdAt: '2026-09-30T08:00:00.000Z', team: 'Propulsion', owner: 'Engineer',
    priority: 'High', status: 'active', health: 'on-track', progress: 50, archivedAt: null,
  } satisfies WeeklyReviewEvent;
  assert.equal(classifyWeeklyReviewEvent(event), 'completion');
  assert.equal(classifyWeeklyReviewEvent({ ...event, body: 'Changed due date.', type: 'checklist' }), 'edited');
  assert.equal(classifyWeeklyReviewEvent({ ...event, body: 'Ready for review.', type: 'comment' }), 'comment');
});

test('weekly review repository returns enriched events only inside the selected week', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    const work = createWorkItemRepository(db);
    const card = await work.insertWorkItem(
      input,
      { id: null, name: 'Admin User', role: 'admin' },
    );
    await db.query(
      'UPDATE work_item_activity SET created_at = $1 WHERE work_item_id = $2',
      ['2026-09-30T08:00:00.000Z', card.id],
    );
    const review = createWeeklyReviewRepository(db);
    const events = await review.listBetween(
      '2026-09-27T18:30:00.000Z',
      '2026-10-04T18:30:00.000Z',
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].workItemId, card.id);
    assert.equal(events[0].workItemTitle, card.title);
    assert.equal(events[0].team, card.team);
    assert.equal(events[0].priority, card.priority);
    assert.equal(events[0].authorName, 'Admin User');
    assert.deepEqual(
      await review.listBetween('2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'),
      [],
    );
  } finally {
    await close();
  }
});

test('weekly review API is admin-only and validates the selected week', async () => {
  const operations = {
    async listBetween() { return []; },
  };
  const request = new Request('http://localhost/api/admin/weekly-review?week=2026-W40&offset=-330');
  const anonymous = createWeeklyReviewHandlers(operations, async () => null);
  assert.equal((await anonymous.GET(request)).status, 401);
  const engineer = createWeeklyReviewHandlers(operations, async () => ({
    id: null, name: 'Engineer', role: 'engineer',
  }));
  assert.equal((await engineer.GET(request)).status, 403);
  const admin = createWeeklyReviewHandlers(operations, async () => ({
    id: null, name: 'Admin', role: 'admin',
  }));
  assert.equal((await admin.GET(new Request(
    'http://localhost/api/admin/weekly-review?week=invalid&offset=-330',
  ))).status, 400);
  const response = await admin.GET(request);
  assert.equal(response.status, 200);
  const payload = await response.json() as { review: { week: string; start: string; events: unknown[] } };
  assert.equal(payload.review.week, '2026-W40');
  assert.equal(payload.review.start, '2026-09-27T18:30:00.000Z');
  assert.deepEqual(payload.review.events, []);
});
