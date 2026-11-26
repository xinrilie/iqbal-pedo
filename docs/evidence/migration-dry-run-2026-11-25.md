# Bukti dry-run migration

- **Tanggal:** 25 November 2026
- **Target database:** `db_gcims_test`
- **Perintah:** `npm.cmd run db:migrate -- --dry-run`
- **Pelaksana:** sesi Codex atas instruksi pengguna
- **Hasil:** berhasil; tidak ada migration tertunda; dry-run tidak mengubah database.
- **Reviewer:** belum ditunjuk
- **Batas bukti:** memeriksa status migration saja. Bukan bukti backup/restore, integrasi bisnis, migration apply, atau UAT.

Pemeriksaan tambahan pada working tree yang sama:

- `npm.cmd run check` — lulus, termasuk syntax check skrip backup, restore, dan migration.
- `git diff --check` — lulus; hanya memberi peringatan normalisasi line ending untuk beberapa file.
- Test suite dan UAT tidak dijalankan.

Output:

```text
Database target: db_gcims_test
Tidak ada migration tertunda.
Dry run: database tidak diubah.
```

Skrip `npm run db:backup` dan `npm run db:restore` tersedia di working tree. Backup/restore drill belum dijalankan: `GCIMS_BACKUP_KEY`, `PG_DUMP_PATH`, `GCIMS_RESTORE_DATABASE_URL`, dan `PG_RESTORE_PATH` belum dikonfigurasi; `pg_dump`, `pg_restore`, serta `createdb` tidak tersedia di `PATH` atau lokasi standar PostgreSQL yang diperiksa. Jangan membuat/menyimpan key di repository.
