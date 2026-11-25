# Kontrak API GCIMS v1 — POS, Pembayaran, dan KDS

## 1. Tujuan dan batas

Dokumen ini menetapkan kontrak komunikasi antara frontend kasir/admin/barista dengan backend GCIMS. Kontrak mengikuti struktur data Sesi 1 dan kebutuhan yang tampak dalam enam mockup. Ini **belum merupakan implementasi backend**.

### Yang bersumber dari mockup
- Kasir memilih menu, menambah kuantitas, menulis catatan, memilih dine-in/takeaway, melihat subtotal/pajak/diskon/total, lalu membayar.
- Pembayaran berhasil menampilkan detail transaksi dan bukti pembayaran.
- Admin melihat ringkasan penjualan dan operasional.
- Navigasi operasional memuat menu, inventori, BOM, ledger, supplier, pengadaan, penerimaan, dan stock opname.

### Rekomendasi teknis
- API menggunakan prefix `/api/v1` dan JSON.
- Harga IDR diserialisasi sebagai integer Rupiah (tanpa floating point). Kuantitas POS diserialisasi sebagai string desimal untuk menjaga presisi `NUMERIC(12,3)` pada `sales_order_items` (maksimum `999999999.999`). Kuantitas konsumsi bahan pada snapshot BOM menggunakan `NUMERIC(18,6)`.
- Semua mutasi sensitif memakai autentikasi dan pemeriksaan permission/outlet scope.
- `Idempotency-Key` diwajibkan pada pembuatan order/pembayaran dan operasi yang dapat diulang.
- KDS memiliki status sendiri, tidak digabung ke status pembayaran.

## 2. Konvensi umum

| Area | Kontrak |
|---|---|
| Base path | `/api/v1` |
| Content type | `application/json; charset=utf-8` |
| Auth | Cookie sesi `HttpOnly`; mutasi browser memakai header `X-CSRF-Token` kecuali webhook provider |
| Waktu | RFC 3339/ISO-8601 dengan timezone; simpan `TIMESTAMPTZ` |
| Uang | Integer Rupiah, contoh `76000` |
| Kuantitas | String desimal, contoh `"150.000"` |
| Identitas | UUID string |
| Pagination | `limit` dan `cursor`; default 25, maksimum 100 |
| Idempotensi | Header `Idempotency-Key`, 16–120 karakter |
| Error | `code`, `message`, `request_id`, `details` |

### Header mutasi
- `Idempotency-Key`: wajib untuk `POST /outlets/{outletId}/orders` dan `POST /orders/{orderId}/payments`. Request hash SHA-256 tersimpan bersama resource untuk mendeteksi key yang dipakai ulang dengan scope/resource berbeda atau body berbeda. Fingerprint payment mencakup company, outlet, order ID, dan body.
- `If-Match`: wajib untuk `PUT /orders/{orderId}/items`; berisi `version_no` draft yang dibaca frontend. Jika versi sudah berubah, backend mengembalikan 409.
- `X-Request-Id`: dibuat gateway/backend jika tidak diberikan; dipakai untuk tracing dan audit.
- `version_no` adalah tambahan migration Sesi 2. Backend harus mengubah draft secara compare-and-swap (`WHERE version_no = expected_version`) dan menaikkan versi dalam transaksi yang sama.

### Envelope sukses
Resource dikembalikan langsung sebagai objek JSON dengan metadata pagination hanya untuk koleksi.

### Envelope error
```json
{
  "error": {
    "code": "ORDER_NOT_EDITABLE",
    "message": "Pesanan tidak lagi berstatus draft.",
    "request_id": "req_01J...",
    "details": []
  }
}
```

Kode HTTP utama:

| HTTP | Arti |
|---:|---|
| 400 | Payload tidak valid / aturan input gagal |
| 401 | Belum terautentikasi atau token tidak valid |
| 403 | Permission atau outlet scope tidak mencukupi |
| 404 | Resource tidak ditemukan dalam scope pengguna |
| 409 | Status konflik, idempotency key dipakai untuk payload berbeda, atau operasi duplikat |
| 422 | Aturan bisnis tidak terpenuhi |
| 429 | Rate limit |
| 500 | Kesalahan internal; response tidak membocorkan SQL/stack trace |
| 502/503 | Provider/layanan downstream tidak tersedia; status pembayaran tetap pending/rekonsiliasi, bukan diasumsikan gagal/lunas |

## 3. Status dan sumber kebenaran

### 3.1 Order

DDL Sesi 1 saat ini mengizinkan:
`draft`, `pending_payment`, `confirmed`, `in_preparation`, `ready`, `served`, `completed`, `cancelled`, `partially_cancelled`, `partially_refunded`, `refunded`.

Untuk kontrak API baru, gunakan:
- `draft`: keranjang masih dapat diedit.
- `pending_payment`: ada instruksi pembayaran yang menunggu hasil.
- `confirmed`: pembayaran sudah memenuhi kewajiban order dan order diterima.
- `completed`: pesanan sudah diserahkan/ditutup.
- `cancelled`, `partially_cancelled`, `partially_refunded`, `refunded`: alur koreksi/penyelesaian sesuai kebijakan.

Nilai `in_preparation`, `ready`, dan `served` tetap ada di constraint DDL lama untuk kompatibilitas, tetapi **API baru tidak menulisnya**. Status produksi berasal dari tiket KDS. Penyempurnaan constraint status order dapat dibuat sebagai migration terpisah setelah kompatibilitas diperiksa.

### 3.2 Payment

Mengikuti enum DDL: `pending`, `succeeded`, `failed`, `expired`, `cancelled`, `partially_refunded`, `refunded`, `reconciliation_required`.

- Redirect browser atau screenshot QR bukan bukti pembayaran.
- QRIS baru `succeeded` setelah callback server-to-server valid atau rekonsiliasi tepercaya.
- Timeout ketika memanggil provider tidak otomatis berarti `failed`; tetap `pending` atau `reconciliation_required` sampai status diverifikasi.

### 3.3 Produksi/KDS

Status rekomendasi tabel baru:
- Ticket: `queued` → `in_preparation` → `ready` → `served`; alternatif `cancelled` dengan alasan.
- Item: `queued` → `in_preparation` → `ready` → `served`; alternatif `cancelled`.
- Perpindahan status wajib mengikuti transisi yang sah; transisi mundur membutuhkan permission dan alasan koreksi. Pengulangan request dengan status target yang sama adalah no-op: kembalikan keadaan terkini tanpa menulis kitchen event kedua.

## 4. Endpoint

| Method & path | Fungsi | Permission rekomendasi |
|---|---|---|
| `GET /outlets/{outletId}/catalog?stockLocationId={uuid}` | Menu/varian dan estimasi porsi yang dapat dibuat dari bahan di lokasi stok terpilih | `pos.catalog.read` |
| `GET /outlets/{outletId}/stock-locations` | Lokasi stok aktif untuk membuat order kasir | `pos.order.create` |
| `POST /outlets/{outletId}/orders` | Membuat draft order dan snapshot harga/BOM | `pos.order.create` |
| `GET /orders/{orderId}` | Detail order | `pos.order.read` |
| `PUT /orders/{orderId}/items` | Mengganti isi keranjang draft dengan `If-Match` | `pos.order.update` |
| `POST /orders/{orderId}/payments` | Memulai pembayaran cash/QRIS/dll | `pos.payment.create` |
| `GET /payments/{paymentId}` | Status pembayaran | `pos.payment.read` |
| `POST /payments/{paymentId}/cancel` | Membatalkan payment pending bila provider mendukung | `pos.payment.cancel` |
| `GET /orders/{orderId}/receipt` | Bukti pembayaran/receipt (hanya setelah order confirmed/completed dan total pembayaran sukses melunasi tagihan) | `pos.receipt.read` |
| `POST /webhooks/payments/{providerCode}` | Menerima callback provider | Signature provider, tanpa bearer user |
| `GET /kds/tickets` | Daftar antrean produksi per outlet/station | `kds.ticket.read` |
| `GET /kds/tickets/{ticketId}` | Detail tiket | `kds.ticket.read` |
| `PATCH /kds/tickets/{ticketId}/status` | Mengubah status tiket | `kds.ticket.update` |
| `PATCH /kds/tickets/{ticketId}/items/{ticketItemId}/status` | Mengubah status item | `kds.ticket.update` |

## 5. Aturan katalog dan harga

1. Filter katalog berdasarkan `company_id` dan `outlet_id` yang sudah diotorisasi.
2. Menu/varian nonaktif atau tidak tersedia tidak tampil kecuali pemanggil memiliki permission `admin.menu.read` dan meminta `includeUnavailable=true`.
3. Harga outlet dari `outlet_menu_variants` mengalahkan harga dasar `menu_variants.price_amount`; jika tidak ada override, pakai harga dasar.
4. Harga yang dikirim frontend hanya untuk display; backend menghitung ulang saat membuat/mengubah order.
5. Resep aktif dipilih server berdasarkan `recipe_versions.status='active'` dan `effective_from/effective_to`; jangan percaya `recipe_version_id` dari browser. Setiap varian POS wajib memiliki resep dan versi BOM aktif. Katalog menandai `is_sellable=false` beserta `sellability_reason` bila syarat tersebut belum terpenuhi.
6. Jika `stockLocationId` diisi, katalog menghitung estimasi porsi dari saldo ledger dikurangi reservasi aktif; lot expired mengikuti aturan FEFO outlet. `available_quantity` dan `is_in_stock` hanya snapshot untuk membantu kasir menandai menu habis. Nilainya dapat berubah sesudah katalog dibaca, sehingga reservasi atomik saat pembayaran tetap menjadi pemeriksaan final.

## 6. Pembuatan dan perubahan draft order

- Order dibuat dengan `status='draft'` dan nomor order dibuat server.
- `stock_location_id` wajib berada di outlet yang sama.
- `order_type` hanya `dine_in` atau `takeaway` sesuai DDL.
- Setiap baris mengacu pada `menu_variant_id` aktif. Harga, nama menu/varian, pajak, diskon, resep aktif, dan rincian resep disnapshot server ke `sales_order_items` dan `sales_order_item_recipe_lines`.
- Kuantitas harus positif. Satuan uang integer IDR; kalkulasi subtotal/pajak/total dilakukan server dengan kebijakan rounding terpusat.
- `PUT /items` bersifat replace-all untuk seluruh keranjang draft agar perilaku jelas; backend menjalankannya dalam satu transaksi DB: lock order, cek `If-Match`, hapus baris draft lama, tulis ulang item + snapshot, hitung ulang header, lalu menaikkan `version_no`.
- Trigger Sesi 1 membatasi perubahan sales item/snapshot saat order bukan draft. API harus mengubah status setelah item selesai disimpan.

## 7. Pembayaran dan callback

### Cash
1. Lock order `FOR UPDATE`; pastikan draft/pending_payment dan jumlah jatuh tempo benar.
2. Validasi uang diterima ≥ jumlah dibayar; hitung kembalian server.
3. Buat `payments` dengan idempotency key, `status='succeeded'`, `method='cash'`.
4. Perbarui order ke `confirmed` dan buat tiket KDS/outbox dalam transaksi yang sama.

### QRIS/Provider
1. Buat `payments` dengan `status='pending'` dan idempotency key sebelum request provider.
2. Panggil provider melalui adapter di luar transaksi DB; simpan provider reference dan detail instruksi yang aman untuk pelanggan.
3. Jika provider timeout, jangan tandai gagal secara spekulatif; status tetap pending/reconciliation_required dan jalankan inquiry/reconcile.
4. Callback diverifikasi signature, timestamp, merchant reference, nominal, mata uang, dan status dari provider.
5. Deduplicate berdasarkan `(provider_code, provider_event_id)`.
6. Simpan event di webhook inbox; proses payment/order di satu transaksi DB dengan row lock. Event sukses yang sudah diproses tidak boleh mem-posting ulang tiket, stok, atau notifikasi.
7. Event sukses mengonfirmasi order dan membuat KDS ticket + outbox event tepat satu kali.

### Batas penting Sesi 3
DDL Sesi 1 belum mempunyai reservasi stok. Karena itu, validasi stok, penguncian bahan, pemotongan ledger yang atomik, dan race condition antar kasir **belum selesai**. Alur pembayaran yang mengaktifkan penjualan nyata belum boleh go-live sampai Sesi 3 mengimplementasikan reserve/consume yang aman dan acceptance test concurrency lulus.

## 8. KDS / antrean barista

- Satu order confirmed menghasilkan satu kitchen ticket pada baseline MVP; bila kelak ada beberapa station, pecah ticket berdasarkan station melalui migration lanjutan.
- Item tiket menyalin nama, varian, jumlah, dan catatan dari sales order item. KDS tidak membaca ulang nama/harga terbaru dari master.
- Ticket dibuat sekali dengan unique `(company_id, order_id)`; retry callback tidak boleh membuat ticket kedua.
- Daftar KDS difilter menurut outlet/station/status dan diurutkan `priority ASC, queued_at ASC, id ASC`; cursor pagination memakai tuple urutan tersebut.
- Perubahan status dicatat pada `kitchen_ticket_events` dan audit log. `ready`/`served` adalah status produksi, bukan status payment.
- Penyelesaian semua item dapat mengubah ticket menjadi ready/served sesuai aturan; perubahan order ke completed dilakukan setelah serah-terima/penutupan yang ditetapkan bisnis.

## 9. Idempotensi dan konsistensi

| Operasi | Kunci deduplikasi |
|---|---|
| Create order | `(outlet_id, idempotency_key)` + `idempotency_request_hash` pada sales_orders |
| Create payment | `(company_id, idempotency_key)` + hash yang mencakup company, outlet, order ID, dan payload pada payments |
| Provider callback | `(provider_code, provider_event_id)` pada webhook inbox/payment_events |
| Ledger posting | idempotency key dan unique source-line movement pada stock_ledger |
| KDS ticket | `(company_id, order_id)` pada kitchen_tickets |
| Outbox event | `dedupe_key` unik per company |

Jika idempotency key sama dan request hash berbeda, kembalikan `409 IDEMPOTENCY_KEY_REUSED`. Bila key sama dan hash sama, kembalikan resource lama tanpa mengulang efek samping. Hash dibuat dari JSON yang telah dinormalisasi secara deterministik (mengabaikan header tracing dan field server-generated).

## 10. Otorisasi

Permission code pada tabel `permissions` perlu di-seed melalui migration/seed terpisah. Kode di tabel endpoint adalah rekomendasi awal, bukan data yang sudah ada di database.

- Kasir: katalog, order, payment, receipt.
- Barista: baca antrean dan update status produksi.
- Manager: override harga/discount/refund/void dan memonitor KDS.
- Admin: master data, role/permission, konfigurasi.

Setiap query harus menerapkan company/outlet scope dari token dan assignment. Mengetahui UUID tidak boleh memberi akses lintas outlet.

## 11. Logging dan observability

- Setiap request mempunyai `request_id` dan actor/outlet.
- Log perubahan order/payment/ticket dengan before/after, actor, reason, provider event id, dan correlation id tanpa menyimpan data kartu atau secret.
- Metrik minimum: payment pending duration, callback signature failures, duplicate callbacks, payment reconciliation backlog, KDS queue age, outbox retry count.
- Payload webhook disanitasi; jangan simpan API secret, access token, PAN/CVV, atau data autentikasi sensitif.

## 12. Asumsi dan keputusan terbuka

1. Provider QRIS/payment gateway belum dipilih; header signature dan payload final harus diadaptasi ke dokumentasi provider yang dipilih.
2. Pajak 10% hanya contoh yang terlihat pada mockup; nilai/penerapan pajak produksi belum ditetapkan.
3. Split tender, partial payment, dan cash overpayment belum diputuskan. Baseline UI dapat memakai satu metode pembayaran per order.
4. Definisi kapan order dianggap `completed` (setelah ready, diserahkan, atau ditutup kasir) perlu persetujuan operasional.
5. Kebijakan dine-in: table number, customer name, dan nomor antrean perlu dikonfirmasi.
6. KDS apakah satu tiket per order atau per station belum dipastikan; rancangan ini memakai satu tiket per order untuk MVP.
7. Stack framework/backend belum ditetapkan; OpenAPI dibuat netral framework.

## 13. Kesiapan go-live

Kontrak API ini menjadi baseline integrasi, bukan izin untuk live. Go-live membutuhkan minimal implementasi backend, autentikasi/RBAC, payment adapter, KDS, outbox worker, Sesi 3 stock reservation + atomic ledger posting, dan pengujian concurrency/provider sandbox.
