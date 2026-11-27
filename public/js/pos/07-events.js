// Ordered browser script; shared page state is initialized by earlier files.
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
    state.authenticated = true;
    state.csrfToken = result.csrf_token;
    state.user = result.user;
    state.scope = result.scope;
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
  $('#logout-button').addEventListener('click', async () => {
    try { await request('/auth/logout', { method: 'POST' }); signOut(); location.href = '/'; }
    catch (error) { toast(`Keluar gagal: ${error.message}`, 'error'); }
  });
  $('#shift-action').addEventListener('click', () => state.authenticated && openShiftModal(state.shift ? 'close' : 'open'));
  $('#cash-movement-button').addEventListener('click', () => {
    if (!state.shift) return openShiftModal('open');
    openShiftModal('movement');
  });
  $('#shift-form').addEventListener('submit', saveShift);
  $('#shift-amount').addEventListener('input', updateShiftVariance);
  $('#close-shift').addEventListener('click', closeShiftDialog);
  $('#shift-modal').addEventListener('click', (event) => { if (event.target === $('#shift-modal')) closeShiftDialog(); });
  $('#shift-drafts').addEventListener('click', (event) => {
    const resumeButton = event.target.closest('[data-resume-shift-draft]');
    if (resumeButton) return resumeShiftDraft(resumeButton.dataset.resumeShiftDraft, resumeButton);
    const cancelButton = event.target.closest('[data-cancel-shift-draft]');
    if (cancelButton) return cancelShiftDraft(cancelButton.dataset.cancelShiftDraft, cancelButton);
    if (event.target.closest('[data-discard-shift-cart]')) discardUnsubmittedShiftCart();
  });
  $('#history-drafts').addEventListener('click', (event) => {
    const resumeButton = event.target.closest('[data-resume-shift-draft]');
    if (resumeButton) return resumeShiftDraft(resumeButton.dataset.resumeShiftDraft, resumeButton);
    const cancelButton = event.target.closest('[data-cancel-shift-draft]');
    if (cancelButton) cancelShiftDraft(cancelButton.dataset.cancelShiftDraft, cancelButton);
  });
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

  initializeApp();
}

initialize();
