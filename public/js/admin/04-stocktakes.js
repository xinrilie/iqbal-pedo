// Ordered browser script; shared page state is initialized by earlier files.
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
