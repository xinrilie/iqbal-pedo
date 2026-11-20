-- GCIMS backend MVP — permission katalog.
-- Aman dijalankan ulang. Dijalankan pada database db_gcims_test terlebih dahulu.
SET search_path = gcims, public;

INSERT INTO permissions (code, module, description) VALUES
  ('pos.catalog.read', 'pos', 'Melihat katalog POS'),
  ('pos.order.create', 'pos', 'Membuat draft pesanan'),
  ('pos.order.read', 'pos', 'Melihat pesanan'),
  ('pos.order.update', 'pos', 'Mengubah draft keranjang'),
  ('pos.payment.create', 'pos', 'Membuat pembayaran'),
  ('pos.payment.read', 'pos', 'Melihat pembayaran'),
  ('pos.payment.cancel', 'pos', 'Membatalkan pembayaran pending'),
  ('pos.receipt.read', 'pos', 'Melihat bukti transaksi'),
  ('pos.shift.read', 'pos', 'Melihat status dan ringkasan shift kasir'),
  ('pos.shift.write', 'pos', 'Membuka dan menutup shift kasir'),
  ('pos.cash_drawer.write', 'pos', 'Mencatat aktivitas laci kas'),
  ('kds.ticket.read', 'kds', 'Melihat antrean barista'),
  ('kds.ticket.update', 'kds', 'Mengubah status tiket barista'),
  ('admin.inventory.read', 'admin', 'Melihat master inventori'),
  ('admin.inventory.update', 'admin', 'Mengubah master inventori'),
  ('admin.menu.read', 'admin', 'Melihat menu dan BOM'),
  ('admin.menu.update', 'admin', 'Mengubah menu dan BOM'),
  ('admin.dashboard.read', 'admin', 'Melihat dashboard operasional'),
  ('procurement.supplier.read', 'procurement', 'Melihat data supplier'),
  ('procurement.supplier.write', 'procurement', 'Membuat dan mengubah data supplier'),
  ('procurement.catalog.read', 'procurement', 'Melihat katalog item supplier'),
  ('procurement.catalog.write', 'procurement', 'Mengelola katalog item supplier'),
  ('procurement.po.read', 'procurement', 'Melihat purchase order'),
  ('procurement.po.create', 'procurement', 'Membuat purchase order'),
  ('procurement.po.submit', 'procurement', 'Mengirim purchase order untuk approval'),
  ('procurement.po.approve', 'procurement', 'Menyetujui purchase order'),
  ('procurement.po.send', 'procurement', 'Menandai purchase order telah dikirim ke supplier'),
  ('procurement.po.cancel', 'procurement', 'Membatalkan purchase order'),
  ('procurement.po.close', 'procurement', 'Menutup purchase order yang telah diterima penuh'),
  ('procurement.receipt.read', 'procurement', 'Melihat goods receipt'),
  ('procurement.receipt.create', 'procurement', 'Mencatat penerimaan barang'),
  ('procurement.receipt.submit', 'procurement', 'Mengirim goods receipt untuk approval'),
  ('procurement.receipt.approve', 'procurement', 'Menyetujui goods receipt'),
  ('procurement.receipt.post', 'procurement', 'Memposting barang diterima ke inventory ledger')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  description = EXCLUDED.description;
