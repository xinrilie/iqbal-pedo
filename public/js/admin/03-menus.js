// Ordered browser script; shared page state is initialized by earlier files.
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
