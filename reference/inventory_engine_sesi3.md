# GCIMS Inventory Engine — Sesi 3

## Tujuan

Menghubungkan snapshot BOM pada order POS dengan stok aktual tanpa mengurangi saldo secara ganda atau menjual stok yang sama melalui dua kasir bersamaan.

## Sumber kebenaran

- Kebutuhan bahan transaksi: `gcims.sales_order_item_recipe_lines` (snapshot BOM yang disimpan saat draft dibuat).
- Saldo fisik: `gcims.v_stock_on_hand`, agregasi append-only `gcims.stock_ledger`.
- Reservasi aktif: `gcims.stock_reservations` + `gcims.stock_reservation_lines`, hanya dihitung selama `status='reserved' AND expires_at > now()`.
- Saldo yang bisa dijual per lot: `gcims.v_stock_available`.

Tidak ada tabel saldo yang dapat diedit langsung. Setiap perubahan stok harus menghasilkan movement ledger.

## Alur cash payment saat ini

1. Payment service mengunci sales order.
2. `reserveOrderStock` membaca seluruh snapshot recipe line lalu mengagregasi kebutuhan berdasarkan `inventory_item_id`.
3. `inventory_items` dikunci `FOR UPDATE` dalam urutan UUID ascending. Semua transaksi stok baru wajib mengikuti urutan yang sama.
4. Stok available dihitung dari on-hand dikurangi reservasi aktif di lokasi order.
5. Jika item lot-tracked, sistem mengalokasikan lot FEFO ketika `track_expiry=true`; tanpa expiry tracking, lot dipilih FIFO `received_at`. Lot expired tidak dapat digunakan. Item yang mewajibkan expiry menolak lot tanpa expiry.
6. Header dan lines reservasi ditulis.
7. Pembayaran cash test-only ditulis `succeeded`.
8. `consumeOrderStock` mengunci item lagi (lock transaction sama), memastikan reserved quantity masih didukung on-hand setelah reservasi lain diperhitungkan, lalu menambahkan movement negatif `sale_consumption`.
9. Reservation menjadi `consumed`; order menjadi `confirmed`; outbox event dan KDS ticket/items/events dibuat.
10. Semua langkah terjadi pada satu transaksi database. Error apa pun sebelum commit me-rollback payment, reservation, ledger, order update, outbox, dan KDS.

## Aturan kuantitas dan stok

- Inventory quantity memakai NUMERIC(18,6) dan exact BigInt micro-units di Node.js; tidak ada floating-point allocation.
- Stock minus tidak diizinkan. Master item dengan `allow_negative_stock=true` ditolak agar konfigurasi tidak bertentangan dengan policy POS.
- Reservation TTL default 15 menit, dapat diatur `GCIMS_STOCK_RESERVATION_TTL_MINUTES` antara 1 sampai 120. Current cash path reserve dan consume dalam transaksi yang sama. TTL ditujukan untuk jalur asynchronous provider masa depan.
- Expiry date ditafsirkan menurut `outlets.timezone_name`, bukan timezone server database.
- Expired reservation tidak dihitung dalam available stock; service melakukan opportunistic expiry cleanup dengan `FOR UPDATE SKIP LOCKED`.

## State machine reservation

`reserved` → salah satu dari `consumed`, `released`, atau `expired`. State terminal tidak diaktifkan kembali. Percobaan baru memakai reservation header baru dan idempotency key baru.

- `consumeOrderStock`: hanya reservation `reserved` yang belum expired; `consumed` replay tidak membuat ledger movement baru.
- `releaseOrderStock`: hanya reservation aktif dapat dilepas; reservation consumed memerlukan return/adjustment flow, bukan release.
- Expired/released reservations tidak mengurangi available stock.

## Lock protocol wajib bagi pengembang modul lanjutan

Setiap writer `stock_ledger` (goods receipt, waste, adjustment, transfer, stocktake, return) wajib:

1. Buka transaksi PostgreSQL.
2. Tentukan seluruh inventory item ID yang akan dimutasi.
3. Lock row `gcims.inventory_items` dengan `ORDER BY id FOR UPDATE` dalam urutan ascending.
4. Hitung on-hand/reservation ulang setelah lock diperoleh.
5. Insert ledger movement dan audit/outbox pada transaksi sama.
6. Jangan menulis atau mengubah saldo stok tanpa ledger.

Jika suatu modul mengunci tabel/item dalam urutan berbeda, risiko deadlock dan over-reservation muncul.

## Batasan rilis ini

- Hanya cash payment test-only yang terhubung ke reserve/consume dalam payment transaction. QRIS/provider asynchronous belum ada.
- `releaseOrderStock` tersedia sebagai service helper, tetapi belum dipanggil dari callback provider karena payment provider belum dibuat.
- Belum ada CRUD reservation atau inventory balance endpoint untuk admin.
- Goods receiving, waste, transfer, adjustment, stocktake posting, return/refund, reporting, dan outbox worker belum mengimplementasikan lock protocol ini.
- Pembayaran diblokir pada production dan hanya boleh diuji pada database bernama `db_gcims_test`.
- SQL migration/runtime, multi-connection concurrency, deadlock, dan rollback wajib diverifikasi pada PostgreSQL 18 sebelum dianggap siap operasional.
