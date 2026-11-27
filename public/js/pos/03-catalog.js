// Ordered browser script; shared page state is initialized by earlier files.
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
      <div class="menu-card-content"><div class="menu-card-title" title="${escapeHtml(product.menu.menu_name)}"><span class="menu-card-name">${escapeHtml(product.menu.menu_name)}</span><span class="product-type-tag">${product.product_type==='retail'?'Retail':'Kafe'}</span></div>
        <div class="menu-card-subtitle">${escapeHtml(variantLabel)}${available ? '' : ` · ${escapeHtml(unavailableReason)}`}</div>
        <div class="menu-card-bottom"><strong class="menu-price">${formatMoney(product.price_amount)}</strong>${product.is_test_price ? '<span class="test-price-pill">Harga uji</span>' : ''}${available
          ? `<button class="add-button" type="button" data-add-variant="${escapeHtml(product.menu_variant_id)}" aria-label="Tambah ${escapeHtml(product.menu.menu_name)} ke pesanan" ${state.busy || state.paymentRequest || !state.shift ? 'disabled' : ''}>+</button>`
          : stockLimit === 0 || !stockAllowsAdd
            ? `<button class="unavailable-tag stock-alert-button" type="button" data-stock-alert="${escapeHtml(product.menu.menu_variant_id)}" data-stock-limit="${stockLimit ?? 0}" data-product-name="${escapeHtml(product.menu.menu_name)}">${stockLimit === 0 ? 'Stok habis' : 'Batas stok'}</button>`
            : `<span class="unavailable-tag">${escapeHtml(unavailableReason === 'Stok bahan habis' ? 'Stok habis' : 'Tidak tersedia')}</span>`}</div>
      </div></article>`;
  }).join('');
}

