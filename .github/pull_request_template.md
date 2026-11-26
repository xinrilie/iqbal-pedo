## Ringkasan

<!-- Jelaskan perubahan dan alasan singkat. -->

## Dampak

- [ ] POS / kasir
- [ ] Admin
- [ ] API / autentikasi
- [ ] Database migration atau seed
- [ ] Dokumentasi

## Database

<!-- Sebut migration yang perlu dijalankan. Tulis "Tidak ada" bila tidak ada perubahan DB. -->

## Verifikasi

- [ ] `npm run check` lulus.
- [ ] `npm test` lulus.
- [ ] PostgreSQL lokal/test diverifikasi bila SQL berubah; hasil dicatat.
- [ ] Alur terdampak diuji pada lingkungan yang sesuai; hasil/tautan bukti dicantumkan.
- [ ] Jika ada perubahan database, migration baru ditinjau dan urutan/setup docs diperbarui.
- [ ] Jika ada migration, dry-run target dan preflight ditinjau; backup/restore path dipastikan.
- [ ] UAT/acceptance pemilik proses dicatat bila perilaku bisnis berubah.
- [ ] Tidak ada secret, dump, data pelanggan atau credential dalam diff/log.

## Dampak dan pemulihan

- Database/schema:
- Risiko/downtime:
- Langkah pemulihan atau forward-fix:
- Reviewer/approver:

## Catatan untuk reviewer

<!-- Screenshot, risiko, atau pekerjaan lanjutan. Jangan sertakan secret/data pelanggan. -->
