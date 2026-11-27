// Ordered browser script; shared page state is initialized by earlier files.
const API = '/api/v1';
const SCOPE_KEY = 'gcims_pos_preferences';
try { sessionStorage.removeItem('gcims_pos_session'); } catch {}
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
let stockAlertReturnFocus = null;
let paymentReturnFocus = null;
let shiftReturnFocus = null;

const state = {
  authenticated: false,
  csrfToken: null,
  user: null,
  scope: null,
  permissions: [],
  stockLocations: [],
  stockLocationId: null,
  shift: null,
  shiftDrafts: [],
  shiftMode: 'open',
  menus: [],
  products: [],
  cart: [],
  category: 'all',
  search: '',
  orderType: 'takeaway',
  history: [],
  lastReceipt: null,
  currentOrder: null,
  orderKey: null,
  paymentKey: null,
  paymentRequest: null,
  draftDirty: false,
  busy: false
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function formatMoney(value) {
  return `Rp${money.format(Number(value) || 0)}`;
}

function makeKey() {
  return globalThis.crypto?.randomUUID?.() ?? `gcims-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 4200);
}

function showStockAlert(message) {
  const active = document.activeElement;
  stockAlertReturnFocus = active?.closest('.hidden') ? $('#search-input') : active;
  $('#stock-alert-message').textContent = message;
  $('#stock-alert-modal').classList.remove('hidden');
  $('#stock-alert-confirm').focus();
}

function closeStockAlert() {
  $('#stock-alert-modal').classList.add('hidden');
  if (stockAlertReturnFocus?.isConnected) stockAlertReturnFocus.focus({ preventScroll: true });
  stockAlertReturnFocus = null;
}

function closePaymentDialog() {
  $('#payment-modal').classList.add('hidden');
  if (paymentReturnFocus?.isConnected) paymentReturnFocus.focus({ preventScroll: true });
  paymentReturnFocus = null;
}

function closeShiftDialog() {
  if (!state.shift) return;
  hideShiftDialog();
}

function hideShiftDialog() {
  $('#shift-modal').classList.add('hidden');
  if (shiftReturnFocus?.isConnected) shiftReturnFocus.focus({ preventScroll: true });
  shiftReturnFocus = null;
}

async function request(path, { method = 'GET', body, headers = {}, auth = true, key } = {}) {
  const requestHeaders = { ...headers };
  if (auth && state.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) requestHeaders['x-csrf-token'] = state.csrfToken;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (key) requestHeaders['idempotency-key'] = key;
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Tidak dapat terhubung ke server. Pastikan backend aktif, lalu coba lagi.');
    throw error;
  }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `Request gagal (${response.status}).`);
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    error.requestId = data?.error?.request_id;
    if (response.status === 401 && state.authenticated) {
      error.sessionEnded = true;
      signOut('Sesi berakhir. Silakan masuk kembali.');
    }
    throw error;
  }
  return data;
}

function loadScope() {
  try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}'); }
  catch { return {}; }
}

function showLogin(message = '') {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('signed-out');
  $('#login-error').textContent = message;
  $('#login-error').classList.toggle('hidden', !message);
}

function hideLogin() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('signed-out');
}

function signOut(message = '') {
  state.authenticated = false;
  state.csrfToken = null;
  state.user = null;
  state.scope = null;
  state.permissions = [];
  state.stockLocations = [];
  state.stockLocationId = null;
  state.shift = null;
  state.shiftDrafts = [];
  state.menus = [];
  state.products = [];
  state.cart = [];
  state.currentOrder = null;
  state.orderKey = null;
  state.paymentKey = null;
  state.paymentRequest = null;
  state.draftDirty = false;
  state.lastReceipt = null;
  state.history = [];
  $('#payment-modal').classList.add('hidden');
  showLogin(message);
}

function updateHeader() {
  const fullName = state.user?.full_name ?? 'Kasir';
  $('#cashier-name').textContent = fullName;
  $('#cashier-avatar').textContent = [...fullName.trim()][0]?.toUpperCase() ?? 'K';
  $('#cashier-shift-state').textContent = state.shift ? 'Kasir · Shift aktif' : 'Kasir · Shift belum dibuka';
  $('#sidebar-outlet').textContent = state.stockLocations[0]?.outlet_name ?? (state.scope?.outlet_id ? `Outlet ${state.scope.outlet_id.slice(0, 8)}` : 'Outlet aktif');
  const location = state.stockLocations.find((item) => item.id === state.stockLocationId);
  $('#sidebar-location').textContent = location ? `${location.code} · ${location.name}` : 'Lokasi stok';
  $('#welcome-line').textContent = `Pesanan baru · ${new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}`;
  $('#shift-label').textContent = state.shift ? `Shift aktif · ${new Intl.DateTimeFormat('id-ID', { timeStyle: 'short' }).format(new Date(state.shift.opened_at))}` : 'Shift belum dibuka';
  $('#shift-action').classList.toggle('shift-closed', !state.shift);
  $('#admin-entry').classList.toggle('hidden', !state.permissions.includes('admin.dashboard.read'));
}

async function initializeApp() {
  const initialView = new URLSearchParams(location.search).get('view');
  $('#pos-layout').classList.remove('hidden');
  $('#history-view').classList.add('hidden');
  $('#success-view').classList.add('hidden');
  try {
    const identity = await request('/auth/me');
    state.csrfToken = identity.csrf_token;
    state.permissions = identity.permissions ?? [];
    state.user = identity.user ?? state.user;
    state.scope = identity.scope ?? state.scope;
    if (state.permissions.includes('admin.dashboard.read')) {
      location.replace('/admin');
      return;
    }
    hideLogin();
    updateHeader();
    const outletId = encodeURIComponent(state.scope.outlet_id);
    const locations = await request(`/outlets/${outletId}/stock-locations`);
    state.stockLocations = locations.data ?? [];
    const savedScope = loadScope();
    state.stockLocationId = state.stockLocations.some((entry) => entry.id === savedScope.stock_location_id)
      ? savedScope.stock_location_id
      : state.stockLocations[0]?.id ?? null;
    if (!state.stockLocationId) throw new Error('Outlet ini belum memiliki lokasi stok aktif. Minta admin menyiapkan lokasi stok terlebih dahulu.');
    await refreshShift();
    const catalog = await loadCatalog(outletId, state.stockLocationId);
    state.menus = catalog;
    state.products = catalog.flatMap((menu) => (menu.variants ?? []).map((variant) => ({ ...variant, menu })));
    renderLocationSelect();
    renderCategories();
    renderMenuGrid();
    renderCart();
    updateHeader();
    if (initialView === 'history') {
      const historyNav = document.querySelector('[data-nav="history"]');
      document.querySelectorAll('[data-nav]').forEach((entry) => entry.classList.toggle('active', entry === historyNav));
      await renderHistory();
    }
    if (!state.shift && initialView !== 'history') openShiftModal('open');
  } catch (error) {
    if (error.status === 401) {
      if (!error.sessionEnded) showLogin();
      return;
    }
    toast(error.message || 'Katalog tidak dapat dimuat.', 'error');
    $('#catalog-count').textContent = 'Tidak dapat memuat katalog';
    $('#menu-grid').innerHTML = `<div class="catalog-empty"><strong>Katalog belum tersedia</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

