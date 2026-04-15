/**
 * One-time setup script for the integration test database.
 * Creates `cuanto_test`, enables PostGIS, and runs all migrations.
 * Safe to re-run — creation and migrations are both idempotent.
 *
 * Usage: pnpm test:db:setup
 */
import postgres from 'postgres';
import { migrateUp } from './migrate.js';

const BASE_URL = 'postgresql://cuanto:cuanto@localhost:5432';

async function main() {
  const adminSql = postgres(`${BASE_URL}/cuanto`, { max: 1 });
  try {
    await adminSql.unsafe('CREATE DATABASE cuanto_test');
    console.log('Created database cuanto_test');
  } catch (err) {
    if (!(err as Error).message.includes('already exists')) throw err;
    console.log('Database cuanto_test already exists');
  } finally {
    await adminSql.end();
  }

  const testSql = postgres(`${BASE_URL}/cuanto_test`, { max: 1 });
  try {
    await testSql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');
    console.log('PostGIS extension ready');
    await migrateUp(testSql);
  } finally {
    await testSql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
