import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../src/lib/db.js';

const env = process.env;
const adminKeys = ['ADMIN_EMAIL', 'ADMIN_NAME', 'ADMIN_PASSWORD'];
const hasAnyAdminValue = adminKeys.some((key) => env[key]);
const hasAllAdminValues = adminKeys.every((key) => env[key]);
if (hasAnyAdminValue && !hasAllAdminValues) throw new Error('Isi ADMIN_EMAIL, ADMIN_NAME, dan ADMIN_PASSWORD bersama-sama, atau kosongkan semuanya untuk akun prototipe.');
const usePrototypeAdmin = !hasAnyAdminValue;
const adminEmail = env.ADMIN_EMAIL || 'admin@local.test';
const adminName = env.ADMIN_NAME || 'Prototype Admin';
const adminPassword = env.ADMIN_PASSWORD || 'admin';
if (!usePrototypeAdmin && adminPassword.length < 12) throw new Error('ADMIN_PASSWORD minimal 12 karakter.');
if (Buffer.byteLength(adminPassword, 'utf8') > 72) throw new Error('ADMIN_PASSWORD maksimal 72 byte untuk bcrypt.');

const companyCode = env.BOOTSTRAP_COMPANY_CODE || env.GCIMS_DEFAULT_COMPANY_CODE || 'GOURMET-COFFEE';
const companyName = env.BOOTSTRAP_COMPANY_NAME || 'Gourmet Coffee';
const outletCode = env.BOOTSTRAP_OUTLET_CODE || env.GCIMS_DEFAULT_OUTLET_CODE || 'MAIN';
const outletName = env.BOOTSTRAP_OUTLET_NAME || 'Gourmet Coffee - Main';
const stockLocationCode = env.BOOTSTRAP_STOCK_LOCATION_CODE || 'MAIN';
const stockLocationName = env.BOOTSTRAP_STOCK_LOCATION_NAME || 'Gudang Utama';
const permissions = [
  ['pos.catalog.read', 'pos', 'Melihat katalog POS'],
  ['pos.order.create', 'pos', 'Membuat draft pesanan'],
  ['pos.order.read', 'pos', 'Melihat pesanan'],
  ['pos.order.update', 'pos', 'Mengubah draft keranjang'],
  ['pos.payment.create', 'pos', 'Membuat pembayaran'],
  ['pos.payment.read', 'pos', 'Melihat pembayaran'],
  ['pos.payment.cancel', 'pos', 'Membatalkan pembayaran pending'],
  ['pos.receipt.read', 'pos', 'Melihat bukti transaksi'],
  ['pos.shift.read', 'pos', 'Melihat status dan ringkasan shift kasir'],
  ['pos.shift.write', 'pos', 'Membuka dan menutup shift kasir'],
  ['pos.cash_drawer.write', 'pos', 'Mencatat aktivitas laci kas'],
  ['kds.ticket.read', 'kds', 'Melihat antrean barista'],
  ['kds.ticket.update', 'kds', 'Mengubah status tiket barista'],
  ['admin.inventory.read', 'admin', 'Melihat master inventori'],
  ['admin.inventory.update', 'admin', 'Mengubah master inventori'],
  ['admin.menu.read', 'admin', 'Melihat menu dan BOM'],
  ['admin.menu.update', 'admin', 'Mengubah menu dan BOM'],
  ['admin.dashboard.read', 'admin', 'Melihat dashboard operasional'],
  ['procurement.supplier.read', 'procurement', 'Melihat data supplier'],
  ['procurement.supplier.write', 'procurement', 'Membuat dan mengubah data supplier'],
  ['procurement.catalog.read', 'procurement', 'Melihat katalog item supplier'],
  ['procurement.catalog.write', 'procurement', 'Mengelola katalog item supplier'],
  ['procurement.po.read', 'procurement', 'Melihat purchase order'],
  ['procurement.po.create', 'procurement', 'Membuat purchase order'],
  ['procurement.po.submit', 'procurement', 'Mengirim purchase order untuk approval'],
  ['procurement.po.approve', 'procurement', 'Menyetujui purchase order'],
  ['procurement.po.send', 'procurement', 'Menandai purchase order telah dikirim ke supplier'],
  ['procurement.po.cancel', 'procurement', 'Membatalkan purchase order'],
  ['procurement.po.close', 'procurement', 'Menutup purchase order yang telah diterima penuh'],
  ['procurement.receipt.read', 'procurement', 'Melihat goods receipt'],
  ['procurement.receipt.create', 'procurement', 'Mencatat penerimaan barang'],
  ['procurement.receipt.submit', 'procurement', 'Mengirim goods receipt untuk approval'],
  ['procurement.receipt.approve', 'procurement', 'Menyetujui goods receipt'],
  ['procurement.receipt.post', 'procurement', 'Memposting barang diterima ke inventory ledger']
];

try {
  const databaseCheck = await pool.query('SELECT current_database() AS name');
  if (databaseCheck.rows[0]?.name !== 'db_gcims_test') {
    throw new Error('Bootstrap admin hanya diizinkan pada db_gcims_test. Periksa DATABASE_URL sebelum melanjutkan.');
  }
  const hash = await bcrypt.hash(adminPassword, 12);
  const result = await withTransaction(async (client) => {
    for (const [code, module, description] of permissions) {
      await client.query(
        `INSERT INTO gcims.permissions (code, module, description)
         VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE
         SET module = EXCLUDED.module, description = EXCLUDED.description`,
        [code, module, description]
      );
    }
    const company = await client.query(
      `INSERT INTO gcims.companies (code, name) VALUES ($1,$2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`, [companyCode, companyName]
    );
    const companyId = company.rows[0].id;
    const outlet = await client.query(
      `INSERT INTO gcims.outlets (company_id, code, name)
       VALUES ($1,$2,$3)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`, [companyId, outletCode, outletName]
    );
    const outletId = outlet.rows[0].id;
    const location = await client.query(
      `INSERT INTO gcims.stock_locations (company_id, outlet_id, code, name, location_type)
       VALUES ($1,$2,$3,$4,'warehouse')
       ON CONFLICT (outlet_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`, [companyId, outletId, stockLocationCode, stockLocationName]
    );
    const locationId = location.rows[0].id;

    let userResult = await client.query('SELECT id FROM gcims.users WHERE lower(email) = lower($1)', [adminEmail]);
    let userId;
    if (userResult.rowCount) {
      userId = userResult.rows[0].id;
      await client.query(
        `UPDATE gcims.users SET full_name = $2, password_hash = $3, is_active = TRUE,
          auth_token_version = auth_token_version + 1, updated_at = now()
          WHERE id = $1`, [userId, adminName, hash]
      );
    } else {
      userResult = await client.query(
        `INSERT INTO gcims.users (full_name, email, password_hash)
         VALUES ($1,$2,$3) RETURNING id`, [adminName, adminEmail, hash]
      );
      userId = userResult.rows[0].id;
    }
    await client.query(
      `INSERT INTO gcims.company_memberships (company_id, user_id, membership_status, joined_at)
       VALUES ($1,$2,'active',now()) ON CONFLICT (company_id,user_id)
       DO UPDATE SET membership_status = 'active'`, [companyId, userId]
    );
    const role = await client.query(
      `INSERT INTO gcims.roles (company_id, code, name, scope, is_system_role)
       VALUES ($1,'ADMIN','Administrator','company',TRUE)
       ON CONFLICT (company_id, code) DO UPDATE SET scope='company', is_system_role=TRUE
       RETURNING id`, [companyId]
    );
    const roleId = role.rows[0].id;
    await client.query(
      `INSERT INTO gcims.role_permissions (role_id, permission_id)
       SELECT $1, id FROM gcims.permissions
       ON CONFLICT DO NOTHING`, [roleId]
    );
    await client.query(
      `INSERT INTO gcims.user_role_assignments (company_id, user_id, role_id, outlet_id)
       VALUES ($1,$2,$3,NULL) ON CONFLICT DO NOTHING`, [companyId, userId, roleId]
    );
    return { companyId, outletId, locationId, userId };
  });
  process.stdout.write(`Bootstrap admin berhasil.\ncompany_id=${result.companyId}\noutlet_id=${result.outletId}\nstock_location_id=${result.locationId}\nuser_id=${result.userId}\n`);
  if (usePrototypeAdmin) process.stdout.write('Akun prototipe: username=admin password=admin (khusus db_gcims_test).\n');
} finally {
  await pool.end();
}
