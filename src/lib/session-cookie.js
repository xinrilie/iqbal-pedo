import { timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'gcims_session';

export function readCookie(header, name = SESSION_COOKIE_NAME) {
  if (typeof header !== 'string') return null;
  const matches = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  try { return decodeURIComponent(value) || null; }
  catch { return null; }
}

export function extractAccessToken(request) {
  const authorization = request.headers.authorization;
  // Browser sessions are cookie-only. Reject Authorization headers so a JWT
  // exposed by an older sessionStorage build cannot keep working as a bearer.
  if (authorization !== undefined) return undefined;
  return readCookie(request.headers.cookie);
}

function maxAgeSeconds(ttl) {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error('JWT_TTL tidak valid untuk cookie sesi.');
  return Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 })[match[2]];
}

export function serializeSessionCookie(token, { ttl, secure = false }) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/v1; Max-Age=${maxAgeSeconds(ttl)}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie({ secure = false } = {}) {
  return `${SESSION_COOKIE_NAME}=; Path=/api/v1; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function csrfTokenMatches(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
