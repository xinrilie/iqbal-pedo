import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { loginWithPassword } from '../auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { pool } from '../lib/db.js';
import { withTransaction } from '../lib/db.js';
import { isBcryptPasswordLengthValid, toLoginCredentials } from '../lib/auth-input.js';
import { accessTokenClaims } from '../lib/jwt-claims.js';
import { config } from '../config.js';
import { clearSessionCookie, serializeSessionCookie } from '../lib/session-cookie.js';

const PrototypeLoginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200).refine(isBcryptPasswordLengthValid, 'Password terlalu panjang untuk algoritma hash yang digunakan.')
});
const ScopedLoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200).refine(isBcryptPasswordLengthValid, 'Password terlalu panjang untuk algoritma hash yang digunakan.'),
  company_id: z.string().uuid(),
  outlet_id: z.string().uuid()
});
const LoginSchema = z.union([PrototypeLoginSchema, ScopedLoginSchema]);

export async function authRoutes(app) {
  app.post('/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') {
      request.log.warn({ security_event: 'auth.login.blocked', reason: 'cross_site', remote_address: request.ip }, 'Cross-site login request blocked');
      throw forbidden('Login lintas situs ditolak.');
    }
    const origin = request.headers.origin;
    if (origin) {
      const allowedOrigins = new Set(config.CORS_ORIGIN.split(',').map((value) => value.trim()));
      if (config.NODE_ENV !== 'production') allowedOrigins.add(`${request.protocol}://${request.headers.host}`);
      if (!allowedOrigins.has(origin)) {
        request.log.warn({ security_event: 'auth.login.blocked', reason: 'origin_rejected', remote_address: request.ip }, 'Login request from an untrusted origin blocked');
        throw forbidden('Origin login tidak diizinkan.');
      }
    }
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload login tidak valid.', parsed.error.issues);
    let user;
    try {
      user = await loginWithPassword(toLoginCredentials(parsed.data));
    } catch (error) {
      if (error.statusCode === 401) {
        request.log.warn({ security_event: 'auth.login.failed', reason: 'invalid_credentials', remote_address: request.ip }, 'Login failed');
      }
      throw error;
    }
    request.log.info({ security_event: 'auth.login.succeeded', actor_user_id: user.id, remote_address: request.ip }, 'Login succeeded');
    const csrfToken = randomBytes(32).toString('base64url');
    const claims = accessTokenClaims(user, csrfToken);
    const token = app.jwt.sign(claims.payload, { ...claims.options, expiresIn: config.JWT_TTL });
    await pool.query('UPDATE gcims.users SET last_login_at = now() WHERE id = $1', [user.id]);
    reply.header('set-cookie', serializeSessionCookie(token, { ttl: config.JWT_TTL, secure: config.NODE_ENV === 'production' }));
    const { company_id: companyId, outlet_id: outletId, auth_token_version: _tokenVersion, ...publicUser } = user;
    return reply.code(200).send({ token_type: 'Cookie', expires_in: config.JWT_TTL, csrf_token: csrfToken, user: publicUser, scope: { company_id: companyId, outlet_id: outletId } });
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE gcims.users SET auth_token_version=auth_token_version+1,updated_at=now() WHERE id=$1`,
        [request.gcims.userId]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data)
         VALUES($1,$2,$3,'auth.session.revoked','user',$3,jsonb_build_object('reason','logout'))`,
        [request.gcims.companyId,request.gcims.outletId,request.gcims.userId]
      );
    });
    reply.header('set-cookie', clearSessionCookie({ secure: config.NODE_ENV === 'production' }));
    return { ok: true };
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
      permissions: permissions.rows[0].codes,
      csrf_token: request.gcims.csrfToken ?? null
    };
  });
}
