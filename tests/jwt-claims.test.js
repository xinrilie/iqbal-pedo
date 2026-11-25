import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { accessTokenClaims } from '../src/lib/jwt-claims.js';

test('session revocation version is emitted as a JWT claim', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  await app.register(jwt, { secret: 'test-only-secret-that-is-not-used-outside-this-unit-test' });
  const input = accessTokenClaims({
    id: '123e4567-e89b-42d3-a456-426614174000',
    company_id: '123e4567-e89b-42d3-a456-426614174001',
    outlet_id: '123e4567-e89b-42d3-a456-426614174002',
    auth_token_version: 7
  }, 'csrf-test-token');

  const token = app.jwt.sign(input.payload, { ...input.options, expiresIn: '15m' });
  assert.equal(app.jwt.decode(token).token_version, 7);
  assert.equal(app.jwt.decode(token).sub, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(app.jwt.decode(token).csrf_token, 'csrf-test-token');
});
