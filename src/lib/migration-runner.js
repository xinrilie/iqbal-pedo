import { createHash } from 'node:crypto';

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/i;

export function parseMigrationFilename(filename) {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  if (!match) throw new Error(`Nama migration tidak valid: ${filename}`);
  return { version: Number(match[1]), name: filename };
}

export function migrationChecksum(sql) {
  const normalizedSql = sql.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalizedSql, 'utf8').digest('hex');
}

export function unwrapMigrationTransaction(sql, filename = 'migration') {
  const lines = sql.replace(/^\uFEFF/, '').split(/\r?\n/);
  const firstSqlLine = lines.findIndex((line) => line.trim() && !line.trim().startsWith('--'));
  const lastSqlLine = lines.findLastIndex((line) => line.trim() && !line.trim().startsWith('--'));
  if (firstSqlLine < 0 || lastSqlLine < firstSqlLine) throw new Error(`${filename} kosong.`);
  if (lines[firstSqlLine].trim().toUpperCase() !== 'BEGIN;'
      || lines[lastSqlLine].trim().toUpperCase() !== 'COMMIT;') {
    throw new Error(`${filename} harus membungkus migration dengan BEGIN; dan COMMIT; pada baris terluar.`);
  }
  lines.splice(lastSqlLine, 1);
  lines.splice(firstSqlLine, 1);
  return lines.join('\n').trim();
}

export function assertContiguousMigrations(migrations) {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].version !== index + 1) {
      throw new Error(`Urutan migration terputus: diharapkan ${(index + 1).toString().padStart(4, '0')}, ditemukan ${ordered[index].name}.`);
    }
  }
  return ordered;
}

export function inferAppliedVersion(markers) {
  let latest = 0;
  let gapFound = false;
  for (let index = 0; index < markers.length; index += 1) {
    if (markers[index]) {
      if (gapFound) throw new Error(`Skema database tidak berurutan: marker migration ${(index + 1).toString().padStart(4, '0')} ditemukan setelah gap.`);
      latest = index + 1;
    } else if (latest > 0) {
      gapFound = true;
    }
  }
  return latest;
}

export function blockedPreflightRows(queryResults) {
  const results = Array.isArray(queryResults) ? queryResults : [queryResults];
  const checks = results.flatMap((result) => result?.rows ?? []).filter((row) => row.check_name !== undefined);
  if (!checks.length) throw new Error('Preflight tidak menghasilkan baris pemeriksaan; migration dibatalkan.');
  return checks.filter((row) => row.status !== 'OK' || Number(row.affected_rows) !== 0);
}
