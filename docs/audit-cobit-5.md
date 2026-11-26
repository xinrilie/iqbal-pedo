# Audit GCIMS menggunakan COBIT 5

**Tanggal:** 25 November 2026  
**Objek:** GCIMS POS & Inventory MVP — repository, source code, migration, konfigurasi, CI, dan dokumentasi pada working tree.  
**Jenis:** desk review berbasis artefak; bukan penetration test, audit runtime, sertifikasi, atau audit organisasi menyeluruh.  
**Riwayat:** laporan COBIT 2019 terdahulu ada di [`audit-cobit-2019.md`](./audit-cobit-2019.md) dan [`audit-cobit-2019-review-2026-11.md`](./audit-cobit-2019-review-2026-11.md). Laporan ini menggunakan kerangka COBIT 5 secara terpisah.

## 1. Ringkasan eksekutif

GCIMS telah menerapkan beberapa kontrol teknis yang relevan: autentikasi dan RBAC, CSRF, session revocation, audit log, transaksi/idempotensi untuk alur tertentu, maker-checker, workflow CI, serta migration runner dengan checksum, preflight, advisory lock dan transaction. Tetapi bukti repository belum menunjukkan sebagian besar proses dijalankan secara terencana, terukur, konsisten di seluruh lingkungan, atau ditinjau pemilik proses.

**Profil kapabilitas sementara: mayoritas proses terpilih berada pada Level 1 (Performed), beberapa aspek teknis BAI06 dan DSS06 menunjukkan artefak menuju Level 2, dan DSS04/DSS02 belum mencapai proses yang dapat dibuktikan.** Ini adalah estimasi berbasis repository, bukan skor COBIT 5 PAM formal. Penilaian formal membutuhkan evaluasi praktik dasar, work product, generic practices, wawancara, bukti operasi, dan penetapan rating tiap process attribute.

**Sistem belum layak untuk produksi atau transaksi nyata.** Pembayaran masih test-only dan webhook provider belum diimplementasikan; backup dan restore belum dibuktikan; migration runner baru belum tercermin dalam instruksi database; dan tidak tersedia bukti uji integrasi PostgreSQL terkini, pemantauan operasional, respons insiden, atau penerimaan bisnis.

## 2. Metode dan skala COBIT 5

COBIT 5 memiliki 37 proses pada domain EDM, APO, BAI, DSS, dan MEA. Penilaian capability menggunakan skala 0–5 berdasarkan ISO/IEC 15504 dan Process Assessment Model (PAM). Proses Level 1 dinilai dari pencapaian tujuan/hasil proses; Level 2 ke atas memerlukan bukti atribut proses generik dan work product yang dikelola. COBIT 5 PAM menggunakan indikator proses spesifik untuk Level 1 dan indikator generik untuk level berikutnya. Rujukan: [ISACA — COBIT 5 PAM](https://www.isaca.org/resources/news-and-trends/industry-news/2014/dupont-drives-continuous-improvement-with-cobit-5-process-assessment-model), [ISACA — penjelasan capability dan metode penilaian COBIT 5](https://www.isaca.org/resources/isaca-journal/issues/2016/volume-1/how-cobit-5-improves-the-work-process-capability-of-auditors-assurance-professionals-and-assessors), serta [perbandingan COBIT 5 dan COBIT 2019](https://www.isaca.org/resources/news-and-trends/industry-news/2020/cobit-2019-and-cobit-5-comparison).

| Level | Nama COBIT 5 | Arti ringkas untuk review ini |
|---:|---|---|
| 0 | Incomplete | Tujuan proses tidak tercapai atau hanya ada sedikit/tidak ada bukti aktivitas proses. |
| 1 | Performed | Aktivitas dasar dijalankan dan tujuan proses sebagian/umumnya tampak dari artefak. |
| 2 | Managed | Proses direncanakan, dipantau, disesuaikan; tanggung jawab dan work product dikendalikan. |
| 3 | Established | Proses baku organisasi didefinisikan dan diterapkan secara konsisten. |
| 4 | Predictable | Proses dijalankan dalam batas terukur dan hasilnya dapat diprediksi. |
| 5 | Optimizing | Proses terus ditingkatkan melalui pengukuran dan inovasi. |

Angka pada tabel berikut merupakan **indikasi awal** dari bukti yang terlihat, bukan hasil rating PAM berbasis wawancara dan pengujian. Nilai 0 pada DSS02/DSS04 berarti proses yang dimaksud tidak tampak terbentuk dalam bukti yang tersedia; bukan pernyataan bahwa tidak ada praktik informal di luar repository. MEA03 diberi “belum dinilai” karena kewajiban eksternal dan konteks organisasi tidak tersedia.

## 3. Maturity/capability proses terpilih

| Proses COBIT 5 | Level indikatif | Bukti yang terlihat | Gap utama |
|---|---:|---|---|
| **EDM03 — Ensure Risk Optimisation** | 1 | Pembatasan pembayaran test-only, preflight migration, validasi keamanan konfigurasi. | Tidak ada risk appetite, risk register disetujui, risk owner, atau risk acceptance. |
| **APO01 — Manage the IT Management Framework** | 1 | README, scope, migration policy, prosedur operasi draft, dokumentasi proyek dan workflow kontribusi. | Pemilik/RACI belum diisi dan proses baru didokumentasikan; pelaksanaan rutin serta approval belum ada buktinya. |
| **APO10 — Manage Suppliers** | 0 | Rancangan Midtrans dan entitas supplier/procurement terdapat di proyek. | Belum ada pengelolaan provider pembayaran, SLA, integrasi, evaluasi vendor, atau rekonsiliasi berjalan. |
| **APO12 — Manage Risk** | 1 | Risiko teknis dan sejumlah kontrol mitigasi muncul di dokumen dan source. | Tidak ada proses siklus risiko yang dipelihara, disetujui, dan ditinjau berkala. |
| **APO13 — Manage Security** | 1 | bcrypt, RBAC, cookie HttpOnly/SameSite, CSRF, Helmet, CORS allowlist, rate limit, session revocation, secret validation. | Tidak ada bukti security review rutin, dependency scanning, secret rotation, review akun istimewa, atau respons insiden. |
| **APO14 — Manage Data** | 1 | Skema relasional, transaksi snapshot, stock ledger, audit log. | Data owner, klasifikasi, retensi/penghapusan, kualitas data terukur, serta backup/restore belum dibuktikan. |
| **BAI02 — Manage Requirements Definition** | 1 | Scope, kontrak API, backlog dan acceptance notes tersedia. | Traceability, persetujuan kebutuhan bisnis, perubahan kriteria, dan bukti UAT formal tidak terlihat. |
| **BAI06 — Manage Changes** | 2* | Runner migration menyediakan ledger versi/checksum, urutan kontigu, advisory lock, preflight dan transaksi; migration append-only. | Runner belum menjadi dokumentasi kanonis; penerapan dan jalur upgrade pada database PostgreSQL belum divalidasi. |
| **BAI07 — Manage Change Acceptance and Transitioning** | 1 | CI menjalankan syntax check/test; migration preflight tersedia; dokumentasi acceptance historis. | Tidak ada bukti branch protection, staging, UAT formal, rollback/restore rehearsal, atau release approval. |
| **DSS01 — Manage Operations** | 1 | Health live/ready, log terstruktur dan redaction, setup lokal. | Monitoring/alert, SLO, runbook produksi, jadwal operasi, dan penanggung jawab layanan belum dibuktikan. |
| **DSS02 — Manage Service Requests and Incidents** | 0 | Request ID, error log dan draft runbook insiden mendukung diagnosis dan memberi alur awal. | Runbook belum disetujui/ditugaskan, belum ada catatan tiket, eskalasi nyata, target respons atau review pascainsiden. |
| **DSS04 — Manage Continuity** | 0 | Instruksi setup menyarankan backup sebelum migrasi. | Backup terjadwal, retensi, RPO/RTO, uji restore, disaster recovery dan bukti pemulihan tidak tersedia. |
| **DSS05 — Manage Security Services** | 1 | Kontrol akses/sesi, redaksi log, rate limit dan pembatasan konfigurasi. | Tidak ada bukti monitoring keamanan, alert, vulnerability management terjadwal, atau latihan respons kebocoran. |
| **DSS06 — Manage Business Process Controls** | 2* | Service menunjukkan transaksi stok atomik, idempotensi, reservation, audit trail dan maker-checker pada alur procurement/stocktake. | Uji PostgreSQL aktual, konkurensi, rollback, migration yang diterapkan, dan acceptance proses bisnis belum diverifikasi. |
| **MEA01 — Monitor, Evaluate and Assess Performance and Conformance** | 1 | Dashboard dan health endpoint memberi sebagian indikator kondisi sistem. | KPI/SLO target, threshold alert, review berkala dan tindakan korektif tertutup tidak tampak. |
| **MEA02 — Monitor, Evaluate and Assess the System of Internal Control** | 1 | RBAC, audit log, source-contract tests, preflight dan CI. | Review independen dan periodik atas akses, log, exception, serta efektivitas kontrol belum dibuktikan. |
| **MEA03 — Monitor, Evaluate and Assess Compliance with External Requirements** | Belum dinilai | Prototype membatasi penggunaan pembayaran dan memperingatkan risiko penggunaan nyata. | Yurisdiksi, kontrak, jenis data, aturan pembayaran/privasi dan pemilik kewajiban belum dikonfirmasi. |
| **MEA04 — Provide Assurance** | 1 | Audit dan test report proyek sebelumnya tersedia. | Rencana assurance independen berkala serta validasi penutupan temuan belum terlihat. |

`*` Level 2 mencerminkan sejumlah mekanisme teknis yang tampak terstruktur, tetapi Level 2 formal mensyaratkan bukti manajemen proses (rencana, pemantauan, penyesuaian, tanggung jawab dan work product). Tanpa bukti operasional tersebut, nilai final dapat turun ke Level 1.

## 4. Temuan risiko/kerentanan dan rekomendasi

Temuan berikut berasal dari review statis. Tidak ada eksploit, kebocoran, atau insiden yang dikonfirmasi dari repository.

| Prioritas | Temuan | Risiko | Rekomendasi dan proses terkait |
|---|---|---|---|
| **Tinggi — sebelum pilot** | **Pemulihan database belum dibuktikan.** Tidak ada evidence backup terjadwal atau restore drill. | Kehilangan transaksi, stok, dan histori audit setelah kerusakan, salah migrasi, atau kehilangan host. | Tetapkan RPO/RTO, retensi dan owner; otomatisasi backup terenkripsi dan batasi akses; uji restore berkala pada DB terisolasi; simpan log uji. (**DSS04, APO14**) |
| **Tinggi — sebelum migration berikutnya** | **Migration runner belum divalidasi pada PostgreSQL.** Pada awal review, dokumentasi juga berkontradiksi dengan runner dan migration 0013. | Operator dapat memakai alur yang belum terverifikasi, atau migration gagal/terlewat ketika dijalankan pada database nyata. | Panduan `db/README.md` dan `db/migrations/README.md` kini sudah diarahkan ke runner/dry-run. Tetap perlu dry-run dan upgrade pada salinan DB, validasi baseline/ledger, lalu simpan bukti hasil sebelum produksi. (**BAI06, BAI07, APO01**) |
| **Tinggi — sebelum penggunaan pembayaran nyata** | **Webhook pembayaran belum dikonfigurasi dan route mengembalikan 501.** | Callback palsu/tidak tervalidasi atau status pembayaran/rekonsiliasi tidak konsisten jika integrasi diaktifkan tanpa kontrol. | Pertahankan test-only; pilih vendor, implementasikan signature verification, validasi nominal/order/status, replay/idempotency, refund dan rekonsiliasi; uji sandbox serta approval merchant sebelum go-live. (**APO10, BAI07, DSS06**) |
| **Tinggi — sebelum dinyatakan siap operasi** | **Migration dan transaksi belum diverifikasi pada PostgreSQL runtime terkini.** | Perbedaan skema, kegagalan apply, race condition atau rollback parsial dapat mengganggu layanan/integritas data. | Dry-run lalu terapkan pada database uji hasil restore; cek ledger/checksum dan readiness; uji alur procurement/stocktake/payment-test, konkurensi dan rollback; dokumentasikan hasil/versi commit. (**BAI07, DSS06**) |
| **Sedang** | **CI belum terbukti diwajibkan untuk merge.** Workflow ada, tetapi aturan repository eksternal tidak terlihat. | Perubahan dapat masuk meski check gagal atau tanpa review. | Wajibkan status check, lindungi branch utama, atur review dan ownership file kritis; simpan bukti konfigurasi. (**BAI07, MEA02**) |
| **Sedang** | **Monitoring serta pelaksanaan proses incident belum dibuktikan.** Draft runbook sudah ditambahkan, tetapi belum ada bukti owner, alert atau pelaksanaan. | Gangguan database, penyalahgunaan akun, mismatch stok atau callback tertunda mungkin terlambat ditangani. | Tetapkan owner dan eskalasi; siapkan alert kesehatan DB dan login mencurigakan; simulasikan runbook database down/akun kompromi/stok mismatch; catat insiden dan tindakan perbaikan. (**DSS01, DSS02, DSS05**) |
| **Sedang** | **Kontrol secret/bootstrap memerlukan disiplin operasi.** README memperingatkan kredensial bootstrap `admin/admin` hanya untuk `db_gcims_test`, dan dump lokal tidak boleh dipublikasikan. | Jika kredensial/dump dibawa ke lingkungan lain atau dibagikan, akses tidak sah dan kebocoran data dapat terjadi. | Pastikan akun demo/prod tidak menggunakan bootstrap; rotasi secret yang pernah dibagi; gunakan penyimpanan secret; batasi/enkripsi backup. Review ini tidak menemukan bukti kebocoran. (**APO13, DSS05, DSS04**) |
| **Sedang** | **Security/data lifecycle belum tercatat.** CI berisi check/test, tetapi bukti pemindaian dependency/security dan aturan retensi tidak tampak. | Kerentanan dependency, hak admin berlebih, atau penyimpanan data terlalu lama dapat tidak terdeteksi. | Jadwalkan dependency/security scan dan triase; review akses admin/log; tetapkan data owner, klasifikasi serta retensi; konfirmasi kewajiban eksternal berdasarkan konteks bisnis. (**APO13, APO14, DSS05, MEA03**) |

## 5. Rencana peningkatan

| Tahap | Pekerjaan | Bukti yang harus disimpan |
|---|---|---|
| **Sebelum migration berikutnya** | Rekonsiliasi dokumentasi dengan runner dan migration 0013; uji baseline dan upgrade pada database uji; dokumentasikan dry-run/apply. | Dokumen setup konsisten, output dry-run, ledger/checksum cocok, readiness lulus. |
| **Sebelum pilot bisnis** | Backup otomatis, RPO/RTO, restore drill, PostgreSQL integration/concurrency test, UAT POS/procurement/stocktake. | Bukti backup dan restore, hasil test/acceptance, daftar gap dengan owner. |
| **Sebelum pembayaran produksi** | Gateway sandbox, callback signature/status, idempotency/replay protection, refund, rekonsiliasi, persetujuan go-live. | Laporan sandbox, hasil rekonsiliasi, persetujuan merchant dan checklist rilis. |
| **30 hari** | Tetapkan owner/RACI; aktifkan required CI; susun runbook operasi dan incident response. | Ruleset branch, RACI, runbook, bukti simulasi insiden. |
| **60–90 hari** | Monitoring/alert, dependency/security review, review akses/log, KPI/SLO dan review kontrol. | Alert teruji, catatan review, metrik, corrective actions dan bukti penutupan. |

Target realistis tahap awal adalah **Level 2** untuk BAI06, BAI07, DSS01, DSS04, DSS05, DSS06 dan MEA02. Target **Level 3** baru layak ditetapkan setelah proses, peran, prosedur baku dan bukti pelaksanaan konsisten di seluruh lingkungan yang relevan.

## 6. Tindak lanjut yang sudah disiapkan di repository

Setelah penilaian awal, repository diperbarui dengan:

- Panduan database/migration yang mengarahkan operator ke runner, dry-run, dan ledger versi.
- Prosedur operasi draft untuk migration, backup/restore drill, rilis/UAT, runbook insiden, dan register bukti di [`operations-level2.md`](./operations-level2.md).
- Checklist PR untuk hasil CI, review migration, backup, UAT, risiko, serta approver.
- Perbaikan marker deteksi migration 0009 agar tidak mensyaratkan role perusahaan sudah ada ketika skema masih kosong.
- Dry-run migration pada database lokal `db_gcims_test` lulus pada 25 November 2026 dan melaporkan tidak ada migration tertunda; bukti dicatat di [`evidence/migration-dry-run-2026-11-25.md`](./evidence/migration-dry-run-2026-11-25.md).

Perubahan ini memperbaiki dokumentasi dan menyiapkan artefak proses; belum menjadi bukti proses Level 2. Dry-run hanya memeriksa rencana migration, bukan integration/UAT. Backup/restore belum dijalankan karena utilitas PostgreSQL CLI tidak tersedia di shell saat ini; branch protection tidak dikonfigurasi dari repository; owner/RACI belum ditetapkan; dan test suite tidak dijalankan pada tindak lanjut ini.

## 7. Kesimpulan

Berdasarkan bukti repository, GCIMS memiliki kontrol teknis yang baik untuk sejumlah alur MVP, tetapi **maturity/capability pengelolaan secara umum masih Level 1 (Performed)** pada proses yang dapat dinilai. Level 2 yang tampak di sebagian aspek kode belum dapat dipastikan tanpa bukti proses terencana dan berulang. Gap paling mendesak adalah continuity/restore, migration governance, validasi runtime dan pembayaran produksi.

GCIMS dapat dilanjutkan sebagai prototype dan pilot uji terkendali. Jangan menyebutnya siap produksi atau “compliant COBIT 5” sebelum temuan prioritas tinggi ditutup dan bukti runtime/organisasi dinilai. Penilaian formal COBIT 5 PAM memerlukan scope organisasi, pemilik proses, wawancara, validasi work product dan penilaian process attribute, bukan hanya pemeriksaan source code.

## 8. Rujukan

- ISACA, [COBIT 5 Process Assessment Model (PAM)](https://www.isaca.org/resources/news-and-trends/industry-news/2014/dupont-drives-continuous-improvement-with-cobit-5-process-assessment-model).
- ISACA, [How COBIT 5 Improves the Work Process Capability of Auditors, Assurance Professionals and Assessors](https://www.isaca.org/resources/isaca-journal/issues/2016/volume-1/how-cobit-5-improves-the-work-process-capability-of-auditors-assurance-professionals-and-assessors).
- ISACA, [COBIT 2019 and COBIT 5 Comparison](https://www.isaca.org/resources/news-and-trends/industry-news/2020/cobit-2019-and-cobit-5-comparison).
- Repository: [`README.md`](../README.md), [`reference/implementation_scope.md`](../reference/implementation_scope.md), [`db/README.md`](../db/README.md), [`db/migrations/README.md`](../db/migrations/README.md), [`scripts/migrate.js`](../scripts/migrate.js), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`src/routes/payments.js`](../src/routes/payments.js), [`src/lib/payment-service.js`](../src/lib/payment-service.js).
