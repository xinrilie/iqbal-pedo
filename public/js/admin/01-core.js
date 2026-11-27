// Ordered browser script; shared page state is initialized by earlier files.
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
