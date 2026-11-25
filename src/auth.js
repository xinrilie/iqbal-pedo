import bcrypt from 'bcryptjs';
import { pool } from './lib/db.js';
import { forbidden, unauthorized } from './lib/errors.js';
import { config } from './config.js';

export async function registerAuth(app) {
  app.decorateRequest('gcims', null);
  app.decorate('authenticate', async function authenticate(request) {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Token akses tidak valid atau kedaluwarsa.');
    }
    const { sub, company_id: companyId, outlet_id: outletId, token_version: tokenVersion } = request.user ?? {};
    if (!sub || !companyId || !outletId) throw unauthorized('Token tidak memiliki scope perusahaan/outlet.');
    const active = await pool.query(
      `SELECT u.auth_token_version
         FROM gcims.users u
         JOIN gcims.company_memberships cm ON cm.user_id = u.id AND cm.company_id = $2
         JOIN gcims.companies c ON c.id = cm.company_id AND c.is_active = TRUE
         JOIN gcims.outlets o ON o.company_id = cm.company_id AND o.id = $3
        WHERE u.id = $1 AND u.is_active = TRUE
          AND cm.membership_status = 'active' AND o.is_active = TRUE`,
      [sub, companyId, outletId]
    );
    if (!active.rowCount) throw unauthorized('Akun, membership, atau outlet sudah tidak aktif.');
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion !== active.rows[0].auth_token_version) {
      throw unauthorized('Sesi sudah dicabut. Silakan masuk kembali.');
    }
    request.gcims = { userId: sub, companyId, outletId };
  });

  app.decorate('requirePermission', function requirePermission(permissionCode) {
    return async function permissionGuard(request) {
      if (!request.gcims) throw unauthorized();
      const result = await pool.query(
        `SELECT 1
           FROM gcims.company_memberships cm
           JOIN gcims.user_role_assignments ura
             ON ura.company_id = cm.company_id AND ura.user_id = cm.user_id
           JOIN gcims.roles r ON r.company_id = ura.company_id AND r.id = ura.role_id
           JOIN gcims.role_permissions rp ON rp.role_id = r.id
           JOIN gcims.permissions p ON p.id = rp.permission_id
          WHERE cm.company_id = $1 AND cm.user_id = $2
            AND cm.membership_status = 'active'
            AND ((r.scope = 'company' AND ura.outlet_id IS NULL) OR (r.scope = 'outlet' AND ura.outlet_id = $3))
            AND p.code = $4
          LIMIT 1`,
        [request.gcims.companyId, request.gcims.userId, request.gcims.outletId, permissionCode]
      );
      if (!result.rowCount) throw forbidden(`Permission '${permissionCode}' tidak tersedia untuk akun/outlet ini.`);
    };
  });
}

export async function loginWithPassword({ username, email, password, companyId, outletId }) {
  const identifier = username ?? email;
  const scopedLogin = Boolean(companyId && outletId);
  const result = await pool.query(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.password_hash, u.auth_token_version,
            c.id AS company_id, o.id AS outlet_id
       FROM gcims.users u
       JOIN gcims.company_memberships cm ON cm.user_id = u.id
       JOIN gcims.companies c ON c.id = cm.company_id AND c.is_active = TRUE
       JOIN gcims.outlets o ON o.company_id = cm.company_id AND o.is_active = TRUE
       JOIN gcims.user_role_assignments ura
         ON ura.company_id = cm.company_id AND ura.user_id = cm.user_id
        AND (ura.outlet_id IS NULL OR ura.outlet_id = o.id)
       JOIN gcims.roles r ON r.company_id = ura.company_id AND r.id = ura.role_id
      WHERE (lower(u.email) = lower($1)
          OR (NOT $4::boolean AND lower(split_part(u.email, '@', 1)) = lower($1)))
        AND u.is_active = TRUE AND cm.membership_status = 'active'
        AND ((r.scope = 'company' AND ura.outlet_id IS NULL) OR (r.scope = 'outlet' AND ura.outlet_id = o.id))
        AND (($4::boolean AND c.id = $2::uuid AND o.id = $3::uuid)
          OR (NOT $4::boolean AND c.code = $5 AND o.code = $6))`,
    [identifier, companyId ?? null, outletId ?? null, scopedLogin,
      config.GCIMS_DEFAULT_COMPANY_CODE, config.GCIMS_DEFAULT_OUTLET_CODE]
  );
  const matchingUsers = [];
  for (const row of result.rows) {
    if (row.password_hash && await bcrypt.compare(password, row.password_hash)) matchingUsers.push(row);
  }
  if (matchingUsers.length !== 1) throw unauthorized('Username/email atau password tidak valid.');
  const user = matchingUsers[0];
  return {
    id: user.id, full_name: user.full_name, email: user.email,
    company_id: user.company_id, outlet_id: user.outlet_id,
    auth_token_version: user.auth_token_version
  };
}
