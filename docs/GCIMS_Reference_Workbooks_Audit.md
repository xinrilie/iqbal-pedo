# Audit referensi workbook GCIMS

Tanggal pemeriksaan: 16 November 2026. Ketiga workbook dibaca sebagai sumber data dan rancangan; teks di dalam workbook tidak dianggap sebagai instruksi untuk mengubah database.

## Kecocokan dengan skema

Database sudah memiliki tabel untuk master item, menu dan varian, resep BOM berversi, satuan konversi, supplier, purchase order, penerimaan barang, serta ledger stok. Alur BOM dapat memakai `recipe_items.quantity_base` untuk menyimpan kuantitas hasil konversi ke satuan dasar item.

Migrasi `0010_catalog_reference_alignment.sql` menambahkan `conversion_basis` dan catatan wajib untuk konversi lintas dimensi. Konversi isi kemasan seperti gram ke `UNT` sekarang bisa disimpan sebagai aturan `package_content`; konversi tanpa dasar/catatan tetap ditolak. BOM READY menggunakan kuantitas yang sudah dikonversi ke satuan stok, sedangkan Operational Master memasok 46 aturan konversi yang berstatus OK.

Database belum memiliki model inventori untuk persiapan tanpa SKU. Dua baris `Soda Water` dicatat di catatan versi resep dan tidak mengurangi stok; semua bahan bersku tetap memakai BOM terkonversi. Enam menu yang ditandai BOM tidak berlaku tetap nonaktif sampai BOM atau pemetaan stok tersedia.

## Ringkasan dan perbedaan sumber

| Workbook | Isi yang ditemukan | Catatan integrasi |
| --- | --- | --- |
| `GCIMS_Inventory_Management_V1_READY_TO_USE.xlsx` | 275 baris master item, 55 menu, 403 baris detail BOM. Ada 398 mapping `OK`, 3 `OK - SAME UOM`, dan 2 baris persiapan tanpa SKU. Sheet opening stock kosong. | Dipilih sebagai sumber master dan BOM; 220 item non-menu diimpor. Dari 401 baris BOM bersku, 49 menu mempunyai BOM aktif yang bisa dipakai. Enam menu bertanda BOM tidak berlaku. |
| `GCIMS - MASTER ITEM NEW (1).xlsx` | 1.279 kode unik: 980 `ADD`, 162 `RSL`, 54 `MNU`, serta item `RAW`, `PKG`, `OPS`, dan `FGD`. | Kode menu memakai pola seperti `CAF-MNU-COF-001`, yang cocok dengan katalog yang sudah ada. Baris `ADD` adalah kombinasi/add-on, bukan master stok yang aman untuk diimpor sebagai item inventori. |
| `GCIMS _ Inventory Management System _ Operational Master _ v1.9.2 (1).xlsx` | 266 master item, 411 baris resep dengan 53 ID resep, 47 baris konversi, 8 supplier, dan 211 baris opening count. | Master item memiliki 266 kode yang juga ada pada workbook READY; READY memiliki 9 kode `MRT` tambahan. Opening count berisi angka tetapi kolom konfirmasinya belum dicentang. |

Kode SKU bahan di workbook yang sudah masuk ke database sebelumnya memakai `CAF-RAW`/`CAF-PKG`; referensi baru memakai `CAF-RM`/`CAF-PK`. Kode menu dari workbook READY juga berbeda dari pola menu pada Master Item New. Karena itu nama yang mirip belum cukup untuk melakukan overwrite atau menyatukan SKU secara otomatis.

Tidak ada harga jual menu pada workbook. Katalog terpilih memberi harga acak deterministik Rp12.000–Rp45.000 untuk pengujian; setiap varian bertanda `is_test_price` dan UI menampilkan label **Harga uji**. Ganti harga sebelum operasional. Opening stock, opening count, dan baris transaksi PO/GR workbook tidak diimpor. Untuk uji checkout saja, fixture `db/dev/opening_balance_ready_catalog.sql` menambahkan saldo simulasi cukup untuk 10 porsi per menu aktif; angka ini bukan stok fisik.

Impor sudah diterapkan ke `db_gcims_test`: 220 master inventori, 55 menu, 401 baris BOM terkonversi, 46 aturan UOM, 8 nama supplier, dan 49 versi resep aktif. Menu lama yang belum pernah dipakai transaksi dibersihkan; 47 SKU stok lama yang tergantikan dinonaktifkan tanpa menghapus ledger. Menu historis dan 109 sales orders tetap tersimpan. Fixture POS menambahkan 43 opening ledger simulasi; harga tidak berasal dari workbook, dan detail kontak supplier tidak dimasukkan ke seed yang dilacak di repo.

## Fitur Admin

Panel Admin mendukung tambah menu dengan satu varian Reguler, harga, kategori, dan komposisi bahan. Harga yang dibuat dari panel juga ditandai harga uji. Hapus menu akan menghapus permanen bila belum pernah dipakai transaksi; menu yang memiliki riwayat penjualan akan diarsipkan agar referensi struk, resep, dan audit tetap utuh.
