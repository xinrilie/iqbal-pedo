# GCIMS — Audit Ringkas Paket v0.3.0

Tanggal audit: 15 November 2026
Basis: arsip GCIMS_Backend_MVP.zip yang diberikan.

## Hasil yang dapat dibuktikan
- `npm run check`: PASS pada Node.js 22.16.0.
- Baseline audit: `npm test` PASS, 29/29 test.
- Follow-up patch (same source tree): `npm run check` PASS and `npm test` PASS, 34/34 test.
- Cakupan kode: auth/RBAC, POS, order, payment tunai test-only, KDS, Inventory Engine Sesi 3, Procurement MVP Sesi 4.
- Migration procurement 005 dan transaksi Supplier → PO → GR → ledger belum diuji pada PostgreSQL runtime.

## Temuan prioritas
1. **P0 — Secret exposure:** arsip asal menyertakan `.env` berisi `DATABASE_URL` dan `JWT_SECRET` non-placeholder. Nilainya tidak disalin ke paket hasil audit. Anggap kredensial tersebut terekspos: rotasi password/database credential dan JWT secret sebelum sistem digunakan kembali.
2. **P1 — Verifikasi DB tertunda:** jalankan migration dan acceptance test pada database uji bersih; khususnya concurrency receiving, rollback posting GR, idempotency replay, dan FEFO/inventory.
3. **P1 — Separation of duties:** follow-up patch now blocks PO/GR self-approval in service logic and adds PostgreSQL constraints in `db/migrations/0006_maker_checker_hardening.sql`. Runtime application remains pending; run `db/preflight/006_maker_checker.sql` first.
4. **P2 — Procurement belum lengkap:** draft edit/discard, supplier AP/payment, supplier return, frontend procurement, stock opname/adjustment, reporting belum tersedia.
5. **P2 — Pembayaran produksi belum tersedia:** QRIS/provider adapter, webhook signature validation, reconciliation, refund, outbox worker belum tersedia. Pembayaran tetap test-only.

## Pembersihan paket
- Dihapus: `.env`, `node_modules/`, arsip ZIP sumber bersarang, backup `auth.js.backup`, direktori migration duplikat, salinan dokumen identik, dan runtime-check SQL duplikat.
- Dipertahankan: source backend, tests, scripts, migrations SQL canonical, schema/dump database, kontrak API, handoff aktif, backlog, laporan test, dan mockup UI.
- Tidak ada fitur aplikasi yang sengaja dihapus dari source. Ini pembersihan distribusi/duplikasi, bukan refactor perilaku.

## Urutan kerja yang direkomendasikan
1. Rotasi secret dan siapkan database uji terpisah.
2. For a fresh test database, follow `db/README.md`; `db/001` and `db/002` are seeds. Run the 005 and 006 preflights before their migrations.
3. Jalankan acceptance test Inventory dan Procurement pada PostgreSQL, termasuk concurrency dan rollback.
4. Apply and verify outstanding migrations, then fix runtime findings before adding new modules.
5. Setelah stabil, lanjutkan modul berikutnya berdasarkan kebutuhan operasional; jangan dulu membangun payment gateway produksi atau dashboard sebelum fondasi DB lulus.

## Batas audit
Audit ini memeriksa struktur arsip, konfigurasi, kontrak/dokumentasi, syntax JavaScript, dan unit/static tests. Tidak ada koneksi ke database pengguna; karena itu tidak menyatakan migrasi SQL, keamanan deployment, maupun kesiapan produksi telah lulus.

## Follow-up runtime (2026-11-15)
- Pada `db_gcims_test` PostgreSQL 18, migration 005, 006, dan 007 berhasil diterapkan; runtime check menunjukkan seluruh tabel procurement, constraint maker-checker, index, dan permission tersedia.
- Smoke test API Supplier → PO → GR → stock ledger lulus. Self-approval PO/GR ditolak; approval user berbeda diterima; posting GR menghasilkan satu movement `+2.000000`; replay tidak menggandakan movement; idempotency key GR yang sama pada PO lain ditolak dengan HTTP 409.
- Smoke test menemukan dan memperbaiki kegagalan post akibat trigger penguncian baris GR. Perbaikan guard ada di migration 007 dan service kini menghindari no-op update lot.
- Setelah perubahan: `npm run check` lulus dan `npm test` lulus (34/34).
- Uji concurrency/rollback procurement lulus: dua GR posting bersamaan menghasilkan satu sukses dan satu HTTP 409 tanpa over-receive; forced failure setelah ledger insert me-rollback GR, PO, ledger, dan audit, lalu retry berhasil.
- Uji inventory/payment concurrency dan rollback lulus di `db_gcims_test`: dua order berebut satu unit bahan menghasilkan satu pembayaran cash sukses dan satu HTTP 409; order yang kalah tidak meninggalkan payment, reservasi, ledger, atau KDS. Forced failure sesudah konsumsi stok me-rollback seluruh transaksi, dan retry dengan idempotency key sama berhasil sekali.
- Item/menu smoke test dinonaktifkan setelah verifikasi, akun test dinonaktifkan, saldo item test kembali nol, dan trigger/function pemaksa rollback dihapus.
- Pada 2026-11-16, 12 pembayaran tunai multi-item berjalan bersamaan; semua sukses, dua movement konsumsi per order, satu tiket KDS per order, dan counter deadlock PostgreSQL tidak meningkat. Race expiry/release reservation lintas transaksi berakhir konsisten; reservasi baru tetap tunggal dan pembayaran sesudahnya berhasil.
- Item/menu/user stress test dinonaktifkan sesudah uji. Longer soak/load dan payment-provider callback races belum dijalankan.
- Pada 2026-11-16, soak API selama 105 detik menyelesaikan 80/80 cash payments dalam 8 batch dengan concurrency 10. Tercatat 160 sale ledger movements, 80 KDS tickets, saldo akhir item uji nol, deadlock counter tetap nol; p95 create-order 558 ms dan p95 payment 398 ms pada mesin/database lokal.
- Dua belas request webhook simultan ke provider yang tidak dikonfigurasi menghasilkan 501 dan tidak mengubah payment/payment_events. Ini hanya membuktikan stub fail-closed; callback race provider sungguhan, validasi signature, dan deduplikasi masih membutuhkan adapter.
- Item/menu/user soak dinonaktifkan dan saldo uji nol; production-like load/soak masih belum dilakukan.
