// Ordered browser script; shared page state is initialized by earlier files.
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
