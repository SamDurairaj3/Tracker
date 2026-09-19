import { closeDatabase, database } from '../db/postgres';
import { assertDemoSeedAllowed, seedDemo } from '../db/seed';

try {
  const confirmed = process.argv.includes('--confirm-demo');
  assertDemoSeedAllowed(process.env, confirmed);
  const count = await seedDemo(database(), process.env, confirmed);
  console.log(`Inserted ${count} demo work items. No existing records were changed.`);
} catch (error) {
  console.error('Demo seed refused or failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
