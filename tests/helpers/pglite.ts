import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Database, Queryable } from '../../db/database';

function queryable(client: PGlite | Transaction): Queryable {
  return {
    async query<Row extends object>(sql: string, values?: unknown[]) {
      // exec, like node-postgres's simple-query mode, accepts migration batches.
      if (values === undefined) {
        const results = await client.exec(sql);
        return { rows: (results[0]?.rows ?? []) as Row[] };
      }
      return client.query<Row>(sql, values);
    },
  };
}

export function memoryPostgres() {
  const engine = new PGlite();
  const db: Database = {
    ...queryable(engine),
    transaction: (operation, options) => engine.transaction(async (client) => {
      if (options?.readOnly) await client.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return operation(queryable(client));
    }),
  };
  return { db, close: () => engine.close() };
}
