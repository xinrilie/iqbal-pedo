# GCIMS — Audit Backlog dan Status Patch

Basis: `GCIMS_Backend_MVP.zip` (backend MVP Sesi 2), enam mockup UI, scope implementasi, kontrak API, skema Sesi 1, dan migration Sesi 2.

Status: **Hardening v0.1.1 dan implementasi kode Inventory Engine Sesi 3 v0.2.0 selesai pada level source/unit tests.** Migration SQL, PostgreSQL runtime, integration, dan concurrency belum diverifikasi; ini bukan sertifikat production readiness.

## P0 — Keamanan distribusi

| ID | Temuan | Dampak | Tindakan | Status / acceptance |
|---|---|---|---|---|
| SEC-001 | Arsip awal menyertakan `.env` berisi konfigurasi rahasia non-placeholder | Credential/secret berpotensi terekspos | Hapus `.env` dari paket distribusi, pertahankan `.env.example`, rotasi secret dan password eksternal | **Paket dibersihkan**; rotasi secret eksternal masih wajib dilakukan pemilik deployment. Acceptance: ZIP baru tidak mengandung `.env` atau `node_modules`. |

## P1 — Perbaikan backend sebelum integrasi operasional

| ID | Temuan | File utama | Tindakan | Status / acceptance |
|---|---|---|---|---|
| AUTH-001 | Company nonaktif masih dapat lolos login/token | `src/auth.js` | Join `gcims.companies` dan wajib `is_active=true` pada login dan authenticate | **Selesai**; guard regresi ada. Runtime DB belum diuji. |
| PAY-001 | Fingerprint idempotensi pembayaran tidak memuat order/outlet | `src/lib/payment-service.js`, `src/lib/payment-rules.js` | Hash memuat company, outlet, order ID, dan body | **Selesai**; test memastikan order berbeda menghasilkan hash berbeda. |
| PAY-002 | Receipt dapat dibuat sebelum pembayaran lunas | `src/lib/payment-service.js`, `src/lib/payment-rules.js` | Receipt hanya untuk order confirmed/completed dan jumlah pembayaran succeeded >= grand total | **Selesai**; unit test untuk belum lunas, draft, dan pembayaran penuh. |
| MENU-001 | Varian tanpa recipe/BOM dapat masuk draft order | `src/lib/order-service.js` | Wajib recipe dan active recipe version; katalog expose sellability | **Selesai**; test source guard. Perlu validasi master data lama sebelum deploy. |
| AUTHZ-002 | `includeUnavailable=true` tidak memiliki permission khusus dan tidak mencakup menu nonaktif | `src/routes/pos.js` | Wajib `admin.menu.read`; filter aktif/nonaktif menyesuaikan flag | **Selesai**; belum integration test role/database. |
| KDS-001 | Antrean diurutkan UUID sehingga bukan FIFO dan pagination tidak stabil | `src/lib/kds-service.js`, `src/lib/ids.js` | Urut `priority, queued_at, id`; composite cursor | **Selesai**; cursor unit test. SQL runtime belum diuji. |
| KDS-002 | Listing KDS menjalankan N+1 query | `src/lib/kds-service.js` | Ambil tiket dan item dalam satu query | **Selesai**; source guard memastikan loop fetch dihilangkan. |
| KDS-003 | Pembatalan item dapat menyebabkan status tiket mundur/invalid timestamp | `src/lib/kds-service.js`, `src/lib/kds-rules.js` | Derive status secara monotonik | **Selesai**; unit test untuk regression case. |
| DATA-001 | Validator kuantitas melampaui batas `NUMERIC(12,3)` | `src/lib/money.js` | Maksimum `999999999.999` | **Selesai**; boundary test. |

## P1 — Inventory Engine Sesi 3 (kode diimplementasikan; runtime acceptance pending)

| ID | Kebutuhan | Dampak jika belum ada | Acceptance wajib |
|---|---|---|---|
| INV-001 | Stock reservation saat order masuk ke payment flow | Dua kasir dapat menjual stok yang sama | **Kode selesai** di `inventory-service.js`, tabel reservation + active unique index; **concurrency test PostgreSQL masih pending**. |
| INV-002 | Atomic stock consumption dari snapshot BOM ketika order dikonfirmasi | Penjualan dan ledger dapat tidak konsisten | **Terintegrasi di cash test-only path** dalam satu `withTransaction`; **rollback/integration test PostgreSQL pending**. |
| INV-003 | Stock ledger idempotency dan unique source movement | Retry dapat mengurangi stok dua kali | **Kode selesai**: reservation state, idempotency key ledger, source line uniqueness; **replay DB test pending**. |
| INV-004 | Locking/ordering per inventory item dan stock location | Deadlock atau race condition antar order | **Lock protocol diimplementasikan** dalam urutan UUID ascending; **multi-connection/deadlock test pending**. |
| INV-005 | Kebijakan stok minus, lot/expiry/FEFO dan pembatalan/refund | Saldo dan traceability tidak dapat dijamin | **No-negative + FEFO/FIFO + expiry validation diimplementasikan**; release helper ada. Refund/return dan provider callback belum ada. |

## P2 — Fitur operasional yang belum tersedia

| ID | Modul | Kebutuhan |
|---|---|---|
| PAY-003 | QRIS/payment gateway | Provider adapter, sandbox, signature verification, event dedupe, inquiry/reconciliation. |
| EVT-001 | Transactional outbox worker | `FOR UPDATE SKIP LOCKED`, lease, retry/backoff, DLQ/manual replay. |
| ADM-001 | Master data | CRUD UOM, inventory, menu, variant, recipe/BOM, outlet override, supplier. |
| PRC-001 | Procurement | Supplier, PO, approval, goods receiving, reject/short receive, stock ledger inbound. Backend MVP implemented in v0.3.0; frontend, AP, returns and runtime acceptance remain outstanding. |
| INV-006 | Stock opname dan adjustment | Count session, variance approval, idempotent adjustment ledger. |
| RPT-001 | Dashboard/reporting | Sales, COGS, stock movement, usage variance, outlet filtering. |
| PAY-004 | Refund dan reconciliation | Refund state machine, approval, partial refund policy, payment-provider reconciliation. |
| UI-001 | Frontend | Admin, cashier, barista/KDS interfaces based on API contract and mockups. |

## P3 — Go-live hardening

1. PostgreSQL integration tests menggunakan schema/migration bersih dan seed reproducible.
2. Concurrency tests untuk order idempotency, payment idempotency, stock reservation/consumption, dan KDS state transitions.
3. Provider sandbox test untuk QRIS dan rekonsiliasi timeout/callback duplikat.
4. Security tests: auth scope escape, permission matrix, SQL injection, rate-limit, secrets, dependency scan, and audit log integrity.
5. Load/soak tests, query plan/index review, monitoring/alerts, backup/restore drill, dan disaster recovery runbook.
6. UAT di outlet pilot sebelum aktivasi produksi.

## Kebijakan yang sudah dipakai oleh Inventory Engine Sesi 3

- Semua varian POS wajib memiliki BOM aktif; bahan diambil dari snapshot BOM order.
- Stok minus dilarang; item dengan `allow_negative_stock=true` ditolak saat pembayaran sampai master dikoreksi.
- Stok dikonsumsi pada saat pembayaran berhasil, bukan pada saat draft dibuat atau saat item diserahkan.
- Lot expiry dilacak: FEFO dan tidak menggunakan lot expired atau lot tanpa expiry; lot tanpa expiry tracking: FIFO `received_at`, tetapi lot expired yang diketahui tetap dikecualikan.
- Pembatalan/refund setelah stock consumption tidak mengembalikan stok otomatis. Butuh workflow return/waste/adjustment tersendiri.
- Satu order terkonfirmasi menghasilkan satu KDS ticket pada baseline MVP.

## Verifikasi tersisa sebelum Inventory Engine dianggap lulus

1. Apply `db/migrations/0004_inventory_engine_s3.sql` pada PostgreSQL 18 bersih setelah schema + migration Sesi 2 + `db/migrations/0003_hardening_v011.sql`.
2. Buat fixture ledger untuk item non-lot, multi-lot FEFO, lot expired, lot tanpa expiry, dan BOM multi-line yang memakai bahan sama.
3. Jalankan dua payment attempt pada dua koneksi untuk stok yang sama; salah satu harus ditolak jika total kebutuhan melebihi stok available.
4. Uji race antara reservation dan consumption, serta reservation dan release.
5. Paksa kegagalan setelah ledger insert tetapi sebelum commit; pastikan payment/order/KDS/reservation/ledger seluruhnya rollback.
6. Uji replay idempotency dan pastikan tidak ada ledger movement kedua.
7. Pastikan setiap writer ledger berikutnya (receiving, waste, adjustment, transfer, stocktake, refund) menggunakan lock protocol item UUID ascending.

## Kriteria selesai patch v0.1.1

- `npm run check` lulus.
- `npm test` lulus.
- ZIP rilis tidak memuat `.env`, `node_modules`, atau file konfigurasi credential lokal.
- Scope yang belum tersedia dinyatakan secara eksplisit dan payment tetap diblokir untuk production.

## Kriteria release v0.2.0 Inventory Engine

- `npm run check` lulus.
- `npm test` lulus.
- Migration `db/migrations/0004_inventory_engine_s3.sql` lulus pada PostgreSQL 18 fresh database dan DB upgrade.
- Concurrency test lintas koneksi menunjukkan tidak ada over-reservation / stok minus.
- Rollback test menunjukkan payment, order status, reservation, stock ledger, outbox dan KDS konsisten.
- Payment tetap test-only sampai semua acceptance di atas dan UAT outlet pilot lulus.


## Follow-up hardening (2026-11-15)

- [x] Canonical migration sequence documented in `db/README.md`; seed scripts 001/002 are explicitly distinguished from schema migrations.
- [x] Read-only preflight added for migration 005 backfill/FK/preferred-supplier/rejection blockers.
- [x] PO and GR approval services enforce maker-checker and reject missing maker identity.
- [x] Migration 006 adds database-level maker-checker checks, scoped repairs for 005 constraint guards, and a goods-receipt lookup index.
- [x] Runtime follow-up on PostgreSQL 18 `db_gcims_test`: migrations 005, 006, and 007 applied; procurement schema, constraints, indexes, and permissions present.
- [x] API smoke flow: Supplier → PO → GR → stock ledger; PO/GR self-approval rejected, distinct approver accepted, posting replay kept one ledger movement, and a reused GR idempotency key on another PO returned 409.
- [x] Posting defect found and fixed: approved GR item rows are locked, while posting must attach the resolved lot. Migration 007 permits only a transaction-authorized NULL-to-lot link with every other row field unchanged; no-op lot updates are skipped.
- [x] `npm run check` and source/unit/static-contract suite: pass, 34/34 tests.
- [x] PostgreSQL procurement receiving concurrency: two simultaneous GR posts that each consume the full remaining PO quantity result in one post and one HTTP 409; the ledger gets one movement.
- [x] Forced PostgreSQL rollback after ledger insert: GR/PO status, stock ledger, and posted audit roll back; a normal retry succeeds exactly once.
- [x] PostgreSQL inventory/payment race: two draft orders concurrently competed for exactly one ingredient unit; one cash payment succeeded and one returned HTTP 409, with no partial reservation/payment/KDS/ledger on the loser.
- [x] Forced payment rollback after stock consumption: payment, reservation, stock ledger, confirmed order, KDS, and payment audit all rolled back; retry with the same idempotency key succeeded exactly once.
- [x] PostgreSQL multi-item lock stress: 12 simultaneous cash payments, each consuming two shared ingredients; all confirmed, each wrote two consumption movements and one KDS ticket, and PostgreSQL deadlock count did not increase.
- [x] Reservation expiry/release race on separate transactions: previous reservation ended `released` or `expired`, exactly one fresh reservation remained active, and payment after cleanup succeeded.
- [x] PostgreSQL/dev API soak: 105-second run, 8 batches × 10 concurrent cash payments (80 total), all successful; 160 sale ledger rows, 80 KDS tickets, exact zero ending balance, no deadlock-counter increase. Payment latency p95 was 398 ms in this local test environment.
- [x] Twelve simultaneous calls to the unconfigured webhook endpoint all returned 501 and wrote no payment/provider-event rows (fail-closed stub behavior).
- [ ] Real provider callback deduplication/signature/concurrency races remain untestable until a provider adapter exists; longer production-like load and soak tests remain outstanding.
