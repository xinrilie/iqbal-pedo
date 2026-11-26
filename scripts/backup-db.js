import 'dotenv/config';
import { createCipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parsePostgresConnection } from './lib/postgres-connection.js';

const MAGIC = Buffer.from('GCIMSBK1');

function getEncryptionKey() {
  const encoded = process.env.GCIMS_BACKUP_KEY;
  if (!encoded) throw new Error('GCIMS_BACKUP_KEY belum diatur. Simpan kunci acak 32 byte di luar repo.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('GCIMS_BACKUP_KEY harus berupa Base64 dari tepat 32 byte.');
  return key;
}

function runPgDump(child) {
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
  return new Promise((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Tidak dapat menjalankan pg_dump: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`pg_dump gagal (${signal || `exit ${code}`}): ${stderr.trim() || 'tanpa rincian error'}`));
    });
  });
}

async function main() {
  const key = getEncryptionKey();
  const connection = parsePostgresConnection(process.env.DATABASE_URL);
  const directory = path.resolve(process.env.GCIMS_BACKUP_DIR || path.join(process.cwd(), 'backups'));
  await mkdir(directory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  const safeDatabase = connection.databaseName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const outputPath = path.join(directory, `gcims-${safeDatabase}-${timestamp}.gcims.enc`);
  const temporaryPath = `${outputPath}.partial`;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const program = process.env.PG_DUMP_PATH || 'pg_dump';
  const child = spawn(program, ['--format=custom', '--no-owner', '--no-privileges', ...connection.args], {
    env: { ...process.env, ...connection.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = runPgDump(child);

  try {
    await writeFile(temporaryPath, Buffer.concat([MAGIC, iv]), { flag: 'wx', mode: 0o600 });
    await Promise.all([
      pipeline(child.stdout, cipher, createWriteStream(temporaryPath, { flags: 'a', mode: 0o600 })),
      exited
    ]);
    await appendFile(temporaryPath, cipher.getAuthTag());
    await rename(temporaryPath, outputPath);
    console.log(`Backup terenkripsi berhasil: ${outputPath}`);
    console.log(`Database: ${connection.databaseName}; ukuran: ${(await stat(outputPath)).size} byte`);
  } catch (error) {
    child.kill();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(`Backup gagal: ${error.message}`);
  process.exitCode = 1;
});
