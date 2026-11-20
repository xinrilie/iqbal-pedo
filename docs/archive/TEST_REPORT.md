# GCIMS Backend v0.2.0 — Test Report

Tanggal pemeriksaan: 2026-11-15

## Hasil

| Pemeriksaan | Hasil | Catatan |
|---|---|---|
| `npm run check` | **PASS** | Semua file JavaScript yang terdaftar, termasuk inventory service/rules, lolos `node --check`. |
| `npm test` | **PASS — 22/22** | Unit/regression tests lulus, termasuk exact quantity math dan allocation rules. |
| OpenAPI YAML parse | **PASS** | `reference/openapi_sesi2.yaml` berhasil diparse sebagai YAML. |
| Inventory migration source guards | **PASS** | Tabel reservation, FK scope, active unique index, available view, expiry logic diperiksa secara statis. |
| Inventory flow source guards | **PASS** | Lock order item, stock availability, FEFO ordering, ledger movement, release helper, dan payment transaction ordering diperiksa. |
| `npm ls --depth=0` | **PASS** | Dependency tree lengkap dan konsisten. |
| Fastify startup + `/health/live` | **PASS** | Server berhasil start; endpoint mengembalikan HTTP 200. |
| `/health/ready` | **EXPECTED 503 / NOT READY** | Server hidup; koneksi PostgreSQL tidak tersedia pada lingkungan audit, sehingga readiness database tidak terpenuhi. |
| PostgreSQL schema/migration runtime | **NOT RUN** | Tidak tersedia PostgreSQL server/client (`postgres`, `pg_ctl`, `psql`, Docker). |
| Transaction/concurrency tests | **NOT RUN** | Memerlukan PostgreSQL hidup dan multi-connection tests. |
| Payment gateway sandbox | **NOT RUN** | Provider belum dipilih/dikonfigurasi. |

## Test coverage

1. Exact decimal arithmetic hingga 6 digit desimal memakai BigInt.
2. Allocator mengikuti urutan bucket dari query (FEFO/FIFO), mengurangi active reservation, dan menolak shortage secara tepat.
3. Negative on-hand tidak dapat dialokasikan.
4. Migration mencakup reservation header/lines, scoped foreign keys, active reservation uniqueness, timestamp state check, dan `v_stock_available`.
5. Service source mengunci `inventory_items` dalam urutan UUID, menghitung reservation aktif, menggunakan outlet timezone untuk expiry, dan menulis `sale_consumption`.
6. Payment path memanggil reserve → insert payment → consume ledger → confirm order → KDS dalam satu `withTransaction`.
7. Hardening v0.1.1 tetap tercakup: company active, payment idempotency, receipt paid-only, BOM required, KDS FIFO/status, serta numeric bounds.

## Batasan penting

Tes source guard dan unit test tidak mengeksekusi SQL terhadap PostgreSQL. Karena itu, migration `db/migrations/0004_inventory_engine_s3.sql`, query `FOR UPDATE`, behavior `SKIP LOCKED`, concurrency/race, rollback, dan integritas ledger **belum dinyatakan lulus runtime**. Pembayaran tetap dibatasi untuk `db_gcims_test` dan non-production.

## Wajib sebelum staging/UAT

- Jalankan seluruh migration pada PostgreSQL 18 database kosong serta upgrade dari dump Sesi 1.
- Siapkan fixture item non-lot, lot FEFO, lot expired, lot tanpa expiry, dan BOM multi-line.
- Jalankan multi-connection reservation test untuk satu stok terbatas dan pastikan tidak ada over-reservation.
- Uji rollback setelah payment insert, setelah ledger insert, dan sebelum KDS/outbox selesai.
- Uji replay payment/reservation/ledger agar tidak ada konsumsi ganda.
- Uji release dan expiry reservation serta pembatalan/refund policy setelah konsumsi.
