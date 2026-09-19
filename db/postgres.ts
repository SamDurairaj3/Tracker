import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import type { Database } from './database';

export function postgresConfig(environment: Record<string, string | undefined> = process.env): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  const max = Number(environment.DATABASE_POOL_MAX ?? 5);
  if (!Number.isInteger(max) || max < 1 || max > 100) {
    throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 100.');
  }
  let connection: Pick<PoolConfig, 'connectionString' | 'host' | 'port' | 'database' | 'user' | 'password'>;
  if (connectionString) {
    if (environment.DATABASE_PASSWORD_FILE) {
      throw new Error('Use DATABASE_URL or DATABASE_PASSWORD_FILE, not both.');
    }
    connection = { connectionString };
  } else if (environment.DATABASE_PASSWORD_FILE) {
    const host = environment.DATABASE_HOST;
    const database = environment.DATABASE_NAME;
    const user = environment.DATABASE_USER;
    if (!host || !database || !user) {
      throw new Error('DATABASE_HOST, DATABASE_NAME, and DATABASE_USER are required with DATABASE_PASSWORD_FILE.');
    }
    const port = Number(environment.DATABASE_PORT ?? 5432);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DATABASE_PORT must be an integer between 1 and 65535.');
    }
    const rawPassword = readFileSync(environment.DATABASE_PASSWORD_FILE, 'utf8');
    const password = rawPassword.replace(/\r?\n$/, '');
    if (!password || /[\r\n]/.test(password)) {
      throw new Error('DATABASE_PASSWORD_FILE must contain one nonempty password line.');
    }
    connection = { host, port, database, user, password };
  } else {
    throw new Error('DATABASE_URL or DATABASE_PASSWORD_FILE is required. Configure PostgreSQL and run pnpm db:migrate.');
  }
  return {
    ...connection,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: 'tracker',
  };
}

export function createPostgresDatabase(pool: Pool): Database {
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(operation, options) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query(options?.readOnly
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
          : 'BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
  };
}

// Lazy initialization permits builds without database credentials. Reuse the pool
// across development reloads; production owns one bounded pool per Node process.
const state = globalThis as typeof globalThis & { trackerPostgresPool?: Pool };

export function postgresPool(): Pool {
  if (!state.trackerPostgresPool) {
    const pool = new Pool(postgresConfig());
    pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
    state.trackerPostgresPool = pool;
  }
  return state.trackerPostgresPool;
}

export function database(): Database {
  return createPostgresDatabase(postgresPool());
}

export async function closeDatabase() {
  const pool = state.trackerPostgresPool;
  delete state.trackerPostgresPool;
  await pool?.end();
}
