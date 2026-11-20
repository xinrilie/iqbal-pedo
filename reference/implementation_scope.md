# Pemetaan sumber dan implementasi backend MVP

## Fakta dari sumber GCIMS

Enam mockup menunjukkan POS (pilih menu, keranjang, dine-in/takeaway, catatan, subtotal, pajak/diskon/total), bukti pembayaran, dashboard operasional, master inventori, menu/BOM, dan ledger susu. Dokumen rancangan menjelaskan penjualan perlu menyalin snapshot harga/BOM dan saldo stok berasal dari pergerakan ledger. API Sesi 2 mendefinisikan katalog, draft order, pembayaran, receipt, webhook, dan KDS.

## Keputusan implementasi tambahan

- Node.js 22+, Fastify 5, PostgreSQL, JavaScript ESM.
- JWT bearer token dengan scope company/outlet; permission diperiksa dari tabel permission/role.
- Harga disimpan sebagai integer Rupiah; kalkulasi line item dengan integer arithmetic untuk kuantitas POS 3 desimal.
- Tarif pajak dibaca dari `system_settings` key `pos.tax_rate`, sebagai rasio desimal (mis. `0.10`). Default 0 karena angka 10% mockup bukan keputusan pajak produksi.
- `Idempotency-Key` untuk create order/payment; request hash mencegah key dipakai ulang untuk payload berbeda.
- Draft update memakai `If-Match` dan `version_no` compare-and-swap.
- Satu order terkonfirmasi menghasilkan satu KDS ticket untuk baseline MVP.
- Pembayaran tunai hanya mode uji dengan flag eksplisit dan database harus bernama `db_gcims_test`.

## Belum diimplementasikan / tidak boleh diasumsikan tersedia

- Payment gateway/QRIS, verifikasi signature dan sandbox provider.
- Worker untuk memproses outbox.
- Dashboard analitik, admin master CRUD, pengadaan, refund dan rekonsiliasi penuh.
- Frontend aplikasi.

Jangan gunakan backend ini untuk transaksi operasional atau production go-live sebelum bagian yang belum diimplementasikan selesai dan diuji.


## Hardening patch v0.1.1 (2026-11-15)

- Login dan autentikasi token menolak company nonaktif.
- Fingerprint idempotensi pembayaran mencakup company, outlet, order, dan payload.
- Receipt hanya dapat diterbitkan untuk order confirmed/completed yang telah lunas dari pembayaran berstatus succeeded.
- Semua varian POS wajib memiliki resep dan versi BOM aktif; katalog menandai `is_sellable` dan alasan bila belum memenuhi syarat.
- `includeUnavailable=true` memerlukan permission `admin.menu.read` dan mencakup menu/varian nonaktif serta tidak tersedia.
- Antrean KDS memakai FIFO deterministik (`priority`, `queued_at`, `id`), cursor komposit, dan satu query daftar agar tidak N+1.
- Agregasi status tiket KDS tidak boleh mundur setelah pembatalan item.
- Validator kuantitas disesuaikan dengan batas `NUMERIC(12,3)`; pembulatan pajak menggunakan aritmetika desimal/BigInt.
- Migration additive `db/migrations/0003_hardening_v011.sql` menambahkan indeks FIFO untuk antrean KDS.

## Inventory Engine Sesi 3 (implementasi v0.2.0)

- Reservasi stok dari snapshot `sales_order_item_recipe_lines` sebelum konfirmasi pembayaran.
- Lock baris `inventory_items` secara deterministik (UUID ascending) agar reservasi paralel pada item yang sama terserialisasi.
- Saldo dihitung dari `v_stock_on_hand`, dikurangi reservasi aktif yang belum kedaluwarsa.
- Alokasi per lot menggunakan FEFO ketika expiry dilacak; tanggal dibandingkan menurut timezone outlet, lot expired dikecualikan, dan lot tanpa expiry dikecualikan bila `track_expiry=true`. FIFO `received_at` digunakan untuk item lot-tracked yang tidak melacak expiry.
- Konsumsi mengirim pergerakan negatif `sale_consumption` ke append-only `stock_ledger` dengan key unik per reservation line, lalu menandai reservasi consumed.
- Reserve, payment, ledger, order confirmation, outbox, dan KDS dibuat pada transaksi yang sama untuk cash test-only. Rollback transaksi mencegah payment/order sukses tanpa stok terposting.
- `releaseOrderStock` disediakan untuk jalur payment gagal/pembatalan; belum terhubung ke payment-provider callback/API karena provider belum diimplementasikan.
- Kebijakan POS melarang stok minus dan menolak item yang dikonfigurasi `allow_negative_stock=true`.
- Belum termasuk inbound goods receipt, waste, transfer, adjustment, stock opname posting, refund/return, dan worker expiry/outbox. Seluruh modul tersebut wajib memakai protokol row-lock yang sama sebelum menulis ledger.
- Perlu PostgreSQL 18 runtime validation, multi-connection concurrency test, deadlock/rollback test, dan UAT sebelum pembayaran diaktifkan di lingkungan non-test.
