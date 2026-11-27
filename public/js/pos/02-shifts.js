// Ordered browser script; shared page state is initialized by earlier files.
async function refreshShift() {
  const result = await request('/cashier/shift');
  state.shift = result.shift;
  state.shiftDrafts = result.drafts ?? [];
  updateHeader();
  renderCart();
  renderMenuGrid();
}

function renderShiftDrafts() {
  const panel = $('#shift-drafts');
  const closing = state.shiftMode === 'close';
  panel.classList.toggle('hidden', !closing);
  if (!closing) {
    panel.innerHTML = '';
    $('#save-shift').disabled = false;
    return;
  }

  const unsavedCart = state.cart.length > 0 && !state.currentOrder;
  const drafts = state.shiftDrafts ?? [];
  const entries = drafts.map((draft) => `<li>
    <div><strong>${escapeHtml(draft.order_number)}</strong><small>${formatMoney(draft.grand_total_amount)} · ${escapeHtml(draft.status === 'pending_payment' ? 'Pembayaran diproses' : 'Belum dibayar')}</small></div>
    ${draft.payment_status === 'pending'
      ? '<span class="draft-in-progress">Tunggu pembayaran</span>'
      : `<div class="draft-actions"><button class="small-button" type="button" data-resume-shift-draft="${escapeHtml(draft.id)}">Lanjutkan</button><button class="small-button danger-button" type="button" data-cancel-shift-draft="${escapeHtml(draft.id)}">Batalkan</button></div>`}
  </li>`).join('');
  const localOrderIsListed = !state.currentOrder || drafts.some((draft) => draft.id === state.currentOrder.id);
  const localDraftWarning = state.currentOrder && !localOrderIsListed
    ? '<p class="draft-warning">Draft pada perangkat ini belum termuat. Muat ulang daftar sebelum menutup shift.</p>'
    : '';
  panel.innerHTML = `${unsavedCart ? `<div class="unsaved-cart-warning"><span>Keranjang ini belum tersimpan sebagai order.</span><button class="small-button danger-button" data-discard-shift-cart type="button">Kosongkan keranjang</button></div>` : ''}
    ${drafts.length ? `<strong class="draft-panel-title">${drafts.length} draft masih terbuka</strong><ul>${entries}</ul>` : ''}
    ${localDraftWarning}
    ${!drafts.length && !unsavedCart && !localDraftWarning ? '<p class="draft-panel-clear">Tidak ada draft yang menahan penutupan shift.</p>' : ''}`;
  $('#save-shift').disabled = drafts.length > 0 || unsavedCart || Boolean(localDraftWarning);
}

function renderHistoryDrafts() {
  const section = $('#history-drafts');
  const container = $('#history-draft-list');
  const drafts = state.shiftDrafts ?? [];
  section.classList.toggle('hidden', drafts.length === 0);
  container.innerHTML = drafts.map((draft) => `<article class="history-card history-draft-card">
    <div><strong>${escapeHtml(draft.order_number)}</strong><span>${escapeHtml(draft.status === 'pending_payment' ? 'Pembayaran tertunda' : 'Belum dibayar')} · ${formatMoney(draft.grand_total_amount)}</span></div>
    ${draft.payment_status === 'pending'
      ? '<span class="draft-in-progress">Pembayaran sedang diproses</span>'
      : `<div class="draft-actions"><button class="small-button" type="button" data-resume-shift-draft="${escapeHtml(draft.id)}">Lanjutkan</button><button class="small-button danger-button" type="button" data-cancel-shift-draft="${escapeHtml(draft.id)}">Batalkan</button></div>`}
  </article>`).join('');
}

function renderShiftCashBreakdown() {
  const container = $('#shift-expected');
  const closing = state.shiftMode === 'close';
  container.classList.toggle('hidden', !closing);
  if (!closing) { container.innerHTML = ''; return; }
  const shift = state.shift ?? {};
  const expected = Number(shift.expected_cash_amount ?? 0);
  container.innerHTML = `<div class="cash-breakdown-row"><span>Modal awal</span><strong>${formatMoney(shift.opening_cash_amount)}</strong></div>
    <div class="cash-breakdown-row"><span>Kas masuk</span><strong>+${formatMoney(shift.cash_in_amount)}</strong></div>
    <div class="cash-breakdown-row"><span>Kas keluar</span><strong>−${formatMoney(shift.cash_out_amount)}</strong></div>
    <div class="cash-breakdown-row"><span>Penjualan tunai</span><strong>+${formatMoney(shift.cash_sales_amount)}</strong></div>
    <div class="cash-breakdown-row cash-breakdown-total"><span>Perkiraan kas di laci</span><strong>${formatMoney(expected)}</strong></div>
    <div class="cash-breakdown-row cash-breakdown-variance" id="shift-variance"><span>Selisih saat ini</span><strong>Masukkan kas akhir</strong></div>`;
  updateShiftVariance();
}

function updateShiftVariance() {
  const row = $('#shift-variance');
  if (!row || state.shiftMode !== 'close') return;
  const input = $('#shift-amount').value.trim();
  const amount = Number(input);
  const value = row.querySelector('strong');
  const note = $('#shift-note');
  const label = $('#shift-note-label');
  if (!input || !Number.isSafeInteger(amount)) {
    value.textContent = 'Masukkan kas akhir';
    row.classList.remove('variance-short', 'variance-over');
    note.required = false;
    label.firstChild.textContent = 'Catatan penutupan (opsional)';
    return;
  }
  const variance = amount - Number(state.shift?.expected_cash_amount ?? 0);
  value.textContent = `${variance > 0 ? '+' : ''}${formatMoney(variance)}`;
  row.classList.toggle('variance-short', variance < 0);
  row.classList.toggle('variance-over', variance > 0);
  note.required = variance !== 0;
  label.firstChild.textContent = variance !== 0 ? 'Alasan selisih kas (wajib)' : 'Catatan penutupan (opsional)';
}

async function resumeShiftDraft(orderId, button) {
  if (state.currentOrder?.id === orderId) {
    hideShiftDialog();
    $('#history-view').classList.add('hidden');
    $('#pos-layout').classList.remove('hidden');
    window.history.replaceState({}, '', '/pos');
    document.querySelectorAll('[data-nav]').forEach((entry) => entry.classList.toggle('active', entry.dataset.nav === 'pos'));
    setCartOpen(true);
    return;
  }
  if (state.currentOrder || state.cart.length) {
    toast('Selesaikan atau kosongkan keranjang saat ini sebelum membuka draft lain.', 'error');
    return;
  }
  const draft = state.shiftDrafts.find((entry) => entry.id === orderId);
  if (!draft || draft.payment_status === 'pending') return;
  button.disabled = true;
  try {
    const order = await request(`/orders/${encodeURIComponent(orderId)}`);
    if (!['draft','pending_payment'].includes(order.status) || order.payment_status === 'pending') {
      await refreshShift();
      renderShiftDrafts();
      throw new Error('Draft ini sudah berubah status dan tidak dapat dilanjutkan.');
    }
    if (!state.stockLocations.some((location) => location.id === order.stock_location_id)) {
      throw new Error('Lokasi stok draft sudah tidak aktif. Batalkan draft atau minta admin memeriksa lokasi stok.');
    }
    const restoredLines = order.lines.map((line) => {
      const product = state.products.find((entry) => entry.menu_variant_id === line.menu_variant_id);
      return {
        variantId: line.menu_variant_id,
        menuName: line.menu_name,
        variantName: line.variant_name,
        sku: product?.code ?? '',
        price: Number(line.unit_price_amount),
        quantity: Number(line.quantity),
        note: line.item_note ?? ''
      };
    });
    state.currentOrder = order;
    state.cart = restoredLines;
    state.orderKey = null;
    state.paymentKey = makeKey();
    state.paymentRequest = null;
    state.draftDirty = false;
    state.stockLocationId = order.stock_location_id;
    state.orderType = order.order_type;
    state.tableLabel = order.table_label ?? '';
    $('#table-label').value = state.tableLabel;
    $('#customer-note').value = order.customer_note ?? '';
    renderLocationSelect();
    hideShiftDialog();
    $('#history-view').classList.add('hidden');
    $('#success-view').classList.add('hidden');
    $('#pos-layout').classList.remove('hidden');
    window.history.replaceState({}, '', '/pos');
    document.querySelectorAll('[data-nav]').forEach((entry) => entry.classList.toggle('active', entry.dataset.nav === 'pos'));
    renderCart();
    renderMenuGrid();
    setCartOpen(true);
    toast(`Draft ${order.order_number} dibuka kembali.`);
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function cancelShiftDraft(orderId, button) {
  const draft = state.shiftDrafts.find((entry) => entry.id === orderId);
  if (!draft || draft.payment_status === 'pending') return;
  if (!confirm(`Batalkan draft ${draft.order_number}? Draft ini tidak bisa dilanjutkan kembali.`)) return;
  button.disabled = true;
  try {
    await request(`/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST', body: { reason: 'Kasir membatalkan draft sebelum tutup shift' }
    });
    state.shiftDrafts = state.shiftDrafts.filter((entry) => entry.id !== orderId);
    if (state.currentOrder?.id === orderId) {
      state.cart = [];
      state.currentOrder = null;
      state.orderKey = null;
      state.paymentKey = null;
      state.paymentRequest = null;
      state.draftDirty = false;
      state.tableLabel = '';
      $('#table-label').value = '';
      $('#customer-note').value = '';
      renderCart();
    }
    renderShiftDrafts();
    await refreshShift();
    renderShiftDrafts();
    renderHistoryDrafts();
    toast(`Draft ${draft.order_number} dibatalkan.`);
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

function discardUnsubmittedShiftCart() {
  if (!state.cart.length || state.currentOrder) return;
  if (!confirm('Kosongkan keranjang yang belum disimpan sebagai order?')) return;
  state.cart = [];
  state.tableLabel = '';
  $('#table-label').value = '';
  $('#customer-note').value = '';
  renderCart();
  renderShiftDrafts();
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
  $('#shift-note-label').firstChild.textContent = movement ? 'Alasan' : 'Catatan penutupan (opsional)';
  $('#shift-note').required = movement;
  $('#cash-event-type-label').classList.toggle('hidden', !movement);
  renderShiftCashBreakdown();
  $('#shift-error').classList.add('hidden');
  $('#close-shift').classList.toggle('hidden', !state.shift);
  $('#save-shift').innerHTML = `<span>${closing ? 'Tutup shift' : movement ? 'Simpan kas' : 'Mulai shift'}</span><span>→</span>`;
  renderShiftDrafts();
  $('#shift-modal').classList.remove('hidden');
  shiftReturnFocus = document.activeElement;
  window.setTimeout(() => $('#shift-amount').focus(), 20);
}

async function saveShift(event) {
  event.preventDefault();
  const amount = Number($('#shift-amount').value);
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  const closing = state.shiftMode === 'close';
  const unsubmittedCart = state.cart.length > 0 && !state.currentOrder;
  if (closing && (state.shiftDrafts.length > 0 || unsubmittedCart || (state.currentOrder && !state.shiftDrafts.some((draft) => draft.id === state.currentOrder.id)))) {
    renderShiftDrafts();
    $('#shift-error').textContent = 'Batalkan semua draft atau kosongkan keranjang yang belum disimpan sebelum menutup shift.';
    $('#shift-error').classList.remove('hidden');
    return;
  }
  const closingNote = $('#shift-note').value.trim();
  if (closing && amount !== Number(state.shift?.expected_cash_amount ?? 0) && !closingNote) {
    $('#shift-note').required = true;
    $('#shift-error').textContent = 'Isi alasan selisih kas untuk melanjutkan.';
    $('#shift-error').classList.remove('hidden');
    $('#shift-note').focus();
    return;
  }
  $('#save-shift').disabled = true;
  $('#shift-error').classList.add('hidden');
  try {
    if (closing) {
      const result = await request(`/cashier/shifts/${encodeURIComponent(state.shift.id)}/close`, {
        method: 'POST', body: { closing_cash_amount: amount, closing_note: closingNote || null }
      });
      state.shift = null;
      state.shiftDrafts = [];
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
    if (error.code === 'SHIFT_HAS_OPEN_ORDERS') {
      try { await refreshShift(); } catch {}
      renderShiftDrafts();
    }
    $('#shift-error').textContent = error.message;
    $('#shift-error').classList.remove('hidden');
  } finally {
    renderShiftDrafts();
  }
}

