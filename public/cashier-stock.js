const SESSION_KEY='gcims_pos_session';
const $=(selector)=>document.querySelector(selector);
const qtyFormat=new Intl.NumberFormat('id-ID',{maximumFractionDigits:6});
let timer=null;
let token=null;
let stockRows=[];
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(value){return qtyFormat.format(Number(value)||0);}
function sessionToken(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null')?.token??null;}catch{return null;}}
function dateLabel(value){if(!value)return '';const [year,month,day]=value.slice(0,10).split('-');return `${day}/${month}/${year}`;}
function populateFilter(id,options,label){const select=$(id);const current=select.value||'all';select.innerHTML=`<option value="all">${label}</option>`+options.map((option)=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');select.value=[...select.options].some((option)=>option.value===current)?current:'all';}
function renderStock(){
  const expiryFilter=$('#stock-expiry-filter').value;
  const categoryFilter=$('#stock-category-filter').value;
  const locationFilter=$('#stock-location-filter').value;
  const sort=$('#stock-sort').value;
  const rows=stockRows.filter((row)=>{
    if(categoryFilter!=='all'&&(row.category_name??'Tanpa kategori')!==categoryFilter)return false;
    if(locationFilter!=='all'&&row.stock_location_id!==locationFilter)return false;
    const expired=Number(row.expired_stock_qty)>0;
    const soon=Number(row.expiring_soon_stock_qty)>0;
    const dated=Boolean(row.earliest_stock_expiry_date);
    if(expiryFilter==='expired'&&!expired)return false;
    if(expiryFilter==='soon'&&!soon)return false;
    if(expiryFilter==='dated'&&!dated)return false;
    return true;
  }).sort((a,b)=>{
    if(sort==='expiry'){
      const left=a.earliest_stock_expiry_date||'9999-12-31';const right=b.earliest_stock_expiry_date||'9999-12-31';
      return left.localeCompare(right)||a.name.localeCompare(b.name,'id');
    }
    if(sort==='available')return Number(b.available_qty_base)-Number(a.available_qty_base)||a.name.localeCompare(b.name,'id');
    return a.name.localeCompare(b.name,'id')||a.stock_location_name.localeCompare(b.stock_location_name,'id');
  });
  $('#stock-count').textContent=`${rows.length} dari ${stockRows.length} baris · saldo per lokasi`;
  const body=$('#stock-body');
  body.innerHTML=rows.length?rows.map((row)=>{
    const available=Number(row.available_qty_base);const expiredQty=Number(row.expired_stock_qty);const soonQty=Number(row.expiring_soon_stock_qty);
    const status=available>0?'<span class="stock-status">Tersedia</span>':'<span class="stock-status unavailable">Habis untuk dijual</span>';
    let expiry='<span class="expiry-muted">Tidak dilacak</span>';
    if(row.track_expiry){
      if(expiredQty>0)expiry=`<span class="expiry-status expired">${fmt(expiredQty)} ${escapeHtml(row.base_uom_code)} kedaluwarsa</span><small>Lot terdekat: ${dateLabel(row.earliest_stock_expiry_date)}</small>`;
      else if(row.next_expiry_date)expiry=`<span class="expiry-status ${soonQty>0?'soon':''}">${dateLabel(row.next_expiry_date)}</span>${soonQty>0?`<small>${fmt(soonQty)} ${escapeHtml(row.base_uom_code)} dalam 30 hari</small>`:'<small>Tanggal lot terdekat</small>'}`;
      else expiry='<span class="expiry-muted">Belum ada lot bertanggal</span>';
    }
    return `<tr><td><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.sku)}</small></td><td>${escapeHtml(row.category_name??'—')}</td><td><strong>${escapeHtml(row.stock_location_name)}</strong><small>${escapeHtml(row.stock_location_code)}</small></td><td>${fmt(row.on_hand_qty_base)} ${escapeHtml(row.base_uom_code)}</td><td><strong>${fmt(row.available_qty_base)} ${escapeHtml(row.base_uom_code)}</strong></td><td>${expiry}</td><td>${status}</td></tr>`;
  }).join(''):'<tr><td colspan="7" class="stock-empty">Tidak ada stok yang cocok dengan filter ini.</td></tr>';
}
async function loadStock(query=''){
  const body=$('#stock-body');body.innerHTML='<tr><td colspan="7" class="stock-empty">Memuat data stok…</td></tr>';
  try{
    const params=new URLSearchParams();if(query.trim())params.set('q',query.trim());
    const response=await fetch(`/api/v1/cashier/stock${params.size?`?${params}`:''}`,{headers:{authorization:`Bearer ${token}`}});
    const data=await response.json().catch(()=>null);
    if(response.status===401){token=null;sessionStorage.removeItem(SESSION_KEY);location.replace('/');return;}
    if(response.status===403)throw new Error('Akun ini belum memiliki izin untuk membaca katalog/stok POS.');
    if(!response.ok)throw new Error(data?.error?.message??`Gagal memuat stok (${response.status}).`);
    stockRows=data?.data??[];
    const categories=[...new Set(stockRows.map((row)=>row.category_name??'Tanpa kategori'))].sort((a,b)=>a.localeCompare(b,'id')).map((name)=>({value:name,label:name}));
    const locations=[...new Map(stockRows.map((row)=>[row.stock_location_id,{value:row.stock_location_id,label:row.stock_location_name}])).values()].sort((a,b)=>a.label.localeCompare(b.label,'id'));
    populateFilter('#stock-category-filter',categories,'Semua kategori');populateFilter('#stock-location-filter',locations,'Semua lokasi');
    renderStock();
    $('#stock-error').classList.add('hidden');
  }catch(error){body.innerHTML=`<tr><td colspan="7" class="stock-empty">${escapeHtml(error.message)}</td></tr>`;$('#stock-error').textContent=error.message;$('#stock-error').classList.remove('hidden');}
}
async function initialize(){
  token=sessionToken();
  if(!token){location.replace('/');return;}
  try{
    const response=await fetch('/api/v1/auth/me',{headers:{authorization:`Bearer ${token}`}});
    const identity=await response.json().catch(()=>null);
    if(response.status===401){token=null;sessionStorage.removeItem(SESSION_KEY);location.replace('/');return;}
    if(!response.ok)throw new Error(identity?.error?.message??'Tidak dapat memeriksa sesi kasir.');
    if((identity.permissions??[]).includes('admin.dashboard.read')){location.replace('/admin');return;}
    const name=identity.user?.full_name??'Kasir';$('#cashier-name').textContent=name;$('#cashier-avatar').textContent=[...name.trim()][0]?.toUpperCase()??'K';
    $('#today-label').textContent=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium'}).format(new Date());
    const outletResponse=await fetch(`/api/v1/outlets/${encodeURIComponent(identity.scope.outlet_id)}/stock-locations`,{headers:{authorization:`Bearer ${token}`}});
    if(outletResponse.ok){const outlet=await outletResponse.json();const first=outlet.data?.[0];if(first?.outlet_name)$('#outlet-name').textContent=first.outlet_name;if(first?.name)$('#outlet-location').textContent=first.name;}
    await loadStock();
  }catch(error){$('#stock-error').textContent=error.message;$('#stock-error').classList.remove('hidden');}
}
$('#stock-search').addEventListener('input',(event)=>{clearTimeout(timer);timer=setTimeout(()=>{if(token)loadStock(event.target.value);},250);});
for(const selector of ['#stock-category-filter','#stock-location-filter','#stock-expiry-filter','#stock-sort'])$(selector).addEventListener('change',renderStock);
$('#logout-button').addEventListener('click',()=>{sessionStorage.removeItem(SESSION_KEY);location.href='/';});
initialize();
