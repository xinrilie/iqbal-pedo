import 'dotenv/config';
import pg from 'pg';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContiguousMigrations,
  blockedPreflightRows,
  inferAppliedVersion,
  migrationChecksum,
  parseMigrationFilename,
  unwrapMigrationTransaction
} from '../src/lib/migration-runner.js';

const { Pool } = pg;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = resolve(ROOT, 'db/migrations');
const PREFLIGHT_DIR = resolve(ROOT, 'db/preflight');
const LOCK_KEY = [71_067_801, 2_026_001];
const PREFLIGHTS = new Map([
  [5, '005_procurement.sql'],
  [6, '006_maker_checker.sql']
]);
const CREATE_HISTORY_SQL = `
  CREATE SCHEMA IF NOT EXISTS gcims;
  CREATE TABLE IF NOT EXISTS gcims.schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version BETWEEN 1 AND 9999),
    name VARCHAR(120) NOT NULL UNIQUE,
    checksum_sha256 VARCHAR(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by TEXT NOT NULL DEFAULT current_user,
    applied_via VARCHAR(16) NOT NULL CHECK (applied_via IN ('baseline', 'runner'))
  );`;

function parseArgs(args) {
  const unknown = args.filter((arg) => !['--yes', '--dry-run'].includes(arg));
  if (unknown.length) throw new Error(`Argumen tidak dikenal: ${unknown.join(' ')}`);
  if (args.includes('--yes') && args.includes('--dry-run')) throw new Error('--yes tidak dapat digabung dengan --dry-run.');
  return { assumeYes: args.includes('--yes'), dryRun: args.includes('--dry-run') };
}

async function loadMigrations() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.toLowerCase().endsWith('.sql'));
  const migrations = [];
  for (const name of names) {
    const parsed = parseMigrationFilename(name);
    const sql = await readFile(resolve(MIGRATIONS_DIR, name), 'utf8');
    migrations.push({ ...parsed, sql, checksum: migrationChecksum(sql) });
  }
  return assertContiguousMigrations(migrations);
}

async function inspectSchema(client) {
  const result = await client.query(`
    SELECT
      to_regclass('gcims.users') IS NOT NULL
        AND to_regclass('gcims.sales_orders') IS NOT NULL
        AND to_regclass('gcims.payments') IS NOT NULL AS m0001,
      to_regclass('gcims.payment_webhook_inbox') IS NOT NULL AS m0002,
      to_regclass('gcims.ix_kitchen_tickets_fifo') IS NOT NULL AS m0003,
      to_regclass('gcims.stock_reservations') IS NOT NULL
        AND to_regclass('gcims.v_stock_available') IS NOT NULL AS m0004,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='purchase_orders' AND column_name='idempotency_request_hash')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='goods_receipt_items' AND column_name='purchase_order_id') AS m0005,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('gcims.purchase_orders') AND conname='ck_po_maker_checker' AND convalidated)
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('gcims.goods_receipts') AND conname='ck_gr_maker_checker' AND convalidated) AS m0006,
      EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='gcims' AND p.proname='guard_goods_receipt_lines'
           AND p.prosrc LIKE '%gcims.allow_goods_receipt_lot_link%'
      ) AS m0007,
      to_regclass('gcims.cashier_shifts') IS NOT NULL
        AND to_regclass('gcims.cash_drawer_events') IS NOT NULL AS m0008,
      to_regclass('gcims.inventory_items') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='inventory_items' AND column_name='canonical_name')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='item_uom_conversions' AND column_name='conversion_basis') AS m0010,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='menu_variants' AND column_name='product_type') AS m0011,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gcims' AND table_name='users' AND column_name='auth_token_version') AS m0012,
      to_regclass('gcims.ix_kitchen_tickets_fifo') IS NOT NULL AS m0013,
      EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='gcims' AND c.relkind IN ('r','p','v','m','S','f')
           AND c.relname <> 'schema_migrations'
      ) AS has_application_objects,
      to_regclass('gcims.schema_migrations') IS NOT NULL AS has_history_table`);
  const row = result.rows[0];
  // Migration 0003 only adds this FIFO index. If 0004+ exists but that index
  // was removed, baseline the historical sequence and let migration 0013
  // restore the index without rewriting immutable migration 0003.
  const markers = [
    row.m0001, row.m0002, Boolean(row.m0003 || row.m0004), row.m0004, row.m0005, row.m0006, row.m0007, row.m0008,
    false, row.m0010, row.m0011, row.m0012, row.m0013
  ].map(Boolean);

  if (markers[0]) {
    const versionMarker = await client.query(`
      SELECT
        (SELECT count(*) FROM gcims.permissions WHERE code IN ('admin.users.read','admin.users.manage','admin.sales.read')) = 3 AS applied`);
    markers[8] = Boolean(versionMarker.rows[0]?.applied);
  }

  let latestVersion;
  try {
    latestVersion = inferAppliedVersion(markers);
  } catch (error) {
    const markerSummary = markers
      .map((present, index) => `${String(index + 1).padStart(4, '0')}=${present ? 'ada' : 'tidak ada'}`)
      .join(', ');
    throw new Error(`${error.message} Marker skema: ${markerSummary}.`);
  }

  return {
    markers,
    latestVersion,
    hasApplicationObjects: Boolean(row.has_application_objects),
    hasHistoryTable: Boolean(row.has_history_table)
  };
}

async function readHistory(client) {
  const result = await client.query(
    `SELECT version, name, checksum_sha256, applied_via
       FROM gcims.schema_migrations ORDER BY version`
  );
  return result.rows;
}

function validateHistory(history, migrations, detectedVersion) {
  const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (let index = 0; index < history.length; index += 1) {
    const applied = history[index];
    const expectedVersion = index + 1;
    const file = filesByVersion.get(applied.version);
    if (applied.version !== expectedVersion) {
      throw new Error(`Ledger migration terputus pada ${String(applied.version).padStart(4, '0')}; jangan lanjutkan sampai riwayat diperiksa.`);
    }
    if (!file || file.name !== applied.name || file.checksum !== applied.checksum_sha256) {
      throw new Error(`Checksum/nama migration ${String(applied.version).padStart(4, '0')} tidak cocok dengan file. Jangan mengubah atau menjalankan migration.`);
    }
  }
  const latestTracked = history.at(-1)?.version ?? 0;
  if (detectedVersion > latestTracked) {
    throw new Error(`Database tampak sudah mencapai migration ${String(detectedVersion).padStart(4, '0')}, tetapi ledger hanya sampai ${String(latestTracked).padStart(4, '0')}. Riwayat manual perlu direkonsiliasi; tidak ada SQL yang dijalankan.`);
  }
  if (latestTracked > detectedVersion) {
    throw new Error(`Ledger mencatat migration ${String(latestTracked).padStart(4, '0')}, tetapi marker skema hanya terdeteksi sampai ${String(detectedVersion).padStart(4, '0')}. Database perlu diperiksa; tidak ada SQL yang dijalankan.`);
  }
  return latestTracked;
}

async function confirmPlan({ assumeYes, dryRun, databaseName, baselineVersion, pending }) {
  console.log(`Database target: ${databaseName}`);
  if (baselineVersion) {
    console.log(`Skema terdeteksi sampai ${String(baselineVersion).padStart(4, '0')}; runner akan mencatat migration lama yang terverifikasi tanpa mengubah data bisnis.`);
  }
  console.log(pending.length
    ? `Migration yang akan diterapkan: ${pending.map((item) => item.name).join(', ')}`
    : 'Tidak ada migration tertunda.');
  if (dryRun) {
    console.log('Dry run: database tidak diubah.');
    return false;
  }
  if (assumeYes) return true;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Konfirmasi interaktif tidak tersedia. Jalankan di terminal atau gunakan --yes setelah memastikan target database.');
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question('Lanjutkan? Ketik "ya" untuk menyetujui: ');
    return answer.trim().toLocaleLowerCase('id') === 'ya';
  } finally {
    readline.close();
  }
}

async function ensureHistoryTable(client) {
  await client.query('BEGIN');
  try {
    await client.query(CREATE_HISTORY_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function seedBaseline(client, migrations, baselineVersion) {
  if (!baselineVersion) return;
  await client.query('BEGIN');
  try {
    for (const migration of migrations.filter((item) => item.version <= baselineVersion)) {
      await client.query(
        `INSERT INTO gcims.schema_migrations(version,name,checksum_sha256,applied_via)
         VALUES($1,$2,$3,'baseline')`,
        [migration.version, migration.name, migration.checksum]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function runPreflight(client, version) {
  const name = PREFLIGHTS.get(version);
  if (!name) return;
  const sql = await readFile(resolve(PREFLIGHT_DIR, name), 'utf8');
  const result = await client.query(sql);
  const blocked = blockedPreflightRows(result);
  if (blocked.length) {
    const details = blocked.map((row) => `${row.check_name}: ${row.affected_rows} (${row.status})`).join('; ');
    throw new Error(`Preflight ${name} memblokir migration ${String(version).padStart(4, '0')}: ${details}`);
  }
  console.log(`Preflight ${name}: semua check lulus.`);
}

async function applyMigration(client, migration) {
  const body = unwrapMigrationTransaction(migration.sql, migration.name);
  await client.query('BEGIN');
  try {
    await client.query(body);
    await client.query(
      `INSERT INTO gcims.schema_migrations(version,name,checksum_sha256,applied_via)
       VALUES($1,$2,$3,'runner')`,
      [migration.version, migration.name, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const { assumeYes, dryRun } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL belum diatur.');
  let databaseName;
  try { databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1)); }
  catch { throw new Error('DATABASE_URL tidak valid.'); }
  const migrations = await loadMigrations();
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, application_name: 'gcims-migration-runner' });
  let client;
  let lockHeld = false;
  try {
    client = await pool.connect();
    const server = await client.query(`SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num`);
    if (server.rows[0].version_num < 150000) throw new Error('GCIMS migration memerlukan PostgreSQL 15 atau lebih baru.');
    if (server.rows[0].database_name !== databaseName) throw new Error('Nama database hasil koneksi tidak cocok dengan DATABASE_URL.');
    await client.query('SELECT pg_advisory_lock($1, $2)', LOCK_KEY);
    lockHeld = true;

    let schema = await inspectSchema(client);
    const history = schema.hasHistoryTable ? await readHistory(client) : [];
    const latestTracked = schema.hasHistoryTable && history.length
      ? validateHistory(history, migrations, schema.latestVersion)
      : schema.latestVersion;

    if (schema.hasApplicationObjects && latestTracked === 0 && schema.latestVersion === 0) {
      throw new Error('Database gcims berisi objek tetapi tidak ada marker migration yang bisa diverifikasi. Runner berhenti tanpa mengubah database.');
    }
    const baselineVersion = history.length === 0 ? schema.latestVersion : 0;
    const pending = migrations.filter((migration) => migration.version > latestTracked);
    if (!await confirmPlan({ assumeYes, dryRun, databaseName, baselineVersion, pending })) return;

    if (!schema.hasHistoryTable) {
      await ensureHistoryTable(client);
      if (baselineVersion) await seedBaseline(client, migrations, baselineVersion);
      schema = await inspectSchema(client);
    }

    for (const migration of pending) {
      await runPreflight(client, migration.version);
      await applyMigration(client, migration);
      console.log(`Applied ${migration.name}.`);
    }
    if (!pending.length) console.log('Migration history sudah sinkron.');
  } finally {
    if (client && lockHeld) await client.query('SELECT pg_advisory_unlock($1, $2)', LOCK_KEY).catch(() => {});
    client?.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Migration gagal: ${error.message}`);
  process.exitCode = 1;
});
