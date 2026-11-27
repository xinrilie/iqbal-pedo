// Ordered browser script; shared page state is initialized by earlier files.
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
