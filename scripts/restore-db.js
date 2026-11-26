import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { parsePostgresConnection } from './lib/postgres-connection.js';

const { Client } = pg;

const MAGIC = Buffer.from('GCIMSBK1');
const HEADER_LENGTH = MAGIC.length + 12;
const TAG_LENGTH = 16;

function getEncryptionKey() {
  const encoded = process.env.GCIMS_BACKUP_KEY;
  if (!encoded) throw new Error('GCIMS_BACKUP_KEY belum diatur. Kunci yang sama harus dipakai saat backup dibuat.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('GCIMS_BACKUP_KEY harus berupa Base64 dari tepat 32 byte.');
  return key;
}

function decryptStream(key) {
  let header = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let decipher;

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        let encrypted = chunk;
        if (!decipher) {
          const take = Math.min(HEADER_LENGTH - header.length, encrypted.length);
          header = Buffer.concat([header, encrypted.subarray(0, take)]);
          encrypted = encrypted.subarray(take);
          if (header.length < HEADER_LENGTH) return callback();
          if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Format backup tidak dikenali.');
          decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
        }

        const buffered = Buffer.concat([tail, encrypted]);
        if (buffered.length > TAG_LENGTH) {
          this.push(decipher.update(buffered.subarray(0, buffered.length - TAG_LENGTH)));
          tail = buffered.subarray(buffered.length - TAG_LENGTH);
        } else {
          tail = buffered;
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        if (!decipher || header.length !== HEADER_LENGTH || tail.length !== TAG_LENGTH) {
          throw new Error('File backup tidak lengkap atau formatnya rusak.');
        }
        decipher.setAuthTag(tail);
        this.push(decipher.final());
        callback();
      } catch {
        callback(new Error('Verifikasi backup gagal. Kunci salah atau file rusak.'));
      }
    }
  });
}

function runPgRestore(child) {
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
  return new Promise((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Tidak dapat menjalankan pg_restore: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`pg_restore gagal (${signal || `exit ${code}`}): ${stderr.trim() || 'tanpa rincian error'}`));
    });
  });
}

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath) throw new Error('Gunakan: npm.cmd run db:restore -- <file-backup.gcims.enc>');
  const key = getEncryptionKey();
  const connection = parsePostgresConnection(process.env.GCIMS_RESTORE_DATABASE_URL, 'GCIMS_RESTORE_DATABASE_URL');
  if (!/(?:_restore|_drill)$/i.test(connection.databaseName)) {
    throw new Error('Target restore harus memakai nama database berakhiran _restore atau _drill.');
  }
  const source = parsePostgresConnection(process.env.DATABASE_URL);
  if (connection.host === source.host && connection.port === source.port && connection.databaseName === source.databaseName) {
    throw new Error('Target restore tidak boleh sama dengan database sumber.');
  }

  const targetClient = new Client({ connectionString: process.env.GCIMS_RESTORE_DATABASE_URL });
  await targetClient.connect();
  try {
    const existingObjects = await targetClient.query(
      `SELECT n.nspname
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r','p','v','m','S','f')
        LIMIT 1`
    );
    if (existingObjects.rowCount) throw new Error(`Database target tidak kosong (objek ditemukan di schema ${existingObjects.rows[0].nspname}).`);
  } finally {
    await targetClient.end();
  }

  const scratchDirectory = await mkdtemp(path.join(os.tmpdir(), 'gcims-restore-'));
  const decryptedDumpPath = path.join(scratchDirectory, 'verified.dump');
  try {
    await chmod(scratchDirectory, 0o700);
    await pipeline(
      createReadStream(backupPath),
      decryptStream(key),
      createWriteStream(decryptedDumpPath, { flags: 'wx', mode: 0o600 })
    );

    const program = process.env.PG_RESTORE_PATH || 'pg_restore';
    const child = spawn(program, [
      '--exit-on-error', '--no-owner', '--no-privileges', ...connection.args, decryptedDumpPath
    ], {
      env: { ...process.env, ...connection.env },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    await runPgRestore(child);
    console.log(`Restore berhasil ke database drill: ${connection.databaseName}`);
    console.log('Validasi /health/ready dan alur aplikasi sebelum menyatakan restore berhasil.');
  } finally {
    await rm(decryptedDumpPath, { force: true });
    await rmdir(scratchDirectory);
  }
}

main().catch((error) => {
  console.error(`Restore gagal: ${error.message}`);
  process.exitCode = 1;
});
