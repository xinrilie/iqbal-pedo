# Sesi 2 — Acceptance Test API dan Operasional

Status saat ini: **kriteria disusun; belum ada backend runtime untuk mengeksekusinya**.

## A. Katalog dan POS

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| API-01 | Kasir membaca katalog outlet yang diizinkan | Hanya menu aktif dalam company/outlet scope yang tampil |
| API-02 | Outlet override harga tersedia | Harga outlet dipakai; jika tidak ada override, pakai harga dasar varian |
| API-03 | Frontend mengirim harga palsu | Backend mengabaikan harga klien dan menghitung ulang dari master/config |
| API-04 | Kasir membuat draft order | Nomor order server-generated, status draft, item + snapshot BOM/harga tercatat |
| API-05 | Draft dengan variant nonaktif / bukan outlet scope | Ditolak tanpa menyimpan order parsial |
| API-06 | Qty nol/negatif/format tidak sah | Ditolak 400/422 |
| API-07 | Update cart pada order confirmed | Ditolak; snapshot tetap tidak berubah |
| API-08 | Create order dipanggil ulang dengan key dan body sama | Mengembalikan resource yang sama, tidak menduplikasi order |
| API-09 | Key sama dengan body berbeda | 409 `IDEMPOTENCY_KEY_REUSED` |
| API-10 | Dua perangkat update draft dengan `If-Match` versi sama | Hanya satu update berhasil; request lain 409 `STALE_ORDER_VERSION` |

## B. Pembayaran

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| PAY-01 | Cash diterima tepat | Payment succeeded; kembalian 0 |
| PAY-02 | Cash diterima lebih besar | Kembalian dihitung backend |
| PAY-03 | Cash diterima kurang | Ditolak, payment tidak succeeded |
| PAY-04 | QRIS dimulai | Payment pending dan provider reference/instruction tersimpan |
| PAY-05 | Provider request timeout | Status tidak diasumsikan gagal; masuk retry/inquiry/reconciliation |
| PAY-06 | Callback signature salah | 401/403; order tidak confirmed |
| PAY-07 | Callback valid dan nominal cocok | Payment succeeded satu kali; order confirmed satu kali |
| PAY-08 | Callback yang sama dikirim ulang | Acknowledged sebagai duplicate; tidak membuat ticket/outbox/ledger kedua |
| PAY-09 | Nominal/currency/reference tidak cocok | Masuk reconciliation_required; tidak mengonfirmasi order |
| PAY-10 | Dua callback bersamaan | Row lock + unique event menjaga satu efek bisnis |
| PAY-11 | Payment sukses tetapi worker/outbox gagal publish | Event tetap di outbox dan dapat dicoba ulang; tidak kehilangan ticket |

## C. KDS / barista

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| KDS-01 | Order terkonfirmasi | Satu ticket dibuat untuk order pada baseline MVP |
| KDS-02 | Callback duplikat | Ticket tetap satu karena unique company/order |
| KDS-03 | Daftar ticket outlet | Pengguna tidak bisa melihat outlet lain |
| KDS-04 | Status queued → in_preparation | Diterima dan tercatat pada kitchen event/audit |
| KDS-05 | Status in_preparation → ready | Diterima |
| KDS-06 | Transisi ready → queued tanpa override | Ditolak |
| KDS-07 | Item note/quantity berubah setelah order confirmed | Snapshot ticket tidak berubah |
| KDS-08 | Ticket cancelled | Wajib reason dan permission sesuai kebijakan |

## D. Konsistensi dan keamanan

| ID | Skenario | Hasil yang diwajibkan |
|---|---|---|
| INT-01 | Order, payment, ticket, outbox | Operasi lokal yang saling terkait menggunakan DB transaction |
| INT-02 | Outbox worker crash setelah claim | Lease/timeout memungkinkan event diproses ulang tanpa duplikasi penerima |
| INT-03 | User mencoba akses UUID outlet lain | 404/403 sesuai kebijakan tanpa membocorkan resource |
| INT-04 | Webhook menyertakan payload sensitif | Payload disanitasi; tidak menyimpan secret/kredensial/data kartu sensitif |
| INT-05 | Request tanpa idempotency key | Ditolak untuk endpoint yang mewajibkannya |
| INT-06 | Audit perubahan status payment/order/ticket | Actor, timestamp, reason/correlation id tersedia |

## E. Blocker go-live

Sesi 2 saja belum cukup untuk menjalankan transaksi nyata. Sebelum live wajib:

1. Sesi 3: stok reservation, row-lock strategy, race condition dua kasir, atomic stock ledger posting, retry/idempotency end-to-end.
2. Implementasi RBAC dan company/outlet scoping yang diuji.
3. Provider sandbox dipilih dan signature/callback/inquiry/reconciliation diverifikasi menggunakan dokumentasi resminya.
4. Outbox worker, retry policy, dead-letter/alerting, dan observability diterapkan.
5. Uji E2E di staging serta backup/restore dasar.
