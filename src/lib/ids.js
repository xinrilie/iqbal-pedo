import { randomUUID, createHash } from 'node:crypto';

export function makeDocumentNumber(prefix) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function requestHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    // UUID check prevents a cursor from becoming arbitrary SQL input.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function encodeCursor(uuid) {
  return Buffer.from(uuid, 'utf8').toString('base64url');
}


export function encodeQueueCursor({ priority, queuedAt, id }) {
  return Buffer.from(JSON.stringify({
    priority: Number(priority),
    queued_at: new Date(queuedAt).toISOString(),
    id
  }), 'utf8').toString('base64url');
}

export function decodeQueueCursor(cursor) {
  if (!cursor || typeof cursor !== 'string' || cursor.length > 512) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 32767) return null;
    if (typeof value.queued_at !== 'string' || !Number.isFinite(Date.parse(value.queued_at))) return null;
    if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) return null;
    return { priority: value.priority, queuedAt: new Date(value.queued_at).toISOString(), id: value.id };
  } catch {
    return null;
  }
}
