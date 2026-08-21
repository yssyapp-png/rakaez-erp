import pg from 'pg';
import dotenv from 'dotenv';
import { migrationFiles } from './src/db/migrations.js';
import { databaseSslOptions } from './src/db/ssl.js';

dotenv.config();
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslOptions(),
});
try {
  const [organizations, appliedMigrations] = await Promise.all([
    pool.query('SELECT count(*) FROM organizations'),
    pool.query('SELECT name FROM schema_migrations ORDER BY name'),
  ]);
  const applied = new Set(appliedMigrations.rows.map(({ name }) => name));
  const missing = migrationFiles.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing database migrations: ${missing.join(', ')}`);
  }
  console.log('DATABASE VERIFIED. organizations count:', organizations.rows[0].count);
  console.log(`DATABASE VERIFIED. migrations applied: ${applied.size}`);
} catch (error) {
  const publicReason = error.message.startsWith('Missing database migrations:')
    ? error.message
    : 'database connection or verification query failed';
  console.error('DATABASE VERIFICATION FAILED:', publicReason);
  process.exitCode = 1;
} finally {
  await pool.end();
}
