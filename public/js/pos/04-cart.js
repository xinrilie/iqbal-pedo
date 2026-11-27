// Ordered browser script; shared page state is initialized by earlier files.
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
    quantity: String(line.quantity).includes('.') ? String(line.quantity) : `${line.quantity}.000`,
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

