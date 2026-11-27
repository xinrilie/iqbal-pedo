// Ordered browser script; shared page state is initialized by earlier files.
function renderDashboard(data){
  $('#outlet-name').textContent=data.outlet_name??'Outlet aktif';
  $('#location-count').textContent=`${data.active_stock_locations} lokasi stok aktif`;
  $('#welcome-title').textContent=`Selamat datang, ${session?.user?.full_name?.split(' ')[0]??'Admin'}.`;
  $('#dashboard-subtitle').textContent=`Ringkasan outlet · Data transaksi hari ini`;
  $('#metric-grid').innerHTML=[
    renderMetric('Penjualan hari ini',formatMoney(data.gross_sales_amount),'Dari pembayaran sukses'),
    renderMetric('Transaksi selesai',data.completed_transactions,'Pesanan lunas hari ini'),
    renderMetric('Item di bawah minimum',`${data.low_stock_items} item`,data.low_stock_items?'Perlu ditinjau':'Tidak ada item kritis'),
    renderMetric('Lokasi stok aktif',data.active_stock_locations,'Gudang, bar, atau area penyimpanan')
  ].join('');
  const rows=data.low_stock_list??[];
  $('#low-stock-body').innerHTML=rows.length?rows.map((item)=>`<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku)}</small></td><td>${formatQty(item.on_hand_qty_base)} ${escapeHtml(item.base_uom_code)}</td><td>${formatQty(item.minimum_stock_base)} ${escapeHtml(item.base_uom_code)}</td><td><span class="stock-pill low">Di bawah minimum</span></td></tr>`).join(''):'<tr><td colspan="4" class="table-empty">Belum ada item di bawah minimum.</td></tr>';
}
function inventoryDateLabel(value){if(!value)return '';const [year,month,day]=String(value).slice(0,10).split('-');return `${day}/${month}/${year}`;}
function populateInventoryFilter(id,options,label){const select=$(id);const current=select.value||'all';select.innerHTML=`<option value="all">${label}</option>`+options.map((option)=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');select.value=[...select.options].some((option)=>option.value===current)?current:'all';}
function renderInventory(){
  const categoryFilter=$('#inventory-category-filter').value;
  const locationFilter=$('#inventory-location-filter').value;
  const statusFilter=$('#inventory-status-filter').value;
  const expiryFilter=$('#inventory-expiry-filter').value;
  const sort=$('#inventory-sort').value;
  const locationsFor=(item)=>item.stock_by_location.filter((location)=>locationFilter==='all'||location.id===locationFilter);
  const onHandFor=(item)=>locationFilter==='all'?Number(item.on_hand_qty_base):locationsFor(item).reduce((sum,location)=>sum+Number(location.quantity),0);
  const items=inventoryRows.filter((item)=>{
    if(categoryFilter!=='all'&&(item.category_name??'Tanpa kategori')!==categoryFilter)return false;
    if(locationFilter!=='all'&&!item.stock_by_location.some((location)=>location.id===locationFilter))return false;
    const qty=onHandFor(item);const minimum=Number(item.minimum_stock_base);
    const status=!item.is_active?'inactive':minimum>0&&qty<minimum?'low':qty<=0?'empty':'okay';
    if(statusFilter!=='all'&&status!==statusFilter)return false;
    const expired=Number(item.expired_stock_qty)>0;const soon=Number(item.expiring_soon_stock_qty)>0;
    const dated=Boolean(item.earliest_stock_expiry_date);
    if(expiryFilter==='expired'&&!expired)return false;
    if(expiryFilter==='soon'&&!soon)return false;
    if(expiryFilter==='dated'&&!dated)return false;
    return true;
  }).sort((a,b)=>{
    if(sort==='expiry')return (a.earliest_stock_expiry_date||'9999-12-31').localeCompare(b.earliest_stock_expiry_date||'9999-12-31')||a.name.localeCompare(b.name,'id');
    if(sort==='low')return onHandFor(a)-onHandFor(b)||a.name.localeCompare(b.name,'id');
    if(sort==='high')return onHandFor(b)-onHandFor(a)||a.name.localeCompare(b.name,'id');
    return a.name.localeCompare(b.name,'id')||a.sku.localeCompare(b.sku,'id');
  });
  $('#inventory-count').textContent=`${items.length} dari ${inventoryRows.length} item`;
  const locations=new Map(inventoryRows.flatMap((item)=>item.stock_by_location.map((location)=>[location.id,location])));
  $('#location-summary').textContent=locationFilter==='all'?`${locations.size} lokasi stok aktif`:`Lokasi: ${locations.get(locationFilter)?.name??'dipilih'}`;
  $('#inventory-footnote').textContent=`Menampilkan ${items.length} item sesuai filter. Saldo dihitung dari ledger.`;
  $('#inventory-body').innerHTML=items.length?items.map((item)=>{
    const itemLocations=locationsFor(item);const onHand=onHandFor(item);const minimum=Number(item.minimum_stock_base);
    const places=itemLocations.length?`<div class="location-list">${itemLocations.map((loc)=>`<div class="location-line"><small>${escapeHtml(loc.name)} · ${escapeHtml(loc.code)}</small><strong>${formatQty(loc.quantity)}</strong></div>`).join('')}</div>`:'<span class="muted">Belum ada lokasi aktif</span>';
    const status=!item.is_active?'<span class="stock-pill inactive">Nonaktif</span>':minimum>0&&onHand<minimum?'<span class="stock-pill low">Kritis</span>':onHand<=0?'<span class="stock-pill inactive">Habis</span>':'<span class="stock-pill">Aman</span>';
    const expiredQty=Number(item.expired_stock_qty);const soonQty=Number(item.expiring_soon_stock_qty);
    let expiry='<span class="expiry-muted">Tidak dilacak</span>';
    if(item.track_expiry){
      if(expiredQty>0)expiry=`<span class="expiry-status expired">${formatQty(expiredQty)} ${escapeHtml(item.base_uom_code)} kedaluwarsa</span><small>Lot: ${inventoryDateLabel(item.earliest_stock_expiry_date)}</small>`;
      else if(item.next_expiry_date)expiry=`<span class="expiry-status ${soonQty>0?'soon':''}">${inventoryDateLabel(item.next_expiry_date)}</span><small>${soonQty>0?`${formatQty(soonQty)} ${escapeHtml(item.base_uom_code)} ≤ 30 hari`:'Tanggal lot terdekat'}</small>`;
      else expiry='<span class="expiry-muted">Belum ada lot bertanggal</span>';
    }
    return `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku)}${item.track_lot?' · Lot':''}${item.track_expiry?' · Expiry':''}</small></td><td>${escapeHtml(item.category_name??'—')}</td><td>${escapeHtml(item.base_uom_code)}</td><td><strong>${formatQty(onHand)} ${escapeHtml(item.base_uom_code)}</strong></td><td>${formatQty(minimum)} ${escapeHtml(item.base_uom_code)}</td><td>${places}</td><td>${expiry}</td><td>${status}</td></tr>`;
  }).join(''):'<tr><td colspan="8" class="table-empty">Item inventori tidak ditemukan untuk filter ini.</td></tr>';
}
