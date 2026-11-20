import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET harus minimal 32 karakter'),
  JWT_TTL: z.string().default('15m'),
  GCIMS_DEFAULT_COMPANY_CODE: z.string().default('GOURMET-COFFEE'),
  GCIMS_DEFAULT_OUTLET_CODE: z.string().default('MAIN'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info')
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
}

export const config = Object.freeze(parsed.data);
