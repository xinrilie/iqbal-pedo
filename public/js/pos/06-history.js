// Ordered browser script; shared page state is initialized by earlier files.
async function renderHistory() {
  $('#pos-layout').classList.add('hidden');
  $('#success-view').classList.add('hidden');
  $('#history-view').classList.remove('hidden');
  try { await refreshShift(); } catch {}
  renderHistoryDrafts();
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

