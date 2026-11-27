// Ordered browser script; shared page state is initialized by earlier files.
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
