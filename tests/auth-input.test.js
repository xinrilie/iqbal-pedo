import test from 'node:test';
import assert from 'node:assert/strict';
import { isBcryptPasswordLengthValid, toLoginCredentials } from '../src/lib/auth-input.js';

test('login API snake_case scope maps to auth service camelCase', () => {
  const apiPayload = {
    email: 'admin@gcims.local',
    password: 'not-a-real-password',
    company_id: '123e4567-e89b-42d3-a456-426614174000',
    outlet_id: '123e4567-e89b-42d3-a456-426614174001'
  };

  assert.deepEqual(toLoginCredentials(apiPayload), {
    email: 'admin@gcims.local',
    password: 'not-a-real-password',
    companyId: '123e4567-e89b-42d3-a456-426614174000',
    outletId: '123e4567-e89b-42d3-a456-426614174001'
  });
});

test('bcrypt password input is limited by UTF-8 bytes', () => {
  assert.equal(isBcryptPasswordLengthValid('a'.repeat(72)), true);
  assert.equal(isBcryptPasswordLengthValid('a'.repeat(73)), false);
  assert.equal(isBcryptPasswordLengthValid('☕'.repeat(25)), false);
});
