import { z } from 'zod';
import { loginWithPassword } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { pool } from '../lib/db.js';
import { toLoginCredentials } from '../lib/auth-input.js';

const PrototypeLoginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200)
});
const ScopedLoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  company_id: z.string().uuid(),
  outlet_id: z.string().uuid()
});
const LoginSchema = z.union([PrototypeLoginSchema, ScopedLoginSchema]);

export async function authRoutes(app) {
  app.post('/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload login tidak valid.', parsed.error.issues);
    const user = await loginWithPassword(toLoginCredentials(parsed.data));
    const token = app.jwt.sign(
      { company_id: user.company_id, outlet_id: user.outlet_id },
      { sub: user.id, expiresIn: process.env.JWT_TTL || '15m' }
    );
    await pool.query('UPDATE gcims.users SET last_login_at = now() WHERE id = $1', [user.id]);
    const { company_id: companyId, outlet_id: outletId, ...publicUser } = user;
    return reply.code(200).send({ access_token: token, token_type: 'Bearer', expires_in: process.env.JWT_TTL || '15m', user: publicUser, scope: { company_id: companyId, outlet_id: outletId } });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const [user, permissions] = await Promise.all([
      pool.query(`SELECT id, full_name, email, phone FROM gcims.users WHERE id = $1`, [request.gcims.userId]),
      pool.query(
        `SELECT COALESCE(array_agg(permission_code ORDER BY permission_code),'{}') AS codes
           FROM (
             SELECT DISTINCT p.code AS permission_code
               FROM gcims.company_memberships cm
               JOIN gcims.user_role_assignments ura ON ura.company_id=cm.company_id AND ura.user_id=cm.user_id
               JOIN gcims.roles r ON r.company_id=ura.company_id AND r.id=ura.role_id
               JOIN gcims.role_permissions rp ON rp.role_id=r.id
               JOIN gcims.permissions p ON p.id=rp.permission_id
              WHERE cm.company_id=$1 AND cm.user_id=$2 AND cm.membership_status='active'
                AND ((r.scope='company' AND ura.outlet_id IS NULL) OR (r.scope='outlet' AND ura.outlet_id=$3))
           ) granted`,
        [request.gcims.companyId, request.gcims.userId, request.gcims.outletId]
      )
    ]);
    return {
      user: user.rows[0],
      scope: { company_id: request.gcims.companyId, outlet_id: request.gcims.outletId },
      permissions: permissions.rows[0].codes
    };
  });
}
