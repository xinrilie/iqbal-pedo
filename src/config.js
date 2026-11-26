import 'dotenv/config';
import { z } from 'zod';
import { validateRuntimeSecurity } from './lib/security-config.js';

const isValidJwtTtl = (value) => /^(\d+)([smhd])$/.test(value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET harus minimal 32 karakter'),
  JWT_TTL: z.string().default('15m').refine(isValidJwtTtl, 'Gunakan format durasi seperti 15m.'),
  GCIMS_DEFAULT_COMPANY_CODE: z.string().default('GOURMET-COFFEE'),
  GCIMS_DEFAULT_OUTLET_CODE: z.string().default('MAIN'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GCIMS_ALERT_WEBHOOK_URL: z.union([z.literal(''), z.string().url()]).default(''),
  LOG_LEVEL: z.string().default('info')
}).superRefine((values, context) => {
  if (values.NODE_ENV === 'production' && values.GCIMS_ALERT_WEBHOOK_URL && new URL(values.GCIMS_ALERT_WEBHOOK_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['GCIMS_ALERT_WEBHOOK_URL'], message: 'Webhook alert produksi harus memakai HTTPS.' });
  }
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
}

validateRuntimeSecurity(parsed.data, {
  testOnlyPaymentEnabled: process.env.GCIMS_ALLOW_TEST_ONLY_PAYMENT === 'true'
});

export const config = Object.freeze(parsed.data);
