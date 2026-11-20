import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'gcims-backend-mvp'
});

pool.on('error', (error) => {
  // Pool error is logged; request handlers receive query errors through their own calls.
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function withTransaction(fn, { isolation = 'READ COMMITTED' } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
