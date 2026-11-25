import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeSecurity } from '../src/lib/security-config.js';

const base = {
  NODE_ENV: 'development',
  JWT_SECRET: '7c0c16cae7bf4e63a6692d17bd32b4c9',
  JWT_TTL: '15m',
  CORS_ORIGIN: 'http://localhost:3000'
};

test('runtime security accepts a local development configuration', () => {
  assert.doesNotThrow(() => validateRuntimeSecurity(base));
});

test('runtime security rejects example and low-diversity JWT secrets', () => {
  assert.throws(() => validateRuntimeSecurity({ ...base, JWT_SECRET: 'replace-with-at-least-32-random-characters' }), /nilai contoh/);
  assert.throws(() => validateRuntimeSecurity({ ...base, JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), /mudah ditebak/);
});

test('runtime security limits token lifetime to five minutes through one day', () => {
  assert.throws(() => validateRuntimeSecurity({ ...base, JWT_TTL: '4m' }), /5 menit sampai 24 jam/);
  assert.throws(() => validateRuntimeSecurity({ ...base, JWT_TTL: '2d' }), /5 menit sampai 24 jam/);
  assert.throws(() => validateRuntimeSecurity({ ...base, JWT_TTL: '15 minutes' }), /5 menit sampai 24 jam/);
});

test('runtime security rejects wildcard and malformed CORS origins', () => {
  assert.throws(() => validateRuntimeSecurity({ ...base, CORS_ORIGIN: '*' }), /wildcard/);
  assert.throws(() => validateRuntimeSecurity({ ...base, CORS_ORIGIN: 'http://localhost:3000/admin' }), /tanpa path/);
});

test('production requires HTTPS origins and disables test-only payment', () => {
  const production = { ...base, NODE_ENV: 'production', CORS_ORIGIN: 'https://pos.example.com' };
  assert.doesNotThrow(() => validateRuntimeSecurity(production));
  assert.throws(() => validateRuntimeSecurity({ ...production, CORS_ORIGIN: 'http://pos.example.com' }), /HTTPS non-lokal/);
  assert.throws(() => validateRuntimeSecurity(production, { testOnlyPaymentEnabled: true }), /tidak boleh aktif di produksi/);
});
