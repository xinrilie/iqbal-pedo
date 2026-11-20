# GCIMS — Audit Procurement Sesi 4

Tanggal: 15 November 2026  
Baseline: v0.2.1  
Hasil implementasi: v0.3.0 Procurement MVP  
Produk: GCIMS All-in-One Café Management System, single outlet, GCIMS POS sebagai kasir utama.

## 1. Ringkasan

Audit awal menemukan bahwa database procurement sudah mempunyai 10 tabel inti, tetapi backend belum memiliki supplier/PO/GR services, routes, permissions, atau stock-in posting. User kemudian menjalankan runtime schema check pada PostgreSQL 18.7 / `db_gcims_test`:

- Semua 10 tabel required berstatus `OK`.
- Semua tabel procurement masih kosong (0 rows) pada saat audit runtime.
- Procurement permissions yang terdeteksi saat itu hanya `pos.receipt.read`; permission procurement belum tersedia.
- Schema receipt line semula belum mengikat PO line ke PO header yang sama.
- Schema semula mensyaratkan `quantity_accepted_base > 0`, sehingga full rejection tidak dapat dicatat sebagai baris GR.

**Keputusan:** gunakan kembali tabel existing. Implementasi v0.3.0 menambahkan workflow di atas schema tersebut dan migration additive 005 untuk menutup dua celah integritas dan menambah idempotency/RBAC.

## 2. Runtime schema — terkonfirmasi oleh pengguna

Tabel:

`suppliers`, `supplier_inventory_items`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items`, `inventory_lots`, `item_uom_conversions`, `stock_ledger`, `audit_logs`.

Kolom penting yang terverifikasi:
- Supplier catalog menyimpan supplier SKU, purchase UOM, default price, minimum order, lead time, preferred/active.
- PO menyimpan status, currency, subtotal/discount/tax/shipping/total, created_by/approved_by.
- PO lines menyimpan ordered quantity, conversion factor, base quantity, unit price, discount dan line total.
- GR lines menyimpan received/rejected/accepted quantities, conversion snapshot, unit cost per base unit dan lot id.
- Lot menyimpan supplier, lot code, supplier lot code, received/manufactured/expiry date, unit cost base.
- Ledger mendukung movement `goods_receipt` positif dan source type `goods_receipt`.

Status PO yang tersedia di CHECK: `draft`, `pending_approval`, `approved`, `sent`, `partially_received`, `fully_received`, `closed`, `cancelled`.  
Status GR yang tersedia: `draft`, `submitted`, `approved`, `posted`, `rejected`.

## 3. Celah schema dan tindakan v0.3.0

### 3.1 Receipt line → PO header/line

Sebelum migration 005:
- FK receipt line ke GR header hanya memastikan company/receipt/outlet.
- FK receipt line ke PO line hanya memastikan company/PO line/item.
- Dua FK itu tidak memastikan PO line berasal dari PO yang tercantum pada GR header.

Tindakan migration 005:
- Tambah `purchase_order_id` pada `goods_receipt_items` dan backfill dari GR header.
- Tambah unique composite pada PO lines dan GR headers.
- Ganti FK agar GR item mengikat `(company_id, goods_receipt_id, outlet_id, purchase_order_id)` ke header dan `(company_id, purchase_order_id, purchase_order_item_id, inventory_item_id)` ke PO line.

### 3.2 Full rejection

Sebelumnya `quantity_accepted_base > 0` mencegah full rejected line. Migration 005 mengubah aturan menjadi `quantity_accepted_base >= 0`, mempertahankan formula conversion, dan mewajibkan `rejection_reason` jika rejected quantity > 0. Baris accepted = 0 tetap tercatat di GR namun tidak menghasilkan stock ledger movement.

### 3.3 Idempotency dan permission

Migration 005 menambah `idempotency_key` + request hash pada PO dan GR, unique partial index per company/outlet, permission procurement, grant otomatis ke role `ADMIN` yang sudah ada, dan unique preferred supplier aktif per inventory item/company. Bootstrap admin juga diperbarui.

## 4. Implementasi backend v0.3.0

### Supplier
- List, create, update/deactivate.
- Supplier item catalog list/upsert.
- Validasi supplier/item company scope, active state, purchase UOM, conversion, default price, MOQ.

### Purchase Order
- Create draft dengan `Idempotency-Key`.
- Snapshot nama item, purchase UOM, conversion, quantity, price, discount dan amount.
- Integer Rupiah arithmetic dan fixed-point decimal.
- Workflow submit, approve, send, cancel, close.
- PO cancel diblokir jika ada GR draft/submitted/approved/posted.

### Goods Receipt
- Create GR draft untuk PO sent/partially_received.
- Partial receipt dan rejected quantity.
- Validasi PO line dan lokasi.
- Lot code dan expiry wajib sesuai flags `track_lot`/`track_expiry`.
- Workflow submit, approve, reject, post.
- Post lock GR/PO; lock inventory item ascending; cek cumulative over-receive; create/reuse lot; insert positive `goods_receipt` ledger movement accepted quantity; update GR/PO; tulis audit dalam satu transaksi.
- Retry post pada status posted mengembalikan dokumen sama.

## 5. API yang benar-benar didaftarkan

Prefix `/api/v1`:
- `/procurement/suppliers`
- `/procurement/suppliers/:supplierId/items`
- `/procurement/suppliers/:supplierId/items/:inventoryItemId`
- `/procurement/purchase-orders`
- `/procurement/purchase-orders/:poId`
- `/procurement/purchase-orders/:poId/{submit,approve,send,cancel,close}`
- `/procurement/purchase-orders/:poId/goods-receipts`
- `/procurement/goods-receipts`
- `/procurement/goods-receipts/:receiptId`
- `/procurement/goods-receipts/:receiptId/{submit,approve,reject,post}`

Detail payload/permissions ada di `reference/kontrak_api_sesi4_procurement.md`.

## 6. Prinsip posting Goods Receipt

1. GR harus approved; PO harus sent/partially_received.
2. PO row dikunci agar dua GR untuk PO yang sama terserialisasi.
3. Inventory item dikunci deterministik ascending UUID.
4. Received quantity kumulatif dibandingkan dengan ordered quantity; over-receive ditolak.
5. Untuk lot-tracked item, lot dibuat/reuse dan metadata harus cocok.
6. Hanya accepted base quantity > 0 menghasilkan `stock_ledger` positive `goods_receipt`.
7. Source = GR header; source line = GR item; key deterministik per GR item.
8. GR posted, PO status, stock ledger dan audit log berada dalam transaksi yang sama.
9. Saldo tidak diubah langsung; saldo tetap berasal dari `v_stock_on_hand`.

## 7. Status verifikasi

<small>
- JavaScript syntax (`npm run check`): PASS.
- Automated tests (`npm test`): 29/29 PASS.
- PostgreSQL 18 migration 005: BELUM dijalankan pada database pengguna.
- End-to-end PO/GR posting di PostgreSQL: BELUM diuji.
- Concurrent receiving/rollback: BELUM diuji.
</small>

Karena runtime DB tidak tersedia di build container, v0.3.0 belum boleh disebut production-ready. Langkah berikutnya adalah pengguna menerapkan migration 005 ke `db_gcims_test`, lalu melakukan UAT Supplier → PO → GR → ledger.

## 8. Batas scope yang belum masuk

- Edit PO draft dan edit GR draft.
- Supplier invoice / AP / supplier payment.
- Supplier return/credit note.
- PDF/print/WhatsApp PO/GR.
- Procurement frontend.
- Separation of duties (maker-checker) belum ditegakkan; RBAC permission ada tetapi pembuat masih bisa approve jika memiliki permission.
- Reorder engine, stock opname, waste, adjustment, report dan dashboard.


## Follow-up patch status (15 November 2026)

The findings in this original audit describe the v0.3.0 implementation at that time. A later source patch now adds `assertMakerChecker` to both PO and GR approval paths and introduces `db/migrations/0006_maker_checker_hardening.sql` with database-level checks. `db/preflight/006_maker_checker.sql` reports historical self-approved or missing-maker records before the constraint is applied. This follow-up has 34/34 source/unit/static-contract tests passing; PostgreSQL runtime application and acceptance tests remain pending.
