import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSessionCookie,
  csrfTokenMatches,
  extractAccessToken,
  readCookie,
  serializeSessionCookie
} from '../src/lib/session-cookie.js';

test('session cookie is HttpOnly, same-site strict, scoped and production-secure', () => {
  const cookie = serializeSessionCookie('header.payload.signature', { ttl: '15m', secure: true });
  assert.match(cookie, /; Path=\/api\/v1;/);
  assert.match(cookie, /; Max-Age=900;/);
  assert.match(cookie, /; HttpOnly;/);
  assert.match(cookie, /; SameSite=Strict;/);
  assert.match(cookie, /; Secure$/);
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/);
});

test('cookie parser rejects duplicates and malformed encoding', () => {
  assert.equal(readCookie('gcims_session=abc; theme=dark'), 'abc');
  assert.equal(readCookie('gcims_session=one; gcims_session=two'), null);
  assert.equal(readCookie('gcims_session=%E0%A4%A'), null);
});

test('legacy bearer tokens are not accepted and CSRF comparison rejects wrong tokens', () => {
  assert.equal(extractAccessToken({ headers: { authorization: 'Bearer old-token', cookie: 'gcims_session=new-token' } }), undefined);
  assert.equal(extractAccessToken({ headers: { cookie: 'gcims_session=new-token' } }), 'new-token');
  assert.equal(csrfTokenMatches('random-csrf-token', 'random-csrf-token'), true);
  assert.equal(csrfTokenMatches('random-csrf-token', 'wrong'), false);
  assert.equal(csrfTokenMatches(undefined, 'random-csrf-token'), false);
});
