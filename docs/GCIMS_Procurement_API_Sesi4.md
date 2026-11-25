# Kontrak API GCIMS Sesi 4 — Procurement

Base URL: `http://127.0.0.1:3000/api/v1`

Semua endpoint memakai cookie sesi `HttpOnly`; mutasi browser wajib mengirim `X-CSRF-Token`. `company_id` dan `outlet_id` tidak diterima dari body; scope selalu diambil dari sesi. Semua endpoint mengikuti RBAC permission.

## Supplier

### GET `/procurement/suppliers`
Permission: `procurement.supplier.read`

Query: `q`, `includeInactive=true|false`, `limit=1..100`.

Response: `{ data: Supplier[] }`, termasuk `catalog_item_count`.

### POST `/procurement/suppliers`
Permission: `procurement.supplier.write`

```json
{
  "code": "DAIRY-001",
  "name": "Supplier Susu Contoh",
  "contact_name": "Sales",
  "email": "sales@example.test",
  "phone": "081200000000",
  "address": "Alamat supplier",
  "payment_terms": "COD",
  "default_lead_time_days": 2
}
```

### PATCH `/procurement/suppliers/:supplierId`
Permission: `procurement.supplier.write`

Field yang dikirim akan diperbarui. `is_active=false` dipakai untuk menonaktifkan supplier; hard delete tidak disediakan.

### GET `/procurement/suppliers/:supplierId/items`
Permission: `procurement.catalog.read`

### PUT `/procurement/suppliers/:supplierId/items/:inventoryItemId`
Permission: `procurement.catalog.write`

```json
{
  "supplier_sku": "MILK-1L",
  "purchase_uom_id": "<uom-uuid>",
  "default_unit_price": 18000,
  "minimum_order_qty": "2.000000",
  "lead_time_days": 2,
  "is_preferred": true,
  "is_active": true
}
```

`purchase_uom_id` harus sama dengan base UOM item atau memiliki `item_uom_conversions` aktif untuk item tersebut. Supplier catalog memiliki satu row per supplier-item.

## Purchase Order

### GET `/procurement/purchase-orders`
Permission: `procurement.po.read`

Query: `status`, `supplierId`, `limit=1..100`.

### POST `/procurement/purchase-orders`
Permission: `procurement.po.create`

Header wajib: `Idempotency-Key` (16–120 karakter).

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
      "purchase_uom_id": "<uom-uuid>",
      "quantity": "10.000000",
      "unit_price_purchase_uom": 18000,
      "discount_amount": 0,
      "notes": "Susu UHT"
    }
  ]
}
```

`unit_price_purchase_uom` boleh dihilangkan jika default price tersedia di supplier catalog. `purchase_uom_id` boleh dihilangkan untuk memakai UOM default supplier catalog. Harga dan quantity wajib divalidasi server. PO dibuat dengan status `draft`.

### GET `/procurement/purchase-orders/:poId`
Permission: `procurement.po.read`

Response berisi header dan `items`, termasuk `quantity_received_purchase_uom` dan `quantity_outstanding_purchase_uom` dari GR yang sudah posted.

### PO transitions

| Endpoint | Permission | From | To |
|---|---|---|---|
| POST `/:poId/submit` | `procurement.po.submit` | draft | pending_approval |
| POST `/:poId/approve` | `procurement.po.approve` | pending_approval | approved |
| POST `/:poId/send` | `procurement.po.send` | approved | sent |
| POST `/:poId/cancel` | `procurement.po.cancel` | draft/pending_approval/approved/sent | cancelled |
| POST `/:poId/close` | `procurement.po.close` | fully_received | closed |

Prefix lengkap: `/procurement/purchase-orders`.

## Goods Receipt

### POST `/procurement/purchase-orders/:poId/goods-receipts`
Permission: `procurement.receipt.create`

PO harus `sent` atau `partially_received`. Header wajib: `Idempotency-Key`.

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

- `purchase_order_item_id` harus milik PO pada path; relasi ini ditegakkan service dan composite FK migration 005.
- `quantity_received` > 0. `quantity_rejected` default 0 dan tidak boleh melebihi received.
- Jika rejected > 0, `rejection_reason` wajib.
- `quantity_accepted_base` dihitung backend dari snapshot conversion factor PO.
- Item `track_lot=true` memerlukan `lot_code` untuk accepted quantity > 0.
- Item `track_expiry=true` memerlukan `expiry_date` yang belum lewat pada timezone outlet.
- `quantity_accepted_base=0` diperbolehkan untuk full rejection; tidak ada ledger movement untuk baris tersebut.

### GET `/procurement/goods-receipts`
Permission: `procurement.receipt.read`

Query: `status`, `purchaseOrderId`, `limit=1..100`.

### GET `/procurement/goods-receipts/:receiptId`
Permission: `procurement.receipt.read`

### GR transitions

| Endpoint | Permission | From | To |
|---|---|---|---|
| POST `/:receiptId/submit` | `procurement.receipt.submit` | draft | submitted |
| POST `/:receiptId/approve` | `procurement.receipt.approve` | submitted | approved |
| POST `/:receiptId/reject` | `procurement.receipt.approve` | submitted | rejected |
| POST `/:receiptId/post` | `procurement.receipt.post` | approved | posted |

Prefix lengkap: `/procurement/goods-receipts`.

## Posting invariant

Pada GR post, backend:
1. Lock GR row dan PO row.
2. Memastikan PO masih `sent`/`partially_received`.
3. Mengunci semua inventory item terkait dalam urutan UUID ascending.
4. Menghitung total received dari GR posted sebelumnya + GR sekarang dan menolak over-receive.
5. Membuat/reuse lot dengan metadata yang konsisten.
6. Menulis positive `goods_receipt` ledger movement untuk accepted base quantity saja.
7. Menandai GR `posted` dan mengubah status PO.
8. Menulis audit log dalam transaksi yang sama.

Jika satu langkah gagal, seluruh transaksi rollback. POST ulang pada GR `posted` mengembalikan receipt yang sama tanpa movement baru.
