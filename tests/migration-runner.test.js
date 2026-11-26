import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContiguousMigrations,
  blockedPreflightRows,
  inferAppliedVersion,
  migrationChecksum,
  parseMigrationFilename,
  unwrapMigrationTransaction
} from '../src/lib/migration-runner.js';

test('parses versioned migration filenames', () => {
  assert.deepEqual(parseMigrationFilename('0012_auth_session_revocation.sql'), {
    version: 12,
    name: '0012_auth_session_revocation.sql'
  });
  assert.throws(() => parseMigrationFilename('auth.sql'), /Nama migration tidak valid/);
});

test('migration checksum is stable and content-sensitive', () => {
  assert.equal(migrationChecksum('SELECT 1;'), migrationChecksum('SELECT 1;'));
  assert.equal(migrationChecksum('SELECT 1;\r\n'), migrationChecksum('SELECT 1;\n'));
  assert.notEqual(migrationChecksum('SELECT 1;'), migrationChecksum('SELECT 2;'));
  assert.match(migrationChecksum('SELECT 1;'), /^[a-f0-9]{64}$/);
});

test('unwraps only the outer transaction and keeps PL/pgSQL blocks intact', () => {
  const sql = '-- header\nBEGIN;\nDO $$ BEGIN\n  PERFORM 1;\nEND $$;\nCOMMIT;\n';
  assert.equal(unwrapMigrationTransaction(sql), '-- header\nDO $$ BEGIN\n  PERFORM 1;\nEND $$;');
  assert.throws(() => unwrapMigrationTransaction('SELECT 1;'), /harus membungkus migration/);
});

test('requires a contiguous migration sequence starting at 0001', () => {
  const items = [
    { version: 2, name: '0002_second.sql' },
    { version: 1, name: '0001_first.sql' }
  ];
  assert.deepEqual(assertContiguousMigrations(items).map((item) => item.version), [1, 2]);
  assert.throws(() => assertContiguousMigrations([items[1], { version: 3, name: '0003_third.sql' }]), /terputus/);
});

test('infers the last contiguous schema marker and rejects markers after a gap', () => {
  assert.equal(inferAppliedVersion([true, true, true, false]), 3);
  assert.equal(inferAppliedVersion([false, false]), 0);
  assert.throws(() => inferAppliedVersion([true, false, true]), /tidak berurutan/);
});

test('preflight allows only a complete set of zero-row OK checks', () => {
  const results = [
    { rows: [{ check_name: 'first', affected_rows: '0', status: 'OK' }] },
    { rows: [{ check_name: 'second', affected_rows: '0', status: 'OK' }] }
  ];
  assert.deepEqual(blockedPreflightRows(results), []);
  assert.deepEqual(blockedPreflightRows({ rows: [
    { check_name: 'bad', affected_rows: '2', status: 'BLOCK' }
  ] }), [{ check_name: 'bad', affected_rows: '2', status: 'BLOCK' }]);
  assert.throws(() => blockedPreflightRows({ rows: [] }), /tidak menghasilkan baris/);
});
