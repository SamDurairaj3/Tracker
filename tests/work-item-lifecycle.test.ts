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
const contributor: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000003',
  name: 'Contributor Engineer',
  role: 'engineer',
};
const unrelated: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000004',
  name: 'Other Engineer',
  role: 'engineer',
};
const admin: WorkItemActor = {
  id: '10000000-0000-4000-8000-000000000005',
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

test('relevant users can discuss cards while unrelated users remain isolated', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    for (const actor of [creator, owner, contributor, unrelated, admin]) {
      await db.query(
        'INSERT INTO auth_users (id, name, email, role) VALUES ($1, $2, $3, $4)',
        [actor.id, actor.name, actor.name.toLowerCase().replace(' ', '.') + '@example.test', actor.role],
      );
    }

    const repository = createWorkItemRepository(db);
    let item = await repository.insertWorkItem({
      ...input,
      owner: owner.name,
      checklist: [{ title: 'Review evidence', assignee: contributor.name }],
    }, creator);
    const checklistId = item.checklist[0].id;
    const otherItem = await repository.insertWorkItem({
      ...input,
      title: 'Administrative follow-up',
      owner: admin.name,
      checklist: [{ title: 'Admin action', assignee: admin.name }],
    }, admin);

    const anonymousActivity = createWorkItemActivityHandlers(repository, async () => null);
    assert.equal(
      (await anonymousActivity.GET(request('http://localhost/api/work-items/activity?id=' + item.id))).status,
      401,
    );

    const creatorApi = createWorkItemHandlers(repository, async () => creator);
    const ownerApi = createWorkItemHandlers(repository, async () => owner);
    const contributorApi = createWorkItemHandlers(repository, async () => contributor);
    const unrelatedApi = createWorkItemHandlers(repository, async () => unrelated);
    const adminApi = createWorkItemHandlers(repository, async () => admin);

    async function listedIds(
      api: ReturnType<typeof createWorkItemHandlers>,
      includeArchived = false,
    ) {
      const response = await api.GET(request(
        'http://localhost/api/work-items' + (includeArchived ? '?includeArchived=true' : ''),
      ));
      assert.equal(response.status, 200);
      return (await response.json() as { items: WorkItem[] }).items.map((candidate) => candidate.id);
    }

    assert.deepEqual(await listedIds(creatorApi), [item.id]);
    assert.deepEqual(await listedIds(ownerApi), [item.id]);
    assert.deepEqual(await listedIds(contributorApi), [item.id]);
    assert.deepEqual(await listedIds(unrelatedApi), []);
    assert.deepEqual(await listedIds(adminApi), [otherItem.id, item.id]);

    const creatorActivity = createWorkItemActivityHandlers(repository, async () => creator);
    const ownerActivity = createWorkItemActivityHandlers(repository, async () => owner);
    const contributorActivity = createWorkItemActivityHandlers(repository, async () => contributor);
    const unrelatedActivity = createWorkItemActivityHandlers(repository, async () => unrelated);

    assert.equal((await contributorActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: '   ' },
    ))).status, 400);
    assert.equal((await contributorActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Evidence reviewed.', checklistStepId: 'not-a-uuid' },
    ))).status, 400);

    const proxiedComment = await contributorActivity.POST(new Request(
      'http://tracker:3000/api/work-items/activity',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'tracker:3000',
          Origin: 'https://tunnel.example',
          'X-Forwarded-Host': 'tunnel.example, tracker:3000',
          'X-Forwarded-Proto': 'https, http',
        },
        body: JSON.stringify({
          id: item.id,
          body: 'Evidence reviewed through the tunnel.',
          checklistStepId: checklistId,
        }),
      },
    ));
    assert.equal(proxiedComment.status, 201);
    assert.equal(proxiedComment.headers.get('cache-control'), 'no-store, private');
    const comment = (await proxiedComment.json() as {
      activity: { authorName: string; checklistStepId: string; checklistTitle: string };
    }).activity;
    assert.equal(comment.authorName, contributor.name);
    assert.equal(comment.checklistStepId, checklistId);
    assert.equal(comment.checklistTitle, 'Review evidence');

    assert.equal((await ownerActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Owner context.' },
    ))).status, 201);
    assert.equal((await creatorActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Creator context.' },
    ))).status, 201);

    for (const activityApi of [creatorActivity, ownerActivity, contributorActivity]) {
      assert.equal((await activityApi.GET(request(
        'http://localhost/api/work-items/activity?id=' + item.id,
      ))).status, 200);
    }
    assert.equal((await unrelatedActivity.GET(request(
      'http://localhost/api/work-items/activity?id=' + item.id,
    ))).status, 403);
    assert.equal((await unrelatedActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Unrelated comment.' },
    ))).status, 403);

    const hostileOrigin = await contributorActivity.POST(new Request(
      'http://tracker:3000/api/work-items/activity',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example',
          'X-Forwarded-Host': 'tunnel.example',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ id: item.id, body: 'Hostile origin.' }),
      },
    ));
    assert.equal(hostileOrigin.status, 403);

    assert.equal((await unrelatedApi.PUT(request(
      'http://localhost/api/work-items',
      'PUT',
      editPayload(item, { title: 'Forbidden edit' }),
    ))).status, 403);
    const unrelatedLifecycle = createWorkItemLifecycleHandlers(repository, async () => unrelated);
    assert.equal((await unrelatedLifecycle.PATCH(request(
      'http://localhost/api/work-items/lifecycle',
      'PATCH',
      { id: item.id, archived: true },
    ))).status, 403);

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
    const retainedComment = historyAfterRemoval.find(
      (entry) => entry.type === 'comment' && entry.authorName === contributor.name,
    );
    assert.equal(retainedComment?.checklistStepId, null);
    assert.equal(retainedComment?.checklistTitle, 'Review evidence');

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
    assert.equal((await ownerActivity.POST(request(
      'http://localhost/api/work-items/activity',
      'POST',
      { id: item.id, body: 'Archived cards reject comments.' },
    ))).status, 409);

    assert.deepEqual(await listedIds(ownerApi), []);
    assert.deepEqual(await listedIds(ownerApi, true), [item.id]);
    assert.deepEqual(await listedIds(unrelatedApi, true), []);
    assert.deepEqual(await listedIds(adminApi), [otherItem.id]);
    assert.deepEqual(await listedIds(adminApi, true), [otherItem.id, item.id]);

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

  const missingOrigin = await api.POST(new Request('http://localhost/api/work-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
  assert.equal(missingOrigin.status, 403);

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
