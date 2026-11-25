const API = '/api/v1';
const SCOPE_KEY = 'gcims_pos_preferences';
const SESSION_KEY = 'gcims_pos_session';
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
let stockAlertReturnFocus = null;
let paymentReturnFocus = null;
let shiftReturnFocus = null;

const state = {
  token: null,
  user: null,
  scope: null,
  permissions: [],
  stockLocations: [],
  stockLocationId: null,
  shift: null,
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
  if (auth && state.token) requestHeaders.authorization = `Bearer ${state.token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (key) requestHeaders['idempotency-key'] = key;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `Request gagal (${response.status}).`);
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details;
    error.requestId = data?.error?.request_id;
    if (response.status === 401 && state.token) signOut('Sesi berakhir. Silakan masuk kembali.');
    throw error;
  }
  return data;
}

function loadScope() {
  try { return JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}'); }
  catch { return {}; }
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, user: state.user, scope: state.scope }));
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
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
  state.token = null;
  state.user = null;
  state.scope = null;
  state.permissions = [];
  state.stockLocations = [];
  state.stockLocationId = null;
  state.shift = null;
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
  sessionStorage.removeItem(SESSION_KEY);
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
    if (error.status === 401) return;
    toast(error.message || 'Katalog tidak dapat dimuat.', 'error');
    $('#catalog-count').textContent = 'Tidak dapat memuat katalog';
    $('#menu-grid').innerHTML = `<div class="catalog-empty"><strong>Katalog belum tersedia</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function refreshShift() {
  const result = await request('/cashier/shift');
  state.shift = result.shift;
  updateHeader();
  renderCart();
  renderMenuGrid();
}

function openShiftModal(mode) {
  const closing = mode === 'close';
  const movement = mode === 'movement';
  state.shiftMode = mode;
  $('#shift-title').textContent = closing ? 'Tutup shift' : movement ? 'Catat pergerakan kas' : 'Mulai shift';
  $('#shift-copy').textContent = closing ? 'Masukkan hasil hitung uang tunai di laci.' : movement ? 'Catat uang yang disetor ke laci atau diambil dari laci.' : 'Hitung uang awal di laci sebelum mulai menerima pesanan.';
  $('#shift-amount-label').firstChild.textContent = closing ? 'Kas akhir terhitung' : movement ? 'Nominal kas' : 'Modal awal';
  $('#shift-amount').value = closing || movement ? '' : '0';
  $('#shift-amount').placeholder = closing || movement ? 'Masukkan nominal' : '0';
  $('#shift-note-label').classList.toggle('hidden', !closing && !movement);
  $('#shift-note-label').firstChild.textContent = movement ? 'Alasan' : 'Catatan penutupan';
  $('#shift-note').required = movement;
  $('#cash-event-type-label').classList.toggle('hidden', !movement);
  $('#shift-expected').classList.toggle('hidden', !closing);
  if (closing) $('#shift-expected').textContent = `Perkiraan kas di laci: ${formatMoney(state.shift?.expected_cash_amount ?? 0)}`;
  $('#shift-error').classList.add('hidden');
  $('#close-shift').classList.toggle('hidden', !state.shift);
  $('#save-shift').innerHTML = `<span>${closing ? 'Tutup shift' : movement ? 'Simpan kas' : 'Mulai shift'}</span><span>→</span>`;
  $('#shift-modal').classList.remove('hidden');
  shiftReturnFocus = document.activeElement;
  window.setTimeout(() => $('#shift-amount').focus(), 20);
}

async function saveShift(event) {
  event.preventDefault();
  const amount = Number($('#shift-amount').value);
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  const closing = state.shiftMode === 'close';
  $('#save-shift').disabled = true;
  $('#shift-error').classList.add('hidden');
  try {
    if (closing) {
      const result = await request(`/cashier/shifts/${encodeURIComponent(state.shift.id)}/close`, {
        method: 'POST', body: { closing_cash_amount: amount, closing_note: $('#shift-note').value.trim() || null }
      });
      state.shift = null;
      hideShiftDialog();
      toast(`Shift ditutup. Selisih kas: ${formatMoney(result.shift.variance_amount)}.`);
    } else if (state.shiftMode === 'movement') {
      const result = await request('/cashier/drawer-events', { method: 'POST', body: {
        event_type: $('#cash-event-type').value,
        amount,
        reason: $('#shift-note').value.trim()
      } });
      hideShiftDialog();
      toast(`${result.event.event_type === 'cash_in' ? 'Kas masuk' : 'Kas keluar'} berhasil dicatat.`);
      await refreshShift();
    } else {
      const result = await request('/cashier/shifts', { method: 'POST', body: { opening_cash_amount: amount } });
      state.shift = result.shift;
      hideShiftDialog();
      await refreshShift();
      toast('Shift kasir berhasil dimulai.');
    }
    updateHeader();
    renderCart();
    renderMenuGrid();
  } catch (error) {
    $('#shift-error').textContent = error.message;
    $('#shift-error').classList.remove('hidden');
  } finally {
    $('#save-shift').disabled = false;
  }
}

async function loadCatalog(outletId, stockLocationId = null) {
  const all = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    if (stockLocationId) query.set('stockLocationId', stockLocationId);
    const result = await request(`/outlets/${outletId}/catalog?${query}`);
    all.push(...(result.data ?? []));
    cursor = result.page?.next_cursor ?? null;
  } while (cursor);
  return all;
}

function renderLocationSelect() {
  const select = $('#stock-location-select');
  select.innerHTML = state.stockLocations.map((location) =>
    `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)} · ${escapeHtml(location.code)}</option>`
  ).join('');
  select.value = state.stockLocationId;
  select.disabled = Boolean(state.currentOrder);
}

function getCategories() {
  const names = state.menus.map((menu) => menu.category?.name).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'id'));
}

function renderCategories() {
  const categories = getCategories();
  const options = [{ id: 'all', name: 'Semua produk' }, ...categories.map((name) => ({ id: name, name }))];
  if (!options.some((option) => option.id === state.category)) state.category = 'all';
  $('#category-row').innerHTML = options.map((option) =>
    `<button type="button" class="category-chip ${state.category === option.id ? 'selected' : ''}" data-category="${escapeHtml(option.id)}" aria-pressed="${state.category === option.id}">${escapeHtml(option.name)}</button>`
  ).join('');
}

function visibleProducts() {
  const term = state.search.trim().toLocaleLowerCase('id');
  return state.products.filter((product) => {
    const category = product.menu.category?.name ?? 'Lainnya';
    if (state.category !== 'all' && category !== state.category) return false;
    if (!term) return true;
    return [product.menu.menu_name, product.menu.code, product.code, product.name, product.menu.category?.name]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase('id').includes(term));
  });
}

function artClass(id) {
  let score = 0;
  for (const char of String(id)) score = (score * 31 + char.charCodeAt(0)) >>> 0;
  return `art-${(score % 6) + 1}`;
}

function imageMarkup(product) {
  if(product.product_type==='retail')return '<span class="retail-art-icon" aria-hidden="true">▤</span>';
  const imageUrl = product.menu.image_url;
  if (imageUrl) {
    try {
      const resolved = new URL(imageUrl, window.location.origin);
      if (resolved.origin === window.location.origin) return `<img class="product-photo" src="${escapeHtml(resolved.pathname + resolved.search)}" alt="" loading="lazy">`;
    } catch { /* Use the local design artwork when the stored image URL is invalid. */ }
  }
  const name = String(product.menu.menu_name ?? '').toLocaleLowerCase('id');
  const file = name.includes('macchiato') ? 'caramel-macchiato'
    : name.includes('latte') ? 'latte'
      : name.includes('americano') ? 'americano'
        : name.includes('cappuccino') ? 'cappuccino'
          : name.includes('flat white') ? 'flat-white'
            : name.includes('susu') || name.includes('aren') ? 'kopi-susu'
              : ['caramel-macchiato','latte','americano','cappuccino','flat-white','kopi-susu'][artClass(product.menu.menu_id).slice(-1) - 1];
  return `<img class="product-photo" src="/pos-assets/${file}.jpg" alt="" loading="lazy">`;
}

function renderMenuGrid() {
  const products = visibleProducts();
  $('#catalog-count').textContent = `${products.length} produk tersedia`;
  if (!products.length) {
    $('#menu-grid').innerHTML = '<div class="catalog-empty"><strong>Menu tidak ditemukan</strong><span>Coba kata pencarian atau kategori lain.</span></div>';
    return;
  }
  $('#menu-grid').innerHTML = products.map((product) => {
    const inCart = state.cart.find((line) => line.variantId === product.menu_variant_id)?.quantity ?? 0;
    const stockLimit = product.available_quantity == null ? null : Number(product.available_quantity);
    const stockAllowsAdd = stockLimit === null || inCart < stockLimit;
    const available = Boolean(product.is_sellable && product.is_available && stockAllowsAdd);
    const unavailableReason = !product.is_available ? 'Produk tidak tersedia'
      : product.sellability_reason === 'recipe_required' ? 'Resep belum tersedia'
        : product.sellability_reason === 'active_recipe_required' ? 'Resep belum aktif'
          : product.sellability_reason === 'retail_item_required' ? 'SKU inventori belum aktif'
          : stockLimit === 0 ? 'Stok bahan habis'
            : !stockAllowsAdd ? `Batas stok · ${stockLimit} ${product.product_type==='retail'?'unit':'porsi'}` : 'Tidak tersedia';
    const variantLabel = product.menu.variants.length > 1 ? product.name : (product.menu.category?.name ?? 'Produk');
    return `<article class="menu-card ${product.product_type==='retail'?'retail-product':''} ${available ? '' : 'unavailable'} ${inCart ? 'in-cart' : ''}" aria-label="${escapeHtml(product.menu.menu_name)}${inCart ? `, ${inCart} di pesanan` : ''}">
      <div class="product-art ${artClass(product.menu.menu_id)}"><span class="art-glow"></span><span class="art-cup"><span class="art-drink"></span></span><span class="art-saucer"></span>${imageMarkup(product)}${inCart ? `<span class="in-cart-count" aria-label="${inCart} di pesanan">${inCart} di pesanan</span>` : ''}</div>
      <div class="menu-card-content"><div class="menu-card-title" title="${escapeHtml(product.menu.menu_name)}">${escapeHtml(product.menu.menu_name)}<span class="product-type-tag">${product.product_type==='retail'?'Retail':'Kafe'}</span></div>
        <div class="menu-card-subtitle">${escapeHtml(variantLabel)}${available ? '' : ` · ${escapeHtml(unavailableReason)}`}</div>
        <div class="menu-card-bottom"><strong class="menu-price">${formatMoney(product.price_amount)}</strong>${product.is_test_price ? '<span class="test-price-pill">Harga uji</span>' : ''}${available
          ? `<button class="add-button" type="button" data-add-variant="${escapeHtml(product.menu_variant_id)}" aria-label="Tambah ${escapeHtml(product.menu.menu_name)} ke pesanan" ${state.busy || state.paymentRequest || !state.shift ? 'disabled' : ''}>+</button>`
          : stockLimit === 0 || !stockAllowsAdd
            ? `<button class="unavailable-tag stock-alert-button" type="button" data-stock-alert="${escapeHtml(product.menu.menu_variant_id)}" data-stock-limit="${stockLimit ?? 0}" data-product-name="${escapeHtml(product.menu.menu_name)}">${stockLimit === 0 ? 'Stok habis' : 'Batas stok'}</button>`
            : `<span class="unavailable-tag">${escapeHtml(unavailableReason === 'Stok bahan habis' ? 'Stok habis' : 'Tidak tersedia')}</span>`}</div>
      </div></article>`;
  }).join('');
}

function addProduct(variantId) {
  if (state.busy || state.paymentRequest) return;
  const product = state.products.find((entry) => entry.menu_variant_id === variantId);
  if (!product) return;
  if (!product.is_sellable || !product.is_available) {
    if (product.available_quantity != null && Number(product.available_quantity) === 0) showStockAlert(`Stok ${product.menu.menu_name} sedang habis. Tidak bisa ditambahkan ke pesanan.`);
    return;
  }
  const line = state.cart.find((entry) => entry.variantId === variantId);
  if (product.available_quantity != null && (line?.quantity ?? 0) >= Number(product.available_quantity)) {
    showStockAlert(`Stok ${product.menu.menu_name} hanya cukup untuk ${product.available_quantity} ${product.product_type==='retail'?'unit':'porsi'}. Kurangi jumlah pesanan atau pilih produk lain.`);
    return;
  }
  if (line) line.quantity += 1;
  else state.cart.push({
    variantId,
    menuName: product.menu.menu_name,
    variantName: product.name,
    sku: product.code,
    price: Number(product.price_amount),
    quantity: 1,
    note: ''
  });
  state.draftDirty = Boolean(state.currentOrder);
  renderCart();
  renderMenuGrid();
}

function cartSubtotal() {
  return state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

function setCartOpen(open) {
  const panel = $('#cart-panel');
  const shouldOpen = Boolean(open && state.cart.length);
  panel.classList.toggle('open', shouldOpen);
  panel.setAttribute('aria-hidden', String(!shouldOpen));
  $('#cart-backdrop').classList.toggle('hidden', !shouldOpen);
  document.body.classList.toggle('cart-open', shouldOpen);
  if (shouldOpen) $('#close-cart').focus();
  else if (!$('#cart-launcher').classList.contains('hidden')) $('#cart-launcher').focus({ preventScroll: true });
  else $('#search-input').focus({ preventScroll: true });
}

function renderCart() {
  const lines = $('#cart-lines');
  const subtotal = cartSubtotal();
  const itemCount = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = state.currentOrder?.grand_total_amount ?? subtotal;
  $('#floating-cart-count').textContent = `${itemCount} item`;
  $('#floating-cart-total').textContent = formatMoney(total);
  $('#cart-launcher').classList.toggle('hidden', itemCount === 0);
  $('#cart-launcher').setAttribute('aria-label', `Buka keranjang, ${itemCount} item, ${formatMoney(total)}`);
  if (itemCount === 0 && $('#cart-panel').classList.contains('open')) setCartOpen(false);
  $('#order-reference').textContent = state.currentOrder
    ? `${state.currentOrder.order_number} · Draft`
    : 'Keranjang baru';
  $('#subtotal-value').textContent = formatMoney(subtotal);
  $('#tax-value').textContent = state.currentOrder ? formatMoney(state.currentOrder.tax_amount) : 'Dihitung saat lanjut';
  $('#total-value').textContent = state.currentOrder ? formatMoney(state.currentOrder.grand_total_amount) : formatMoney(subtotal);
  $('#checkout-label').textContent = state.paymentRequest ? 'Ulangi pembayaran' : state.currentOrder ? 'Lanjutkan bayar' : `Lanjut bayar · ${itemCount} item`;
  $('#checkout-button').disabled = !state.cart.length || state.busy || !state.shift;
  $('#clear-cart').disabled = !state.cart.length || state.busy;
  $('#stock-location-select').disabled = Boolean(state.currentOrder) || state.busy;
  const retailOnly=state.cart.length>0&&state.cart.every((line)=>state.products.find((product)=>product.menu_variant_id===line.variantId)?.product_type==='retail');
  const dineInButton=document.querySelector('[data-order-type="dine_in"]');
  dineInButton?.classList.toggle('hidden',retailOnly);
  if(retailOnly&&state.orderType==='dine_in')state.orderType='takeaway';
  $('#table-field').classList.toggle('visible', state.orderType === 'dine_in');
  $('#table-label').value = state.tableLabel ?? $('#table-label').value;
  $('#table-label').disabled = Boolean(state.currentOrder) || state.busy;
  $('#customer-note').disabled = state.busy || Boolean(state.paymentRequest);
  document.querySelectorAll('[data-order-type]').forEach((button) => { button.disabled = Boolean(state.currentOrder) || state.busy; });
  document.querySelectorAll('[data-order-type]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.orderType === state.orderType);
  });
  if (!state.cart.length) {
    lines.innerHTML = '<div class="empty-cart"><span class="empty-cart-icon">＋</span><strong>Keranjang masih kosong</strong><span>Pilih menu untuk mulai membuat pesanan.</span></div>';
    return;
  }
  lines.innerHTML = state.cart.map((line) => {
    const product = state.products.find((item) => item.menu_variant_id === line.variantId);
    const stockLimit = product?.available_quantity == null ? null : Number(product.available_quantity);
    const atStockLimit = stockLimit !== null && line.quantity >= stockLimit;
    return `<div class="cart-line" data-cart-line="${escapeHtml(line.variantId)}">
    <div class="cart-line-top"><span class="cart-line-name">${escapeHtml(line.menuName)}</span><strong class="cart-line-price">${formatMoney(line.price * line.quantity)}</strong></div>
    <div class="cart-line-meta">${escapeHtml(line.sku)} | ${escapeHtml(line.variantName)}${atStockLimit ? ` · Stok maksimum ${stockLimit} ${product?.product_type==='retail'?'unit':'porsi'}` : ''}</div>
    <div class="cart-line-controls"><div class="quantity-control"><button type="button" data-quantity="-1" data-variant="${escapeHtml(line.variantId)}" aria-label="Kurangi jumlah" ${state.busy || state.paymentRequest ? 'disabled' : ''}>−</button><span>${line.quantity}</span><button type="button" data-quantity="1" data-variant="${escapeHtml(line.variantId)}" aria-label="Tambah jumlah" title="${atStockLimit ? 'Stok sudah mencapai batas' : 'Tambah jumlah'}" ${state.busy || state.paymentRequest ? 'disabled' : ''}>+</button></div>
      <input class="line-note" maxlength="500" value="${escapeHtml(line.note)}" data-line-note="${escapeHtml(line.variantId)}" placeholder="Catatan item" ${state.busy || state.paymentRequest ? 'disabled' : ''}>
      <button class="remove-line" type="button" data-remove-line="${escapeHtml(line.variantId)}" ${state.busy || state.paymentRequest ? 'disabled' : ''}>Hapus</button></div>
  </div>`;
  }).join('');
}

function serializeCart() {
  return state.cart.map((line) => ({
    menu_variant_id: line.variantId,
    quantity: `${line.quantity}.000`,
    item_note: line.note.trim() || null
  }));
}

function orderBody() {
  const body = {
    order_type: state.orderType,
    stock_location_id: state.stockLocationId,
    customer_note: $('#customer-note').value.trim() || null,
    lines: serializeCart()
  };
  if (state.orderType === 'dine_in') body.table_label = $('#table-label').value.trim() || null;
  return body;
}

async function ensureDraftOrder() {
  if (!state.cart.length) throw new Error('Tambahkan menu ke keranjang terlebih dahulu.');
  const outletId = encodeURIComponent(state.scope.outlet_id);
  if (!state.currentOrder) {
    state.orderKey ??= makeKey();
    const order = await request(`/outlets/${outletId}/orders`, {
      method: 'POST', body: orderBody(), key: state.orderKey
    });
    state.currentOrder = order;
    state.draftDirty = false;
    state.orderKey = null;
    state.paymentKey = makeKey();
  } else if (state.draftDirty) {
    const updated = await request(`/orders/${encodeURIComponent(state.currentOrder.id)}/items`, {
      method: 'PUT',
      headers: { 'if-match': String(state.currentOrder.version_no) },
      body: { lines: serializeCart(), customer_note: $('#customer-note').value.trim() || null }
    });
    state.currentOrder = updated;
    state.draftDirty = false;
  }
  renderCart();
  return state.currentOrder;
}

async function beginCheckout() {
  if (!state.shift) {
    openShiftModal('open');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  renderCart();
  renderMenuGrid();
  try {
    const order = await ensureDraftOrder();
    openPaymentDialog(order);
  } catch (error) {
    if (error.status === 409) toast(`${error.message} Muat ulang pesanan bila ada perubahan dari perangkat lain.`, 'error');
    else if (error.code === 'INSUFFICIENT_STOCK') showStockAlert(error.message);
    else toast(error.message || 'Pesanan belum dapat disimpan.', 'error');
  } finally {
    state.busy = false;
    renderCart();
    renderMenuGrid();
    if (!$('#payment-modal').classList.contains('hidden')) updateChange();
  }
}

function openPaymentDialog(order) {
  $('#payment-order-number').textContent = order.order_number;
  $('#amount-due-value').textContent = formatMoney(order.grand_total_amount);
  $('#cash-received').value = state.paymentRequest?.cash_received_amount ?? order.grand_total_amount;
  $('#cash-received').disabled = Boolean(state.paymentRequest);
  $('#payment-error').classList.add('hidden');
  $('#confirm-payment').disabled = false;
  $('#confirm-payment').innerHTML = '<span>Konfirmasi tunai</span><span>→</span>';
  renderQuickCash(order.grand_total_amount);
  updateChange();
  paymentReturnFocus = document.activeElement;
  $('#payment-modal').classList.remove('hidden');
  window.setTimeout(() => $('#cash-received').focus(), 20);
}

function renderQuickCash(amount) {
  const step = 5000;
  const rounded = Math.ceil(amount / step) * step;
  const amounts = [...new Set([amount, rounded, rounded + step, rounded + step * 2])];
  $('#quick-cash').innerHTML = amounts.map((value) =>
    `<button type="button" data-cash-amount="${value}" ${state.paymentRequest ? 'disabled' : ''}>${formatMoney(value)}</button>`
  ).join('');
}

function updateChange() {
  const received = Number.parseInt($('#cash-received').value, 10) || 0;
  const due = Number(state.currentOrder?.grand_total_amount ?? 0);
  $('#change-value').textContent = formatMoney(Math.max(0, received - due));
  $('#confirm-payment').disabled = state.busy || received < due || !due;
}

async function confirmCashPayment() {
  if (state.busy || !state.currentOrder) return;
  const received = Number.parseInt($('#cash-received').value, 10);
  const amount = Number(state.currentOrder.grand_total_amount);
  if (!Number.isSafeInteger(received) || received < amount) {
    $('#payment-error').textContent = 'Uang diterima harus sama dengan atau lebih besar dari total tagihan.';
    $('#payment-error').classList.remove('hidden');
    return;
  }
  state.busy = true;
  state.paymentRequest ??= { amount, cash_received_amount: received };
  $('#cash-received').disabled = true;
  $('#confirm-payment').disabled = true;
  $('#payment-error').classList.add('hidden');
  $('#confirm-payment').innerHTML = '<span>Memproses transaksi…</span><span>· · ·</span>';
  renderCart();
  renderMenuGrid();
  try {
    const payment = await request(`/orders/${encodeURIComponent(state.currentOrder.id)}/payments`, {
      method: 'POST',
      key: state.paymentKey,
      body: { method: 'cash', ...state.paymentRequest }
    });
    let receipt = null;
    try { receipt = await request(`/orders/${encodeURIComponent(state.currentOrder.id)}/receipt`); }
    catch (error) { toast(`Pembayaran berhasil, tetapi struk tidak dapat dimuat: ${error.message}`, 'error'); }
    showSuccess({ payment, receipt, order: state.currentOrder, received });
  } catch (error) {
    $('#payment-error').textContent = error.message || 'Pembayaran belum berhasil. Coba lagi dengan transaksi yang sama.';
    $('#payment-error').classList.remove('hidden');
    $('#confirm-payment').innerHTML = '<span>Coba lagi</span><span>→</span>';
    if (error.code === 'INSUFFICIENT_STOCK') {
      state.paymentRequest = null;
      state.paymentKey = makeKey();
      $('#payment-modal').classList.add('hidden');
      showStockAlert(error.message);
      try {
        const catalog = await loadCatalog(encodeURIComponent(state.scope.outlet_id), state.stockLocationId);
        state.menus = catalog;
        state.products = catalog.flatMap((menu) => (menu.variants ?? []).map((variant) => ({ ...variant, menu })));
        renderMenuGrid();
      } catch { /* Keep the original stock error visible if the refresh also fails. */ }
    }
  } finally {
    state.busy = false;
    renderCart();
    renderMenuGrid();
    updateChange();
  }
}

function statusLabel(status) {
  return ({ queued: 'Siap dibuat', in_preparation: 'Sedang dibuat', ready: 'Siap diserahkan', served: 'Diserahkan', confirmed: 'Dikonfirmasi' })[status] ?? 'Siap dibuat';
}

function showSuccess({ payment, receipt, order, received }) {
  state.lastReceipt = { payment, receipt, order, received };
  setCartOpen(false);
  $('#cart-launcher').classList.add('hidden');
  $('#payment-modal').classList.add('hidden');
  $('#pos-layout').classList.add('hidden');
  $('#history-view').classList.add('hidden');
  $('#success-view').classList.remove('hidden');
  renderSuccess(state.lastReceipt);
  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === 'pos'));
}

function renderSuccess(data) {
  const order = data.receipt?.order ?? data.order;
  const payment = data.receipt?.payments?.[0] ?? data.payment;
  const lines = order.lines ?? [];
  const productionLines = lines.filter((line) => line.product_type !== 'retail');
  const paidAt = payment.confirmed_at ? new Date(payment.confirmed_at) : new Date();
  const dateText = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(paidAt);
  const change = Math.max(0, data.received - Number(order.grand_total_amount));
  const receiptCard = data.receipt ? `<aside class="receipt-card" id="printable-receipt"><div class="receipt-logo"><img src="/pos-assets/gourmets-logo.png" alt=""></div><h2>GOURMET'S COFFEE CO.</h2><p>Café & Mart</p><p>${escapeHtml(state.stockLocations[0]?.outlet_name ?? '')}</p><div class="receipt-divider"></div>
      <div class="receipt-meta"><span>Transaksi</span><strong>${escapeHtml(payment.payment_number ?? '—')}</strong></div><div class="receipt-meta"><span>Pesanan</span><strong>${escapeHtml(order.order_number)}</strong></div><div class="receipt-meta"><span>Tanggal</span><strong>${escapeHtml(dateText)}</strong></div><div class="receipt-meta"><span>Kasir</span><strong>${escapeHtml(state.user?.full_name ?? 'Kasir')}</strong></div>
      <div class="receipt-divider"></div>${lines.map((line) => `<div class="receipt-item"><span>${escapeHtml(line.quantity)} × ${escapeHtml(line.menu_name)}<br>${escapeHtml(line.variant_name)}</span><strong>${formatMoney(line.total_amount)}</strong></div>`).join('')}
      <div class="receipt-divider"></div><div class="receipt-meta"><span>Subtotal</span><strong>${formatMoney(order.gross_subtotal_amount)}</strong></div><div class="receipt-meta"><span>Pajak</span><strong>${formatMoney(order.tax_amount)}</strong></div><div class="receipt-total"><span>Total</span><strong>${formatMoney(order.grand_total_amount)}</strong></div><div class="receipt-meta"><span>Tunai</span><strong>${formatMoney(data.received)}</strong></div><div class="receipt-meta"><span>Kembalian</span><strong>${formatMoney(change)}</strong></div><span class="receipt-status">LUNAS</span><p class="receipt-thanks">Good coffee. Better days.</p><p>Simpan struk ini sebagai bukti transaksi.</p>
      <div class="receipt-actions"><button class="outline-button" id="print-receipt" type="button">▣ Cetak struk</button></div></aside>`
    : `<aside class="receipt-card"><div class="receipt-logo">✓</div><h2>Pembayaran tersimpan</h2><p>Transaksi ${escapeHtml(payment.payment_number ?? '')}</p><div class="receipt-divider"></div><p>Hak akses untuk melihat struk belum tersedia pada akun ini. Minta admin menambahkan permission pos.receipt.read.</p></aside>`;
  $('#success-view').innerHTML = `<div class="success-heading"><div><p class="eyebrow">TRANSAKSI SELESAI</p><h1>Pembayaran berhasil</h1><p class="subheading">${escapeHtml(dateText)} · ${productionLines.length?'Produk kafe diteruskan ke barista.':'Transaksi retail selesai.'}</p></div><button class="outline-button" id="new-order-button" type="button"><span>＋</span>Pesanan baru</button></div>
    <div class="success-columns"><div class="success-main">
        <section class="success-card"><div class="paid-summary"><span class="check-circle">✓</span><div><span class="paid-label">LUNAS · TUNAI UJI</span><h2>Tagihan ${formatMoney(payment.amount)} lunas</h2><p>${productionLines.length?'Item kafe siap diracik; barang retail bisa langsung diserahkan.':'Barang siap diserahkan kepada pelanggan.'}</p></div></div>
        <div class="transaction-details"><div><span>No. transaksi</span><strong>${escapeHtml(payment.payment_number ?? '—')}</strong></div><div><span>Pesanan</span><strong>${escapeHtml(order.order_number)}</strong></div><div><span>Kasir</span><strong>${escapeHtml(state.user?.full_name ?? 'Kasir')}</strong></div><div><span>Waktu bayar</span><strong>${escapeHtml(dateText)}</strong></div><div><span>Metode</span><strong>Tunai</strong></div><div><span>Kembalian</span><strong>${formatMoney(change)}</strong></div></div></section>
      <section class="stock-confirmation"><span>♧</span><div><strong>Stok transaksi sudah diperbarui.</strong><p>Konsumsi bahan dan barang retail tercatat otomatis di stock ledger.</p></div></section>
      ${productionLines.length?`<section class="success-card kds-card"><h2>Pesanan untuk barista</h2><p>${order.order_type === 'dine_in' ? 'Dine-in' : 'Bawa pulang'}${order.table_label ? ` · Meja ${escapeHtml(order.table_label)}` : ''} | ${productionLines.length} item kafe</p>${productionLines.map((line) => `<div class="success-line"><div><strong>${escapeHtml(line.menu_name)} · ${escapeHtml(line.variant_name)}</strong><span>${escapeHtml(line.quantity)} × ${formatMoney(line.unit_price_amount)}${line.item_note ? ` · ${escapeHtml(line.item_note)}` : ''}</span></div><span class="status-pill">${escapeHtml(statusLabel(order.production_status))}</span></div>`).join('')}</section>`:''}
    </div>${receiptCard}</div>`;
  $('#new-order-button').addEventListener('click', startNewOrder);
  $('#print-receipt')?.addEventListener('click', () => window.print());
}

async function startNewOrder() {
  state.busy = true;
  state.cart = [];
  state.currentOrder = null;
  state.orderKey = null;
  state.paymentKey = null;
  state.paymentRequest = null;
  state.draftDirty = false;
  state.lastReceipt = null;
  $('#customer-note').value = '';
  $('#table-label').value = '';
  state.tableLabel = '';
  $('#success-view').classList.add('hidden');
  $('#pos-layout').classList.remove('hidden');
  renderLocationSelect();
  renderCart();
  renderMenuGrid();
  try {
    const catalog = await loadCatalog(encodeURIComponent(state.scope.outlet_id), state.stockLocationId);
    state.menus = catalog;
    state.products = catalog.flatMap((menu) => (menu.variants ?? []).map((variant) => ({ ...variant, menu })));
  } catch (error) {
    toast(`Ketersediaan stok belum diperbarui: ${error.message}`, 'error');
  } finally {
    state.busy = false;
    renderCart();
    renderMenuGrid();
  }
}

async function renderHistory() {
  $('#pos-layout').classList.add('hidden');
  $('#success-view').classList.add('hidden');
  $('#history-view').classList.remove('hidden');
  const container = $('#history-list');
  container.innerHTML = '<div class="history-empty">Memuat riwayat transaksi…</div>';
  try {
    const result = await request('/cashier/transactions?limit=100');
    state.history = result.data ?? [];
    if (!state.history.length) {
      container.innerHTML = '<div class="history-empty">Belum ada transaksi lunas untuk akun ini.</div>';
      return;
    }
    container.innerHTML = state.history.map((entry) => `<article class="history-card"><div><strong>${escapeHtml(entry.order_number)}</strong><span>${escapeHtml(new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.confirmed_at)))}</span></div><strong class="history-amount">${formatMoney(entry.grand_total_amount)}</strong><span class="status-pill">Lunas · ${escapeHtml(entry.method)}</span></article>`).join('');
  } catch (error) {
    container.innerHTML = `<div class="history-empty">Riwayat gagal dimuat: ${escapeHtml(error.message)}</div>`;
  }
}

function changeQuantity(variantId, delta) {
  if (state.busy || state.paymentRequest) return;
  const line = state.cart.find((entry) => entry.variantId === variantId);
  if (!line) return;
  const product = state.products.find((entry) => entry.menu_variant_id === variantId);
  if (delta > 0 && product?.available_quantity != null && line.quantity >= Number(product.available_quantity)) {
    showStockAlert(`Stok hanya cukup untuk ${product.available_quantity} porsi. Kurangi jumlah pesanan atau pilih menu lain.`);
    return;
  }
  line.quantity += delta;
  if (line.quantity <= 0) {
    if (state.currentOrder && state.cart.length === 1) {
      line.quantity = 1;
      toast('Draft harus memiliki minimal satu item.');
      return;
    }
    state.cart = state.cart.filter((entry) => entry.variantId !== variantId);
  }
  state.draftDirty = Boolean(state.currentOrder);
  renderCart();
  renderMenuGrid();
}

function removeLine(variantId) {
  if (state.busy || state.paymentRequest) return;
  if (state.currentOrder && state.cart.length === 1) {
    toast('Draft harus memiliki minimal satu item. Tambahkan item lain sebelum menghapus yang terakhir.');
    return;
  }
  state.cart = state.cart.filter((entry) => entry.variantId !== variantId);
  state.draftDirty = Boolean(state.currentOrder);
  renderCart();
  renderMenuGrid();
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.innerHTML = '<span>Memeriksa akun…</span><span>· · ·</span>';
  try {
    const result = await request('/auth/login', {
      method: 'POST', auth: false,
      body: { username, password: String(form.get('password')) }
    });
    state.token = result.access_token;
    state.user = result.user;
    state.scope = result.scope;
    saveSession();
    state.cart = [];
    state.currentOrder = null;
    state.history = [];
    await initializeApp();
  } catch (error) {
    showLogin(error.message || 'Username atau password tidak valid.');
  } finally {
    submit.disabled = false;
    submit.innerHTML = '<span>Masuk</span><span>→</span>';
  }
}

function initialize() {
  $('#today-label').textContent = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  $('#login-form').addEventListener('submit', handleLogin);
  $('#logout-button').addEventListener('click', () => { signOut(); location.href = '/'; });
  $('#shift-action').addEventListener('click', () => state.token && openShiftModal(state.shift ? 'close' : 'open'));
  $('#cash-movement-button').addEventListener('click', () => {
    if (!state.shift) return openShiftModal('open');
    openShiftModal('movement');
  });
  $('#shift-form').addEventListener('submit', saveShift);
  $('#close-shift').addEventListener('click', closeShiftDialog);
  $('#shift-modal').addEventListener('click', (event) => { if (event.target === $('#shift-modal')) closeShiftDialog(); });
  $('#drawer-button').addEventListener('click', async () => {
    if (!state.shift) return openShiftModal('open');
    try {
      await request('/cashier/drawer-events', { method: 'POST', body: { event_type: 'no_sale_open', amount: 0, reason: 'Buka laci tanpa transaksi' } });
      toast('Aktivitas buka laci tercatat. Laci fisik masih dibuka manual.');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#search-input').addEventListener('input', (event) => { state.search = event.target.value; renderMenuGrid(); });
  $('#search-input').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.currentTarget.value = ''; state.search = ''; renderMenuGrid(); }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-input').focus(); }
    if (event.key === 'Escape' && $('#cart-panel').classList.contains('open')) setCartOpen(false);
    if (event.key === 'Escape' && !$('#stock-alert-modal').classList.contains('hidden')) closeStockAlert();
    if (event.key === 'Escape' && !state.busy && !$('#payment-modal').classList.contains('hidden')) closePaymentDialog();
    if (event.key === 'Escape' && !$('#shift-modal').classList.contains('hidden')) closeShiftDialog();
    if (event.key === 'Tab') {
      const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].find((candidate) => !candidate.classList.contains('hidden') && getComputedStyle(candidate).visibility !== 'hidden');
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((control) => control.getClientRects().length);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  $('#category-row').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    renderCategories();
    renderMenuGrid();
  });
  $('#menu-grid').addEventListener('click', (event) => {
    const stockButton = event.target.closest('[data-stock-alert]');
    if (stockButton) {
      const quantity = Number(stockButton.dataset.stockLimit);
      showStockAlert(quantity > 0
        ? `Stok ${stockButton.dataset.productName} hanya cukup untuk ${quantity} porsi dan sudah mencapai batas.`
        : `Stok ${stockButton.dataset.productName} sedang habis. Tidak bisa ditambahkan ke pesanan.`);
      return;
    }
    const button = event.target.closest('[data-add-variant]');
    if (button) addProduct(button.dataset.addVariant);
  });
  $('#cart-lines').addEventListener('click', (event) => {
    const quantityButton = event.target.closest('[data-quantity]');
    if (quantityButton) return changeQuantity(quantityButton.dataset.variant, Number(quantityButton.dataset.quantity));
    const removeButton = event.target.closest('[data-remove-line]');
    if (removeButton) removeLine(removeButton.dataset.removeLine);
  });
  $('#cart-lines').addEventListener('input', (event) => {
    const input = event.target.closest('[data-line-note]');
    if (!input || state.paymentRequest || state.busy) return;
    const line = state.cart.find((entry) => entry.variantId === input.dataset.lineNote);
    if (line) { line.note = input.value; state.draftDirty = Boolean(state.currentOrder); }
  });
  $('#clear-cart').addEventListener('click', () => {
    if (state.currentOrder) { toast('Draft sudah tersimpan. Ubah item lalu lanjutkan, atau selesaikan transaksi ini.'); return; }
    state.cart = [];
    renderCart();
  });
  document.querySelectorAll('[data-order-type]').forEach((button) => button.addEventListener('click', () => {
    state.orderType = button.dataset.orderType;
    state.draftDirty = Boolean(state.currentOrder);
    renderCart();
  }));
  $('#table-label').addEventListener('input', (event) => { state.tableLabel = event.target.value; state.draftDirty = Boolean(state.currentOrder); });
  $('#customer-note').addEventListener('input', () => { state.draftDirty = Boolean(state.currentOrder); });
  $('#stock-location-select').addEventListener('change', (event) => {
    const previousLocationId = state.stockLocationId;
    const nextLocationId = event.target.value;
    const preferences = loadScope();
    state.stockLocationId = nextLocationId;
    state.busy = true;
    renderCart();
    renderMenuGrid();
    loadCatalog(encodeURIComponent(state.scope.outlet_id), nextLocationId).then((catalog) => {
      state.menus = catalog;
      state.products = catalog.flatMap((menu) => (menu.variants ?? []).map((variant) => ({ ...variant, menu })));
      localStorage.setItem(SCOPE_KEY, JSON.stringify({ ...preferences, stock_location_id: nextLocationId }));
      updateHeader();
    }).catch((error) => {
      state.stockLocationId = previousLocationId;
      $('#stock-location-select').value = previousLocationId;
      toast(`Katalog stok tidak dapat dimuat: ${error.message}`, 'error');
    }).finally(() => {
      state.busy = false;
      renderCart();
      renderMenuGrid();
    });
  });
  $('#cart-launcher').addEventListener('click', () => setCartOpen(true));
  $('#close-cart').addEventListener('click', () => setCartOpen(false));
  $('#cart-backdrop').addEventListener('click', () => setCartOpen(false));
  $('#stock-alert-close').addEventListener('click', closeStockAlert);
  $('#stock-alert-confirm').addEventListener('click', closeStockAlert);
  $('#stock-alert-modal').addEventListener('click', (event) => { if (event.target === $('#stock-alert-modal')) closeStockAlert(); });
  $('#checkout-button').addEventListener('click', () => { setCartOpen(false); beginCheckout(); });
  $('#close-payment').addEventListener('click', () => { if (!state.busy) closePaymentDialog(); });
  $('#payment-modal').addEventListener('click', (event) => { if (!state.busy && event.target === $('#payment-modal')) closePaymentDialog(); });
  $('#cash-received').addEventListener('input', updateChange);
  $('#quick-cash').addEventListener('click', (event) => {
    const button = event.target.closest('[data-cash-amount]');
    if (!button) return;
    $('#cash-received').value = button.dataset.cashAmount;
    updateChange();
  });
  $('#confirm-payment').addEventListener('click', confirmCashPayment);
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-nav]').forEach((entry) => entry.classList.toggle('active', entry === button));
    if (button.dataset.nav === 'history') {
      window.history.replaceState({}, '', '/pos?view=history');
      renderHistory();
    }
    else {
      window.history.replaceState({}, '', '/pos');
      $('#history-view').classList.add('hidden');
      $('#success-view').classList.add('hidden');
      $('#pos-layout').classList.remove('hidden');
    }
  }));

  const session = readSession();
  if (session?.token && session?.scope?.company_id && session?.scope?.outlet_id) {
    state.token = session.token;
    state.user = session.user;
    state.scope = session.scope;
    initializeApp();
  } else showLogin();
}

initialize();
