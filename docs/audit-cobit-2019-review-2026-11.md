# Audit GCIMS dengan COBIT 2019 — tinjauan kondisi terkini

**Tanggal:** 25 November 2026  
**Objek:** GCIMS POS & Inventory MVP, berdasarkan source code, konfigurasi, migration, workflow CI, dan dokumen yang tersedia pada working tree.  
**Jenis:** desk review / audit berbasis bukti repository; bukan penetration test, audit runtime, sertifikasi, atau audit organisasi menyeluruh.  
**Dokumen sebelumnya:** [`audit-cobit-2019.md`](./audit-cobit-2019.md) tetap dipertahankan sebagai baseline.

## 1. Ringkasan eksekutif

Kondisi repository telah berkembang dibanding audit sebelumnya. Ada workflow CI untuk syntax check dan test; migration runner kini mencatat versi dan checksum, menggunakan advisory lock, memeriksa preflight, serta menerapkan migration transaksional; pemeriksaan maker-checker juga ada di service dan constraint database. Kontrol aplikasi seperti RBAC, session revocation, CSRF, rate limit, audit log, ledger stok, dan idempotensi tampak di kode.

**Penilaian kapabilitas keseluruhan: Level 1 — Performed, dengan beberapa kontrol teknis mendekati/menunjukkan Level 2.** Angka ini adalah ringkasan konservatif dari bukti repository untuk objective yang dipilih, bukan skor COBIT resmi organisasi. Proses masih belum didukung bukti operasi konsisten, pemilik formal, pemantauan hasil, dan validasi runtime.

**Belum layak untuk produksi/transaksi nyata.** Pembayaran sengaja test-only dan webhook provider belum dikonfigurasi; pemulihan database belum dibuktikan; migration runner dan migration 0013 belum direkonsiliasi ke dokumen setup; CI tidak membuktikan bahwa branch protection mewajibkan workflow lulus; dan tidak ada bukti deployment, PostgreSQL acceptance/concurrency test terkini, monitoring atau penanganan insiden.

Tidak ditemukan bukti cukup untuk menyatakan ada eksploit yang telah terjadi. Temuan di bawah adalah **kerentanan/gap kontrol berbasis code review**, bukan hasil pemindaian dinamis atau pembuktian exploitability.

## 2. Metode, skala, dan batasan

COBIT 2019 Performance Management mengukur capability objective/proses pada skala 0–5. Penetapan capability seharusnya didasarkan pada aktivitas proses yang dinilai dan bukti tervalidasi. Karena akses audit ini terbatas pada repository, skor adalah estimasi *evidence-based* dan tidak mengklaim seluruh aktivitas COBIT telah terpenuhi. Lihat [panduan penilaian COBIT 2019 dari ISACA](https://www.isaca.org/resources/news-and-trends/industry-news/2019/using-cobit-2019-performance-management-model-to-assess-governance-and-management-objectives) dan [penjelasan skala capability 0–5](https://www.isaca.org/resources/news-and-trends/industry-news/2020/cobit-2019-and-cobit-5-comparison).

| Level | Makna ringkas yang dipakai dalam review |
|---:|---|
| 0 | Proses tidak lengkap/tidak menunjukkan kapabilitas dasar. |
| 1 | Tujuan proses dikerjakan melalui aktivitas dasar; hasil dapat terlihat, tetapi konsistensi dan pengelolaannya belum terbukti. |
| 2 | Proses direncanakan, dipantau, disesuaikan, dan memiliki hasil/artefak pengelolaan yang dapat ditelusuri. |
| 3 | Proses terdefinisi dan dijalankan dengan cara baku organisasi. |
| 4 | Proses terdefinisi serta kinerjanya diukur secara kuantitatif. |
| 5 | Pengukuran dipakai untuk optimasi dan perbaikan berkelanjutan. |

Level diberikan per objective berdasarkan artefak repository. Kehadiran kode/tes bukan bukti bahwa kontrol berjalan pada deployment atau direview rutin. Working tree berisi perubahan yang belum tentu sudah di-commit, di-merge, atau digunakan di database. Tidak ada akses ke database PostgreSQL runtime, cloud/deployment, backup, log produksi, CI branch protection, wawancara, bukti UAT, maupun prosedur kerja.

## 3. Profil capability objective terpilih

| Objective | Level estimasi | Bukti repository | Kesenjangan utama |
|---|---:|---|---|
| **EDM03 — Ensured Risk Optimization** | 1 | Pembatasan pembayaran test-only, pemeriksaan konfigurasi keamanan, preflight migration. | Belum ada risk register yang disetujui, risk owner, target risiko, atau risk acceptance. |
| **APO01 — Managed I&T Management Framework** | 1 | README, scope, migration policy, workflow kontribusi. | Dokumentasi setup bertentangan dengan runner dan migration terkini; RACI/SOP operasi tidak terlihat. |
| **APO12 — Managed Risk** | 1 | Risiko teknis tersirat dalam guardrails dan dokumen audit terdahulu. | Tidak ada siklus identifikasi, penilaian, penanganan, dan review risiko yang tercatat. |
| **APO13 — Managed Security** | 1 | bcrypt, RBAC, cookie HttpOnly/SameSite, CSRF, CORS allowlist, Helmet, rate limit, revocation, secret validation. | Belum ada bukti security review/scan berkala, rotation secret, review hak akses, atau latihan respons insiden. |
| **APO14 — Managed Data** | 1 | Relational schema, snapshot transaksi, stock ledger, audit log. | Pemilik data, klasifikasi, retensi/penghapusan, backup/restore, dan uji kualitas data belum dibuktikan. |
| **BAI06 — Managed IT Changes** | 2* | Migration runner: schema ledger, checksum SHA-256, advisory lock, urutan kontigu, preflight, transaction; migration append-only. | Implementasi baru belum tercermin dalam dokumen kanonis; baseline database lama dan semua jalur upgrade perlu diverifikasi di PostgreSQL. |
| **BAI07 — Managed IT Change Acceptance and Transitioning** | 1 | GitHub Actions menjalankan `npm ci`, `npm run check`, `npm test`; ada migration preflight dan laporan test historis. | Tidak ada bukti branch protection, staging gate, UAT formal, rollback/restore rehearsal, atau acceptance pemilik proses. |
| **DSS01 — Managed Operations** | 1 | Health live/ready, structured logs dengan redaction, instruksi menjalankan aplikasi lokal. | Tidak ada monitoring/alert/SLO, runbook produksi, jadwal operasional, atau bukti dukungan layanan. |
| **DSS02 — Managed Service Requests and Incidents** | 0 | Request ID dan log membantu diagnosis teknis. | Tidak ada alur pencatatan, klasifikasi, eskalasi, komunikasi, target respons, dan review insiden yang terbukti. |
| **DSS04 — Managed Continuity** | 0 | Dokumen setup meminta backup sebelum migration. | Backup otomatis, RPO/RTO, retensi, restore drill, dan prosedur pemulihan tidak tersedia/terbukti. |
| **DSS05 — Managed Security Services** | 1 | Kontrol autentikasi, session revocation, rate limit, redaksi log. | Tidak ada bukti alert keamanan, pemindaian kerentanan/dependency terjadwal, secret operations, dan incident response. |
| **DSS06 — Managed Business Process Controls** | 2* | Kode menunjukkan transaksi stok atomik, idempotensi, reservation, audit log, maker-checker untuk procurement/stocktake. | Integrasi PostgreSQL, concurrency, rollback, migrasi yang sudah diterapkan, dan UAT bisnis belum diverifikasi saat review ini. |
| **MEA01 — Managed Performance and Conformance Monitoring** | 1 | Health endpoints dan dashboard operasional tersedia. | Tidak terlihat KPI/SLO target, alert threshold, review berkala, atau corrective action yang ditutup. |
| **MEA02 — Managed System of Internal Control** | 1 | RBAC, audit log, preflight, CI dan sejumlah test source-contract. | Tidak ada bukti review independen atas akses/log/exception dan efektivitas kontrol secara periodik. |
| **MEA04 — Managed Assurance** | 1 | Ada audit COBIT terdahulu, laporan tes, dan dokumen procurement audit. | Tidak ada rencana assurance berkala dan bukti temuan ditutup serta divalidasi oleh reviewer independen. |

`*` Level 2 hanya menggambarkan sebagian kontrol teknis terlihat terkelola dalam repository. Tanpa bukti operasi berulang, keputusan organisasi, dan hasil runtime, level proses final tetap perlu divalidasi. Objective lain tidak dipilih sebagai fokus audit ini; tidak dinilai bukan berarti sudah terpenuhi.

## 4. Temuan kerentanan dan prioritas

| ID / prioritas | Temuan dan dampak potensial | Bukti dan rekomendasi |
|---|---|---|
| **F-01 / Tinggi** | **Ketahanan dan pemulihan database belum dibuktikan.** Kerusakan, salah migrasi, atau hilangnya host dapat menghilangkan transaksi, stok, dan jejak audit. | Dokumen meminta backup sebelum perubahan, tetapi tidak ada bukti backup terjadwal/restore drill. Tetapkan RPO/RTO dan retensi dengan pemilik bisnis; otomatisasi backup terenkripsi; batasi akses backup; uji restore ke lingkungan terisolasi secara berkala dan simpan hasilnya. (DSS04, APO14) |
| **F-02 / Tinggi** | **Dokumentasi migrasi berkontradiksi dengan kode saat ini.** Operator dapat memilih prosedur manual lama, melewatkan migration 0013, atau memakai urutan yang tidak konsisten. | `scripts/migrate.js`, `.github/workflows/ci.yml`, dan migration 0013 ada di working tree, sementara `db/README.md` dan `db/migrations/README.md` menyatakan tidak ada runner dan berhenti di 0012; beberapa instruksi masih meminta 0012 sebagai migration pending. Tetapkan runner sebagai satu-satunya alur resmi setelah validasi; perbarui urutan, versi terbaru, contoh command, baseline/upgrade path dan health check; uji upgrade pada salinan database sebelum rilis. (APO01, BAI06, BAI07) |
| **F-03 / Tinggi** | **Pembayaran belum aman/siap untuk operasi bisnis nyata.** Callback pihak ketiga belum memiliki autentikasi provider; status pembayaran online, rekonsiliasi, refund, dan penanganan callback ulang belum operasional. | Route webhook secara eksplisit mengembalikan 501 dan menyebut signature verification belum ada. Pertahankan mode test-only sampai provider dipilih; implementasikan verifikasi signature, validasi nominal/status/order, idempotency dan replay protection, rekonsiliasi/refund; uji sandbox dan persetujuan go-live sebelum mengaktifkan. (APO10, DSS06, BAI07) |
| **F-04 / Tinggi** | **Migrasi database belum dibuktikan pada PostgreSQL aktual.** Runner dan test source tidak membuktikan skema runtime atau concurrency benar; kegagalan dapat menghentikan layanan atau merusak integritas data. | Laporan sebelumnya menyebut uji migration dan concurrency PostgreSQL belum dilakukan. Jalankan dry-run lalu migration pada database uji hasil restore; verifikasi ledger/checksum dan `/health/ready`; lakukan acceptance procurement, stocktake, payment test, serta concurrent posting/rollback; simpan hasil dan versi commit. (BAI07, DSS06) |
| **F-05 / Sedang** | **CI yang tersedia belum terbukti wajib untuk merge.** Check dapat berjalan tetapi perubahan masih bisa masuk tanpa check lulus bila branch protection/ruleset tidak mewajibkannya. | Workflow hanya menyatakan trigger push/PR ke `main`; konfigurasi repository eksternal tidak tersedia. Aktifkan required status checks, proteksi branch, review minimal, dan aturan CODEOWNERS bila sesuai; simpan bukti pengaturan. (BAI07, MEA02) |
| **F-06 / Sedang** | **Monitoring dan respons insiden belum dibentuk.** Gangguan DB, penyalahgunaan akun, selisih stok, atau callback gagal mungkin terlambat diketahui/ditangani. | Endpoint health/log tersedia tetapi alert, runbook, owner dan pencatatan insiden belum tampak. Tetapkan penanggung jawab dan kanal eskalasi; mulai dengan alert DB/health dan lonjakan login gagal, runbook untuk database down/stok mismatch/akun kompromi, serta catatan insiden dan review pasca-kejadian. (DSS01, DSS02, DSS05) |
| **F-07 / Sedang** | **Kebersihan kontrol masih bergantung pada konsistensi artefak dan praktik operator.** Contoh kredensial bootstrap `admin/admin` dan dump lokal menambah risiko jika database/dump dibagikan atau kredensial dibawa ke lingkungan lain. | README membatasi bootstrap ke `db_gcims_test`, meminta penggantian password, dan mengingatkan dump/secret tidak dipublikasikan. Pertahankan guard tersebut; pastikan seed/demo tidak memakai ulang kredensial, gunakan secret manager, rotasi bila pernah dibagi, batasi dan enkripsi backup. Tidak ada bukti `.env`/dump bocor pada review ini. (APO13, DSS05) |
| **F-08 / Sedang** | **Belum ada bukti lifecycle keamanan dan kewajiban data.** Kerentanan dependency/akses berlebihan atau retensi data yang tak sesuai dapat tidak terdeteksi. | CI saat ini menjalankan check dan test tetapi tidak menunjukkan pemindaian dependency/security; repository juga tidak menetapkan retensi/klasifikasi data. Tambah dependency/security scanning terjadwal dengan penanganan temuan, review akses admin periodik, serta konfirmasi data owner, klasifikasi, retensi, dan kewajiban kontraktual/regulasi yang berlaku. (APO13, APO14, MEA03) |

Prioritas tinggi di atas adalah hambatan sebelum produksi. Prioritas sedang harus memiliki owner dan tanggal target sebelum pemakaian rutin. Penentuan risiko legal/privacy spesifik belum dapat dilakukan tanpa yurisdiksi, jenis data aktual, kontrak, dan konfirmasi pemilik bisnis.

## 5. Rencana perbaikan yang dapat diverifikasi

| Jangka waktu | Tindakan | Bukti penyelesaian |
|---|---|---|
| **Sebelum migration berikutnya** | Rekonsiliasi seluruh panduan database dengan runner/migration 0013; verifikasi migration baru dan baseline pada salinan DB; dokumentasikan perintah dry-run dan apply yang aman. | README konsisten, hasil dry-run, hasil migration di database uji, schema ledger/checksum cocok, dan `/health/ready` lulus. |
| **Sebelum pilot operasional** | Backup otomatis, retensi dan akses backup; uji restore; tetapkan RPO/RTO; validasi PostgreSQL untuk alur order/stok/procurement/stocktake. | Log backup, restore report, hasil integration/concurrency test dan UAT yang disetujui. |
| **Sebelum transaksi non-tunai/produksi** | Selesaikan adapter gateway, callback verification, idempotency, rekonsiliasi, refund/manual review; aktifkan hanya setelah review. | Hasil sandbox, threat/control review, rekonsiliasi contoh, persetujuan pemilik merchant dan go-live checklist. |
| **30 hari** | Aktifkan required CI checks/review; tetapkan owner sistem, database, keamanan dan insiden; buat runbook incident/operasi. | Bukti ruleset/branch protection, RACI, runbook dan catatan simulasi insiden. |
| **60–90 hari** | Tambahkan monitoring/alert, dependency-security review, review akses dan audit log; tetapkan indikator KPI/SLO serta siklus MEA. | Dashboard/alert terbukti, hasil review akses/log, daftar temuan dengan owner dan tanggal penutupan. |

Target awal yang disarankan untuk proses prioritas adalah **Level 2** untuk BAI06, BAI07, DSS01, DSS04, DSS05, DSS06 dan MEA02; **Level 3** menjadi target jangka menengah setelah proses baku organisasi, owner, pengukuran, serta bukti pelaksanaan stabil. Target akhir perlu disetujui pemilik sistem/bisnis melalui konteks COBIT enterprise design factors.

## 6. Perubahan dibanding audit terdahulu

| Area | Catatan audit terdahulu | Kondisi repository saat review |
|---|---|---|
| Change/migration (BAI06) | Status migration dicatat manual; belum ada runner/ledger. | Runner baru memiliki schema ledger, checksum, advisory lock, validasi urutan, preflight dan apply transaksional. Dokumentasi belum mengikuti perubahan. |
| CI dan acceptance (BAI07) | Belum ada CI wajib. | Workflow CI menjalankan syntax check dan test untuk push/PR ke `main`; status wajib dan branch protection tidak dapat diverifikasi. |
| Maker-checker (DSS06/MEA02) | Follow-up menyatakan helper dan migration 0006 ditambahkan, runtime masih pending. | Kode service dan constraint database tersedia; penerapan migration/runtime acceptance tetap belum diverifikasi. |
| KDS FIFO (DSS06) | Belum menjadi fokus temuan awal. | Ada migration 0013 untuk memulihkan FIFO index; dokumentasi canonical migration order belum mencantumkannya. |
| Continuity, incident, payment production | Gap utama audit terdahulu. | Belum ada bukti perubahan yang menutupnya; pembayaran masih test-only dan webhook 501. |

Dokumen terdahulu menyebut hasil tes 46/46 untuk audit awal dan laporan procurement mencatat 34/34 pada baseline yang lebih lama. Angka historis itu bukan hasil menjalankan ulang tes pada working tree saat ini; review ini tidak menjalankan test atau mengakses database runtime.

## 7. Kesimpulan

GCIMS menunjukkan kontrol aplikasi dan transaksi yang cukup baik untuk MVP, serta kemajuan nyata pada CI dan migrasi skema. Namun kapabilitas tata kelola dan operasi yang dapat dibuktikan masih dominan **Level 1**. Level 2 tampak pada beberapa kontrol perubahan dan proses bisnis di kode, tetapi belum tervalidasi sebagai proses rutin pada lingkungan berjalan.

Kesimpulan audit saat ini: **prototype dengan kontrol teknis yang berkembang; belum layak dinyatakan siap produksi atau compliant dengan COBIT 2019.** Tutup temuan F-01 sampai F-04 sebelum pilot yang menyimpan transaksi nyata. Validasi eksternal atas database, deployment, akses, backup, CI settings, dan tata kelola diperlukan untuk menetapkan skor organisasi yang definitif.

## 8. Referensi internal dan kerangka

- Audit sebelumnya: [`docs/audit-cobit-2019.md`](./audit-cobit-2019.md).
- Lingkup sistem: [`reference/implementation_scope.md`](../reference/implementation_scope.md).
- Setup database: [`db/README.md`](../db/README.md), [`db/migrations/README.md`](../db/migrations/README.md).
- Implementasi migration: [`scripts/migrate.js`](../scripts/migrate.js), [`src/lib/migration-runner.js`](../src/lib/migration-runner.js).
- Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- Pembayaran: [`src/routes/payments.js`](../src/routes/payments.js), [`src/lib/payment-service.js`](../src/lib/payment-service.js).
- Procurement dan maker-checker: [`src/lib/procurement-service.js`](../src/lib/procurement-service.js), migration `0005`–`0007`.
- ISACA, [Using COBIT 2019 Performance Management Model to Assess Governance and Management Objectives](https://www.isaca.org/resources/news-and-trends/industry-news/2019/using-cobit-2019-performance-management-model-to-assess-governance-and-management-objectives).
- ISACA, [COBIT 2019 and COBIT 5 Comparison](https://www.isaca.org/resources/news-and-trends/industry-news/2020/cobit-2019-and-cobit-5-comparison).
