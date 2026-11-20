# GCIMS Sesi 4 — Procurement MVP (v0.3.0)

## 1. Tujuan

Membangun workflow pengadaan untuk GCIMS single-outlet di atas tabel procurement yang sudah tersedia. Source transaksi, approval, penerimaan dan penambahan stok harus terlacak. Saldo inventory tetap berasal dari `stock_ledger`; service tidak pernah mengubah saldo secara langsung.

## 2. Modul yang diimplementasikan

### Supplier Management
- List supplier per company.
- Create supplier.
- Update/deactivate supplier.
- List supplier item catalog.
- Upsert supplier item catalog dengan purchase UOM, default price, minimum order quantity, lead time, preferred flag, dan active flag.
- Supplier dan item wajib berada dalam company yang sama.

### Purchase Order
- Create draft PO dengan 1–100 lines.
- Harga dapat dikirim pada PO line atau diambil dari default supplier catalog.
- PO line harus memakai purchase UOM yang terdaftar pada katalog supplier.
- Konversi ke base UOM diambil dari `item_uom_conversions` yang berlaku pada tanggal database; jika purchase UOM sama dengan base UOM, faktor = 1.
- Nama item, purchase UOM, conversion factor, ordered quantity, harga, diskon, dan line total disimpan sebagai snapshot.
- Nilai Rupiah dihitung di backend menggunakan integer arithmetic dan half-up rounding.
- Header total = subtotal - diskon baris + pajak + shipping.
- Create PO memakai `Idempotency-Key` dan request hash.
- Workflow: `draft -> pending_approval -> approved -> sent -> partially_received/fully_received -> closed`.
- Cancel diizinkan sebelum aktivitas receiving dimulai; PO dengan GR draft/submitted/approved/posted tidak dapat dibatalkan.

### Goods Receiving
- Create draft GR untuk PO berstatus `sent` atau `partially_received`.
- Satu PO line hanya boleh muncul satu kali pada satu GR.
- Quantity diterima dan ditolak menggunakan purchase UOM PO line. Faktor konversi diambil dari snapshot PO, bukan dari client.
- Dukung partial receiving dan beberapa GR untuk satu PO.
- Quantity rejected wajib memiliki rejection reason.
- Baris dengan semua quantity ditolak tetap dapat dicatat (`quantity_accepted_base = 0`) tetapi tidak menghasilkan stock ledger movement.
- Jika inventory item `track_lot=true`, penerimaan accepted wajib punya lot code.
- Jika `track_expiry=true`, penerimaan accepted wajib punya expiry date yang belum lewat pada timezone outlet.
- Lot dibuat/reuse saat GR diposting, bukan ketika draft dibuat.
- Workflow: `draft -> submitted -> approved -> posted`, atau `submitted -> rejected`.
- GR post memakai transaksi database, mengunci PO, mengunci inventory item secara UUID ascending, memeriksa over-receive kumulatif, membuat/reuse lot dan menulis ledger.
- Satu accepted GR item menghasilkan satu movement positif `goods_receipt` dengan `source_type='goods_receipt'`, `source_id=goods_receipt_id`, `source_line_id=goods_receipt_item_id`, `source_line_sequence=1`.
- `idempotency_key` ledger berbentuk `goods-receipt:<receipt_id>:<receipt_item_id>`.
- PO status otomatis menjadi `partially_received` atau `fully_received` berdasarkan kuantitas fisik yang sudah diterima pada GR posted (termasuk quantity rejected). Outstanding = ordered - physically received, mengikuti definisi operasional rancangan GCIMS.
- Retry post pada GR berstatus `posted` mengembalikan dokumen yang sama (replay); tidak membuat movement kedua.

## 3. API

Prefix: `/api/v1`

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/procurement/suppliers` | `procurement.supplier.read` | List supplier |
| POST | `/procurement/suppliers` | `procurement.supplier.write` | Create supplier |
| PATCH | `/procurement/suppliers/:supplierId` | `procurement.supplier.write` | Update/deactivate supplier |
| GET | `/procurement/suppliers/:supplierId/items` | `procurement.catalog.read` | List supplier catalog |
| PUT | `/procurement/suppliers/:supplierId/items/:inventoryItemId` | `procurement.catalog.write` | Upsert supplier catalog item |
| GET | `/procurement/purchase-orders` | `procurement.po.read` | List PO |
| POST | `/procurement/purchase-orders` | `procurement.po.create` | Create PO draft; requires `Idempotency-Key` |
| GET | `/procurement/purchase-orders/:poId` | `procurement.po.read` | Detail PO dan aggregate received/outstanding |
| POST | `/procurement/purchase-orders/:poId/submit` | `procurement.po.submit` | Draft -> pending approval |
| POST | `/procurement/purchase-orders/:poId/approve` | `procurement.po.approve` | Pending approval -> approved |
| POST | `/procurement/purchase-orders/:poId/send` | `procurement.po.send` | Approved -> sent |
| POST | `/procurement/purchase-orders/:poId/cancel` | `procurement.po.cancel` | Cancel PO sebelum receiving |
| POST | `/procurement/purchase-orders/:poId/close` | `procurement.po.close` | Close fully received PO |
| POST | `/procurement/purchase-orders/:poId/goods-receipts` | `procurement.receipt.create` | Create GR draft; requires `Idempotency-Key` |
| GET | `/procurement/goods-receipts` | `procurement.receipt.read` | List GR |
| GET | `/procurement/goods-receipts/:receiptId` | `procurement.receipt.read` | Detail GR |
| POST | `/procurement/goods-receipts/:receiptId/submit` | `procurement.receipt.submit` | Draft -> submitted |
| POST | `/procurement/goods-receipts/:receiptId/approve` | `procurement.receipt.approve` | Submitted -> approved |
| POST | `/procurement/goods-receipts/:receiptId/reject` | `procurement.receipt.approve` | Submitted -> rejected |
| POST | `/procurement/goods-receipts/:receiptId/post` | `procurement.receipt.post` | Approved -> posted + stock ledger |

## 4. Contoh payload

### Supplier

```json
{
  "code": "DAIRY-001",
  "name": "Supplier Susu Contoh",
  "contact_name": "Admin Sales",
  "email": "sales@example.test",
  "phone": "081200000000",
  "payment_terms": "COD",
  "default_lead_time_days": 2
}
```

### Supplier catalog

```json
{
  "supplier_sku": "MILK-1L",
  "purchase_uom_id": "<uom-liter-uuid>",
  "default_unit_price": 18000,
  "minimum_order_qty": "2.000000",
  "lead_time_days": 2,
  "is_preferred": true,
  "is_active": true
}
```

### Purchase Order

Header: `Idempotency-Key: gcims-po-<unique-value>`

```json
{
  "supplier_id": "<supplier-uuid>",
  "expected_at": "2026-11-20T09:00:00+07:00",
  "currency_code": "IDR",
  "tax_amount": 0,
  "shipping_amount": 0,
  "notes": "Pembelian stok mingguan",
  "lines": [
    {
      "inventory_item_id": "<inventory-item-uuid>",
      "purchase_uom_id": "<uom-liter-uuid>",
      "quantity": "10.000000",
      "unit_price_purchase_uom": 18000,
      "discount_amount": 0,
      "notes": "Susu UHT full cream"
    }
  ]
}
```

### Goods Receipt

Header: `Idempotency-Key: gcims-gr-<unique-value>`

```json
{
  "stock_location_id": "<stock-location-uuid>",
  "supplier_document_no": "INV-SUP-001",
  "notes": "Penerimaan kiriman pagi",
  "lines": [
    {
      "purchase_order_item_id": "<po-line-uuid>",
      "quantity_received": "10.000000",
      "quantity_rejected": "1.000000",
      "lot_code": "MILK-LOT-202611",
      "supplier_lot_code": "SUP-LOT-7781",
      "manufactured_at": "2026-11-01",
      "expiry_date": "2027-02-01",
      "rejection_reason": "Kemasan penyok"
    }
  ]
}
```

`quantity_accepted_base` dihitung backend = `(received - rejected) * base_qty_per_purchase_unit` dengan pembulatan 6 desimal. Client tidak boleh mengirim hasil konversi sendiri.

## 5. Migration

File baru: `db/migrations/0005_procurement_mvp.sql`

Apply setelah migration `0001_schema_sesi1.sql` hingga `0004_inventory_engine_s3.sql`.

Migration:
- Menambah idempotency key/hash untuk PO dan GR.
- Menambah snapshot PO identity dan metadata lot pada GR item.
- Mem-backfill purchase_order_id dan lot metadata dari header/lot yang sudah ada.
- Mengganti FK agar GR item wajib merujuk PO line dari PO header yang sama.
- Mengizinkan full rejection tanpa menambah stok.
- Menambah procurement permissions dan memberikan seluruh permission procurement kepada company-scoped role `ADMIN` yang sudah ada.

Jangan reset database atau mengulang migration yang sudah diterapkan. File `db/001` dan `db/002` adalah seed, bukan schema migration. Ikuti `db/README.md` dan buat backup sebelum mengubah database yang berisi data.

## 6. Known limitations / not yet production-ready

- Belum ada endpoint edit PO draft atau edit GR draft; buat ulang dokumen draft yang salah sebelum submit, atau cancel PO jika belum ada receiving.
- Follow-up hardening: maker-checker kini ditegakkan pada service PO/GR dan melalui check constraint migration 006. Jalankan preflight 006 terlebih dahulu; penerapan PostgreSQL runtime tetap harus diverifikasi.
- Belum ada supplier invoice/AP, pembayaran supplier, retur ke supplier, attachment invoice/foto, PDF/WhatsApp PO, dan reorder suggestion.
- Belum ada frontend Procurement.
- Tidak ada PostgreSQL runtime verification pada lingkungan build ini; migration dan transaksi GR harus diuji pada database test milik pengguna.
- Automated unit/contract tests tidak menggantikan concurrent multi-connection test, rollback test, atau UAT.

## 7. Prinsip integritas

- Stok bertambah hanya saat GR status approved diposting.
- Stock ledger append-only; tidak ada UPDATE/DELETE ledger.
- Hanya quantity accepted yang menambah stok.
- Lot dibuat/reuse dan ledger diposting dalam transaksi yang sama.
- PO receiving cumulative diperiksa saat post di bawah lock PO; dua GR untuk PO yang sama terserialisasi.
- Scope company/outlet selalu diambil dari JWT, bukan dari body client.
