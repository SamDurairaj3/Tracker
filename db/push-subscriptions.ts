import { randomUUID } from 'node:crypto';
import { database } from './postgres';
import type { Database } from './database';
import type { StoredPushSubscription } from '../lib/web-push';

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  authSecret: string;
  expirationTime: number | null;
  userAgent: string | null;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

function hydrate(row: PushSubscriptionRow): StoredPushSubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    authSecret: row.auth_secret,
  };
}

export function createPushSubscriptionRepository(db: Database) {
  return {
    async upsert(userId: string, input: PushSubscriptionInput) {
      await db.query(`
        INSERT INTO push_subscriptions (
          id, user_id, endpoint, p256dh, auth_secret, expiration_time,
          user_agent, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
        ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth_secret = EXCLUDED.auth_secret,
            expiration_time = EXCLUDED.expiration_time,
            user_agent = EXCLUDED.user_agent,
            updated_at = now()
      `, [
        randomUUID(), userId, input.endpoint, input.p256dh, input.authSecret,
        input.expirationTime, input.userAgent,
      ]);
    },

    async remove(userId: string, endpoint: string) {
      await db.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, endpoint],
      );
    },

    async removeById(id: string) {
      await db.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
    },

    async listForNames(names: string[]) {
      if (!names.length) return [];
      const { rows } = await db.query<PushSubscriptionRow>(`
        SELECT subscription.id, subscription.endpoint,
               subscription.p256dh, subscription.auth_secret
          FROM push_subscriptions subscription
          JOIN auth_users user_account ON user_account.id = subscription.user_id
         WHERE user_account.name = ANY($1::text[])
           AND COALESCE(user_account.banned, false) = false
         ORDER BY subscription.created_at ASC
      `, [names]);
      return rows.map(hydrate);
    },

    async listForRole(role: string) {
      const { rows } = await db.query<PushSubscriptionRow>(`
        SELECT subscription.id, subscription.endpoint,
               subscription.p256dh, subscription.auth_secret
          FROM push_subscriptions subscription
          JOIN auth_users user_account ON user_account.id = subscription.user_id
         WHERE user_account.role = $1
           AND COALESCE(user_account.banned, false) = false
         ORDER BY subscription.created_at ASC
      `, [role]);
      return rows.map(hydrate);
    },
  };
}

export const pushSubscriptions = {
  upsert: (userId: string, input: PushSubscriptionInput) =>
    createPushSubscriptionRepository(database()).upsert(userId, input),
  remove: (userId: string, endpoint: string) =>
    createPushSubscriptionRepository(database()).remove(userId, endpoint),
  removeById: (id: string) =>
    createPushSubscriptionRepository(database()).removeById(id),
  listForNames: (names: string[]) =>
    createPushSubscriptionRepository(database()).listForNames(names),
  listForRole: (role: string) =>
    createPushSubscriptionRepository(database()).listForRole(role),
};
