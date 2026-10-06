import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addLocalDays,
  calendarDayDifference,
  defaultWorkDates,
  dueCopy,
  greetingForHour,
  localDateKey,
} from '../lib/local-time';
import { buildTimeline, timelinePosition } from '../lib/work-schedule';
import {
  createWorkItemHandlers,
  validateCreateWorkItem,
  validateWorkItemEdit,
  validateWorkItemPatch,
} from '../lib/work-items-api';
import { filterWorkItemActivity, type WorkItem, type WorkItemActivity, type WorkItemPatch } from '../lib/work-items';
import { input } from './helpers/contract';

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'PROP-001',
    title: 'Validate feed system',
    team: 'Propulsion',
    owner: 'Owner Engineer',
    status: 'active',
    health: 'on-track',
    priority: 'High',
    progress: 20,
    start: '2026-02-02',
    due: '2026-02-12',
    dueLabel: '12 Feb',
    createdBy: 'Admin',
    type: 'Task',
    purpose: 'Validate behavior',
    expectedResult: 'Reviewed evidence',
    linkedGoal: null,
    progressMethod: 'checklist-count',
    blocker: null,
    needsAttention: false,
    createdAt: '2026-02-01T08:00:00.000Z',
    updatedAt: '2026-02-01T08:00:00.000Z',
    archivedAt: null,
    archivedByName: null,
    activityCount: 0,
    latestActivityAt: null,
    checklist: [{
      id: 'step-1',
      workItemId: 'PROP-001',
      title: 'Collect evidence',
      assignee: 'Assigned Engineer',
      status: 'open',
      weight: 1,
      position: 0,
      due: '2026-02-05',
    }],
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/work-items', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
}

test('local work dates and greetings follow the supplied device-local clock', () => {
  const lateJanuary = new Date(2026, 0, 31, 23, 58);
  assert.deepEqual(defaultWorkDates(lateJanuary), {
    start: '2026-01-31',
    due: '2026-02-07',
  });
  assert.equal(localDateKey(addLocalDays(lateJanuary, 1)), '2026-02-01');
  assert.equal(greetingForHour(5), 'Good morning');
  assert.equal(greetingForHour(12), 'Good afternoon');
  assert.equal(greetingForHour(19), 'Good evening');
  assert.equal(calendarDayDifference('2026-02-01', '2026-02-03'), 2);
  assert.equal(dueCopy('2026-02-01', '2026-02-02'), '1 day overdue');
  assert.equal(dueCopy('2026-02-02', '2026-02-02'), 'Due today');
  assert.equal(dueCopy('2026-02-03', '2026-02-02'), 'Due tomorrow');
});

test('Gantt timeline includes today and real item dates without fixed-year labels', () => {
  const item = workItem();
  const timeline = buildTimeline([item], new Date(2026, 1, 6, 14, 30));
  assert.ok(timeline.startKey <= item.start);
  assert.ok(timeline.endKey >= item.due);
  assert.ok(timeline.todayIndex >= 0 && timeline.todayIndex < timeline.days);
  assert.equal(timeline.days % 7, 0);
  assert.ok(timeline.weeks.every((week) => week.label && week.sublabel.startsWith('Week ')));
  const position = timelinePosition(item, timeline);
  assert.ok(position);
  assert.match(position.gridColumn, /^\d+ \/ span \d+$/);
});

test('PATCH runtime validation rejects invalid workflow and checklist states', () => {
  assert.deepEqual(validateWorkItemPatch({ id: 'PROP-001', status: 'invented' }), {
    error: 'Invalid workflow status.',
  });
  assert.deepEqual(validateWorkItemPatch({
    id: 'PROP-001',
    checklistStep: { id: 'step-1', status: 'almost-done' },
  }), { error: 'A valid checklist action and status are required.' });
  assert.deepEqual(validateWorkItemPatch({ id: 'PROP-001' }), {
    error: 'No supported work-item changes were supplied.',
  });
  assert.deepEqual(validateWorkItemPatch({ id: 'PROP-001', needsAttention: 'yes' }), {
    error: 'Attention state must be true or false.',
  });
  assert.deepEqual(validateWorkItemPatch({ id: 'PROP-001', needsAttention: true }), {
    patch: { id: 'PROP-001', needsAttention: true },
  });
  assert.deepEqual(validateWorkItemPatch({
    id: 'PROP-001',
    status: 'review',
    checklistStep: { id: 'step-1', status: 'done' },
  }), {
    patch: {
      id: 'PROP-001',
      status: 'review',
      checklistStep: { id: 'step-1', status: 'done' },
    },
  });
});

test('create and edit validation normalize optional checklist dates and reject impossible dates', () => {
  const created = validateCreateWorkItem({
    ...input,
    checklist: [{ ...input.checklist[0], due: '   ' }],
  });
  assert.ok('input' in created);
  assert.equal(created.input?.checklist[0].due, null);
  assert.ok('error' in validateCreateWorkItem({ ...input, due: '2026-02-30' }));
  assert.ok('error' in validateCreateWorkItem({
    ...input,
    checklist: [{ ...input.checklist[0], due: '2026-02-30' }],
  }));

  const item = workItem();
  const edit = {
    id: item.id,
    title: item.title,
    type: item.type,
    team: item.team,
    owner: item.owner,
    priority: item.priority,
    purpose: item.purpose,
    expectedResult: item.expectedResult,
    linkedGoal: item.linkedGoal ?? '',
    start: item.start,
    due: item.due,
    progressMethod: item.progressMethod,
    progress: item.progress,
    checklist: item.checklist.map((step) => ({
      id: '00000000-0000-4000-8000-000000000001',
      title: step.title,
      assignee: step.assignee,
      due: '',
      weight: step.weight,
    })),
  };
  const edited = validateWorkItemEdit(edit);
  assert.ok('input' in edited);
  assert.equal(edited.input?.checklist[0].due, null);
  assert.ok('error' in validateWorkItemEdit({
    ...edit,
    checklist: [{ ...edit.checklist[0], due: '2026-04-31' }],
  }));
});

test('activity filters separate comments from other events without changing the full feed', () => {
  const entries: WorkItemActivity[] = [
    {
      id: 'activity-1', workItemId: 'PROP-001', type: 'comment', authorUserId: null,
      authorName: 'Owner Engineer', body: 'Reviewed.', checklistStepId: null,
      checklistTitle: null, createdAt: '2026-02-01T08:00:00.000Z',
    },
    {
      id: 'activity-2', workItemId: 'PROP-001', type: 'edited', authorUserId: null,
      authorName: 'Owner Engineer', body: 'Changed due date.', checklistStepId: null,
      checklistTitle: null, createdAt: '2026-02-01T09:00:00.000Z',
    },
  ];
  assert.deepEqual(filterWorkItemActivity(entries, 'everything'), entries);
  assert.deepEqual(filterWorkItemActivity(entries, 'comments'), [entries[0]]);
  assert.deepEqual(filterWorkItemActivity(entries, 'activity'), [entries[1]]);
});

test('engineers can update owned workflow and assigned actions only', async () => {
  let current = workItem();
  let writes = 0;
  const repository = {
    async listWorkItems() { return [current]; },
    async getWorkItem() { return current; },
    async insertWorkItem() { return current; },
    async patchWorkItem(patch: WorkItemPatch) {
      writes += 1;
      current = {
        ...current,
        status: patch.status ?? current.status,
        checklist: patch.checklistStep
          ? current.checklist.map((step) => step.id === patch.checklistStep?.id
            ? { ...step, status: patch.checklistStep.status }
            : step)
          : current.checklist,
      };
      return current;
    },
  };

  const outsider = createWorkItemHandlers(
    repository,
    async () => ({ id: null, name: 'Other Engineer', role: 'engineer' }),
  );
  const malformed = new Request('http://localhost/api/work-items', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: '{',
  });
  assert.equal((await outsider.PATCH(malformed)).status, 400);
  assert.equal((await outsider.PATCH(patchRequest({ id: current.id, status: 'review' }))).status, 403);
  assert.equal((await outsider.PATCH(patchRequest({
    id: current.id,
    checklistStep: { id: 'step-1', status: 'done' },
  }))).status, 403);
  assert.equal(writes, 0);

  const owner = createWorkItemHandlers(
    repository,
    async () => ({ id: null, name: 'Owner Engineer', role: 'engineer' }),
  );
  assert.equal((await owner.PATCH(patchRequest({ id: current.id, status: 'review' }))).status, 200);

  const assignee = createWorkItemHandlers(
    repository,
    async () => ({ id: null, name: 'Assigned Engineer', role: 'engineer' }),
  );
  assert.equal((await assignee.PATCH(patchRequest({
    id: current.id,
    checklistStep: { id: 'step-1', status: 'done' },
  }))).status, 200);
  assert.equal(writes, 2);
  assert.equal(current.status, 'review');
  assert.equal(current.checklist[0].status, 'done');
});
