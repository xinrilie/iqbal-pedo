const API='/api/v1';
try { sessionStorage.removeItem('gcims_pos_session'); } catch {}
const $=(selector)=>document.querySelector(selector);
const money=new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0});
const quantity=new Intl.NumberFormat('id-ID',{maximumFractionDigits:6});
let session=null;
let searchTimer=null;
let cashiers=[];
let adminUsers=[];
let inventoryRows=[];
let ledgerRows=[];
let ledgerTotal=0;
let ledgerQuery=new URLSearchParams();
let salesQuery=new URLSearchParams();
let resetCashier=null;
let adminMenus=[];
let menuIngredients=[];
let menuCategories=[];
let selectedMenuId=null;
let editingVariantId=null;
let adminPermissions=[];
let stocktakeRows=[];
let selectedStocktakeId=null;
let suppliers=[];
let procurementItems=[];
let selectedSupplierId=null;
let editingSupplierId=null;
let purchaseOrders=[];
let goodsReceipts=[];
let selectedPoId=null;
let selectedReceiptId=null;
let selectedSupplierCatalog=[];
let poIdempotency=null;
let receiptIdempotency=null;

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function formatMoney(value){return money.format(Number(value)||0);}
function formatQty(value){return quantity.format(Number(value)||0);}
function showLogin(message=''){ $('#login-screen').classList.remove('hidden'); $('.admin-shell').classList.add('hidden'); $('#login-error').textContent=message; $('#login-error').classList.toggle('hidden',!message); }
function showToast(message,isError=false){const node=document.createElement('div');node.className=`toast${isError?' error':''}`;node.textContent=message;$('#toast-region').append(node);setTimeout(()=>node.remove(),4000);}
async function request(path,{method='GET',body,auth=true,headers:extraHeaders={}}={}){
  const headers={...extraHeaders};if(auth&&session?.csrfToken&&!['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))headers['x-csrf-token']=session.csrfToken;if(body!==undefined)headers['content-type']='application/json';
  let response;
  try{response=await fetch(`${API}${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch(error){if(error instanceof TypeError)throw new Error('Tidak dapat terhubung ke server. Pastikan backend aktif, lalu coba lagi.');throw error;}
  let data=null;try{data=await response.json();}catch{}
  if(!response.ok){const error=new Error(data?.error?.message??`Request gagal (${response.status}).`);error.status=response.status;error.requestId=data?.error?.request_id;if(response.status===401){const hadSession=Boolean(session?.csrfToken);session=null;showLogin(hadSession?'Sesi berakhir. Silakan masuk kembali.':'');}throw error;}
  return data;
}
function renderMetric(label,value,note){return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note">${escapeHtml(note)}</span></article>`;}
function renderDashboard(data){
  $('#outlet-name').textContent=data.outlet_name??'Outlet aktif';
  $('#location-count').textContent=`${data.active_stock_locations} lokasi stok aktif`;
  $('#welcome-title').textContent=`Selamat datang, ${session?.user?.full_name?.split(' ')[0]??'Admin'}.`;
  $('#dashboard-subtitle').textContent=`Ringkasan outlet · Data transaksi hari ini`;
  $('#metric-grid').innerHTML=[
    renderMetric('Penjualan hari ini',formatMoney(data.gross_sales_amount),'Dari pembayaran sukses'),
    renderMetric('Transaksi selesai',data.completed_transactions,'Pesanan lunas hari ini'),
    renderMetric('Bahan di bawah minimum',`${data.low_stock_items} item`,data.low_stock_items?'Perlu ditinjau':'Tidak ada item kritis'),
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
function renderMenuDetail(menuId){
  const variants=adminMenus.filter((row)=>row.menu_id===menuId);const menu=variants[0];const detail=$('#menu-detail');
  if(!menu){detail.innerHTML='<div class="empty-state"><strong>Menu tidak ditemukan</strong></div>';return;}
  const canUpdate=adminPermissions.includes('admin.menu.update');
  detail.innerHTML=`<header class="panel-heading"><div><p class="eyebrow">${escapeHtml(menu.category_name??'Tanpa kategori')}</p><h2>${escapeHtml(menu.menu_name)}</h2><p>${escapeHtml(menu.menu_code)} · ${menu.menu_active?'Aktif':'Nonaktif'}</p></div>${canUpdate?`<button class="small-button danger-button menu-delete-button" type="button" data-delete-menu="${escapeHtml(menu.menu_id)}">Hapus menu</button>`:''}</header>${variants.map((variant)=>{
    const available=variant.menu_active&&variant.variant_active&&variant.outlet_available&&(variant.product_type!=='retail'||variant.retail_item_active);
    const items=variant.recipe_items??[];
    const sourceNote=String(variant.version_notes??'').split('Preparation only, no inventory SKU:').pop();
    const preparationNote=String(variant.version_notes??'').includes('Preparation only, no inventory SKU:')?sourceNote.trim():'';
    const retail=variant.product_type==='retail';
    const rows=retail?`<tr><td><strong>${escapeHtml(variant.retail_item_name??'SKU tidak ditemukan')}</strong><small>${escapeHtml(variant.retail_item_sku??'')}</small></td><td>${formatQty(variant.retail_quantity_base)} ${escapeHtml(variant.retail_item_uom_code??'')}</td><td>Stok retail langsung</td></tr>`:items.length?items.map((item)=>`<tr><td><strong>${escapeHtml(item.item_name)}</strong><small>${escapeHtml(item.sku)}</small></td><td>${formatQty(item.quantity_base)} ${escapeHtml(item.uom_code)}</td><td>${escapeHtml(item.preparation_note||'—')}</td></tr>`).join(''):'<tr><td colspan="3" class="table-empty">Belum ada resep aktif. Tambahkan komposisi sebelum produk dijual.</td></tr>';
    const price=Number(variant.price_amount)>0?formatMoney(variant.price_amount):'Harga belum diisi';
    return `<article class="menu-variant-block"><div class="menu-variant-heading"><div><h3>${escapeHtml(variant.variant_name)}</h3><p>${escapeHtml(variant.variant_code)} · ${price}${variant.is_test_price?' · <span class="test-price-label">HARGA UJI</span>':''} · <span class="stock-pill ${available?'':'inactive'}">${available?'Tersedia':'Tidak tersedia'}</span></p><p>${retail?'Produk retail · stok dipotong per unit jual':variant.version_no?`Resep v${variant.version_no}${variant.effective_from?` · aktif sejak ${escapeHtml(new Date(variant.effective_from).toLocaleString('id-ID'))}`:''}`:'Belum ada resep aktif'}</p>${preparationNote?`<p class="recipe-source-note">Persiapan tanpa SKU (tidak mengurangi stok): ${escapeHtml(preparationNote)}</p>`:''}</div>${canUpdate&&!retail?`<button class="small-button recipe-action" type="button" data-edit-recipe="${escapeHtml(variant.variant_id)}">${items.length?'Edit resep':'Tambah resep'}</button>`:''}</div><div class="table-scroll"><table class="menu-recipe-table"><thead><tr><th>${retail?'SKU inventori':'Bahan'}</th><th>${retail?'Qty per unit':'Takaran / porsi'}</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
  }).join('')}`;
}
function renderMenuList(query=''){
  const list=$('#admin-menu-list');const groups=new Map();for(const row of adminMenus){const key=row.menu_id;if(!groups.has(key))groups.set(key,row);}
  const menus=[...groups.values()].filter((row)=>`${row.menu_name} ${row.category_name??''} ${row.menu_code}`.toLowerCase().includes(query.trim().toLowerCase()));
  $('#menu-count').textContent=`${groups.size} produk · ${adminMenus.length} varian`;
  list.innerHTML=menus.length?menus.map((row)=>`<button class="admin-menu-option ${row.menu_id===selectedMenuId?'selected':''}" type="button" data-menu-select="${escapeHtml(row.menu_id)}"><span><strong>${escapeHtml(row.menu_name)}</strong><small>${escapeHtml(row.category_name??'Tanpa kategori')} · ${escapeHtml(row.menu_code)}${row.menu_active?'':' · Arsip'}</small></span><small>${adminMenus.filter((item)=>item.menu_id===row.menu_id).length} varian</small></button>`).join(''):'<p class="table-empty">Menu tidak ditemukan.</p>';
}
async function loadMenus(){
  $('#admin-menu-list').innerHTML='<p class="table-empty">Memuat menu…</p>';
  try{const result=await request('/admin/menus');adminMenus=result.data??[];menuIngredients=result.ingredients??[];menuCategories=result.categories??[];const form=$('#menu-create-form');form.elements.category_id.innerHTML='<option value="">Pilih kategori</option>'+menuCategories.map((category)=>`<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');form.elements.retail_inventory_item_id.innerHTML='<option value="">Pilih SKU inventori</option>'+menuIngredients.map((item)=>`<option value="${escapeHtml(item.id)}" data-sku="${escapeHtml(item.sku)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${escapeHtml(item.sku)} (${escapeHtml(item.uom_code)})</option>`).join('');selectedMenuId=adminMenus[0]?.menu_id??null;renderMenuList($('#menu-search').value);renderMenuDetail(selectedMenuId);$('#error-banner').classList.add('hidden');}
  catch(error){$('#admin-menu-list').innerHTML=`<p class="table-empty">${escapeHtml(error.message)}</p>`;$('#error-banner').textContent=error.status===403?'Akun ini belum memiliki izin admin.menu.read. Minta admin memberikan akses Produk & BOM.':error.message;$('#error-banner').classList.remove('hidden');}
}
function addRecipeLine(item=null,containerId='#recipe-lines'){
  const line=document.createElement('div');line.className='recipe-line';
  line.innerHTML=`<label>Bahan<select name="inventory_item_id" required><option value="">Pilih bahan</option>${menuIngredients.map((ingredient)=>`<option value="${escapeHtml(ingredient.id)}">${escapeHtml(ingredient.name)} · ${escapeHtml(ingredient.sku)} (${escapeHtml(ingredient.uom_code)})</option>`).join('')}</select></label><label>Qty dasar<input name="quantity_base" type="number" min="0.000001" step="0.000001" required placeholder="0"></label><label>Catatan<input name="preparation_note" maxlength="300" placeholder="Opsional"></label><button class="small-button recipe-remove" type="button" aria-label="Hapus bahan">×</button>`;
  if(item){line.querySelector('[name="inventory_item_id"]').value=item.inventory_item_id;line.querySelector('[name="quantity_base"]').value=item.quantity_base;line.querySelector('[name="preparation_note"]').value=item.preparation_note??'';}
  line.querySelector('.recipe-remove').addEventListener('click',()=>line.remove());$(containerId).append(line);
}
function openRecipeEditor(variantId){
  const variant=adminMenus.find((row)=>row.variant_id===variantId);if(!variant)return;editingVariantId=variantId;$('#recipe-title').textContent=`Resep ${variant.menu_name} · ${variant.variant_name}`;$('#recipe-lines').innerHTML='';
  const current=variant.recipe_items??[];if(current.length)current.forEach((item)=>addRecipeLine(item));else addRecipeLine();$('#recipe-error').classList.add('hidden');$('#recipe-dialog').classList.remove('hidden');
}
function openMenuCreate(){
  const form=$('#menu-create-form');form.reset();$('#new-menu-lines').innerHTML='';addRecipeLine(null,'#new-menu-lines');syncProductTypeFields();$('#menu-create-error').classList.add('hidden');$('#menu-create-dialog').classList.remove('hidden');form.elements.code.focus();
}
function syncProductTypeFields(){const form=$('#menu-create-form');const retail=form.elements.product_type.value==='retail';$('#retail-product-fields').classList.toggle('hidden',!retail);$('#prepared-product-fields').classList.toggle('hidden',retail);form.elements.retail_inventory_item_id.required=retail;form.elements.retail_quantity_base.required=retail;form.querySelectorAll('#new-menu-lines select,#new-menu-lines input').forEach((input)=>{input.disabled=retail;input.required=!retail&&input.name!=='preparation_note';});}
const stocktakeStatusLabels={draft:'Draft',counting:'Sedang dihitung',pending_review:'Menunggu persetujuan',approved:'Disetujui',posted:'Diposting',cancelled:'Dibatalkan'};
function renderStocktakeList(){
  const body=$('#stocktake-body');
  $('#stocktake-count').textContent=`${stocktakeRows.length} opname`;
  body.innerHTML=stocktakeRows.length?stocktakeRows.map((row)=>`<tr><td><strong>${escapeHtml(row.stocktake_number)}</strong></td><td>${escapeHtml(row.stock_location_name)}</td><td><span class="stock-pill ${row.status==='posted'?'':'low'}">${escapeHtml(stocktakeStatusLabels[row.status]??row.status)}</span></td><td>${Number(row.counted_line_count)}/${Number(row.line_count)} item</td><td>${escapeHtml(row.created_by_name??'Admin')}</td><td>${escapeHtml(new Date(row.created_at).toLocaleString('id-ID'))}</td><td><button type="button" class="small-button" data-stocktake-id="${escapeHtml(row.id)}">Buka</button></td></tr>`).join(''):'<tr><td colspan="7" class="table-empty">Belum ada stok opname di outlet ini.</td></tr>';
}
function renderStocktakeDetail(stocktake){
  selectedStocktakeId=stocktake.id;
  $('#stocktake-detail-panel').classList.remove('hidden');
  $('#stocktake-detail-title').textContent=stocktake.stocktake_number;
  $('#stocktake-detail-copy').textContent=`${stocktake.stock_location_name} · ${stocktakeStatusLabels[stocktake.status]??stocktake.status} · dibuat ${stocktake.created_by_name??'Admin'}`;
  const actions=$('#stocktake-actions');
  actions.innerHTML=stocktake.status==='counting'?'<button type="button" class="primary-button" data-stocktake-action="submit">Kirim untuk persetujuan</button><button type="button" class="small-button danger-button" data-stocktake-action="cancel">Batalkan</button>':stocktake.status==='pending_review'?'<button type="button" class="primary-button" data-stocktake-action="approve">Setujui</button><button type="button" class="small-button danger-button" data-stocktake-action="cancel">Batalkan</button>':stocktake.status==='approved'?'<button type="button" class="primary-button" data-stocktake-action="post">Posting ke ledger</button>':'';
  $('#stocktake-lines').innerHTML=stocktake.lines.length?stocktake.lines.map((line)=>{
    const editable=stocktake.status==='counting';
    const variance=Number(line.variance_qty_base??0);
    const detail=[line.lot_code?`Lot ${line.lot_code}`:'Tanpa lot',line.expiry_date?`Exp ${line.expiry_date}`:''].filter(Boolean).join(' · ');
    return `<tr data-stocktake-line="${escapeHtml(line.id)}"><td><strong>${escapeHtml(line.item_name)}</strong><small>${escapeHtml(line.sku)} · ${escapeHtml(detail)}</small></td><td>${formatQty(line.system_qty_base)} ${escapeHtml(line.base_uom_code)}</td><td><input class="stocktake-count-input" name="counted_qty_base" type="number" min="0" max="999999999999" step="0.000001" value="${line.counted_qty_base===null?'':escapeHtml(line.counted_qty_base)}" ${editable?'required':'disabled'} aria-label="Hasil hitung ${escapeHtml(line.item_name)}"></td><td class="ledger-quantity ${variance<0?'negative':variance>0?'positive':''}">${line.variance_qty_base===null?'Belum dihitung':`${variance>0?'+':''}${formatQty(variance)} ${escapeHtml(line.base_uom_code)}`}</td><td><input name="reason_code" maxlength="60" value="${escapeHtml(line.reason_code??'')}" ${editable?'':'disabled'} aria-label="Alasan selisih ${escapeHtml(line.item_name)}"></td><td><input name="notes" maxlength="500" value="${escapeHtml(line.notes??'')}" ${editable?'':'disabled'} aria-label="Catatan ${escapeHtml(line.item_name)}"></td><td>${editable?'<button type="button" class="small-button" data-save-stocktake-line>Simpan</button>':''}</td></tr>`;
  }).join(''):'<tr><td colspan="7" class="table-empty">Opname ini tidak memiliki item.</td></tr>';
}
async function loadStocktakes(){
  const body=$('#stocktake-body');
  body.innerHTML='<tr><td colspan="7" class="table-empty">Memuat stok opname…</td></tr>';
  try{
    const [result,locations]=await Promise.all([request('/admin/stocktakes?limit=100'),request('/admin/inventory/ledger?limit=1&offset=0')]);
    stocktakeRows=result.data??[];
    const select=$('#stocktake-location');const selected=select.value;
    select.innerHTML='<option value="">Pilih lokasi</option>'+(locations.locations??[]).map((location)=>`<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`).join('');
    if((locations.locations??[]).some((location)=>location.id===selected))select.value=selected;
    renderStocktakeList();
    if(selectedStocktakeId&&stocktakeRows.some((row)=>row.id===selectedStocktakeId))await openStocktake(selectedStocktakeId);
    else if(!stocktakeRows.length){selectedStocktakeId=null;$('#stocktake-detail-panel').classList.add('hidden');}
    $('#error-banner').classList.add('hidden');
  }catch(error){body.innerHTML=`<tr><td colspan="7" class="table-empty">${escapeHtml(error.message)}</td></tr>`;$('#error-banner').textContent=error.message;$('#error-banner').classList.remove('hidden');}
}
async function openStocktake(stocktakeId){
  try{const result=await request(`/admin/stocktakes/${encodeURIComponent(stocktakeId)}`);renderStocktakeDetail(result);}
  catch(error){showToast(error.message,true);}
}
const procurementStatusLabels={draft:'Draft',pending_approval:'Menunggu approval',approved:'Disetujui',sent:'Dikirim',partially_received:'Diterima sebagian',fully_received:'Diterima penuh',closed:'Ditutup',cancelled:'Dibatalkan',submitted:'Menunggu approval',rejected:'Ditolak',posted:'Diposting'};
function fillSelect(select,rows,placeholder,label){select.innerHTML=`<option value="">${placeholder}</option>`+rows.map((row)=>`<option value="${escapeHtml(row.id)}">${escapeHtml(label(row))}</option>`).join('');}
async function loadSuppliers(){
  try{const [supplierResult,itemResult]=await Promise.all([request('/procurement/suppliers?includeInactive=true&limit=100'),request('/procurement/inventory-items')]);suppliers=supplierResult.data??[];procurementItems=itemResult.data??[];
    $('#supplier-count').textContent=`${suppliers.length} supplier`;$('#supplier-list').innerHTML=suppliers.length?suppliers.map((s)=>`<div class="procurement-option ${s.id===selectedSupplierId?'selected':''}"><button type="button" class="procurement-option-select" data-supplier-id="${escapeHtml(s.id)}"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.code)} · ${Number(s.catalog_item_count)} item · ${s.is_active?'Aktif':'Nonaktif'}</small></button><button type="button" class="small-button" data-supplier-active="${escapeHtml(s.id)}" data-active="${s.is_active}">${s.is_active?'Nonaktifkan':'Aktifkan'}</button></div>`).join(''):'<p class="table-empty">Belum ada supplier.</p>';
    const itemSelect=$('#supplier-item-form').elements.inventory_item_id;fillSelect(itemSelect,procurementItems.filter((i)=>true),'Pilih item inventori',(i)=>`${i.name} · ${i.sku} (${i.base_uom_code})`);itemSelect.onchange=()=>{const item=procurementItems.find((i)=>i.id===itemSelect.value);const uom=$('#supplier-item-form').elements.purchase_uom_id;fillSelect(uom,item?.purchase_uoms??[],'Pilih UOM',(x)=>`${x.code} · ${x.name}`);};
    const form=$('#po-create-form');fillSelect(form.elements.supplier_id,suppliers.filter((s)=>s.is_active),'Pilih supplier',(s)=>`${s.name} (${s.code})`);await loadSupplierCatalog(selectedSupplierId);
  }catch(error){$('#supplier-list').innerHTML=`<p class="table-empty">${escapeHtml(error.message)}</p>`;showToast(`Data pengadaan: ${error.message}`,true);}
}
async function loadSupplierCatalog(supplierId){
  const panel=$('#supplier-catalog-panel');if(!supplierId){panel.classList.add('hidden');return;}selectedSupplierId=supplierId;panel.classList.remove('hidden');
  try{const result=await request(`/procurement/suppliers/${supplierId}/items`);$('#supplier-catalog-title').textContent=`Katalog · ${result.supplier.name}`;const body=$('#supplier-items-body');body.innerHTML=result.data.length?result.data.map((i)=>`<tr><td><strong>${escapeHtml(i.inventory_item_name)}</strong><small>${escapeHtml(i.sku)}</small></td><td>${escapeHtml(i.supplier_sku??'—')}</td><td>${escapeHtml(i.purchase_uom_code)}</td><td>${formatMoney(i.default_unit_price)}</td><td>${escapeHtml(i.minimum_order_qty??'—')}</td><td>${i.is_active?'Aktif':'Nonaktif'}${i.is_preferred?' · Utama':''}</td><td><button type="button" class="small-button" data-supplier-item-edit="${escapeHtml(i.inventory_item_id)}">Edit</button></td></tr>`).join(''):'<tr><td colspan="7" class="table-empty">Katalog masih kosong.</td></tr>';$('#supplier-list').querySelectorAll('[data-supplier-id]').forEach((b)=>b.classList.toggle('selected',b.dataset.supplierId===supplierId));}
  catch(error){showToast(error.message,true);}
}
async function loadPurchaseOrders(){
  try{const [result,supplierResult]=await Promise.all([request('/procurement/purchase-orders?limit=100'),request('/procurement/suppliers?limit=100')]);purchaseOrders=result.data??[];suppliers=supplierResult.data??[];$('#po-count').textContent=`${purchaseOrders.length} PO`;const form=$('#po-create-form');fillSelect(form.elements.supplier_id,suppliers,'Pilih supplier',(s)=>`${s.name} (${s.code})`);$('#po-body').innerHTML=purchaseOrders.length?purchaseOrders.map((po)=>`<tr><td><strong>${escapeHtml(po.po_number)}</strong></td><td>${escapeHtml(po.supplier_name)}</td><td><span class="stock-pill ${['cancelled','closed'].includes(po.status)?'inactive':po.status==='pending_approval'?'low':''}">${escapeHtml(procurementStatusLabels[po.status]??po.status)}</span></td><td>${formatMoney(po.total_amount)}</td><td>${new Date(po.ordered_at).toLocaleDateString('id-ID')}</td><td><button type="button" class="small-button" data-po-open="${escapeHtml(po.id)}">Detail</button></td></tr>`).join(''):'<tr><td colspan="6" class="table-empty">Belum ada purchase order.</td></tr>';}
  catch(error){$('#po-body').innerHTML=`<tr><td colspan="6" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}
}
function addPurchaseOrderLine(){const container=$('#po-create-lines');const row=document.createElement('fieldset');row.className='procurement-line po-create-line';row.innerHTML=`<legend>Item PO</legend><label>Item supplier<select name="inventory_item_id" required><option value="">Pilih supplier dan item</option></select></label><label>Jumlah<input name="quantity" type="number" min="0.000001" step="0.000001" required></label><label>Harga satuan (Rp)<input name="unit_price_purchase_uom" type="number" min="0" step="1" placeholder="Pakai harga katalog"></label><button class="small-button danger-button" type="button" data-remove-po-line>Hapus baris</button>`;container.append(row);const select=row.querySelector('[name="inventory_item_id"]');fillSelect(select,selectedSupplierCatalog,'Pilih item supplier',(item)=>`${item.inventory_item_name} · ${item.supplier_sku??item.sku} · ${item.purchase_uom_code} · ${formatMoney(item.default_unit_price)}`);select.querySelectorAll('option[value]').forEach((option)=>{const item=selectedSupplierCatalog.find((entry)=>entry.id===option.value);if(item){option.dataset.price=item.default_unit_price??'';option.dataset.uom=item.purchase_uom_id;option.dataset.inventoryItemId=item.inventory_item_id;}});}
async function openPurchaseOrder(id){try{const po=await request(`/procurement/purchase-orders/${id}`);selectedPoId=id;$('#po-detail-panel').classList.remove('hidden');$('#po-detail-title').textContent=po.po_number;$('#po-detail-copy').textContent=`${po.supplier_name} · ${procurementStatusLabels[po.status]??po.status} · total ${formatMoney(po.total_amount)}`;$('#po-lines').innerHTML=po.items.map((i)=>`<tr><td>${escapeHtml(i.description_snapshot)}<small>${escapeHtml(i.sku)}</small></td><td>${formatQty(i.quantity_ordered)} ${escapeHtml(i.purchase_uom_code)}</td><td>${formatQty(i.quantity_received_purchase_uom)}</td><td>${formatQty(i.quantity_outstanding_purchase_uom)}</td><td>${formatMoney(i.unit_price_purchase_uom)}</td><td>${formatMoney(i.line_total_amount)}</td></tr>`).join('');const actions={draft:['submit'],pending_approval:['approve','cancel'],approved:['send','cancel'],sent:['cancel'],partially_received:[],fully_received:['close']};$('#po-actions').innerHTML=(actions[po.status]??[]).map((a)=>`<button type="button" class="${a==='approve'?'primary-button':'small-button'}" data-po-action="${a}">${a==='submit'?'Kirim approval':a==='approve'?'Setujui':a==='send'?'Tandai dikirim':a==='close'?'Tutup PO':'Batalkan'}</button>`).join('');}
catch(error){showToast(error.message,true);}}
async function loadGoodsReceipts(){
  try{if(!procurementItems.length){const items=await request('/procurement/inventory-items');procurementItems=items.data??[];}const [result,poResult,locationResult]=await Promise.all([request('/procurement/goods-receipts?limit=100'),request('/procurement/purchase-orders?limit=100'),request('/admin/inventory/ledger?limit=1&offset=0')]);goodsReceipts=result.data??[];$('#gr-count').textContent=`${goodsReceipts.length} penerimaan`;const form=$('#gr-create-form');const eligible=(poResult.data??[]).filter((p)=>['sent','partially_received'].includes(p.status));fillSelect(form.elements.purchase_order_id,eligible,'Pilih PO yang dikirim',(p)=>`${p.po_number} · ${p.supplier_name}`);fillSelect(form.elements.stock_location_id,locationResult.locations??[],'Pilih lokasi stok',(l)=>`${l.name} (${l.code})`);$('#gr-body').innerHTML=goodsReceipts.length?goodsReceipts.map((gr)=>`<tr><td><strong>${escapeHtml(gr.receipt_number)}</strong></td><td>${escapeHtml(gr.po_number)}</td><td><span class="stock-pill ${gr.status==='posted'?'':'low'}">${escapeHtml(procurementStatusLabels[gr.status]??gr.status)}</span></td><td>${formatQty(gr.accepted_base_total)}</td><td>${new Date(gr.received_at).toLocaleString('id-ID')}</td><td><button class="small-button" type="button" data-gr-open="${escapeHtml(gr.id)}">Detail</button></td></tr>`).join(''):'<tr><td colspan="6" class="table-empty">Belum ada penerimaan.</td></tr>';}
  catch(error){$('#gr-body').innerHTML=`<tr><td colspan="6" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}
}
async function loadReceiptPoLines(poId){const container=$('#gr-lines');if(!poId){container.innerHTML='<p class="muted">Pilih PO untuk memuat item dan sisa jumlah yang dapat diterima.</p>';return;}try{const po=await request(`/procurement/purchase-orders/${poId}`);container.innerHTML=`<h3>${escapeHtml(po.po_number)} · ${escapeHtml(po.supplier_name)}</h3>`+po.items.filter((i)=>Number(i.quantity_outstanding_purchase_uom)>0).map((i)=>{const item=procurementItems.find((x)=>x.id===i.inventory_item_id);return `<fieldset class="procurement-line" data-po-line="${escapeHtml(i.id)}"><legend>${escapeHtml(i.description_snapshot)} · sisa ${formatQty(i.quantity_outstanding_purchase_uom)} ${escapeHtml(i.purchase_uom_code)}</legend><label>Diterima<input name="quantity_received" type="number" min="0.000001" max="${escapeHtml(i.quantity_outstanding_purchase_uom)}" step="0.000001" value="${escapeHtml(i.quantity_outstanding_purchase_uom)}" required></label><label>Ditolak<input name="quantity_rejected" type="number" min="0" step="0.000001" value="0"></label>${item?.track_lot?'<label>Kode lot<input name="lot_code" maxlength="100" required></label><label>Lot supplier<input name="supplier_lot_code" maxlength="100"></label>':''}${item?.track_expiry?'<label>Kedaluwarsa<input name="expiry_date" type="date" required></label>':''}<label class="rejection-reason">Alasan ditolak<input name="rejection_reason" maxlength="1000"></label></fieldset>`;}).join('')||'<p class="muted">PO sudah diterima seluruhnya.</p>';}
catch(error){container.innerHTML=`<p class="login-error">${escapeHtml(error.message)}</p>`;}}
async function openGoodsReceipt(id){try{const gr=await request(`/procurement/goods-receipts/${id}`);selectedReceiptId=id;$('#gr-detail-panel').classList.remove('hidden');$('#gr-detail-title').textContent=gr.receipt_number;$('#gr-detail-copy').textContent=`${gr.po_number} · ${gr.supplier_name} · ${procurementStatusLabels[gr.status]??gr.status}`;$('#gr-lines-detail').innerHTML=gr.items.map((i)=>`<tr><td>${escapeHtml(i.inventory_item_name)}<small>${escapeHtml(i.sku)}</small></td><td>${formatQty(i.quantity_received_purchase_uom)} ${escapeHtml(i.purchase_uom_code)}</td><td>${formatQty(i.quantity_rejected_purchase_uom)}</td><td>${formatQty(i.quantity_accepted_base)} base</td><td>${escapeHtml(i.received_lot_code??i.lot_code??'—')}${i.expiry_date?` · ${escapeHtml(i.expiry_date)}`:''}</td></tr>`).join('');const acts=gr.status==='draft'?['submit','delete']:gr.status==='submitted'?['approve','reject']:gr.status==='approved'?['post']:[];$('#gr-actions').innerHTML=acts.map((a)=>`<button class="${a==='approve'||a==='post'?'primary-button':'small-button'} ${a==='delete'?'danger-button':''}" type="button" data-gr-action="${a}">${a==='submit'?'Kirim approval':a==='approve'?'Setujui':a==='reject'?'Tolak':a==='delete'?'Hapus draft':'Posting stok'}</button>`).join('');}
catch(error){showToast(error.message,true);}}
function showPage(page){
  const pages=['dashboard','inventory','ledger','stocktakes','suppliers','purchase-orders','goods-receipts','menus','cashiers','sales','shifts'];
  if(!pages.includes(page))page='dashboard';
  pages.forEach((name)=>$(`#${name}-page`).classList.toggle('hidden',name!==page));
  $('#page-crumb').textContent=({dashboard:'Ringkasan',inventory:'Inventori',ledger:'Ledger stok',stocktakes:'Stok opname',suppliers:'Supplier', 'purchase-orders':'Purchase order','goods-receipts':'Penerimaan',menus:'Produk & BOM',cashiers:'Akun kasir',sales:'Penjualan',shifts:'Rekap shift'})[page];
  document.querySelectorAll('.admin-nav [data-page]').forEach((link)=>link.classList.toggle('active',link.dataset.page===page));
}
function localDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function setDefaultDates(formId){const form=$(formId);if(!form)return;const today=localDate();form.elements.from.value=today;form.elements.to.value=today;}
function ledgerFiltersFromForm(){const values=new FormData($('#ledger-filter'));const query=new URLSearchParams();for(const key of ['from','to','q','stock_location_id','movement_type']){const value=String(values.get(key)||'').trim();if(value)query.set(key,value);}return query;}
function cashierOptions(){return '<option value="">Semua kasir</option>'+cashiers.map((c)=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.full_name)} · ${escapeHtml(c.username)}</option>`).join('');}
async function loadCashiers(){
  const body=$('#cashier-body');if(body)body.innerHTML='<tr><td colspan="6" class="table-empty">Memuat akun…</td></tr>';
  try{const result=await request('/admin/cashiers');cashiers=result.data??[];
    for(const id of ['#sales-filter','#shift-filter']){const select=$(id)?.elements.cashier_id;if(select){const value=select.value;select.innerHTML=cashierOptions();select.value=value;}}
    if($('#cashier-count'))$('#cashier-count').textContent=`${cashiers.length} akun`;
    if(body)body.innerHTML=cashiers.length?cashiers.map((c)=>`<tr><td><strong>${escapeHtml(c.full_name)}</strong><small>@${escapeHtml(c.username)}</small></td><td><span class="stock-pill ${c.is_active?'':'inactive'}">${c.is_active?'Aktif':'Nonaktif'}</span></td><td>${c.last_login_at?escapeHtml(new Date(c.last_login_at).toLocaleString('id-ID')):'Belum pernah'}</td><td>${Number(c.completed_transactions)||0}</td><td>${c.open_shift_id?`<span class="stock-pill low">Aktif sejak ${escapeHtml(new Date(c.shift_opened_at).toLocaleString('id-ID'))}</span>`:'Tidak aktif'}</td><td><div class="row-actions"><button type="button" class="small-button" data-password="${escapeHtml(c.id)}" data-name="${escapeHtml(c.full_name)}">Atur password</button><button type="button" class="small-button ${c.is_active?'danger-button':''}" data-status="${escapeHtml(c.id)}" data-active="${c.is_active}" ${c.is_active&&c.open_shift_id?'disabled title="Tutup shift kasir terlebih dahulu"':''}>${c.is_active?'Nonaktifkan':'Aktifkan'}</button></div></td></tr>`).join(''):'<tr><td colspan="6" class="table-empty">Belum ada akun kasir.</td></tr>';
  }catch(error){if(body)body.innerHTML=`<tr><td colspan="6" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}
}
async function loadAdmins(){
  const body=$('#admin-body');
  body.innerHTML='<tr><td colspan="4" class="table-empty">Memuat akun admin…</td></tr>';
  try{
    const result=await request('/admin/admins');adminUsers=result.data??[];
    body.innerHTML=adminUsers.length?adminUsers.map((user)=>`<tr><td><strong>${escapeHtml(user.full_name)}</strong><small>@${escapeHtml(user.username)}</small></td><td><span class="stock-pill ${user.is_active?'':'inactive'}">${user.is_active?'Aktif':'Nonaktif'}</span></td><td>${user.last_login_at?escapeHtml(new Date(user.last_login_at).toLocaleString('id-ID')):'Belum pernah'}</td><td><div class="row-actions"><button type="button" class="small-button" data-password="${escapeHtml(user.id)}" data-name="${escapeHtml(user.full_name)}" data-entity="admins">Atur password</button>${user.id!==session.user.id?`<button type="button" class="small-button ${user.is_active?'danger-button':''}" data-admin-status="${escapeHtml(user.id)}" data-active="${user.is_active}">${user.is_active?'Nonaktifkan':'Aktifkan'}</button>`:'<span class="muted">Akun ini</span>'}</div></td></tr>`).join(''):'<tr><td colspan="4" class="table-empty">Belum ada akun admin.</td></tr>';
  }catch(error){body.innerHTML=`<tr><td colspan="4" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}
}
function queryFromForm(form){const values=new FormData(form);const p=new URLSearchParams();for(const key of ['from','to','cashier_id']){const value=String(values.get(key)||'');if(value)p.set(key,value);}return p;}
async function loadSales(){
  const body=$('#sales-body');body.innerHTML='<tr><td colspan="7" class="table-empty">Memuat laporan…</td></tr>';
  try{
    salesQuery=queryFromForm($('#sales-filter'));
    const result=await request(`/admin/sales?${salesQuery}`);const summary=result.summary;
    $('#sales-range-label').textContent=`${result.from} sampai ${result.to}`;
    $('#sales-row-count').textContent=`${result.data.length} baris`;
    $('#sales-metrics').innerHTML=[
      renderMetric('Transaksi lunas',summary.transaction_count,'Pembayaran berhasil'),
      renderMetric('Total pembayaran',formatMoney(summary.paid_amount),'Nilai pembayaran sukses'),
      renderMetric('Tunai diterima',formatMoney(summary.cash_received_amount),'Termasuk uang kembalian'),
      renderMetric('Kembalian',formatMoney(summary.cash_change_amount),'Diberikan ke pelanggan')
    ].join('');
    body.innerHTML=result.data.length?result.data.map((row)=>`<tr>
      <td>${escapeHtml(new Date(row.confirmed_at).toLocaleString('id-ID'))}</td>
      <td><strong>${escapeHtml(row.order_number)}</strong><small>${escapeHtml(row.payment_number)}</small></td>
      <td>${escapeHtml(row.cashier_name)}</td><td>${escapeHtml(row.method)}</td>
      <td>${escapeHtml(row.order_type)}${row.table_label?`<small>${escapeHtml(row.table_label)}</small>`:''}</td>
      <td><strong>${formatQty(Number(row.item_quantity))} unit</strong><small>${escapeHtml(row.item_summary||'').replaceAll('\n','<br>')}</small></td>
      <td><strong>${formatMoney(row.amount)}</strong>${row.method==='cash'?`<small>Terima ${formatMoney(row.cash_received_amount)} · Kembali ${formatMoney(row.cash_change_amount)}</small>`:''}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="table-empty">Tidak ada pembayaran pada rentang ini.</td></tr>';
    $('#error-banner').classList.add('hidden');
  }catch(error){body.innerHTML=`<tr><td colspan="7" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}
}
async function loadShifts(){const body=$('#shift-body');body.innerHTML='<tr><td colspan="12" class="table-empty">Memuat rekap shift…</td></tr>';try{const p=queryFromForm($('#shift-filter'));const result=await request(`/admin/shifts?${p}`);const s=result.summary;$('#shift-range-label').textContent=`${result.from} sampai ${result.to}`;$('#shift-row-count').textContent=`${result.data.length} shift`;$('#shift-metrics').innerHTML=[renderMetric('Jumlah shift',s.total,'Pada rentang terpilih'),renderMetric('Masih terbuka',s.open,'Belum direkonsiliasi'),renderMetric('Sudah ditutup',s.closed,'Kasir menyelesaikan shift'),renderMetric('Total selisih',formatMoney(s.total_variance),'Akumulasi shift yang ditutup')].join('');body.innerHTML=result.data.length?result.data.map((r)=>`<tr><td><strong>${escapeHtml(r.cashier_name)}</strong></td><td><span class="stock-pill ${r.status==='open'?'low':''}">${r.status==='open'?'Terbuka':'Ditutup'}</span></td><td>${escapeHtml(new Date(r.opened_at).toLocaleString('id-ID'))}</td><td>${r.closed_at?escapeHtml(new Date(r.closed_at).toLocaleString('id-ID')):'—'}</td><td>${formatMoney(r.opening_cash_amount)}</td><td>${formatMoney(r.cash_in_amount)}</td><td>${formatMoney(r.cash_out_amount)}</td><td>${formatMoney(r.cash_sales_amount)}</td><td>${formatMoney(r.expected_cash_amount)}</td><td>${r.closing_cash_amount==null?'—':formatMoney(r.closing_cash_amount)}</td><td>${r.variance_amount==null?'—':`<strong>${formatMoney(r.variance_amount)}</strong>`}</td><td class="shift-note-cell">${r.closing_note?escapeHtml(r.closing_note):'—'}</td></tr>`).join(''):'<tr><td colspan="12" class="table-empty">Belum ada shift pada rentang ini.</td></tr>';$('#error-banner').classList.add('hidden');}catch(error){body.innerHTML=`<tr><td colspan="12" class="table-empty">${escapeHtml(error.message)}</td></tr>`;}}
async function loadDashboard(){
  try{const result=await request('/admin/dashboard');renderDashboard(result.data);}
  catch(error){$('#error-banner').textContent=error.status===403?'Akun ini belum memiliki izin admin.dashboard.read. Minta admin memberikan akses dashboard.':error.message;$('#error-banner').classList.remove('hidden');$('#metric-grid').innerHTML='';}
}
async function loadInventory(query=''){
  const body=$('#inventory-body');body.innerHTML='<tr><td colspan="8" class="table-empty">Memuat inventori…</td></tr>';
  try{
    const params=new URLSearchParams();if(query.trim())params.set('q',query.trim());
    const result=await request(`/admin/inventory${params.size?`?${params}`:''}`);inventoryRows=result.data??[];
    const categories=[...new Set(inventoryRows.map((item)=>item.category_name??'Tanpa kategori'))].sort((a,b)=>a.localeCompare(b,'id')).map((name)=>({value:name,label:name}));
    const locations=[...new Map(inventoryRows.flatMap((item)=>item.stock_by_location.map((location)=>[location.id,{value:location.id,label:location.name}]))).values()].sort((a,b)=>a.label.localeCompare(b.label,'id'));
    populateInventoryFilter('#inventory-category-filter',categories,'Semua kategori');
    populateInventoryFilter('#inventory-location-filter',locations,'Semua lokasi');
    renderInventory();$('#error-banner').classList.add('hidden');
  }
  catch(error){body.innerHTML=`<tr><td colspan="8" class="table-empty">${escapeHtml(error.message)}</td></tr>`;$('#error-banner').textContent=error.status===403?'Akun ini belum memiliki izin admin.inventory.read. Minta admin memberikan akses inventori.':error.message;$('#error-banner').classList.remove('hidden');}
}
const movementLabels={opening_balance:'Saldo awal',goods_receipt:'Barang masuk',sale_consumption:'Konsumsi POS',waste:'Waste',adjustment_in:'Koreksi masuk',adjustment_out:'Koreksi keluar',transfer_in:'Transfer masuk',transfer_out:'Transfer keluar',return_to_stock:'Retur ke stok',stocktake_in:'Opname masuk',stocktake_out:'Opname keluar'};
function localDateOffset(days){const date=new Date();date.setDate(date.getDate()+days);return localDate(date);}
function setLedgerDefaults(){const form=$('#ledger-filter');if(!form.elements.from.value)form.elements.from.value=localDateOffset(-29);if(!form.elements.to.value)form.elements.to.value=localDate();}
function renderLedger(append=false){
  const body=$('#ledger-body');
  const rows=ledgerRows;
  if(!rows.length){body.innerHTML='<tr><td colspan="8" class="table-empty">Tidak ada pergerakan stok pada filter ini.</td></tr>';}
  else {
    const html=rows.map((row)=>{
      const amount=Number(row.quantity_delta_base);
      const source=row.source_id?`${row.source_type} · ${row.source_id.slice(0,8)}`:row.source_type;
      const reason=row.reason?`<small>${escapeHtml(row.reason)}</small>`:'';
      return `<tr><td>${escapeHtml(new Date(row.occurred_at).toLocaleString('id-ID'))}</td><td><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.sku)}</small></td><td><span class="stock-pill ${amount<0?'low':''}">${escapeHtml(movementLabels[row.movement_type]??row.movement_type)}</span></td><td class="ledger-quantity ${amount<0?'negative':'positive'}"><strong>${amount>0?'+':''}${formatQty(amount)} ${escapeHtml(row.base_uom_code)}</strong></td><td class="ledger-quantity"><strong>${formatQty(Number(row.balance_after_base))} ${escapeHtml(row.base_uom_code)}</strong></td><td>${escapeHtml(row.stock_location_name)}${row.lot_code?`<small>Lot ${escapeHtml(row.lot_code)}${row.expiry_date?` · Exp ${escapeHtml(row.expiry_date)}`:''}</small>`:''}</td><td>${escapeHtml(source)}${reason}</td><td>${escapeHtml(row.actor_name??'Sistem')}</td></tr>`;
    }).join('');
    if(append)body.insertAdjacentHTML('beforeend',html);else body.innerHTML=html;
  }
  $('#ledger-count').textContent=`${ledgerTotal.toLocaleString('id-ID')} pergerakan`;
  $('#ledger-footnote').textContent=`Menampilkan ${rows.length.toLocaleString('id-ID')} dari ${ledgerTotal.toLocaleString('id-ID')} pergerakan · terbaru lebih dahulu.`;
  $('#ledger-more').classList.toggle('hidden',rows.length>=ledgerTotal);
}
async function loadLedger({append=false}={}){
  const body=$('#ledger-body');if(!append)body.innerHTML='<tr><td colspan="8" class="table-empty">Memuat ledger…</td></tr>';
  const offset=append?ledgerRows.length:0;
  const params=new URLSearchParams(ledgerQuery);params.set('limit','100');params.set('offset',String(offset));
  try{
    const result=await request(`/admin/inventory/ledger?${params}`);
    if(!append){ledgerRows=[];}
    ledgerRows.push(...(result.data??[]));ledgerTotal=result.total??0;
    const location=$('#ledger-filter').elements.stock_location_id;const selected=location.value;
    location.innerHTML='<option value="">Semua lokasi</option>'+(result.locations??[]).map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');location.value=selected;
    renderLedger(append);$('#error-banner').classList.add('hidden');
  }catch(error){if(!append)body.innerHTML=`<tr><td colspan="8" class="table-empty">${escapeHtml(error.message)}</td></tr>`;$('#error-banner').textContent=error.status===403?'Akun ini belum memiliki izin admin.inventory.read. Minta admin memberikan akses inventori.':error.message;$('#error-banner').classList.remove('hidden');}
}
async function downloadCsv(path,query,button,filename,message){
  const originalText=button.textContent;button.disabled=true;button.textContent='Menyiapkan…';
  try{
    let response;
    try{response=await fetch(`${API}${path}?${query}`,{headers:{accept:'text/csv'}});}
    catch(error){if(error instanceof TypeError)throw new Error('Tidak dapat terhubung ke server. Pastikan backend aktif, lalu coba lagi.');throw error;}
    if(!response.ok){let data=null;try{data=await response.json();}catch{}throw new Error(data?.error?.message??`Ekspor gagal (${response.status}).`);}
    const blob=await response.blob();const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
    anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast(message);
  }catch(error){showToast(error.message,true);}
  finally{button.disabled=false;button.textContent=originalText;}
}
function exportLedger(){return downloadCsv('/admin/inventory/ledger/export',new URLSearchParams(ledgerQuery),$('#ledger-export'),'gcims-ledger.csv','Ledger berhasil diunduh sesuai filter aktif.');}
function exportSales(){const query=new URLSearchParams(salesQuery);if(!query.has('from')||!query.has('to')){showToast('Terapkan rentang tanggal sebelum mengunduh laporan.',true);return;}return downloadCsv('/admin/sales/export',query,$('#sales-export'),`gcims-penjualan-${query.get('from')}-${query.get('to')}.csv`,'Laporan penjualan berhasil diunduh sesuai filter aktif.');}
function exportShifts(){const form=$('#shift-filter');if(!form.reportValidity())return;const query=queryFromForm(form);return downloadCsv('/admin/shifts/export',query,$('#shift-export'),`gcims-rekap-shift-${query.get('from')}-${query.get('to')}.csv`,'Rekap shift berhasil diunduh sesuai filter aktif.');}
async function startApp(){
  session=session??{};
  try{
    const identity=await request('/auth/me');
    if(!(identity.permissions??[]).includes('admin.dashboard.read')){location.replace('/pos');return;}
    adminPermissions=identity.permissions??[];
    session.csrfToken=identity.csrf_token;
    $('#menu-add-button').classList.toggle('hidden',!adminPermissions.includes('admin.menu.update'));
    session.user=identity.user??session.user;
  }catch(error){if(error.status!==401)showLogin(error.message||'Sesi admin tidak valid. Silakan masuk kembali.');return;}
  $('#login-screen').classList.add('hidden');$('.admin-shell').classList.remove('hidden');
  $('#user-name').textContent=session.user?.full_name??'Admin';$('#user-avatar').textContent=[...(session.user?.full_name??'A')][0]?.toUpperCase()??'A';
  const now=new Date();$('#today-label').textContent=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium'}).format(now);$('#today-chip').textContent=new Intl.DateTimeFormat('id-ID',{dateStyle:'full'}).format(now);
  const page=location.pathname.split('/')[2]||'dashboard';showPage(page);
  if(page==='dashboard')await loadDashboard();else if(page==='inventory')await loadInventory();else if(page==='ledger'){setLedgerDefaults();ledgerQuery=ledgerFiltersFromForm();await loadLedger();}else if(page==='stocktakes')await loadStocktakes();else if(page==='suppliers')await loadSuppliers();else if(page==='purchase-orders')await loadPurchaseOrders();else if(page==='goods-receipts')await loadGoodsReceipts();else if(page==='menus')await loadMenus();else{await loadCashiers();if(page==='cashiers')await loadAdmins();if(page==='sales')await loadSales();if(page==='shifts')await loadShifts();}
}
async function login(event){
  event.preventDefault();const form=new FormData(event.currentTarget);const submit=event.currentTarget.querySelector('button');submit.disabled=true;submit.textContent='Memeriksa akun…';
  try{const result=await request('/auth/login',{method:'POST',auth:false,body:{username:String(form.get('username')).trim(),password:String(form.get('password'))}});session={csrfToken:result.csrf_token,user:result.user,scope:result.scope};await startApp();}
  catch(error){$('#login-error').textContent=error.message;$('#login-error').classList.remove('hidden');}
  finally{submit.disabled=false;submit.innerHTML='Masuk <span>→</span>';}
}
$('#login-form').addEventListener('submit',login);
$('#logout-button').addEventListener('click',async()=>{try{await request('/auth/logout',{method:'POST'});session=null;location.href='/';}catch(error){showToast(`Keluar gagal: ${error.message}`,true);}});
$('#inventory-search').addEventListener('input',(event)=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadInventory(event.target.value),250);});
for(const selector of ['#inventory-category-filter','#inventory-location-filter','#inventory-status-filter','#inventory-expiry-filter','#inventory-sort'])$(selector).addEventListener('change',renderInventory);
function loadPageData(page){if(page==='dashboard')return loadDashboard();if(page==='inventory')return loadInventory();if(page==='ledger'){setLedgerDefaults();ledgerQuery=ledgerFiltersFromForm();return loadLedger();}if(page==='stocktakes')return loadStocktakes();if(page==='suppliers')return loadSuppliers();if(page==='purchase-orders')return loadPurchaseOrders();if(page==='goods-receipts')return loadGoodsReceipts();if(page==='menus')return loadMenus();if(['cashiers','sales','shifts'].includes(page))return loadCashiers().then(()=>{if(page==='cashiers')return loadAdmins();if(page==='sales'){setDefaultDates('#sales-filter');return loadSales();}if(page==='shifts'){setDefaultDates('#shift-filter');return loadShifts();}});}
document.querySelectorAll('.admin-nav [data-page]').forEach((link)=>link.addEventListener('click',(event)=>{event.preventDefault();const page=link.dataset.page;history.pushState({},'',link.href);showPage(page);loadPageData(page);}));
window.addEventListener('popstate',()=>{const page=location.pathname.split('/')[2]||'dashboard';showPage(page);loadPageData(page);});
$('#menu-search').addEventListener('input',(event)=>renderMenuList(event.target.value));
$('#admin-menu-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-menu-select]');if(!button)return;selectedMenuId=button.dataset.menuSelect;renderMenuList($('#menu-search').value);renderMenuDetail(selectedMenuId);});
$('#menu-detail').addEventListener('click',async(event)=>{const recipeButton=event.target.closest('[data-edit-recipe]');const deleteButton=event.target.closest('[data-delete-menu]');if(recipeButton){openRecipeEditor(recipeButton.dataset.editRecipe);return;}if(deleteButton){const selected=adminMenus.find((row)=>row.menu_id===deleteButton.dataset.deleteMenu);if(!selected||!confirm(`Hapus ${selected.menu_name} dari katalog? Menu yang sudah pernah terjual akan diarsipkan agar riwayat tetap utuh.`))return;deleteButton.disabled=true;try{const result=await request(`/admin/menus/${deleteButton.dataset.deleteMenu}`,{method:'DELETE'});showToast(result.archived?'Menu diarsipkan; riwayat transaksi tetap tersimpan.':'Menu dihapus.');await loadMenus();}catch(error){showToast(error.message,true);deleteButton.disabled=false;}}});
$('#recipe-add-line').addEventListener('click',()=>addRecipeLine());
$('#recipe-close').addEventListener('click',()=>$('#recipe-dialog').classList.add('hidden'));
$('#recipe-dialog').addEventListener('click',(event)=>{if(event.target.id==='recipe-dialog')$('#recipe-dialog').classList.add('hidden');});
$('#menu-add-button').addEventListener('click',openMenuCreate);
$('#menu-create-add-line').addEventListener('click',()=>addRecipeLine(null,'#new-menu-lines'));
$('#menu-create-form').elements.product_type.addEventListener('change',syncProductTypeFields);
$('#menu-create-form').elements.retail_inventory_item_id.addEventListener('change',(event)=>{const option=event.target.selectedOptions[0];if(!option?.value)return;const form=$('#menu-create-form');if(!form.elements.code.value)form.elements.code.value=option.dataset.sku??'';if(!form.elements.name.value)form.elements.name.value=option.dataset.name??'';});
$('#menu-create-close').addEventListener('click',()=>$('#menu-create-dialog').classList.add('hidden'));
$('#menu-create-dialog').addEventListener('click',(event)=>{if(event.target.id==='menu-create-dialog')$('#menu-create-dialog').classList.add('hidden');});
$('#menu-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const productType=String(values.get('product_type'));const items=productType==='prepared'?[...form.querySelectorAll('.recipe-line')].map((line)=>({inventory_item_id:line.querySelector('[name="inventory_item_id"]').value,quantity_base:line.querySelector('[name="quantity_base"]').value,preparation_note:line.querySelector('[name="preparation_note"]').value})):undefined;const error=$('#menu-create-error');error.classList.add('hidden');const button=form.querySelector('[type="submit"]');button.disabled=true;try{const body={code:values.get('code'),name:values.get('name'),category_id:values.get('category_id'),price_amount:values.get('price_amount'),product_type:productType};if(productType==='retail'){body.retail_inventory_item_id=values.get('retail_inventory_item_id');body.retail_quantity_base=values.get('retail_quantity_base');}else body.items=items;const result=await request('/admin/menus',{method:'POST',body});$('#menu-create-dialog').classList.add('hidden');showToast(`Produk ${result.menu.name} berhasil dibuat.`);await loadMenus();selectedMenuId=result.menu.id;renderMenuList($('#menu-search').value);renderMenuDetail(selectedMenuId);}catch(err){error.textContent=err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#recipe-form').addEventListener('submit',async(event)=>{event.preventDefault();if(!editingVariantId)return;const form=event.currentTarget;const items=[...form.querySelectorAll('.recipe-line')].map((line)=>({inventory_item_id:line.querySelector('[name="inventory_item_id"]').value,quantity_base:line.querySelector('[name="quantity_base"]').value,preparation_note:line.querySelector('[name="preparation_note"]').value}));const error=$('#recipe-error');error.classList.add('hidden');const button=form.querySelector('[type="submit"]');button.disabled=true;try{const result=await request(`/admin/menus/${editingVariantId}/recipe`,{method:'PUT',body:{items}});$('#recipe-dialog').classList.add('hidden');showToast(`Resep versi ${result.version_no} berhasil disimpan.`);await loadMenus();}catch(err){error.textContent=err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#cashier-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');const values=new FormData(form);const error=$('#cashier-form-error');error.classList.add('hidden');button.disabled=true;try{await request('/admin/cashiers',{method:'POST',body:{full_name:values.get('full_name'),username:values.get('username'),password:values.get('password')}});form.reset();showToast('Akun kasir berhasil dibuat.');await loadCashiers();}catch(err){error.textContent=err.requestId?`${err.message} ID laporan: ${err.requestId}. Cek log terminal backend.`:err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#cashier-body').addEventListener('click',async(event)=>{const passwordButton=event.target.closest('[data-password]');const statusButton=event.target.closest('[data-status]');if(passwordButton){resetCashier={id:passwordButton.dataset.password,name:passwordButton.dataset.name,entity:'cashiers'};$('#password-user-label').textContent=`Akun: ${resetCashier.name}`;$('#password-form').reset();$('#password-error').classList.add('hidden');$('#password-dialog').classList.remove('hidden');$('#password-form').elements.password.focus();return;}if(statusButton){const active=statusButton.dataset.active==='true';if(active&&!confirm('Nonaktifkan akun kasir ini?'))return;statusButton.disabled=true;try{await request(`/admin/cashiers/${statusButton.dataset.status}/status`,{method:'PATCH',body:{is_active:!active}});showToast(`Akun kasir ${active?'dinonaktifkan':'diaktifkan'}.`);await loadCashiers();}catch(err){showToast(err.message,true);statusButton.disabled=false;}}});
$('#admin-body').addEventListener('click',async(event)=>{const passwordButton=event.target.closest('[data-password]');const statusButton=event.target.closest('[data-admin-status]');if(passwordButton){resetCashier={id:passwordButton.dataset.password,name:passwordButton.dataset.name,entity:'admins'};$('#password-user-label').textContent=`Akun: ${resetCashier.name}`;$('#password-form').reset();$('#password-error').classList.add('hidden');$('#password-dialog').classList.remove('hidden');$('#password-form').elements.password.focus();return;}if(statusButton){const active=statusButton.dataset.active==='true';if(active&&!confirm('Nonaktifkan akun admin ini? Sesi yang sedang aktif akan dicabut.'))return;statusButton.disabled=true;try{await request(`/admin/admins/${statusButton.dataset.adminStatus}/status`,{method:'PATCH',body:{is_active:!active}});showToast(`Akun admin ${active?'dinonaktifkan':'diaktifkan'}.`);await loadAdmins();}catch(error){showToast(error.message,true);statusButton.disabled=false;}}});
$('#admin-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const button=form.querySelector('[type="submit"]');const error=$('#admin-form-error');button.disabled=true;error.classList.add('hidden');try{await request('/admin/admins',{method:'POST',body:{full_name:values.get('full_name'),username:values.get('username'),password:values.get('password')}});form.reset();showToast('Akun admin berhasil dibuat.');await loadAdmins();}catch(err){error.textContent=err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#password-close').addEventListener('click',()=>$('#password-dialog').classList.add('hidden'));
$('#password-dialog').addEventListener('click',(event)=>{if(event.target.id==='password-dialog')$('#password-dialog').classList.add('hidden');});
$('#password-form').addEventListener('submit',async(event)=>{event.preventDefault();if(!resetCashier)return;const button=event.currentTarget.querySelector('button[type="submit"]');const error=$('#password-error');button.disabled=true;error.classList.add('hidden');try{await request(`/admin/${resetCashier.entity??'cashiers'}/${resetCashier.id}/password`,{method:'POST',body:{password:new FormData(event.currentTarget).get('password')}});$('#password-dialog').classList.add('hidden');showToast(`Password akun ${resetCashier.entity==='admins'?'admin':'kasir'} berhasil diatur ulang. Sesi lama dicabut.`);if(resetCashier.entity==='admins')await loadAdmins();else await loadCashiers();}catch(err){error.textContent=err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#sales-filter').addEventListener('submit',(event)=>{event.preventDefault();loadSales();});
$('#shift-filter').addEventListener('submit',(event)=>{event.preventDefault();loadShifts();});
$('#ledger-filter').addEventListener('submit',(event)=>{event.preventDefault();ledgerQuery=ledgerFiltersFromForm();loadLedger();});
$('#ledger-more').addEventListener('click',()=>loadLedger({append:true}));
$('#ledger-export').addEventListener('click',exportLedger);
$('#sales-export').addEventListener('click',exportSales);
$('#shift-export').addEventListener('click',exportShifts);
$('#stocktake-create-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=event.currentTarget;const button=form.querySelector('[type="submit"]');const values=new FormData(form);button.disabled=true;
  try{const result=await request('/admin/stocktakes',{method:'POST',body:{stock_location_id:values.get('stock_location_id'),notes:values.get('notes')||null}});selectedStocktakeId=result.id;showToast(`Opname ${result.stocktake_number} dimulai.`);await loadStocktakes();}
  catch(error){showToast(error.message,true);}
  finally{button.disabled=false;}
});
$('#stocktake-body').addEventListener('click',(event)=>{const button=event.target.closest('[data-stocktake-id]');if(button)openStocktake(button.dataset.stocktakeId);});
$('#stocktake-lines').addEventListener('click',async(event)=>{
  const button=event.target.closest('[data-save-stocktake-line]');if(!button||!selectedStocktakeId)return;
  const row=button.closest('[data-stocktake-line]');const body={counted_qty_base:row.querySelector('[name="counted_qty_base"]').value,reason_code:row.querySelector('[name="reason_code"]').value.trim()||null,notes:row.querySelector('[name="notes"]').value.trim()||null};
  button.disabled=true;
  try{const result=await request(`/admin/stocktakes/${selectedStocktakeId}/items/${row.dataset.stocktakeLine}`,{method:'PUT',body});renderStocktakeDetail(result);showToast('Hitungan disimpan.');await loadStocktakes();}
  catch(error){showToast(error.message,true);button.disabled=false;}
});
$('#stocktake-actions').addEventListener('click',async(event)=>{
  const button=event.target.closest('[data-stocktake-action]');if(!button||!selectedStocktakeId)return;
  const action=button.dataset.stocktakeAction;
  let body;
  if(action==='cancel'){const reason=prompt('Alasan membatalkan stok opname:');if(reason===null)return;if(reason.trim().length<2){showToast('Alasan minimal 2 karakter.',true);return;}body={reason:reason.trim()};}
  button.disabled=true;
  try{const result=await request(`/admin/stocktakes/${selectedStocktakeId}/${action}`,{method:'POST',body});renderStocktakeDetail(result);showToast(action==='post'?'Selisih masuk ke ledger.':`Stok opname ${stocktakeStatusLabels[result.status]?.toLowerCase()??'diperbarui'}.`);await loadStocktakes();}
  catch(error){showToast(error.message,true);button.disabled=false;}
});
function resetSupplierForm(){editingSupplierId=null;const form=$('#supplier-create-form');form.reset();$('#supplier-form-title').textContent='Tambah supplier';form.querySelector('[type="submit"]').textContent='Simpan supplier';$('#supplier-form-reset').classList.add('hidden');}
$('#supplier-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const button=form.querySelector('[type="submit"]');const error=$('#supplier-form-error');error.classList.add('hidden');button.disabled=true;try{const body={code:values.get('code'),name:values.get('name'),contact_name:values.get('contact_name')||null,email:values.get('email')||null,phone:values.get('phone')||null,payment_terms:values.get('payment_terms')||null};await request(editingSupplierId?`/procurement/suppliers/${editingSupplierId}`:'/procurement/suppliers',{method:editingSupplierId?'PATCH':'POST',body});showToast(editingSupplierId?'Supplier diperbarui.':'Supplier ditambahkan.');resetSupplierForm();await loadSuppliers();}catch(err){error.textContent=err.message;error.classList.remove('hidden');}finally{button.disabled=false;}});
$('#supplier-form-reset').addEventListener('click',resetSupplierForm);
$('#supplier-list').addEventListener('click',async(event)=>{const select=event.target.closest('[data-supplier-id]');const active=event.target.closest('[data-supplier-active]');if(select){await loadSupplierCatalog(select.dataset.supplierId);const supplier=suppliers.find((s)=>s.id===select.dataset.supplierId);if(supplier){editingSupplierId=supplier.id;const form=$('#supplier-create-form');for(const key of ['code','name','contact_name','email','phone','payment_terms'])form.elements[key].value=supplier[key]??'';$('#supplier-form-title').textContent=`Edit supplier · ${supplier.name}`;form.querySelector('[type="submit"]').textContent='Simpan perubahan';$('#supplier-form-reset').classList.remove('hidden');}return;}if(active){const supplier=suppliers.find((s)=>s.id===active.dataset.supplierActive);if(!supplier)return;try{await request(`/procurement/suppliers/${supplier.id}`,{method:'PATCH',body:{is_active:active.dataset.active!=='true'}});showToast(`Supplier ${active.dataset.active==='true'?'dinonaktifkan':'diaktifkan'}.`);await loadSuppliers();}catch(error){showToast(error.message,true);}}});
$('#supplier-items-body').addEventListener('click',(event)=>{const button=event.target.closest('[data-supplier-item-edit]');if(!button)return;request(`/procurement/suppliers/${selectedSupplierId}/items`).then((result)=>{const item=result.data.find((row)=>row.inventory_item_id===button.dataset.supplierItemEdit);if(!item)return;const form=$('#supplier-item-form');form.elements.inventory_item_id.value=item.inventory_item_id;form.elements.inventory_item_id.dispatchEvent(new Event('change'));setTimeout(()=>{form.elements.purchase_uom_id.value=item.purchase_uom_id;form.elements.supplier_sku.value=item.supplier_sku??'';form.elements.default_unit_price.value=item.default_unit_price??'';form.elements.minimum_order_qty.value=item.minimum_order_qty??'';form.elements.is_preferred.checked=item.is_preferred;form.elements.is_active.checked=item.is_active;},0);}).catch((error)=>showToast(error.message,true));});
$('#supplier-item-form').addEventListener('submit',async(event)=>{event.preventDefault();if(!selectedSupplierId)return;const form=event.currentTarget;const values=new FormData(form);const price=values.get('default_unit_price');const minimum=values.get('minimum_order_qty');const button=form.querySelector('[type="submit"]');button.disabled=true;try{await request(`/procurement/suppliers/${selectedSupplierId}/items/${values.get('inventory_item_id')}`,{method:'PUT',body:{supplier_sku:values.get('supplier_sku')||null,purchase_uom_id:values.get('purchase_uom_id'),default_unit_price:price===''?null:Number(price),minimum_order_qty:minimum===''?null:minimum,is_preferred:form.elements.is_preferred.checked,is_active:form.elements.is_active.checked}});showToast('Katalog supplier diperbarui.');await loadSupplierCatalog(selectedSupplierId);await loadSuppliers();}catch(error){showToast(error.message,true);}finally{button.disabled=false;}});
$('#po-create-form').elements.supplier_id.addEventListener('change',async(event)=>{selectedSupplierCatalog=[];$('#po-create-lines').innerHTML='';if(!event.target.value)return;try{const result=await request(`/procurement/suppliers/${event.target.value}/items`);selectedSupplierCatalog=result.data.filter((item)=>item.is_active);addPurchaseOrderLine();}catch(error){showToast(error.message,true);}});
$('#po-add-line').addEventListener('click',()=>{if(!selectedSupplierCatalog.length){showToast('Pilih supplier yang memiliki item aktif di katalognya.',true);return;}addPurchaseOrderLine();});
$('#po-create-lines').addEventListener('change',(event)=>{if(event.target.name!=='inventory_item_id')return;const option=event.target.selectedOptions[0];const price=event.target.closest('.po-create-line').querySelector('[name="unit_price_purchase_uom"]');price.value=option?.dataset.price??'';});
$('#po-create-lines').addEventListener('click',(event)=>{const button=event.target.closest('[data-remove-po-line]');if(button){const lines=$('#po-create-lines').querySelectorAll('.po-create-line');if(lines.length===1){showToast('PO minimal memiliki satu item.',true);return;}button.closest('.po-create-line').remove();}});
$('#po-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const lines=[...$('#po-create-lines').querySelectorAll('.po-create-line')].map((row)=>{const entry=selectedSupplierCatalog.find((item)=>item.id===row.querySelector('[name="inventory_item_id"]').value);const price=row.querySelector('[name="unit_price_purchase_uom"]').value;return entry?{inventory_item_id:entry.inventory_item_id,purchase_uom_id:entry.purchase_uom_id,quantity:row.querySelector('[name="quantity"]').value,...(price===''?{}:{unit_price_purchase_uom:Number(price)})}:null;}).filter(Boolean);if(!lines.length||lines.length!==$('#po-create-lines').querySelectorAll('.po-create-line').length){showToast('Pilih item untuk setiap baris PO.',true);return;}const button=form.querySelector('[type="submit"]');button.disabled=true;try{const body={supplier_id:values.get('supplier_id'),expected_at:values.get('expected_at')?new Date(`${values.get('expected_at')}T12:00:00`).toISOString():null,notes:values.get('notes')||null,lines};const fingerprint=JSON.stringify(body);if(poIdempotency?.fingerprint!==fingerprint)poIdempotency={fingerprint,key:crypto.randomUUID()};const result=await request('/procurement/purchase-orders',{method:'POST',body,headers:{'idempotency-key':poIdempotency.key}});poIdempotency=null;showToast(`PO ${result.po_number} dibuat.`);form.reset();$('#po-create-lines').innerHTML='';selectedSupplierCatalog=[];await loadPurchaseOrders();await openPurchaseOrder(result.id);}catch(error){showToast(error.message,true);}finally{button.disabled=false;}});
$('#po-body').addEventListener('click',(event)=>{const button=event.target.closest('[data-po-open]');if(button)openPurchaseOrder(button.dataset.poOpen);});
$('#po-actions').addEventListener('click',async(event)=>{const button=event.target.closest('[data-po-action]');if(!button||!selectedPoId)return;const action=button.dataset.poAction;if(action==='cancel'&&!confirm('Batalkan purchase order ini?'))return;button.disabled=true;try{await request(`/procurement/purchase-orders/${selectedPoId}/${action}`,{method:'POST'});showToast(`Purchase order ${procurementStatusLabels[action==='submit'?'pending_approval':action==='approve'?'approved':action==='send'?'sent':action==='close'?'closed':'cancelled']}.`);await loadPurchaseOrders();await openPurchaseOrder(selectedPoId);}catch(error){showToast(error.message,true);button.disabled=false;}});
$('#gr-create-form').elements.purchase_order_id.addEventListener('change',(event)=>loadReceiptPoLines(event.target.value));
$('#gr-create-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const lines=[...$('#gr-lines').querySelectorAll('[data-po-line]')].map((row)=>({row,purchase_order_item_id:row.dataset.poLine,quantity_received:row.querySelector('[name="quantity_received"]')?.value,quantity_rejected:row.querySelector('[name="quantity_rejected"]')?.value||'0'})).filter((line)=>line.quantity_received&&Number(line.quantity_received)>0).map((line)=>({...line,lot_code:line.row.querySelector('[name="lot_code"]')?.value||null,supplier_lot_code:line.row.querySelector('[name="supplier_lot_code"]')?.value||null,expiry_date:line.row.querySelector('[name="expiry_date"]')?.value||null,rejection_reason:line.row.querySelector('[name="rejection_reason"]')?.value||null})).map(({row,...line})=>line);if(!lines.length){showToast('Isi jumlah diterima pada minimal satu item.',true);return;}const button=form.querySelector('[type="submit"]');button.disabled=true;try{const body={stock_location_id:values.get('stock_location_id'),supplier_document_no:values.get('supplier_document_no')||null,lines};const fingerprint=JSON.stringify({poId:values.get('purchase_order_id'),body});if(receiptIdempotency?.fingerprint!==fingerprint)receiptIdempotency={fingerprint,key:crypto.randomUUID()};const result=await request(`/procurement/purchase-orders/${values.get('purchase_order_id')}/goods-receipts`,{method:'POST',headers:{'idempotency-key':receiptIdempotency.key},body});receiptIdempotency=null;showToast(`Penerimaan ${result.receipt_number} dicatat.`);form.reset();$('#gr-lines').innerHTML='<p class="muted">Pilih PO untuk memuat item dan sisa jumlah yang dapat diterima.</p>';await loadGoodsReceipts();await openGoodsReceipt(result.id);}catch(error){showToast(error.message,true);}finally{button.disabled=false;}});
$('#gr-body').addEventListener('click',(event)=>{const button=event.target.closest('[data-gr-open]');if(button)openGoodsReceipt(button.dataset.grOpen);});
$('#gr-actions').addEventListener('click',async(event)=>{const button=event.target.closest('[data-gr-action]');if(!button||!selectedReceiptId)return;const action=button.dataset.grAction;if(action==='post'&&!confirm('Posting akan menambah barang ke stok dan membuat ledger permanen. Lanjutkan?'))return;if(action==='delete'&&!confirm('Hapus draft penerimaan ini? Data draft dan itemnya akan dihapus, sementara audit tetap menyimpan jejak penghapusan.'))return;let reason;if(action==='reject'){reason=prompt('Alasan penolakan:');if(reason===null)return;if(reason.trim().length<2){showToast('Alasan penolakan minimal 2 karakter.',true);return;}}button.disabled=true;try{if(action==='delete'){const result=await request(`/procurement/goods-receipts/${selectedReceiptId}`,{method:'DELETE'});showToast(`Draft ${result.receipt_number} dihapus.`);selectedReceiptId=null;$('#gr-detail-panel').classList.add('hidden');await loadGoodsReceipts();return;}await request(`/procurement/goods-receipts/${selectedReceiptId}/${action}`,{method:'POST',body:action==='reject'?{reason:reason.trim()}:undefined});showToast(action==='post'?'Penerimaan diposting ke stok.':`Penerimaan ${action==='approve'?'disetujui':action==='reject'?'ditolak':'dikirim untuk persetujuan'}.`);await loadGoodsReceipts();await openGoodsReceipt(selectedReceiptId);}catch(error){showToast(error.message,true);button.disabled=false;}});
setDefaultDates('#sales-filter');setDefaultDates('#shift-filter');
startApp();
