// Ordered browser script; shared page state is initialized by earlier files.
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
    try { await refreshShift(); }
    catch (error) { toast(`Pembayaran berhasil. Ringkasan shift belum diperbarui: ${error.message}`, 'error'); }
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
  state.cart = [];
  state.currentOrder = null;
  state.orderKey = null;
  state.paymentKey = null;
  state.paymentRequest = null;
  state.draftDirty = false;
  $('#cart-launcher').classList.add('hidden');
  setCartOpen(false);
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

