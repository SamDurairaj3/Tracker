import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPushSubscriptionRepository } from '../db/push-subscriptions';
import { migrate } from '../db/migrate';
import { validatePushSubscription } from '../lib/push-api';
import { readVapidConfig } from '../lib/push-config';
import { encryptPushPayload } from '../lib/web-push';
import {
  planCreatedNotifications,
  planUpdatedNotifications,
} from '../lib/work-item-notifications';
import type { WorkItem } from '../lib/work-items';
import { memoryPostgres } from './helpers/pglite';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'PROP-001', title: 'Pressure proof test', team: 'Propulsion', owner: 'Owner Engineer',
    status: 'ready', health: 'on-track', priority: 'High', progress: 0,
    start: '2026-10-01', due: '2026-10-05', dueLabel: '5 Oct', createdBy: 'Admin User',
    type: 'Task', purpose: 'Evidence', expectedResult: 'Reviewed evidence', linkedGoal: null,
    progressMethod: 'checklist-count', blocker: null, createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z', archivedAt: null, archivedByName: null,
    activityCount: 1, latestActivityAt: '2026-10-01T00:00:00.000Z',
    checklist: [{
      id: '11111111-1111-4111-8111-111111111111', workItemId: 'PROP-001', title: 'Review data',
      assignee: 'Checklist Engineer', due: null, status: 'open', weight: 1, position: 0,
    }],
    ...overrides,
  };
}

test('Web Push encryption matches the RFC 8291 example', () => {
  const output = encryptPushPayload(
    Buffer.from('When I grow up, I want to be a watermelon'),
    Buffer.from('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'base64url'),
    Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url'),
    {
      senderPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
      salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
      recordSize: 4096,
    },
  );
  assert.equal(output.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('VAPID configuration accepts only a file-backed P-256 private key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-vapid-'));
  const path = join(directory, 'key.pem');
  try {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const config = readVapidConfig({
      VAPID_PRIVATE_KEY_FILE: path,
      VAPID_SUBJECT: 'mailto:admin@example.test',
    });
    assert.equal(Buffer.from(config.publicKey, 'base64url').length, 65);
    assert.throws(() => readVapidConfig({
      VAPID_PRIVATE_KEY: 'secret',
      VAPID_PRIVATE_KEY_FILE: path,
      VAPID_SUBJECT: 'mailto:admin@example.test',
    }), /must not be stored/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('push subscription validation rejects malformed endpoints and keys', () => {
  const valid = {
    endpoint: 'https://push.example.test/subscription/1',
    expirationTime: null,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
      auth: Buffer.alloc(16, 2).toString('base64url'),
    },
  };
  assert.ok(validatePushSubscription(valid, 'Test browser'));
  assert.equal(validatePushSubscription({ ...valid, endpoint: 'http://push.example.test/1' }, null), null);
  assert.equal(validatePushSubscription({ ...valid, keys: { ...valid.keys, auth: 'short' } }, null), null);
  assert.equal(validatePushSubscription({
    ...valid,
    keys: { ...valid.keys, p256dh: Buffer.alloc(65, 1).toString('base64url') },
  }, null), null);
});

test('notification plans target owners and new assignees without notifying the actor', () => {
  const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Admin User', role: 'admin' };
  const created = planCreatedNotifications(item(), actor);
  assert.deepEqual(created.map((plan) => plan.recipients), [['Owner Engineer'], ['Checklist Engineer']]);

  const before = item();
  const after = item({
    owner: 'New Owner',
    checklist: before.checklist.map((step) => ({ ...step, assignee: 'New Assignee' })),
    updatedAt: '2026-10-01T01:00:00.000Z',
  });
  const updated = planUpdatedNotifications(before, after, actor);
  assert.ok(updated.some((plan) => plan.payload.title === 'Work card assigned to you' && plan.recipients.includes('New Owner')));
  assert.ok(updated.some((plan) => plan.payload.title === 'New checklist assignment' && plan.recipients.includes('New Assignee')));
  assert.ok(updated.every((plan) => !plan.recipients.includes(actor.name)));
});

test('push subscriptions stay attached to active authenticated users', async () => {
  const { db, close } = memoryPostgres();
  try {
    await migrate(db);
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query(`
      INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at, role, banned)
      VALUES ($1, 'Owner Engineer', 'owner@example.test', true, now(), now(), 'engineer', false)
    `, [userId]);
    const repository = createPushSubscriptionRepository(db);
    await repository.upsert(userId, {
      endpoint: 'https://push.example.test/subscription/owner',
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
      authSecret: Buffer.alloc(16, 2).toString('base64url'),
      expirationTime: null,
      userAgent: 'Test browser',
    });
    assert.equal((await repository.listForNames(['Owner Engineer'])).length, 1);
    await db.query('UPDATE auth_users SET banned = true WHERE id = $1', [userId]);
    assert.equal((await repository.listForNames(['Owner Engineer'])).length, 0);
  } finally {
    await close();
  }
});
