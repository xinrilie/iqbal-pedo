import { config } from '../config.js';

const loginFailures = new Map();
const lastAlerts = new Map();
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_ALERT_THRESHOLD = 5;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_TRACKED_KEYS = 2048;

function trimState(now) {
  for (const [key, value] of loginFailures) {
    if (now - value.updatedAt > 60 * 60 * 1000) loginFailures.delete(key);
  }
  for (const [key, value] of lastAlerts) {
    if (now - value > 60 * 60 * 1000) lastAlerts.delete(key);
  }
  while (loginFailures.size > MAX_TRACKED_KEYS) loginFailures.delete(loginFailures.keys().next().value);
  while (lastAlerts.size > MAX_TRACKED_KEYS) lastAlerts.delete(lastAlerts.keys().next().value);
}

function shouldAlert(request, event, now) {
  const remoteAddress = request.ip || 'unknown';
  let key = event;

  if (event === 'auth.login.failed') {
    key = `${event}:${remoteAddress}`;
    let state = loginFailures.get(key);
    if (!state || now - state.windowStartedAt > FAILURE_WINDOW_MS) {
      state = { count: 0, windowStartedAt: now, updatedAt: now };
    }
    state.count += 1;
    state.updatedAt = now;
    loginFailures.set(key, state);
    if (state.count < FAILURE_ALERT_THRESHOLD) return false;
    event = 'auth.login.failure_burst';
  }

  if (event === 'http.rate_limited') key = `${event}:${remoteAddress}`;
  const lastSent = lastAlerts.get(key) ?? 0;
  if (now - lastSent < ALERT_COOLDOWN_MS) return false;
  lastAlerts.set(key, now);
  trimState(now);
  return true;
}

async function deliverAlert(request, event, details) {
  const endpoint = config.GCIMS_ALERT_WEBHOOK_URL;
  const message = `[GCIMS] ${event}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: message,
        content: message,
        service: 'gcims-backend',
        event,
        occurred_at: new Date().toISOString(),
        request_id: request.id,
        details
      }),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      request.log.warn({ security_event: 'alert.delivery_failed', alert_event: event, status_code: response.status }, 'Operational alert webhook rejected the event');
    }
    await response.body?.cancel();
  } catch (error) {
    request.log.warn({ security_event: 'alert.delivery_failed', alert_event: event, error_name: error.name }, 'Operational alert webhook could not be reached');
  }
}

export function alertSecurityEvent(request, event, details = {}) {
  if (!config.GCIMS_ALERT_WEBHOOK_URL) return;
  if (!shouldAlert(request, event, Date.now())) return;
  const safeDetails = { ...details };
  if (event.startsWith('auth.login')) {
    safeDetails.remote_address = request.ip;
    if (event === 'auth.login.failed') safeDetails.failure_threshold = FAILURE_ALERT_THRESHOLD;
  }
  if (event === 'http.rate_limited') safeDetails.remote_address = request.ip;
  void deliverAlert(request, event === 'auth.login.failed' ? 'auth.login.failure_burst' : event, safeDetails);
}
