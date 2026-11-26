# Prosedur operasi dan bukti COBIT 5 Level 2

Dokumen ini menetapkan cara kerja minimum untuk migration, backup/restore, rilis/UAT, dan insiden. Prosedur tidak menaikkan maturity dengan sendirinya: jalankan sesuai jadwal, isi catatan bukti, tindak lanjuti kegagalan, dan lakukan review berkala.

## 1. Peran minimum

Tunjuk nama orang untuk setiap peran sebelum proses dipakai pada data operasional. Satu orang boleh memegang beberapa peran selama pemisahan tugas pada approval transaksi tetap dijaga.

| Peran | Tanggung jawab |
|---|---|
| Pemilik sistem/bisnis | Menyetujui scope rilis, acceptance/UAT, target pemulihan, serta risiko residual. |
| Operator aplikasi | Menjalankan deployment, memeriksa health, mengumpulkan log rilis, dan membuka insiden. |
| Operator database | Backup, restore, migration, akses database, dan verifikasi integritas. |
| Reviewer perubahan | Memeriksa diff, migration, hasil CI, rencana rollback/pemulihan, dan bukti UAT sebelum rilis. |
| Incident lead | Menetapkan severity, koordinator, komunikasi, dan review pascainsiden. |

Nama pemilik dan pengganti: isi pada register bukti di bagian 6 atau sistem pencatatan tim.

## 2. Migration database

### Sebelum perubahan

1. Pastikan perubahan memakai migration bernomor baru; migration lama tidak diedit.
2. Buat backup database target dan pastikan berkas dump dapat dibaca dengan `pg_restore --list`.
3. Jalankan dry-run dari root repository:

   ```powershell
   npm.cmd run db:migrate -- --dry-run
   ```

4. Cocokkan database target dan daftar migration yang dicetak. Jika target salah, marker tidak berurutan, checksum berbeda, atau preflight memblokir, berhenti dan investigasi. Jangan mengedit ledger untuk melewati guard.
5. Review SQL migration, dampak lock/downtime, kebutuhan ruang, dan rencana pemulihan. Reviewer memberi persetujuan tercatat.

### Pelaksanaan dan verifikasi

1. Jalankan secara interaktif:

   ```powershell
   npm.cmd run db:migrate
   ```

2. Simpan output runner, nama database, commit/release, operator, waktu, dan hasil tiap preflight.
3. Periksa bahwa ledger sudah sinkron:

   ```sql
   SELECT version, name, checksum_sha256, applied_at, applied_by, applied_via
   FROM gcims.schema_migrations
   ORDER BY version;
   ```

4. Pastikan endpoint `/health/ready` berstatus `ready`, lalu lakukan smoke test login, POS test path, inventory dan alur yang terdampak.
5. Jika gagal, hentikan perubahan lanjutan. Simpan error/log; jangan menghapus ledger atau menjalankan ulang SQL manual. Pulihkan dari backup atau buat migration korektif setelah review.

Untuk automation, `--yes` hanya boleh dipakai setelah pipeline memvalidasi target dan menyimpan output dry-run serta approval.

## 3. Backup dan restore drill PostgreSQL

### Backup

Jalankan sebelum migration/rilis database dan sesuai frekuensi yang disetujui pemilik sistem. Skrip `npm run db:backup` membuat custom-format dump dan mengenkripsinya dengan AES-256-GCM. Sebelum dipakai:

1. Sediakan executable `pg_dump` yang kompatibel dengan server PostgreSQL. Jika tidak ada di `PATH`, atur `PG_DUMP_PATH`.
2. Atur `GCIMS_BACKUP_KEY` menjadi Base64 dari 32 byte acak. Simpan key di password manager/secret store yang aksesnya dibatasi, terpisah dari backup. Key yang hilang berarti backup tidak dapat direstore. Jangan commit key atau menaruhnya di log/tiket.
3. Pastikan `DATABASE_URL` menunjuk ke database yang benar. `GCIMS_BACKUP_DIR` opsional; lokasi default adalah folder `backups/` yang di-ignore Git.
4. Jalankan:

   ```powershell
   npm.cmd run db:backup
   ```

Simpan nama file, SHA-256, ukuran, database sumber, waktu, versi PostgreSQL, dan ID lokasi storage dalam register backup. Pindahkan salinan terenkripsi ke storage terpisah dari host database dan tetapkan retensi dengan pemilik bisnis.

### Restore drill

Restore harus mengarah ke database baru/terisolasi yang tidak dipakai aplikasi. Buat database kosong dengan akhiran `_restore` atau `_drill` melalui database admin yang disetujui. Sediakan `pg_restore` (atur `PG_RESTORE_PATH` bila tidak ada di `PATH`), lalu atur `GCIMS_RESTORE_DATABASE_URL` ke database kosong tersebut. Skrip menolak nama target tanpa akhiran itu, database sumber yang sama, dan target yang sudah berisi tabel/view/sequences.

Gunakan **key yang sama persis** dengan backup. Pilih file `.gcims.enc` dari lokasi backup yang diverifikasi, lalu jalankan:

```powershell
npm.cmd run db:restore -- "D:\lokasi-aman\gcims-db_gcims_test-timestamp.gcims.enc"
```

Skrip mendekripsi backup ke file sementara di direktori temp OS, memverifikasi tag autentikasi AES-GCM, baru kemudian menjalankan `pg_restore`; file sementara dihapus saat proses selesai/gagal. Penghapusan file bukan secure erase. Jalankan hanya pada mesin/volume terenkripsi dan akun OS yang aksesnya dibatasi; hindari komputer bersama atau temp directory yang dapat dibaca pengguna lain. Pastikan URL target benar; jangan restore ke database bisnis. Setelah restore, validasi objek penting, gunakan konfigurasi aplikasi terisolasi untuk memeriksa `/health/ready`, lalu lakukan smoke test tanpa pembayaran nyata. Catat durasi, error, objek yang diperiksa, hasil, operator dan gap. Database drill dibersihkan hanya setelah hasil disimpan dan target diverifikasi.

Tetapkan target RPO/RTO bersama pemilik bisnis. Sampai ada keputusan tersebut, jangan mengklaim target pemulihan tertentu.

## 4. Rilis dan UAT

Setiap rilis yang mengubah kode atau skema harus memiliki record berikut:

1. PR ditinjau orang selain pembuat; workflow CI `check-and-test` lulus. Pengelola repository harus mengaktifkan **required status check** untuk branch `main`, minimal untuk job `Check and test`, serta melarang direct push sesuai kebijakan tim. File workflow saja tidak mengaktifkan branch protection.
2. Migration ditinjau, dry-run dan preflight lulus; backup dan restore path tersedia untuk perubahan database.
3. UAT dijalankan pada database terisolasi oleh peran bisnis yang ditunjuk. Pilih skenario sesuai perubahan: login/role, order dan pembayaran test, stok/ledger, PO→GR→posting, stocktake→approval→posting, shift/cash drawer, laporan.
4. Catat versi/commit, lingkungan, skenario, hasil aktual, bukti tanpa data sensitif, defect, keputusan accept/reject, nama penguji dan approver.
5. Rilis ke lingkungan tujuan; periksa health/readiness dan smoke test; tetapkan periode observasi serta cara eskalasi.
6. Bila gagal, hentikan promosi lebih lanjut, buka incident/change record, gunakan rencana restore/forward-fix yang telah disetujui, lalu ulangi verifikasi.

### Formulir UAT/rilis

| Field | Isi |
|---|---|
| Release / commit |  |
| Lingkungan dan database |  |
| Migration tertunda / ledger akhir |  |
| Backup ID dan restore terakhir |  |
| CI run / status |  |
| Skenario UAT dan hasil |  |
| Defect / pengecualian |  |
| Keputusan bisnis (accept/reject) |  |
| Operator / reviewer / approver |  |
| Waktu rilis / hasil health check |  |

## 5. Runbook insiden minimum

### Severity awal

- **SEV-1:** transaksi tidak dapat diproses luas, dugaan data hilang/korup, akses tak sah, atau eksposur credential/data. Hentikan perubahan/rilis; hubungi incident lead dan pemilik bisnis segera.
- **SEV-2:** fungsi penting terganggu atau integritas stok/pembayaran diragukan tetapi dampak terbatas. Catat, tetapkan operator, dan eskalasi pada pemilik sistem.
- **SEV-3:** gangguan minor dengan workaround dan tanpa indikasi kehilangan/integritas data. Catat di backlog operasional dan pantau hingga selesai.

Severity ini usulan awal; pemilik bisnis harus menyetujui dan menentukan target respons sebelum dijadikan SLA.

### Database tidak tersedia

1. Catat waktu mulai, request ID, endpoint, dampak pengguna, dan perubahan terakhir.
2. Periksa `/health/ready`, status database, kapasitas disk/koneksi, dan log server tanpa menyalin credential.
3. Jangan menjalankan migration ulang atau mengubah ledger secara manual.
4. Eskalasi ke operator database; pulihkan koneksi/layanan sesuai prosedur hosting. Jika data rusak, incident lead dan pemilik bisnis memutuskan restore berdasarkan RPO/RTO dan bukti backup.
5. Setelah pulih, uji login dan alur transaksi test; rekonsiliasi transaksi/ledger selama periode gangguan; dokumentasikan akar penyebab dan tindakan pencegahan.

### Selisih stok/ledger

1. Hentikan posting ulang terhadap dokumen/PO/GR terkait; jangan mengedit atau menghapus ledger langsung.
2. Catat item, lot, source document, waktu, actor, dan request ID.
3. Minta operator memeriksa ledger, reservation, idempotency key dan dokumen sumber menggunakan query read-only.
4. Koreksi hanya lewat alur transaksi/migration yang direview dan disetujui; lakukan rekonsiliasi sebelum membuka kembali proses.

### Dugaan akun/secret kompromi

1. Eskalasi sebagai SEV-1; batasi akses yang diduga terdampak dan cabut sesi/nonaktifkan akun melalui mekanisme resmi.
2. Rotasi secret yang terdampak dari lingkungan aman; jangan menaruh nilai secret di tiket atau log.
3. Pertahankan log/audit terkait dan catat rentang waktu serta sistem/data yang mungkin terpapar.
4. Incident lead menentukan komunikasi dan kewajiban pemberitahuan setelah konsultasi pemilik bisnis/penasihat yang berwenang.
5. Pulihkan akses dengan prinsip least privilege; review penyebab, tindakan korektif dan tanggal verifikasi.

### Payment callback gagal/berulang

Saat ini provider belum diaktifkan dan webhook mengembalikan 501. Jika integrasi provider kelak diaktifkan, gunakan dashboard provider dan prosedur rekonsiliasi yang disetujui; verifikasi signature/status/nominal, idempotency dan replay behavior. Jangan menandai pembayaran lunas manual tanpa bukti provider dan approval tercatat.

## 6. Register bukti operasi

Simpan register ini di lokasi tim dengan akses terbatas; tautkan file bukti tanpa memasukkan password, token, dump, data pelanggan, atau payload sensitif.

| Tanggal | Proses (migration/backup/restore/release/incident) | Sistem/lingkungan | Operator dan reviewer | Hasil / pengecualian | Tindakan, owner, due date | Link bukti |
|---|---|---|---|---|---|---|
| 2026-11-25 | Migration dry-run | `db_gcims_test` lokal | Pelaksana: sesi Codex atas instruksi pengguna; reviewer belum ditunjuk | Lulus; tidak ada migration tertunda; database tidak diubah. Backup/restore dan UAT belum diuji. | Sediakan PostgreSQL CLI, simpan key di secret store, konfigurasi target drill, jalankan backup/restore; owner belum ditunjuk. | [`evidence/migration-dry-run-2026-11-25.md`](./evidence/migration-dry-run-2026-11-25.md) |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |

## 7. Tinjauan berkala

- **Setiap hari kerja:** cek hasil backup/job dan alert operasional.
- **Setiap rilis:** review PR/CI, migration, UAT, backup, readiness dan sign-off.
- **Bulanan:** restore drill, review akun admin/permission, insiden/exception dan tindakan terbuka.
- **Triwulanan:** review target RPO/RTO, runbook, dependency/security findings, akses backup, KPI/SLO dan efektivitas kontrol bersama pemilik proses.

Frekuensi ini baseline usulan untuk MVP. Pemilik sistem perlu menyetujui penyesuaian berdasarkan volume transaksi, dampak gangguan, dan kemampuan tim. Pada akhir tiap review, catat keputusan, peserta, temuan, owner, tenggat dan tanggal pemeriksaan ulang.
