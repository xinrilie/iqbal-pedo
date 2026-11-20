-- Admin-only cashier account management and sales/shift reporting permissions.
-- Apply after 0008_cashier_shifts.sql.
BEGIN;

INSERT INTO gcims.permissions (code,module,description) VALUES
  ('admin.users.read','admin','Melihat akun kasir'),
  ('admin.users.manage','admin','Menambah, menonaktifkan, dan mengatur ulang akun kasir'),
  ('admin.sales.read','admin','Melihat laporan penjualan dan shift kasir')
ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module,description=EXCLUDED.description;

INSERT INTO gcims.roles (company_id,code,name,description,scope,is_system_role)
SELECT c.id,'CASHIER','Kasir','Akun operasional kasir POS','outlet',TRUE
  FROM gcims.companies c
ON CONFLICT (company_id,code) DO NOTHING;

INSERT INTO gcims.role_permissions (role_id,permission_id)
SELECT r.id,p.id
  FROM gcims.roles r
  JOIN gcims.permissions p ON p.code IN (
    'pos.catalog.read','pos.order.create','pos.order.read','pos.order.update',
    'pos.payment.create','pos.payment.read','pos.payment.cancel','pos.receipt.read',
    'pos.shift.read','pos.shift.write','pos.cash_drawer.write'
  )
 WHERE r.code='CASHIER'
ON CONFLICT DO NOTHING;

INSERT INTO gcims.role_permissions (role_id,permission_id)
SELECT r.id,p.id
  FROM gcims.roles r
  JOIN gcims.permissions p ON p.code IN ('admin.users.read','admin.users.manage','admin.sales.read')
 WHERE r.code='ADMIN'
ON CONFLICT DO NOTHING;

COMMIT;
