# GCIMS v0.3.0 — Procurement MVP

Dokumentasi utama:
- `reference/procurement_sesi4.md` — desain dan aturan bisnis.
- `reference/kontrak_api_sesi4_procurement.md` — endpoint dan payload.
- `db/migrations/0005_procurement_mvp.sql` — Procurement MVP migration.
- `db/preflight/005_procurement.sql` — read-only data checks before migration 005.
- `db/migrations/0006_maker_checker_hardening.sql` — database-level maker-checker and receipt lookup index.
- `db/preflight/006_maker_checker.sql` — read-only historical approval checks before migration 006.
- `db/README.md` — canonical database setup and migration order.
- `docs/GCIMS_Procurement_Audit_Sesi4.md` — audit runtime dan implementasi.
- `docs/GCIMS_Procurement_Backlog_Sesi4.md` — backlog selesai/tersisa.

## Windows PowerShell

1. Pastikan database target yang benar dan buat backup terlebih dahulu.
2. Untuk migration 005, jalankan preflight dan periksa semua `affected_rows` bernilai `0`:

```powershell
$Psql = 'psql' # Jika tidak ada di PATH, isi dengan full path psql.exe.
& $Psql "$env:DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -f .\db\preflight\005_procurement.sql
```

3. Jika tidak ada blocker, terapkan migration 005:

```powershell
& $Psql "$env:DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -f .\db\migrations\0005_procurement_mvp.sql
```

4. Jalankan preflight 006. Semua pemeriksaan harus bernilai `0`; dokumen lama yang dibuat dan disetujui oleh user yang sama atau tanpa identitas pembuat harus ditinjau secara manual:

```powershell
& $Psql "$env:DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -f .\db\preflight\006_maker_checker.sql
```

5. Jika tidak ada blocker, terapkan migration 006:

```powershell
& $Psql "$env:DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -f .\db\migrations\0006_maker_checker_hardening.sql
```

6. Jalankan `npm.cmd run check`, `npm.cmd test`, restart backend, dan verifikasi `http://127.0.0.1:3000/health/ready`.
Jangan reset database dan jangan ulang schema/migration yang sudah diterapkan. File di `db/seeds/` adalah seed, bukan migration.
