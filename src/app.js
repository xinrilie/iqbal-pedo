import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './lib/db.js';
import { AppError } from './lib/errors.js';
import { registerAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { posRoutes } from './routes/pos.js';
import { orderRoutes } from './routes/orders.js';
import { paymentRoutes } from './routes/payments.js';
import { kdsRoutes } from './routes/kds.js';
import { procurementRoutes } from './routes/procurement.js';
import { cashierRoutes } from './routes/cashier.js';
import { adminRoutes } from './routes/admin.js';
import { uiRoutes } from './routes/ui.js';
import { stocktakeRoutes } from './routes/stocktakes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', '*.password', '*.password_hash', '*.token', '*.access_token'],
        censor: '[REDACTED]'
      }
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => `gcims-${randomUUID()}`,
    trustProxy: false,
    bodyLimit: 1_048_576
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'idempotency-key', 'if-match', 'x-request-id', 'x-csrf-token']
  });
  await app.register(rateLimit, { global: true, max: 150, timeWindow: '1 minute' });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await registerAuth(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id,
          details: error.details
        }
      });
    }
    if (error?.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Terlalu banyak request. Coba lagi beberapa saat.', request_id: request.id, details: [] } });
    }
    if (error?.validation) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'Request tidak valid.', request_id: request.id, details: error.validation }
      });
    }
    if (error?.code === '23505') {
      return reply.code(409).send({ error: { code: 'DUPLICATE_RESOURCE', message: 'Data dengan identitas yang sama sudah ada.', request_id: request.id, details: [] } });
    }
    if (error?.code === '23503' || error?.code === '23514') {
      return reply.code(422).send({ error: { code: 'DATA_INTEGRITY_VIOLATION', message: 'Operasi melanggar aturan integritas data.', request_id: request.id, details: [] } });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal.', request_id: request.id, details: [] }
    });
  });

  app.get('/health/live', async () => ({ status: 'ok', service: 'gcims-backend' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      const result = await pool.query(
        `SELECT current_database() AS database_name,
                to_regnamespace('gcims') IS NOT NULL AS gcims_schema_available,
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema='gcims' AND table_name='users' AND column_name='auth_token_version'
                ) AS auth_session_migration_available`
      );
      if (!result.rows[0].gcims_schema_available) {
        return reply.code(503).send({ status: 'not_ready', database: result.rows[0].database_name, schema: 'unavailable' });
      }
      if (!result.rows[0].auth_session_migration_available) {
        return reply.code(503).send({ status: 'not_ready', database: result.rows[0].database_name, schema: 'gcims', migration: '0012_auth_session_revocation' });
      }
      return { status: 'ready', database: result.rows[0].database_name, schema: 'gcims' };
    } catch {
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });

  await uiRoutes(app);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(posRoutes, { prefix: '/api/v1' });
  await app.register(orderRoutes, { prefix: '/api/v1' });
  await app.register(paymentRoutes, { prefix: '/api/v1' });
  await app.register(kdsRoutes, { prefix: '/api/v1' });
  await app.register(procurementRoutes, { prefix: '/api/v1' });
  await app.register(cashierRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(stocktakeRoutes, { prefix: '/api/v1' });

  app.addHook('onClose', async () => {
    await pool.end();
  });
  return app;
}
