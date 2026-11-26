# Audit awal GCIMS berdasarkan COBIT 2019

**Tanggal:** 25 November 2026  
**Objek:** Repository GCIMS POS & Inventory MVP  
**Jenis:** Desk review berbasis kode dan dokumentasi, bukan audit sertifikasi atau audit organisasi menyeluruh.

## 1. Ringkasan hasil

GCIMS memiliki fondasi aplikasi yang cukup tertata untuk prototipe lokal: autentikasi berizin, kontrol sesi browser, migrasi SQL berurutan, ledger stok, idempotensi, pemeriksaan stok, maker-checker, dokumentasi setup, serta tes otomatis. Namun, bukti yang ada belum cukup untuk menyatakan proses COBIT telah berjalan sebagai proses organisasi yang konsisten.

**Kesimpulan:** layak dilanjutkan sebagai prototipe; belum layak dinyatakan siap operasional produksi atau “sesuai COBIT 2019”. Risiko utama yang perlu ditutup sebelum dipakai klien adalah pemulihan database yang belum dibuktikan, perubahan skema yang masih manual, belum adanya monitoring/penanganan insiden, serta payment gateway yang belum diintegrasikan.

Penilaian ini sengaja menyesuaikan COBIT pada skala MVP satu outlet. COBIT 2019 menyediakan 40 objective dalam domain EDM, APO, BAI, DSS, dan MEA serta menganjurkan penyesuaian sistem tata kelola dengan konteks organisasi; audit ini tidak menilai seluruh 40 objective. [COBIT 2019 ISACA](https://www.isaca.org/resources/cobit), [COBIT design factors ISACA](https://www.isaca.org/resources/news-and-trends/industry-news/2019/cobit-design-factors).

## 2. Metode dan batas bukti

Audit meninjau source code, konfigurasi, migration, skrip, dokumentasi, serta hasil `npm.cmd run check` dan `npm.cmd test`. Unit/source-contract test lulus **46/46**. Tidak ada akses untuk memverifikasi database PostgreSQL pengguna, pengaturan deployment, backup, jaringan, akun merchant, praktik kerja tim, bukti persetujuan, atau wawancara pemilik proses.

Label berikut adalah **status bukti pada repository**, bukan capability level COBIT:

- **Terbukti sebagian:** ada kontrol/artefak relevan, tetapi belum ada bukti proses berjalan berulang atau pengujian operasional.
- **Belum terbukti:** repository tidak cukup menunjukkan kontrol atau prosesnya.
- **Tidak dinilai:** membutuhkan bukti dari pemilik bisnis, deployment, atau pihak eksternal.

Karena keterbatasan tersebut, audit tidak menetapkan capability/maturity score COBIT.

## 3. Penyesuaian konteks GCIMS

- **Skala dan strategi:** MVP untuk satu outlet café dan convenience store; prioritas wajar adalah akurasi transaksi/stok, kemudahan kasir, dan menjaga data transaksi.
- **Metode pengembangan:** JavaScript modular, Fastify, halaman browser tanpa framework, PostgreSQL; workflow dan kontrol produksi belum terotomasi.
- **Risiko I&T utama:** kehilangan/perbedaan data stok, pembayaran yang tidak terrekonsiliasi, credential bocor, migration salah sasaran, gangguan layanan, dan akun dengan hak berlebihan.
- **Sumber daya dan pihak:** bukti menunjukkan pengembangan repo kolaboratif, tetapi peran formal pemilik sistem, penyetuju rilis, operator database, dan penanggung jawab insiden belum tercatat.
- **Vendor:** Midtrans baru dirancang; belum ada akun atau integrasi provider yang berjalan.

Penyesuaian ini merupakan inferensi dari struktur dan dokumentasi proyek, bukan hasil konfirmasi organisasi.

### Goals cascade awal (hipotesis untuk dikonfirmasi pemilik proyek)

| Kebutuhan pengguna/bisnis | Hasil I&T yang perlu dijaga | Objective prioritas |
|---|---|---|
| Kasir dapat melayani pelanggan cepat; stok jual tetap akurat | POS tersedia, perhitungan benar, stok/ledger konsisten | BAI03, DSS01, DSS06, MEA01 |
| Pemilik dapat mengendalikan akses, data, dan transaksi | Akses sesuai role, perubahan dapat ditelusuri, risiko diketahui | EDM03, APO12, APO13, APO14, DSS05, MEA02 |
| Sistem dapat dipelihara bersama dan pulih dari gangguan | Rilis terkendali, data dapat dipulihkan, insiden ditangani | EDM01, APO01, BAI06, BAI07, BAI11, DSS02, DSS04 |

Pemetaan ini adalah hipotesis audit dari konteks MVP, belum disetujui pemilik bisnis.

## 4. Penilaian objective terpilih

| Objective COBIT 2019 | Status bukti | Bukti yang terlihat | Gap utama |
|---|---|---|---|
| **EDM01 — Governance Framework Setting and Maintenance** | Belum terbukti | Ada aturan kontribusi dan kebijakan migration | Tidak ada RACI, pemilik keputusan, persetujuan risiko, atau forum review tata kelola |
| **EDM03 — Ensured Risk Optimization** | Terbukti sebagian | Pengamanan sesi, pembatasan pembayaran uji, preflight SQL | Belum ada risk register dengan pemilik, dampak, mitigasi, dan penerimaan residual risk |
| **APO01 — Managed I&T Management Framework** | Terbukti sebagian | README, peta proyek, migration policy, permission roles | Belum ada SOP operasi, pembagian tanggung jawab, dan alur perubahan/rilis yang disepakati |
| **APO10 — Managed Vendors** | Belum terbukti | Rancangan integrasi Midtrans tersedia | Belum ada akun, evaluasi vendor/kanal, pengaturan callback, SLA, atau prosedur rekonsiliasi |
| **APO12 — Managed Risk** | Terbukti sebagian | Kontrol keamanan dan pembatasan mode pembayaran uji | Analisis ancaman/risiko belum dipelihara sebagai register dan belum ada tinjauan berkala |
| **APO13 — Managed Security** | Terbukti sebagian | bcrypt, RBAC, cookie HttpOnly, CSRF, CORS allowlist, rate limit, security config | Belum ada bukti review keamanan independen, vulnerability/dependency scan rutin, secret rotation, atau prosedur respons insiden |
| **APO14 — Managed Data** | Terbukti sebagian | Skema relasional, snapshot transaksi/BOM, stock ledger, audit log append-only | Belum ada klasifikasi data, jadwal retensi/penghapusan, data owner, atau bukti uji backup dan restore |
| **BAI02/BAI03 — Managed Requirements Definition / Solutions Identification and Build** | Terbukti sebagian | Dokumen rancangan, referensi workbook, kontrak API, dan tes source-contract | Kebutuhan belum memiliki persetujuan/traceability formal dari kriteria penerimaan ke rilis |
| **BAI06 — Managed IT Changes** | Terbukti sebagian | Migration bernomor dan aturan append-only | Tidak ada migration runner atau tabel versi; status migration di tiap database dicatat manual |
| **BAI07 — Managed IT Change Acceptance and Transitioning** | Terbukti sebagian | `npm run check`, `npm test`, preflight untuk beberapa migration | Tidak ada CI wajib, staging release gate, rollback plan teruji, atau bukti UAT formal |
| **BAI11 — Managed Projects** | Terbukti sebagian | Backlog, patch notes, report, dan scope terdokumentasi | Tidak ada baseline rencana, pemilik deliverable, acceptance formal, atau pencatatan risiko/jadwal proyek |
| **DSS01 — Managed Operations** | Terbukti sebagian | `/health/live`, `/health/ready`, structured logs, langkah setup lokal | Belum ada monitoring/alerting, SLO, runbook produksi, atau bukti operasi terjadwal |
| **DSS02 — Managed Service Requests and Incidents** | Belum terbukti | Error memakai request ID dan log terminal | Belum ada alur pencatatan, klasifikasi, eskalasi, komunikasi, dan review insiden |
| **DSS04 — Managed Continuity** | Belum terbukti | README secara eksplisit menyebut backup/restore belum didokumentasikan dan diuji | Belum ada target RPO/RTO, backup otomatis, uji restore, atau prosedur pemulihan |
| **DSS05 — Managed Security Services** | Terbukti sebagian | Kontrol autentikasi, session revocation, cookie, CSRF, rate limiting | Belum ada pengawasan akses/log keamanan, pemindaian rutin, pengelolaan secret operasional, dan respons kebocoran yang dibuktikan |
| **DSS06 — Managed Business Process Controls** | Terbukti sebagian kuat | Transaksi pembayaran uji dan konsumsi ledger atomik, idempotensi, stock reservation, maker-checker pengadaan/opname | Kontrol belum tervalidasi dengan integration/concurrency test PostgreSQL pengguna; alur pembayaran provider belum tersedia |
| **MEA01 — Managed Performance and Conformance Monitoring** | Terbukti sebagian | Dashboard penjualan/stok/shift dan health endpoint | Belum ada KPI/SLO dengan target, alert threshold, review berkala, dan tindakan korektif tercatat |
| **MEA02 — Managed System of Internal Control** | Terbukti sebagian | Audit log append-only, tes otomatis, preflight migration, kontrol role | Belum ada bukti review berkala atas log, akses, exception, dan efektivitas kontrol oleh pihak selain pembuat |
| **MEA03 — Managed Compliance with External Requirements** | Tidak dinilai | Repository mengunci pembayaran nyata dan memberi peringatan prototipe | Belum ada daftar kewajiban hukum/kontrak yang dikonfirmasi pemilik bisnis atau penasihat berwenang |
| **MEA04 — Managed Assurance** | Belum terbukti | Ada audit dan test report proyek terdahulu | Belum ada rencana assurance independen, jadwal penilaian, atau bukti temuan ditutup dan divalidasi |

## 5. Temuan dan prioritas

### P1 — Pemulihan database belum dibuktikan

`reference/implementation_scope.md` menyebut backup/restore dan disaster recovery belum terdokumentasi dan diuji. Untuk POS, kegagalan ini dapat menghilangkan transaksi, perubahan stok, atau histori audit. Tentukan pemilik backup, frekuensi, retensi, RPO/RTO; buat backup konsisten; lakukan restore berkala ke database terisolasi dan simpan hasil uji.

### P1 — Belum ada kontrol perubahan skema lintas database

Migration policy sudah baik dalam menjaga migration tetap append-only, tetapi belum ada schema version table atau runner. Status tiap database dicatat manual sehingga environment kolaborator dapat tertinggal atau menjalankan migration tidak berurutan. Buat ledger versi migration dan skrip apply yang memeriksa urutan, backup/preflight bila diperlukan, serta menghentikan apply pada kegagalan pertama.

### P1 — Pembayaran belum siap digunakan klien

Pembayaran saat ini tunai uji dan dikunci ke `db_gcims_test`; webhook provider masih mengembalikan 501. Rancangan Midtrans belum berupa integrasi. Jangan mengaktifkan pembayaran produksi sebelum integrasi sandbox, verifikasi callback/status, idempotensi, rekonsiliasi, expiry/reservasi stok, dan prosedur refund/manual review diuji.

### P2 — Monitoring dan penanganan insiden belum terbentuk

Health endpoint dan log memudahkan diagnosis lokal, tetapi belum menunjukkan siapa yang menerima alert, bagaimana layanan dipulihkan, atau bagaimana insiden keamanan dicatat dan ditutup. Buat runbook sederhana untuk database down, login gagal massal, stok/ledger mismatch, dan callback pembayaran tertunda.

### P2 — Proses keamanan belum mencakup keseluruhan siklus

Kontrol aplikasi telah meningkat, terutama sesi HttpOnly, CSRF, RBAC, revocation, dan rate limit login. Namun repository tidak menunjukkan proses rutin secret rotation, dependency scanning, review akses admin, log review, atau latihan respons insiden. Password bootstrap `admin/admin` dibatasi ke `db_gcims_test`; pastikan akun itu tidak dibawa ke database demo/produksi dan ganti password sebelum database dibagikan.

### P2 — Kepemilikan data dan kewajiban eksternal belum dikonfirmasi

Model data dan audit trail cukup matang untuk prototipe, tetapi belum ada klasifikasi data, retensi, siapa yang boleh meminta ekspor/penghapusan, atau kebutuhan kontrak/payment provider yang disetujui. Tetapkan pemilik dan aturan sebelum memproses data pelanggan atau transaksi nyata.

## 6. Rencana perbaikan bertahap

| Tahap | Pekerjaan | Hasil yang dapat diperiksa |
|---|---|---|
| **Sebelum demo klien** | Ganti password bootstrap; buat checklist lingkungan; tentukan siapa admin, kasir, dan pemilik database; pastikan mode pembayaran uji jelas | Checklist demo, akun terpisah, dan bukti UAT alur utama |
| **Sebelum kolaborasi rutin** | Migration ledger/runner, CI untuk `npm run check` dan `npm test`, review migration dan pull request | Setup database konsisten dan gate perubahan otomatis |
| **Sebelum operasi nyata** | Backup otomatis dan uji restore; monitoring/alert; incident runbook; target pemulihan; uji database concurrency | Bukti restore dan latihan operasi yang ditandatangani penanggung jawab |
| **Sebelum payment go-live** | Midtrans sandbox, callback signature/status verification, idempotensi, refund/reconciliation workflow, HTTPS domain callback, approval pemilik merchant | Hasil uji sandbox dan persetujuan go-live dari pemilik bisnis |
| **Berkala** | Review akun/permission, audit log, dependency/security findings, insiden dan KPI | Catatan review dan daftar tindakan korektif dengan pemilik/tanggal target |

## 7. Benchmark: Open Source Point of Sale (OSPOS)

OSPOS dipakai sebagai referensi fungsi dan praktik repository, bukan sebagai bukti bahwa GCIMS harus memakai teknologi atau model bisnis yang sama. Halaman publik OSPOS mendeskripsikan aplikasi web PHP/CodeIgniter 4, MySQL/MariaDB, dan Bootstrap 3; README-nya mencantumkan stok, supplier, cash-up, izin multiuser, laporan, receiving, barcode, receipt, tabel restoran, dan fitur lain. Repository juga menyediakan `tests/`, `.github/`, dokumentasi install/upgrade, serta security policy. Seluruh poin itu adalah **apa yang dinyatakan/tersedia di repository**, bukan hasil audit kode, uji operasi, atau sertifikasi COBIT atas OSPOS.

| Referensi OSPOS | Kondisi GCIMS | Adaptasi yang disarankan | COBIT terkait |
|---|---|---|---|
| Cash-up dan riwayat transaksi | GCIMS sudah memiliki shift, drawer event, laporan penjualan/shift | Pertahankan rekonsiliasi expected cash vs hitung kas; tambahkan UAT dan review selisih berkala | DSS06, MEA01, MEA02 |
| Barcode dan pencetakan struk | Alur struk digital sudah ada; belum ada bukti dukungan perangkat printer/barcode produksi | Prioritaskan uji barcode scanner sebagai keyboard input dan printer yang akan dipakai di toko | BAI02, BAI03, DSS01 |
| Stock management dan kits | GCIMS punya BOM resep, FEFO, lot, ledger, reservasi stok | Pertahankan model per-lot dan validasi stok; jangan menggantinya dengan kit generik sebelum uji kebutuhan retail | APO14, DSS06 |
| Supplier, receiving, izin pengguna, laporan | GCIMS sudah memiliki procurement, goods receipt, RBAC, dashboard | Tambahkan uji proses ujung-ke-ujung dan review berkala atas akses serta laporan; hindari duplikasi modul | APO10, DSS06, MEA01, MEA02 |
| Dokumentasi install/upgrade, tests, CI, security policy | GCIMS punya README, aturan migration, tests dan audit; migration status masih manual dan belum ada CI wajib | Jadikan upgrade runbook, migration ledger/runner, CI untuk check/test, dan security reporting sebagai deliverable kolaborasi | BAI06, BAI07, DSS02, DSS05, MEA04 |

### Batas lisensi dan penggunaan referensi

README OSPOS menyatakan penggunaan MIT dengan syarat tambahan: footer atribusi OSPOS harus terlihat di setiap halaman dan tidak boleh diubah. Karena itu gunakan OSPOS sebagai referensi fitur/alur saja; jangan salin atau rebrand kodenya sebelum meninjau lisensi penuh dan menyepakati kewajiban atribusi. Pernyataan ini mencatat isi repository, bukan pendapat hukum.

### Backlog GCIMS yang diprioritaskan dari benchmark

1. **Sebelum uji toko:** barcode scanner dan printer struk yang benar-benar dipakai, termasuk uji kegagalan koneksi dan cetak ulang tanpa membuat transaksi kedua.
2. **Sebelum laporan dianggap kontrol:** rekonsiliasi cash-up, selisih kas, penjualan, dan ledger; simpan bukti UAT serta review admin.
3. **Sebelum kolaborasi tim rutin:** CI check/test, migration ledger/runner, dan instruksi install/upgrade yang diuji oleh kontributor baru.
4. **Belakangan bila kebutuhan bisnis ada:** promo/discount dengan batas otorisasi, pelanggan/rewards, dan fitur restoran meja. Jangan menambahkannya hanya agar daftar fitur menyamai OSPOS.

Rujukan benchmark: [repository dan README OSPOS](https://github.com/opensourcepos/opensourcepos), [folder tes](https://github.com/opensourcepos/opensourcepos/tree/master/tests), [security policy](https://github.com/opensourcepos/opensourcepos/blob/master/SECURITY.md), dan [ketentuan atribusi yang dijelaskan README](https://github.com/opensourcepos/opensourcepos#license).

## 8. Kesimpulan audit

Secara **teknis**, GCIMS punya kontrol aplikasi yang relevan untuk prototipe dan beberapa proses transaksi telah dirancang dengan baik. Secara **tata kelola COBIT**, bukti operasi, penanggung jawab, risk acceptance, continuity, monitoring, dan assurance masih kurang. Kesimpulan ini bukan pernyataan bahwa organisasi telah memenuhi atau tidak memenuhi seluruh COBIT 2019; penilaian organisasi memerlukan konteks enterprise, wawancara, bukti konfigurasi runtime, dan pengujian PostgreSQL/deployment.

## 9. Rujukan

- ISACA, [COBIT framework and publications](https://www.isaca.org/resources/cobit).
- ISACA, [COBIT 2019 design factors](https://www.isaca.org/resources/news-and-trends/industry-news/2019/cobit-design-factors).
- Repository: [`README.md`](../README.md), [`db/migrations/README.md`](../db/migrations/README.md), [`reference/implementation_scope.md`](../reference/implementation_scope.md), [`docs/GCIMS_Procurement_Backlog_Sesi4.md`](./GCIMS_Procurement_Backlog_Sesi4.md), `src/auth.js`, `src/lib/session-cookie.js`, `src/lib/payment-service.js`, `db/migrations/0001_schema_sesi1.sql`–`0012_auth_session_revocation.sql`, dan `tests/`.
