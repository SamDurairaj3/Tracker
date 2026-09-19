import { migrate } from '../db/migrate';
import { closeDatabase, database } from '../db/postgres';

try {
  const applied = await migrate(database());
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema is up to date.');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
