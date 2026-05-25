import postgres from 'postgres';

const DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';

export default async function globalSetup() {
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
  } catch {
    throw new Error(
      `Cannot connect to PostgreSQL at localhost:5432.\n` +
        `Is Docker running? Try: docker compose up -d`,
    );
  } finally {
    await sql.end();
  }
}
