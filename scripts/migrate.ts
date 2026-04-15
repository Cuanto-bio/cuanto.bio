import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function getAppliedVersions(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`
    SELECT version FROM schema_migrations ORDER BY version
  `;
  return new Set(rows.map((r) => r.version));
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  const exists = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'schema_migrations'
    ) AS exists
  `;
  if (!exists[0].exists) {
    const bootstrap = await readFile(
      join(MIGRATIONS_DIR, '0001_create_schema_migrations.up.sql'),
      'utf8',
    );
    await sql.unsafe(bootstrap);
    await sql`INSERT INTO schema_migrations (version) VALUES ('0001')`;
  }
}

async function migrateUp(sql: postgres.Sql): Promise<void> {
  await ensureMigrationsTable(sql);
  const applied = await getAppliedVersions(sql);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.up.sql'))
    .sort();

  for (const file of files) {
    const version = file.split('_')[0];
    if (applied.has(version)) continue;

    console.log(`Applying migration ${version}...`);
    const sql_text = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(sql_text);
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });
    console.log(`Applied ${version}`);
  }
}

async function migrateDown(sql: postgres.Sql): Promise<void> {
  await ensureMigrationsTable(sql);
  const applied = await getAppliedVersions(sql);
  if (applied.size === 0) {
    console.log('No migrations to roll back.');
    return;
  }

  // biome-ignore lint/style/noNonNullAssertion: guarded by applied.size === 0 check above
  const latest = [...applied].sort().at(-1)!;
  const files = await readdir(MIGRATIONS_DIR);
  const downFile = files.find(
    (f) => f.startsWith(latest) && f.endsWith('.down.sql'),
  );

  if (!downFile) {
    throw new Error(`No down migration found for version ${latest}`);
  }

  console.log(`Rolling back migration ${latest}...`);
  const sql_text = await readFile(join(MIGRATIONS_DIR, downFile), 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(sql_text);
    await tx`DELETE FROM schema_migrations WHERE version = ${latest}`;
  });
  console.log(`Rolled back ${latest}`);
}

export { migrateUp };

async function main() {
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    console.error('Usage: migrate.ts <up|down>');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const sql = postgres(url);
  try {
    if (direction === 'up') {
      await migrateUp(sql);
    } else {
      await migrateDown(sql);
    }
  } finally {
    await sql.end();
  }
}

// Only run when executed directly (not when imported)
if (
  process.argv[1]?.endsWith('migrate.ts') ||
  process.argv[1]?.endsWith('migrate.js')
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
