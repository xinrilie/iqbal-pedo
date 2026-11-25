# Rancangan integrasi pembayaran Midtrans

Dokumen ini menyiapkan integrasi Midtrans Snap untuk POS GCIMS. Akun dan credential merchant belum tersedia, jadi integrasi belum boleh diaktifkan atau dianggap sudah teruji terhadap sandbox Midtrans.

## Keputusan rancangan

- POS meminta backend GCIMS membuat pembayaran untuk order yang sudah memiliki snapshot harga dan item.
- Backend membuat record pembayaran `pending`, mengunci order, dan mereservasi stok untuk durasi yang sama dengan masa berlaku pembayaran.
- Backend meminta Snap transaction token ke Midtrans. Server Key hanya dikirim dari backend ke API Midtrans; browser hanya menerima `redirect_url` atau token Snap yang memang ditujukan untuk tampilan pembayaran.
- POS membuka halaman Snap. Redirect kembali ke POS hanya untuk menampilkan status sementara; redirect browser tidak pernah menjadi bukti pembayaran.
- Midtrans mengirim notifikasi ke endpoint webhook GCIMS. Backend memverifikasi signature, mencocokkan merchant order ID, nominal, currency, status, dan fraud status sebelum memprosesnya.
- Dalam satu transaksi database, webhook sukses menandai payment succeeded, mengonsumsi reservasi stok, mengonfirmasi order, membuat tiket KDS dan outbox, serta mencatat audit. Event callback yang berulang tidak boleh menggandakan efek tersebut.
- Status gagal/kedaluwarsa membatalkan percobaan pembayaran dan melepaskan reservasi. Status terlambat setelah stok dilepas masuk ke `reconciliation_required`; sistem tidak boleh mengonfirmasi atau mengonsumsi stok secara diam-diam.
- Status sukses hanya berasal dari notifikasi tervalidasi atau pemeriksaan status server-ke-server. Respons browser tidak dipercaya.

## Alur

1. Kasir memilih pembayaran online pada order yang masih dapat dibayar.
2. Backend memvalidasi scope, permission, total, idempotency key, dan status order; membuat payment pending dan stock reservation secara atomik.
3. Backend meminta Snap token menggunakan ID pembayaran GCIMS yang unik dan nominal yang dihitung server. Idempotent retry mengembalikan percobaan yang sama, bukan membuat charge baru.
4. Browser membuka Snap checkout. Backend menyediakan endpoint status pembayaran yang aman agar UI dapat menampilkan `Menunggu pembayaran`, `Berhasil`, `Gagal`, atau `Kedaluwarsa`.
5. Webhook diverifikasi dan dimasukkan ke `payment_webhook_inbox`. Pemrosesan callback dan perubahan order/stock/payment dilakukan atomik; duplicate callback menghasilkan respons sukses tanpa menjalankan efek dua kali.
6. Redirect ke POS memuat ulang status dari backend. POS hanya menampilkan struk dan status lunas setelah backend menyatakan payment berhasil.

## Status dan aturan stok

`pending` menahan stok sementara. Nilai TTL reservasi harus sama atau lebih panjang sedikit dari expiry Snap, tetapi tetap berada dalam batas konfigurasi reservasi. Setelah reservation dilepas, callback sukses yang datang terlambat tidak boleh menjual stok yang sudah mungkin terjual ke order lain; tandai untuk rekonsiliasi dan tindak lanjuti refund/manual review di provider.

Status `capture` hanya sukses bila sesuai kebijakan transaksi provider dan `fraud_status` menerima transaksi. `settlement` dianggap sukses. `deny`, `cancel`, `expire`, dan `failure` tidak boleh memotong stok. Status yang tidak dikenal atau nominal/currency/reference yang tidak cocok masuk rekonsiliasi, bukan dianggap lunas.

## Konfigurasi saat akun tersedia

Credential disimpan hanya di `.env` lokal atau secret manager deployment, tidak di database plain text, frontend, log, fixture, atau Git:

```env
MIDTRANS_MODE=disabled
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_SIGNATURE_SECRET=
PAYMENT_PUBLIC_BASE_URL=
```

Mode sandbox dan production harus dibedakan secara eksplisit. Production memerlukan HTTPS untuk aplikasi dan callback, credential production terpisah, URL notifikasi pada dashboard merchant, dan smoke test transaksi kecil yang disetujui pemilik akun. Tidak boleh ada fallback otomatis dari production ke sandbox atau sebaliknya.

## Rencana implementasi

1. Tambahkan provider adapter Midtrans yang tidak mengaktifkan payment ketika konfigurasi disabled.
2. Tambahkan migrasi untuk menyimpan metadata checkout yang dibutuhkan secara minimal dan aturan unik/callback bila skema berjalan memerlukan perubahan.
3. Implementasikan create-pending, callback verifier, status endpoint, duplicate handling, expiry/release, dan rekonsiliasi.
4. Tambahkan UI POS untuk memilih pembayaran tunai uji atau Snap, menunggu status, mencoba ulang dengan aman, dan menangani callback/refresh.
5. Uji adapter dengan fixture signature dan HTTP mock tanpa akun. Setelah akun tersedia, jalankan sandbox end-to-end dan uji callback berulang, callback palsu, nominal tidak cocok, expiry, kegagalan jaringan, dan stok habis.
6. Aktifkan production hanya setelah pemilik merchant menyetujui akun, channel, credential, kebijakan expiry, callback domain, dan prosedur rekonsiliasi/refund.

## Credential dan callback Midtrans

Midtrans Snap membuat transaction token dari backend lalu menampilkan checkout di browser. Notification backend harus diverifikasi dengan `signature_key`; per dokumentasi Midtrans yang berlaku sejak 28 Oktober 2026, perhitungan menggunakan Signature Secret Key, dan status sukses perlu mengecek status transaksi serta fraud status. Simpan hanya metadata yang dibutuhkan dan jangan log body callback mentah atau secret.

Referensi resmi: [Snap integration guide](https://docs.midtrans.com/docs/snap-snap-integration-guide), [HTTP(S) notification/webhooks](https://docs.midtrans.com/docs/https-notification-webhooks), dan [access keys serta Signature Secret Key](https://docs.midtrans.com/docs/access-keys).
