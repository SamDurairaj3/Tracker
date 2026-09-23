import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate } from '../db/migrate';
import { createWorkItemRepository, type WorkItemActor } from '../db/work-items';
import { createWorkItemActivityHandlers, createWorkItemLifecycleHandlers } from '../lib/work-item-activity-api';
import { createWorkItemHandlers } from '../lib/work-items-api';
import type { WorkItem, WorkItemEditInput } from '../lib/work-items';
import { input } from './helpers/contract';
import { memoryPostgres } from './helpers/pglite';

const creator: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Creator Engineer',
  role: 'engineer',
};
const owner: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000002',
  name: 'Owner Engineer',
  role: 'engineer',
};
const outsider: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000003',
  name: 'Other Engineer',
  role: 'engineer',
};
const admin: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000004',
  name: 'Admin Person',
  role: 'admin',
};

function request(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined
      ? undefined
      : { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function editPayload(item: WorkItem, changes: Partial<WorkItemEditInput> = {}): WorkItemEditInput {
  return {
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
      id: step.id,
      title: step.title,
      assignee: step.assignee,
      weight: step.weight,
    })),
    ...changes,
  };
}

test('shared discussion and lifecycle permissions remain transactional', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    for (const actor of [creator, owner, outsider, admin]) {
      await db.query(
        `INSERT INTO auth_users (id, name, email, role)
         VALUES ($1, $2, $3, $4)`,
        [actor.id, actor.name, actor.name.toLowerCase().replace(' ', '.') + '@example.test', actor.role],
      );
    }

    const repository = createWorkItemRepository(db);
    let item = await repository.insertWorkItem({
      ...input,
      owner: owner.name,
      checklist: [{ title: 'Review evidence', assignee: owner.name }],
    }, creator);
    const checklistId = item.checklist[0].id;

    const anonymousActivity = createWorkItemActivityHandlers(repository, async () => null);
    assert.equal(
      (await anonymousActivity.GET(request('http://localhost/api/work-items/activity?id=' + item.id))).status,
      401,
    );

    const outsiderActivity = createWorkItemActivityHandlers(repository, async () => outsider);
    assert.equal((await outsiderActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: '   ' },
    ))).status, 400);
    assert.equal((await outsiderActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Cross-team review is complete.', checklistStepId: 'not-a-uuid' },
    ))).status, 400);

    const commentResponse = await outsiderActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      {
        id: item.id,
        body: 'Cross-team review is complete.',
        checklistStepId: checklistId,
      },
    ));
    assert.equal(commentResponse.status, 201);
    assert.equal(commentResponse.headers.get('cache-control'), 'no-store, private');
    const comment = (await commentResponse.json() as {
      activity: { authorName: string; checklistStepId: string; checklistTitle: string };
    }).activity;
    assert.equal(comment.authorName, outsider.name);
    assert.equal(comment.checklistStepId, checklistId);
    assert.equal(comment.checklistTitle, 'Review evidence');

    const unrelatedApi = createWorkItemHandlers(repository, async () => outsider);
    assert.equal((await unrelatedApi.PUT(request(
      'http://localhost/api/work-items',
      'PUT',
      editPayload(item, { title: 'Forbidden edit' }),
    ))).status, 403);
    const unrelatedLifecycle = createWorkItemLifecycleHandlers(repository, async () => outsider);
    assert.equal((await unrelatedLifecycle.PATCH(request(
      'http://localhost/api/work-items/lifecycle',
      'PATCH',
      { id: item.id, archived: true },
    ))).status, 403);

    const ownerApi = createWorkItemHandlers(repository, async () => owner);
    const ownerEdit = await ownerApi.PUT(request(
      'http://localhost/api/work-items',
      'PUT',
      editPayload(item, { title: 'Owner-updated result', checklist: [] }),
    ));
    assert.equal(ownerEdit.status, 200);
    item = (await ownerEdit.json() as { item: WorkItem }).item;
    assert.equal(item.title, 'Owner-updated result');
    assert.equal(item.checklist.length, 0);

    const historyAfterRemoval = await repository.listWorkItemActivity(item.id);
    const retainedComment = historyAfterRemoval.find((entry) => entry.type === 'comment');
    assert.equal(retainedComment?.checklistStepId, null);
    assert.equal(retainedComment?.checklistTitle, 'Review evidence');

    const adminApi = createWorkItemHandlers(repository, async () => admin);
    const adminEdit = await adminApi.PUT(request(
      'http://localhost/api/work-items',
      'PUT',
      editPayload(item, { priority: 'Critical' }),
    ));
    assert.equal(adminEdit.status, 200);
    item = (await adminEdit.json() as { item: WorkItem }).item;
    assert.equal(item.priority, 'Critical');

    const creatorLifecycle = createWorkItemLifecycleHandlers(repository, async () => creator);
    const archiveResponse = await creatorLifecycle.PATCH(request(
      'http://localhost/api/work-items/lifecycle',
      'PATCH',
      { id: item.id, archived: true },
    ));
    assert.equal(archiveResponse.status, 200);
    item = (await archiveResponse.json() as { item: WorkItem }).item;
    assert.ok(item.archivedAt);

    assert.equal((await ownerApi.PATCH(request(
      'http://localhost/api/work-items',
      'PATCH',
      { id: item.id, status: 'active' },
    ))).status, 409);
    assert.equal((await outsiderActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Archived cards reject comments.' },
    ))).status, 409);

    assert.deepEqual(await repository.listWorkItems(), []);
    assert.deepEqual((await repository.listWorkItems(true)).map((candidate) => candidate.id), [item.id]);

    const restoreResponse = await creatorLifecycle.PATCH(request(
      'http://localhost/api/work-items/lifecycle',
      'PATCH',
      { id: item.id, archived: false },
    ));
    assert.equal(restoreResponse.status, 200);
    item = (await restoreResponse.json() as { item: WorkItem }).item;
    assert.equal(item.archivedAt, null);

    const eventTypes = (await repository.listWorkItemActivity(item.id)).map((entry) => entry.type);
    for (const type of ['created', 'comment', 'edited', 'archived', 'restored']) {
      assert.ok(eventTypes.includes(type as typeof eventTypes[number]));
    }

    const adminLifecycle = createWorkItemLifecycleHandlers(repository, async () => admin);
    await adminLifecycle.PATCH(request(
      'http://localhost/api/work-items/lifecycle',
      'PATCH',
      { id: item.id, archived: true },
    ));

    const engineerDelete = await ownerApi.DELETE(request(
      'http://localhost/api/work-items',
      'DELETE',
      { id: item.id, confirmation: item.id },
    ));
    assert.equal(engineerDelete.status, 403);

    assert.equal((await adminApi.DELETE(request(
      'http://localhost/api/work-items',
      'DELETE',
      { id: item.id, confirmation: 'wrong' },
    ))).status, 400);
    assert.equal((await adminApi.DELETE(request(
      'http://localhost/api/work-items',
      'DELETE',
      { id: item.id, confirmation: item.id },
    ))).status, 200);

    assert.equal(await repository.getWorkItem(item.id), null);
    assert.equal((await db.query(
      'SELECT COUNT(*)::integer AS count FROM work_item_activity WHERE work_item_id = $1',
      [item.id],
    )).rows[0].count, 0);
    assert.equal((await db.query(
      'SELECT COUNT(*)::integer AS count FROM checklist_steps WHERE work_item_id = $1',
      [item.id],
    )).rows[0].count, 0);
  } finally {
    await close();
  }
});

test('mutation requests enforce JSON content type and browser same origin', async () => {
  let writes = 0;
  const repository = {
    async listWorkItems() { return []; },
    async getWorkItem() { return null; },
    async insertWorkItem() { writes += 1; throw new Error('must not run'); },
    async patchWorkItem() { writes += 1; throw new Error('must not run'); },
    async editWorkItem() { writes += 1; throw new Error('must not run'); },
    async setWorkItemArchived() { writes += 1; throw new Error('must not run'); },
    async deleteWorkItem() { writes += 1; throw new Error('must not run'); },
  };
  const api = createWorkItemHandlers(repository, async () => admin);
  const noType = await api.POST(new Request('http://localhost/api/work-items', {
    method: 'POST',
    body: JSON.stringify(input),
  }));
  assert.equal(noType.status, 415);

  const crossOrigin = await api.POST(new Request('http://localhost/api/work-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://attacker.example',
    },
    body: JSON.stringify(input),
  }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(writes, 0);
});
