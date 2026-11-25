import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { isBcryptPasswordLengthValid } from '../lib/auth-input.js';
import { pool, withTransaction } from '../lib/db.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';

const InventoryQuery = z.object({ q: z.string().trim().max(120).optional() });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const LedgerQuery = z.object({
  q: z.string().trim().max(120).optional(),
  from: DateOnly.optional(), to: DateOnly.optional(),
  stock_location_id: z.string().uuid().optional(),
  movement_type: z.enum(['opening_balance','goods_receipt','sale_consumption','waste','adjustment_in','adjustment_out','transfer_in','transfer_out','return_to_stock','stocktake_in','stocktake_out']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(50000).default(0)
});
const ReportQuery = z.object({
  from: DateOnly.optional(), to: DateOnly.optional(),
  cashier_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});
const CashierCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  full_name: z.string().trim().min(2).max(160),
  password: z.string().min(6).max(200).refine(isBcryptPasswordLengthValid, 'Password maksimal 72 byte.')
});
const CashierStatus = z.object({ is_active: z.boolean() });
const CashierPassword = z.object({ password: z.string().min(6).max(200).refine(isBcryptPasswordLengthValid, 'Password maksimal 72 byte.') });
const RecipeUpdate = z.object({
  items: z.array(z.object({
    inventory_item_id: z.string().uuid(),
    quantity_base: z.coerce.number().finite().positive().max(1_000_000_000),
    preparation_note: z.string().trim().max(300).optional().default('')
  })).min(1).max(50)
});

const MenuCreate = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{3,60}$/),
  name: z.string().trim().min(2).max(160),
  category_id: z.string().uuid(),
  price_amount: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  product_type: z.enum(['prepared','retail']).default('prepared'),
  retail_inventory_item_id: z.string().uuid().optional(),
  retail_quantity_base: z.coerce.number().finite().positive().max(1_000_000_000).default(1)
});

async function reportRange(companyId, outletId, query) {
  const { rows } = await pool.query(
    `SELECT (now() AT TIME ZONE timezone_name)::date::text AS today
       FROM gcims.outlets WHERE company_id=$1 AND id=$2`, [companyId, outletId]
  );
  const today = rows[0]?.today;
  const from = query.from ?? today;
  const to = query.to ?? today;
  if (!from || !to || from > to) throw badRequest('Rentang tanggal laporan tidak valid.');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > 92) throw badRequest('Rentang laporan maksimal 93 hari.');
  return { from, to };
}

export async function adminRoutes(app) {
  app.get('/admin/menus', { preHandler: [app.authenticate, app.requirePermission('admin.menu.read')] }, async (request) => {
    const { companyId, outletId } = request.gcims;
    const [menuResult, ingredientResult, categoryResult] = await Promise.all([
      pool.query(
        `SELECT m.id AS menu_id,m.code AS menu_code,m.name AS menu_name,m.description,m.is_active AS menu_active,
                mc.name AS category_name,mv.id AS variant_id,mv.code AS variant_code,mv.name AS variant_name,
                mv.is_active AS variant_active,COALESCE(omv.price_amount,mv.price_amount)::text AS price_amount,
                mv.is_test_price,mv.product_type,mv.retail_inventory_item_id,
                mv.retail_quantity_base::text AS retail_quantity_base,
                retail_item.sku AS retail_item_sku,retail_item.name AS retail_item_name,
                retail_uom.code AS retail_item_uom_code,retail_item.is_active AS retail_item_active,
                COALESCE(omv.is_available,TRUE) AS outlet_available,r.id AS recipe_id,
                rv.id AS version_id,rv.version_no,rv.effective_from,rv.notes AS version_notes,
                COALESCE(lines.items,'[]'::jsonb) AS recipe_items
           FROM gcims.menus m
           LEFT JOIN gcims.menu_categories mc ON mc.company_id=m.company_id AND mc.id=m.category_id
           JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id
           LEFT JOIN gcims.inventory_items retail_item ON retail_item.company_id=mv.company_id AND retail_item.id=mv.retail_inventory_item_id
           LEFT JOIN gcims.uoms retail_uom ON retail_uom.id=retail_item.base_uom_id
           LEFT JOIN gcims.outlet_menu_variants omv ON omv.company_id=mv.company_id AND omv.outlet_id=$2 AND omv.menu_variant_id=mv.id
           LEFT JOIN gcims.recipes r ON r.company_id=mv.company_id AND r.menu_variant_id=mv.id
           LEFT JOIN LATERAL (
             SELECT rv0.* FROM gcims.recipe_versions rv0
              WHERE rv0.company_id=r.company_id AND rv0.recipe_id=r.id AND rv0.status='active'
                AND rv0.effective_from<=now() AND (rv0.effective_to IS NULL OR rv0.effective_to>now())
              ORDER BY rv0.effective_from DESC LIMIT 1
           ) rv ON TRUE
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object('inventory_item_id',ii.id,'sku',ii.sku,'item_name',ii.name,
                       'quantity_base',ri.quantity_base::text,'uom_code',u.code,'preparation_note',ri.preparation_note)
                       ORDER BY ri.line_no) AS items
               FROM gcims.recipe_items ri
               JOIN gcims.inventory_items ii ON ii.company_id=ri.company_id AND ii.id=ri.inventory_item_id
               JOIN gcims.uoms u ON u.id=ii.base_uom_id
              WHERE ri.company_id=m.company_id AND ri.recipe_version_id=rv.id
           ) lines ON TRUE
          WHERE m.company_id=$1
          ORDER BY m.is_active DESC,mc.name NULLS LAST,m.name,mv.is_default DESC,mv.name`, [companyId, outletId]
      ),
      pool.query(
        `SELECT ii.id,ii.sku,ii.name,u.code AS uom_code
           FROM gcims.inventory_items ii JOIN gcims.uoms u ON u.id=ii.base_uom_id
          WHERE ii.company_id=$1 AND ii.is_active ORDER BY ii.name,ii.sku`, [companyId]
      ),
      pool.query(
        `SELECT id,code,name FROM gcims.menu_categories WHERE company_id=$1 AND is_active ORDER BY sort_order,name`, [companyId]
      )
    ]);
    return { data: menuResult.rows, ingredients: ingredientResult.rows, categories: categoryResult.rows };
  });

  app.post('/admin/menus', { preHandler: [app.authenticate, app.requirePermission('admin.menu.update')] }, async (request, reply) => {
    const menu = MenuCreate.safeParse(request.body);
    const recipe = menu.success && menu.data.product_type === 'prepared' ? RecipeUpdate.safeParse(request.body) : null;
    if (!menu.success || (recipe && !recipe.success)) throw badRequest('Data produk atau resep tidak valid.', [...(menu.error?.issues ?? []), ...(recipe?.error?.issues ?? [])]);
    if (menu.data.product_type === 'retail' && !menu.data.retail_inventory_item_id) throw badRequest('Pilih SKU inventori untuk produk retail.');
    if (menu.data.product_type === 'prepared' && menu.data.retail_inventory_item_id) throw badRequest('Produk kafe tidak memakai mapping SKU retail.');
    const { companyId, outletId, userId } = request.gcims;
    const recipeItems = recipe?.data.items ?? [];
    const itemIds = [...new Set(recipeItems.map((item) => item.inventory_item_id))];
    if (itemIds.length !== recipeItems.length) throw badRequest('Bahan yang sama hanya boleh muncul satu kali dalam resep.');
    try {
      const created = await withTransaction(async (client) => {
        const category = await client.query(
          `SELECT id FROM gcims.menu_categories WHERE company_id=$1 AND id=$2 AND is_active FOR SHARE`,
          [companyId, menu.data.category_id]
        );
        if (!category.rowCount) throw badRequest('Kategori menu tidak aktif atau tidak ditemukan.');
        const inventoryIds = menu.data.product_type === 'retail' ? [menu.data.retail_inventory_item_id] : itemIds;
        const ingredients = await client.query(
          `SELECT id FROM gcims.inventory_items WHERE company_id=$1 AND is_active AND id=ANY($2::uuid[])`, [companyId, inventoryIds]
        );
        if (ingredients.rowCount !== inventoryIds.length) throw badRequest('Ada item inventori yang tidak aktif atau bukan milik company ini.');
        const insertedMenu = await client.query(
          `INSERT INTO gcims.menus(company_id,category_id,code,name,is_active)
           VALUES ($1,$2,$3,$4,TRUE) RETURNING id,code,name`,
          [companyId, menu.data.category_id, menu.data.code, menu.data.name]
        );
        const menuRow = insertedMenu.rows[0];
        const variant = await client.query(
          `INSERT INTO gcims.menu_variants(company_id,menu_id,code,name,price_amount,is_default,is_active,is_test_price,
             product_type,retail_inventory_item_id,retail_quantity_base)
           VALUES ($1,$2,'REGULAR','Reguler',$3,TRUE,TRUE,TRUE,$4,$5,$6) RETURNING id`,
          [companyId, menuRow.id, menu.data.price_amount, menu.data.product_type,
           menu.data.product_type === 'retail' ? menu.data.retail_inventory_item_id : null,
           menu.data.retail_quantity_base]
        );
        if (menu.data.product_type === 'retail') {
          await client.query(
            `INSERT INTO gcims.outlet_menu_variants(company_id,outlet_id,menu_variant_id,price_amount,is_available)
             VALUES ($1,$2,$3,$4,TRUE)`,
            [companyId,outletId,variant.rows[0].id,menu.data.price_amount]
          );
          await client.query(
            `INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data)
             VALUES ($1,$2,$3,'admin.retail_product.created','menu',$4,$5::jsonb)`,
            [companyId,outletId,userId,menuRow.id,JSON.stringify({ code:menuRow.code,name:menuRow.name,product_type:'retail',retail_inventory_item_id:menu.data.retail_inventory_item_id,retail_quantity_base:menu.data.retail_quantity_base,price_amount:menu.data.price_amount })]
          );
          return { ...menuRow, variant_id: variant.rows[0].id, product_type: 'retail' };
        }
        const recipeRow = await client.query(
          `INSERT INTO gcims.recipes(company_id,menu_variant_id,name)
           VALUES ($1,$2,$3) RETURNING id`,
          [companyId, variant.rows[0].id, `${menuRow.name} · Reguler`]
        );
        const version = await client.query(
          `INSERT INTO gcims.recipe_versions(company_id,recipe_id,version_no,status,effective_from,notes,created_by,approved_by)
           VALUES ($1,$2,1,'draft',now(),'Resep awal dari panel admin',$3,$3) RETURNING id`,
          [companyId, recipeRow.rows[0].id, userId]
        );
        for (const [index, item] of recipeItems.entries()) await client.query(
          `INSERT INTO gcims.recipe_items(company_id,recipe_version_id,line_no,inventory_item_id,quantity_base,preparation_note)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, version.rows[0].id, index + 1, item.inventory_item_id, item.quantity_base, item.preparation_note || null]
        );
        await client.query(`UPDATE gcims.recipe_versions SET status='active' WHERE id=$1`, [version.rows[0].id]);
        await client.query(
          `INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data)
           VALUES ($1,$2,$3,'admin.menu.created','menu',$4,$5::jsonb)`,
          [companyId, outletId, userId, menuRow.id, JSON.stringify({ code: menuRow.code, name: menuRow.name, product_type:'prepared', price_amount: menu.data.price_amount, recipe_items: recipeItems })]
        );
        return { ...menuRow, variant_id: variant.rows[0].id, recipe_version_id: version.rows[0].id };
      });
      return reply.code(201).send({ menu: created });
    } catch (error) {
      if (error.code === '23505') throw conflict('MENU_CODE_EXISTS', 'Kode menu tersebut sudah digunakan.');
      throw error;
    }
  });

  app.delete('/admin/menus/:menuId', { preHandler: [app.authenticate, app.requirePermission('admin.menu.update')] }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.menuId).success) throw notFound('Menu tidak ditemukan.');
    const { companyId, outletId, userId } = request.gcims;
    return withTransaction(async (client) => {
      const menu = await client.query(
        `SELECT id,code,name,is_active FROM gcims.menus WHERE company_id=$1 AND id=$2 FOR UPDATE`, [companyId, request.params.menuId]
      );
      if (!menu.rowCount) throw notFound('Menu tidak ditemukan.');
      const variants = await client.query(
        `SELECT id FROM gcims.menu_variants WHERE company_id=$1 AND menu_id=$2 FOR UPDATE`, [companyId, request.params.menuId]
      );
      const variantIds = variants.rows.map((row) => row.id);
      const referencedSale = variantIds.length ? await client.query(
        `SELECT 1 FROM gcims.sales_order_items soi
          LEFT JOIN gcims.recipe_versions rv ON rv.company_id=soi.company_id AND rv.id=soi.recipe_version_id
         WHERE soi.company_id=$1 AND (soi.menu_variant_id=ANY($2::uuid[]) OR rv.recipe_id IN (
           SELECT id FROM gcims.recipes WHERE company_id=$1 AND menu_variant_id=ANY($2::uuid[])
         )) LIMIT 1`, [companyId, variantIds]
      ) : { rowCount: 0 };
      const details = menu.rows[0];
      if (referencedSale.rowCount) {
        await client.query(`UPDATE gcims.menus SET is_active=FALSE,updated_at=now() WHERE company_id=$1 AND id=$2`, [companyId, details.id]);
        await client.query(`UPDATE gcims.menu_variants SET is_active=FALSE,updated_at=now() WHERE company_id=$1 AND menu_id=$2`, [companyId, details.id]);
        await client.query(`UPDATE gcims.outlet_menu_variants SET is_available=FALSE,updated_at=now() WHERE company_id=$1 AND menu_variant_id=ANY($2::uuid[])`, [companyId, variantIds]);
        await client.query(
          `INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
           VALUES ($1,$2,$3,'admin.menu.archived','menu',$4,$5::jsonb,jsonb_build_object('is_active',FALSE))`,
          [companyId, outletId, userId, details.id, JSON.stringify({ code: details.code, name: details.name, is_active: details.is_active })]
        );
        return { deleted: false, archived: true, code: details.code, name: details.name };
      }
      await client.query(
        `INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data)
         VALUES ($1,$2,$3,'admin.menu.deleted','menu',$4,$5::jsonb)`,
        [companyId, outletId, userId, details.id, JSON.stringify({ code: details.code, name: details.name })]
      );
      const recipes = await client.query(
        `SELECT id FROM gcims.recipes WHERE company_id=$1 AND menu_variant_id=ANY($2::uuid[])`, [companyId, variantIds]
      );
      const recipeIds = recipes.rows.map((row) => row.id);
      if (recipeIds.length) {
        await client.query(`UPDATE gcims.recipe_versions SET status='retired' WHERE company_id=$1 AND recipe_id=ANY($2::uuid[]) AND status='active'`, [companyId, recipeIds]);
        await client.query(`DELETE FROM gcims.recipe_items WHERE company_id=$1 AND recipe_version_id IN (SELECT id FROM gcims.recipe_versions WHERE company_id=$1 AND recipe_id=ANY($2::uuid[]))`, [companyId, recipeIds]);
        await client.query(`DELETE FROM gcims.recipe_versions WHERE company_id=$1 AND recipe_id=ANY($2::uuid[])`, [companyId, recipeIds]);
        await client.query(`DELETE FROM gcims.recipes WHERE company_id=$1 AND id=ANY($2::uuid[])`, [companyId, recipeIds]);
      }
      if (variantIds.length) {
        await client.query(`DELETE FROM gcims.outlet_menu_variants WHERE company_id=$1 AND menu_variant_id=ANY($2::uuid[])`, [companyId, variantIds]);
        await client.query(`DELETE FROM gcims.menu_variants WHERE company_id=$1 AND id=ANY($2::uuid[])`, [companyId, variantIds]);
      }
      await client.query(`DELETE FROM gcims.menus WHERE company_id=$1 AND id=$2`, [companyId, details.id]);
      return { deleted: true, archived: false, code: details.code, name: details.name };
    });
  });

  app.put('/admin/menus/:variantId/recipe', { preHandler: [app.authenticate, app.requirePermission('admin.menu.update')] }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.variantId).success) throw notFound('Varian menu tidak ditemukan.');
    const parsed = RecipeUpdate.safeParse(request.body);
    if (!parsed.success) throw badRequest('Komposisi resep tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    const uniqueIds = [...new Set(parsed.data.items.map((item) => item.inventory_item_id))];
    if (uniqueIds.length !== parsed.data.items.length) throw badRequest('Bahan yang sama hanya boleh muncul satu kali dalam resep.');
    return withTransaction(async (client) => {
      const variant = await client.query(
        `SELECT mv.id,mv.name,mv.product_type,m.name AS menu_name FROM gcims.menu_variants mv
          JOIN gcims.menus m ON m.company_id=mv.company_id AND m.id=mv.menu_id
         WHERE mv.company_id=$1 AND mv.id=$2 FOR UPDATE OF mv`, [companyId, request.params.variantId]
      );
      if (!variant.rowCount) throw notFound('Varian menu tidak ditemukan.');
      if (variant.rows[0].product_type === 'retail') throw badRequest('Produk retail memakai SKU stok langsung dan tidak memiliki resep BOM.');
      const ingredients = await client.query(
        `SELECT id FROM gcims.inventory_items WHERE company_id=$1 AND is_active AND id=ANY($2::uuid[])`, [companyId, uniqueIds]
      );
      if (ingredients.rowCount !== uniqueIds.length) throw badRequest('Ada bahan yang tidak aktif atau bukan milik outlet ini.');
      const recipeResult = await client.query(
        `INSERT INTO gcims.recipes (company_id,menu_variant_id,name)
         VALUES ($1,$2,$3) ON CONFLICT (menu_variant_id) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [companyId, request.params.variantId, `${variant.rows[0].menu_name} · ${variant.rows[0].name}`]
      );
      const recipeId = recipeResult.rows[0].id;
      const active = await client.query(
        `SELECT id,version_no FROM gcims.recipe_versions WHERE company_id=$1 AND recipe_id=$2 AND status='active' FOR UPDATE`,
        [companyId, recipeId]
      );
      if (active.rowCount) await client.query(
        `UPDATE gcims.recipe_versions SET status='retired',effective_to=now() WHERE id=$1`, [active.rows[0].id]
      );
      const versionNo = active.rowCount
        ? Number(active.rows[0].version_no) + 1
        : Number((await client.query('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM gcims.recipe_versions WHERE recipe_id=$1', [recipeId])).rows[0].next);
      const version = await client.query(
        `INSERT INTO gcims.recipe_versions (company_id,recipe_id,version_no,status,effective_from,notes,created_by,approved_by)
         VALUES ($1,$2,$3,'draft',now(),'Pembaruan melalui panel admin',$4,$4) RETURNING id`,
        [companyId, recipeId, versionNo, userId]
      );
      for (const [index, item] of parsed.data.items.entries()) await client.query(
        `INSERT INTO gcims.recipe_items (company_id,recipe_version_id,line_no,inventory_item_id,quantity_base,preparation_note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [companyId, version.rows[0].id, index + 1, item.inventory_item_id, item.quantity_base, item.preparation_note || null]
      );
      await client.query(`UPDATE gcims.recipe_versions SET status='active' WHERE id=$1`, [version.rows[0].id]);
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
         VALUES ($1,$2,$3,'admin.menu.recipe_updated','recipe',$4,$5::jsonb,$6::jsonb)`,
        [companyId, outletId, userId, recipeId,
          JSON.stringify({ version_no: active.rowCount ? Number(active.rows[0].version_no) : null }),
          JSON.stringify({ version_no: versionNo, items: parsed.data.items })]
      );
      return { recipe_version_id: version.rows[0].id, version_no: versionNo };
    });
  });

  app.get('/admin/cashiers', { preHandler: [app.authenticate, app.requirePermission('admin.users.read')] }, async (request) => {
    const result = await pool.query(
      `SELECT u.id,u.full_name,split_part(u.email,'@',1) AS username,u.email,u.is_active,u.last_login_at,
              ura.outlet_id,
              shift.id AS open_shift_id,shift.opened_at AS shift_opened_at,
              COALESCE(sales.completed_transactions,0)::integer AS completed_transactions
         FROM gcims.users u
         JOIN gcims.company_memberships cm ON cm.company_id=$1 AND cm.user_id=u.id AND cm.membership_status='active'
         JOIN gcims.user_role_assignments ura ON ura.company_id=cm.company_id AND ura.user_id=cm.user_id
         JOIN gcims.roles r ON r.company_id=ura.company_id AND r.id=ura.role_id AND r.code='CASHIER'
         LEFT JOIN LATERAL (
           SELECT id,opened_at FROM gcims.cashier_shifts
            WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=u.id AND status='open' LIMIT 1
         ) shift ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT o.id)::integer AS completed_transactions
             FROM gcims.sales_orders o JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
            WHERE o.company_id=$1 AND o.outlet_id=$2 AND o.cashier_user_id=u.id AND p.status='succeeded'
         ) sales ON TRUE
        WHERE u.id<>$3 AND ((r.scope='company' AND ura.outlet_id IS NULL) OR (r.scope='outlet' AND ura.outlet_id=$2))
        ORDER BY u.is_active DESC,u.full_name,u.id`,
      [request.gcims.companyId, request.gcims.outletId, request.gcims.userId]
    );
    return { data: result.rows };
  });

  app.post('/admin/cashiers', { preHandler: [app.authenticate, app.requirePermission('admin.users.manage')] }, async (request, reply) => {
    const parsed = CashierCreate.safeParse(request.body);
    if (!parsed.success) throw badRequest('Data akun kasir tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    const hash = await bcrypt.hash(parsed.data.password, 12);
    let created;
    try {
      created = await withTransaction(async (client) => {
      const role = await client.query(
        `SELECT id FROM gcims.roles WHERE company_id=$1 AND code='CASHIER' AND scope='outlet'`, [companyId]
      );
      if (!role.rowCount) throw conflict('CASHIER_ROLE_NOT_CONFIGURED', 'Role Kasir belum disiapkan. Jalankan migration 0009_admin_accounts_reports.sql.');
      const user = await client.query(
        `INSERT INTO gcims.users (full_name,email,password_hash)
         VALUES ($1,$2,$3) RETURNING id,full_name,split_part(email,'@',1) AS username,email,is_active,created_at`,
        [parsed.data.full_name, `${parsed.data.username}@local.test`, hash]
      );
      const cashier = user.rows[0];
      await client.query(
        `INSERT INTO gcims.company_memberships (company_id,user_id,membership_status,joined_at)
         VALUES ($1,$2,'active',now())`, [companyId, cashier.id]
      );
      await client.query(
        `INSERT INTO gcims.user_role_assignments (company_id,user_id,role_id,outlet_id,assigned_by)
         VALUES ($1,$2,$3,$4,$5)`, [companyId, cashier.id, role.rows[0].id, outletId, userId]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,$2,$3,'admin.cashier.created','user',$4,jsonb_build_object('username',$5::text,'role','CASHIER'))`,
        [companyId, outletId, userId, cashier.id, parsed.data.username]
      );
        return cashier;
      });
    } catch (error) {
      if (error.code === '23505') throw conflict('CASHIER_USERNAME_EXISTS', 'Username tersebut sudah digunakan. Pilih username lain.');
      throw error;
    }
    return reply.code(201).send({ cashier: created });
  });

  app.patch('/admin/cashiers/:cashierId/status', { preHandler: [app.authenticate, app.requirePermission('admin.users.manage')] }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.cashierId).success) throw notFound('Akun kasir tidak ditemukan.');
    const parsed = CashierStatus.safeParse(request.body);
    if (!parsed.success) throw badRequest('Status akun tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    return withTransaction(async (client) => {
      const cashier = await client.query(
        `SELECT u.id,u.is_active FROM gcims.users u
         JOIN gcims.user_role_assignments ura ON ura.company_id=$1 AND ura.user_id=u.id AND ura.outlet_id=$2
         JOIN gcims.roles r ON r.company_id=ura.company_id AND r.id=ura.role_id AND r.code='CASHIER'
         WHERE u.id=$3 FOR UPDATE OF u`, [companyId,outletId,request.params.cashierId]
      );
      if (!cashier.rowCount) throw notFound('Akun kasir tidak ditemukan.');
      if (cashier.rows[0].is_active && !parsed.data.is_active) {
        const openShift = await client.query(
          `SELECT 1 FROM gcims.cashier_shifts WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=$3 AND status='open' LIMIT 1`,
          [companyId,outletId,request.params.cashierId]
        );
        if (openShift.rowCount) throw conflict('CASHIER_HAS_OPEN_SHIFT','Kasir masih memiliki shift aktif. Tutup shift sebelum menonaktifkan akun.');
      }
      const updated = await client.query(
        `UPDATE gcims.users SET is_active=$2,auth_token_version=auth_token_version+1,updated_at=now() WHERE id=$1
         RETURNING id,full_name,is_active`, [request.params.cashierId,parsed.data.is_active]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
         VALUES ($1,$2,$3,'admin.cashier.status_changed','user',$4,jsonb_build_object('is_active',$5::boolean),jsonb_build_object('is_active',$6::boolean))`,
        [companyId,outletId,userId,request.params.cashierId,cashier.rows[0].is_active,parsed.data.is_active]
      );
      return { cashier: updated.rows[0] };
    });
  });

  app.post('/admin/cashiers/:cashierId/password', { preHandler: [app.authenticate, app.requirePermission('admin.users.manage')] }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.cashierId).success) throw notFound('Akun kasir tidak ditemukan.');
    const parsed = CashierPassword.safeParse(request.body);
    if (!parsed.success) throw badRequest('Password baru tidak valid.', parsed.error.issues);
    const hash = await bcrypt.hash(parsed.data.password, 12);
    const { companyId, outletId, userId } = request.gcims;
    await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE gcims.users u SET password_hash=$4,auth_token_version=auth_token_version+1,updated_at=now()
          FROM gcims.user_role_assignments ura JOIN gcims.roles r ON r.company_id=ura.company_id AND r.id=ura.role_id
         WHERE u.id=$3 AND ura.company_id=$1 AND ura.user_id=u.id AND ura.outlet_id=$2 AND r.code='CASHIER'
         RETURNING u.id`, [companyId,outletId,request.params.cashierId,hash]
      );
      if (!result.rowCount) throw notFound('Akun kasir tidak ditemukan.');
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id)
         VALUES ($1,$2,$3,'admin.cashier.password_reset','user',$4)`, [companyId,outletId,userId,request.params.cashierId]
      );
    });
    return { ok: true };
  });

  app.get('/admin/sales', { preHandler: [app.authenticate, app.requirePermission('admin.sales.read')] }, async (request) => {
    const parsed = ReportQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter laporan penjualan tidak valid.', parsed.error.issues);
    const { companyId,outletId }=request.gcims;
    const range=await reportRange(companyId,outletId,parsed.data);
    const params=[companyId,outletId,range.from,range.to,parsed.data.cashier_id??null];
    const [summary,rows]=await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT p.order_id)::integer AS transaction_count,
                COALESCE(SUM(p.amount),0)::bigint AS paid_amount,
                COALESCE(SUM(p.cash_received_amount) FILTER (WHERE p.method='cash'),0)::bigint AS cash_received_amount,
                COALESCE(SUM(p.cash_change_amount) FILTER (WHERE p.method='cash'),0)::bigint AS cash_change_amount
           FROM gcims.payments p JOIN gcims.sales_orders o ON o.company_id=p.company_id AND o.id=p.order_id
           JOIN gcims.outlets outlet ON outlet.company_id=o.company_id AND outlet.id=o.outlet_id
          WHERE p.company_id=$1 AND o.outlet_id=$2 AND p.status='succeeded'
            AND (p.confirmed_at AT TIME ZONE outlet.timezone_name)::date BETWEEN $3::date AND $4::date
            AND ($5::uuid IS NULL OR o.cashier_user_id=$5)`,params),
      pool.query(
        `SELECT p.id AS payment_id,p.payment_number,p.method,p.amount,p.cash_received_amount,p.cash_change_amount,p.confirmed_at,
                o.id AS order_id,o.order_number,o.order_type,o.table_label,o.status AS order_status,
                COALESCE(u.full_name,'Kasir tidak diketahui') AS cashier_name,o.cashier_user_id
           FROM gcims.payments p JOIN gcims.sales_orders o ON o.company_id=p.company_id AND o.id=p.order_id
           JOIN gcims.outlets outlet ON outlet.company_id=o.company_id AND outlet.id=o.outlet_id
           LEFT JOIN gcims.users u ON u.id=o.cashier_user_id
          WHERE p.company_id=$1 AND o.outlet_id=$2 AND p.status='succeeded'
            AND (p.confirmed_at AT TIME ZONE outlet.timezone_name)::date BETWEEN $3::date AND $4::date
            AND ($5::uuid IS NULL OR o.cashier_user_id=$5)
          ORDER BY p.confirmed_at DESC,p.id DESC LIMIT $6`,[...params,parsed.data.limit])
    ]);
    return { from:range.from,to:range.to,summary:{transaction_count:Number(summary.rows[0].transaction_count),paid_amount:Number(summary.rows[0].paid_amount),cash_received_amount:Number(summary.rows[0].cash_received_amount),cash_change_amount:Number(summary.rows[0].cash_change_amount)},data:rows.rows.map((row)=>({...row,amount:Number(row.amount),cash_received_amount:row.cash_received_amount==null?null:Number(row.cash_received_amount),cash_change_amount:row.cash_change_amount==null?null:Number(row.cash_change_amount)})) };
  });

  app.get('/admin/shifts', { preHandler: [app.authenticate, app.requirePermission('admin.sales.read')] }, async (request) => {
    const parsed=ReportQuery.safeParse(request.query);
    if(!parsed.success) throw badRequest('Parameter rekap shift tidak valid.',parsed.error.issues);
    const {companyId,outletId}=request.gcims;
    const range=await reportRange(companyId,outletId,parsed.data);
    const result=await pool.query(
      `SELECT s.id,s.status,s.opened_at,s.closed_at,s.opening_cash_amount,s.closing_cash_amount,
              COALESCE(s.expected_cash_amount,s.opening_cash_amount+COALESCE(ev.cash_in,0)-COALESCE(ev.cash_out,0)+COALESCE(sales.cash_sales,0))::bigint AS expected_cash_amount,
              s.variance_amount,s.closing_note,u.id AS cashier_id,u.full_name AS cashier_name,
              COALESCE(ev.cash_in,0)::bigint AS cash_in_amount,COALESCE(ev.cash_out,0)::bigint AS cash_out_amount,
              COALESCE(sales.cash_sales,0)::bigint AS cash_sales_amount
         FROM gcims.cashier_shifts s JOIN gcims.users u ON u.id=s.cashier_user_id
         JOIN gcims.outlets outlet ON outlet.company_id=s.company_id AND outlet.id=s.outlet_id
         LEFT JOIN LATERAL (SELECT SUM(amount) FILTER(WHERE event_type='cash_in') AS cash_in,SUM(amount) FILTER(WHERE event_type='cash_out') AS cash_out
           FROM gcims.cash_drawer_events WHERE company_id=s.company_id AND cashier_shift_id=s.id) ev ON TRUE
         LEFT JOIN LATERAL (SELECT SUM(p.amount) AS cash_sales FROM gcims.sales_orders o JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
           WHERE o.company_id=s.company_id AND o.cashier_shift_id=s.id AND p.method='cash' AND p.status='succeeded') sales ON TRUE
        WHERE s.company_id=$1 AND s.outlet_id=$2
          AND (s.opened_at AT TIME ZONE outlet.timezone_name)::date BETWEEN $3::date AND $4::date
          AND ($5::uuid IS NULL OR s.cashier_user_id=$5)
        ORDER BY s.opened_at DESC,s.id DESC LIMIT $6`,
      [companyId,outletId,range.from,range.to,parsed.data.cashier_id??null,parsed.data.limit]
    );
    const data=result.rows.map((row)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value!=null&&/amount$/.test(key)?Number(value):value])));
    return {from:range.from,to:range.to,summary:{total:data.length,open:data.filter((x)=>x.status==='open').length,closed:data.filter((x)=>x.status==='closed').length,total_variance:data.filter((x)=>x.variance_amount!=null).reduce((sum,x)=>sum+Number(x.variance_amount),0)},data};
  });

  app.get('/admin/dashboard', { preHandler: [app.authenticate, app.requirePermission('admin.dashboard.read')] }, async (request) => {
    const { companyId, outletId } = request.gcims;
    const result = await pool.query(
      `WITH scope AS (
         SELECT timezone_name,name AS outlet_name FROM gcims.outlets WHERE company_id=$1 AND id=$2
       ), item_balances AS (
         SELECT ii.id, ii.sku, ii.name, ii.minimum_stock_base,
                COALESCE(SUM(soh.on_hand_qty_base),0) AS on_hand_qty_base,
                u.code AS base_uom_code
           FROM gcims.inventory_items ii
           JOIN gcims.uoms u ON u.id=ii.base_uom_id
           LEFT JOIN gcims.v_stock_on_hand soh
             ON soh.company_id=ii.company_id AND soh.outlet_id=$2 AND soh.inventory_item_id=ii.id
          WHERE ii.company_id=$1 AND ii.is_active
          GROUP BY ii.id,u.code
       ), today_orders AS (
         SELECT so.id,so.grand_total_amount
           FROM gcims.sales_orders so CROSS JOIN scope
          WHERE so.company_id=$1 AND so.outlet_id=$2
            AND so.confirmed_at IS NOT NULL
            AND (so.confirmed_at AT TIME ZONE scope.timezone_name)::date = (now() AT TIME ZONE scope.timezone_name)::date
            AND EXISTS (SELECT 1 FROM gcims.payments p WHERE p.company_id=so.company_id AND p.order_id=so.id AND p.status='succeeded')
       )
       SELECT (SELECT COUNT(*) FROM today_orders)::integer AS completed_transactions,
              (SELECT outlet_name FROM scope) AS outlet_name,
              COALESCE((SELECT SUM(grand_total_amount) FROM today_orders),0)::bigint AS gross_sales_amount,
              (SELECT COUNT(*) FROM item_balances)::integer AS active_inventory_items,
              (SELECT COUNT(*) FROM item_balances WHERE minimum_stock_base > 0 AND on_hand_qty_base < minimum_stock_base)::integer AS low_stock_items,
              (SELECT COUNT(*) FROM gcims.stock_locations WHERE company_id=$1 AND outlet_id=$2 AND is_active)::integer AS active_stock_locations,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'sku',sku,'name',name,'on_hand_qty_base',on_hand_qty_base::text,'minimum_stock_base',minimum_stock_base::text,'base_uom_code',base_uom_code) ORDER BY (on_hand_qty_base / NULLIF(minimum_stock_base,0)),name)
                FROM item_balances WHERE minimum_stock_base > 0 AND on_hand_qty_base < minimum_stock_base), '[]'::jsonb) AS low_stock_list`,
      [companyId, outletId]
    );
    const row = result.rows[0];
    return { data: {
      outlet_name: row.outlet_name,
      completed_transactions: Number(row.completed_transactions),
      gross_sales_amount: Number(row.gross_sales_amount),
      active_inventory_items: Number(row.active_inventory_items),
      low_stock_items: Number(row.low_stock_items),
      active_stock_locations: Number(row.active_stock_locations),
      low_stock_list: row.low_stock_list
    } };
  });

  app.get('/admin/inventory', { preHandler: [app.authenticate, app.requirePermission('admin.inventory.read')] }, async (request) => {
    const parsed = InventoryQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter inventori tidak valid.', parsed.error.issues);
    const { companyId, outletId } = request.gcims;
    const result = await pool.query(
      `SELECT ii.id,ii.sku,ii.name,ii.description,ii.is_active,ii.track_lot,ii.track_expiry,
              ii.allow_negative_stock,ii.minimum_stock_base::text,ii.safety_stock_base::text,
              u.code AS base_uom_code,ic.name AS category_name,
              COALESCE(SUM(loc.qty::numeric),0)::text AS on_hand_qty_base,
              COUNT(loc.stock_location_id)::integer AS active_location_count,
              expiry.earliest_stock_expiry_date::text AS earliest_stock_expiry_date,
              expiry.next_expiry_date::text AS next_expiry_date,
              COALESCE(expiry.expired_stock_qty,0)::numeric(18,6)::text AS expired_stock_qty,
              COALESCE(expiry.expiring_soon_stock_qty,0)::numeric(18,6)::text AS expiring_soon_stock_qty,
              COALESCE(jsonb_agg(jsonb_build_object('id',loc.stock_location_id,'code',loc.location_code,'name',loc.location_name,'type',loc.location_type,'quantity',loc.qty) ORDER BY loc.location_name)
                FILTER (WHERE loc.stock_location_id IS NOT NULL),'[]'::jsonb) AS stock_by_location
         FROM gcims.inventory_items ii
         JOIN gcims.uoms u ON u.id=ii.base_uom_id
         JOIN gcims.outlets o ON o.company_id=ii.company_id AND o.id=$2
         LEFT JOIN gcims.inventory_categories ic ON ic.company_id=ii.company_id AND ic.id=ii.category_id
         LEFT JOIN LATERAL (
           SELECT sl.id AS stock_location_id,sl.code AS location_code,sl.name AS location_name,
                  sl.location_type,COALESCE(SUM(soh.on_hand_qty_base),0)::text AS qty
             FROM gcims.stock_locations sl
             LEFT JOIN gcims.v_stock_on_hand soh
               ON soh.company_id=sl.company_id AND soh.outlet_id=sl.outlet_id
              AND soh.stock_location_id=sl.id AND soh.inventory_item_id=ii.id
            WHERE sl.company_id=ii.company_id AND sl.outlet_id=$2 AND sl.is_active
            GROUP BY sl.id
         ) loc ON TRUE
         LEFT JOIN LATERAL (
           SELECT MIN(il.expiry_date) FILTER (WHERE COALESCE(lot_balance.on_hand_qty_base,0)>0) AS earliest_stock_expiry_date,
                  MIN(il.expiry_date) FILTER (WHERE COALESCE(lot_balance.on_hand_qty_base,0)>0
                    AND il.expiry_date >= (now() AT TIME ZONE o.timezone_name)::date) AS next_expiry_date,
                  SUM(GREATEST(COALESCE(lot_balance.on_hand_qty_base,0),0)) FILTER (
                    WHERE il.expiry_date < (now() AT TIME ZONE o.timezone_name)::date) AS expired_stock_qty,
                  SUM(GREATEST(COALESCE(lot_balance.on_hand_qty_base,0),0)) FILTER (
                    WHERE il.expiry_date BETWEEN (now() AT TIME ZONE o.timezone_name)::date
                      AND (now() AT TIME ZONE o.timezone_name)::date + 30) AS expiring_soon_stock_qty
             FROM gcims.inventory_lots il
             JOIN gcims.stock_locations expiry_location
               ON expiry_location.company_id=il.company_id AND expiry_location.outlet_id=$2
              AND expiry_location.id=il.stock_location_id AND expiry_location.is_active
             LEFT JOIN gcims.v_stock_on_hand lot_balance
               ON lot_balance.company_id=il.company_id AND lot_balance.outlet_id=expiry_location.outlet_id
              AND lot_balance.stock_location_id=il.stock_location_id AND lot_balance.inventory_item_id=il.inventory_item_id
              AND lot_balance.lot_id=il.id
            WHERE ii.track_expiry AND il.company_id=ii.company_id AND il.inventory_item_id=ii.id
         ) expiry ON TRUE
        WHERE ii.company_id=$1
          AND ($3::text IS NULL OR ii.name ILIKE '%'||$3||'%' OR ii.sku ILIKE '%'||$3||'%' OR ic.name ILIKE '%'||$3||'%')
        GROUP BY ii.id,u.code,ic.name,expiry.earliest_stock_expiry_date,expiry.next_expiry_date,
                 expiry.expired_stock_qty,expiry.expiring_soon_stock_qty
        ORDER BY ii.is_active DESC,ii.name,ii.sku
        LIMIT 300`,
      [companyId, outletId, parsed.data.q || null]
    );
    return { data: result.rows.map((row) => {
      const onHand = Number(row.on_hand_qty_base);
      const minimum = Number(row.minimum_stock_base);
      return { ...row, on_hand_qty_base: row.on_hand_qty_base, minimum_stock_base: row.minimum_stock_base,
        safety_stock_base: row.safety_stock_base, active_location_count: Number(row.active_location_count),
        stock_by_location: row.stock_by_location,
        expired_stock_qty: row.expired_stock_qty, expiring_soon_stock_qty: row.expiring_soon_stock_qty,
        earliest_stock_expiry_date: row.earliest_stock_expiry_date, next_expiry_date: row.next_expiry_date,
        stock_status: !row.is_active ? 'inactive' : minimum > 0 && onHand < minimum ? 'low' : 'okay' };
    }) };
  });

  app.get('/admin/inventory/ledger', { preHandler: [app.authenticate, app.requirePermission('admin.inventory.read')] }, async (request) => {
    const parsed = LedgerQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter ledger tidak valid.', parsed.error.issues);
    const { companyId, outletId } = request.gcims;
    const { from, to, q, stock_location_id: locationId, movement_type: movementType, limit, offset } = parsed.data;
    if (from && to && from > to) throw badRequest('Rentang tanggal ledger tidak valid.');
    if (from && to && (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 366) {
      throw badRequest('Rentang ledger maksimal 367 hari.');
    }
    const [ledgerResult, locationResult] = await Promise.all([
      pool.query(
        `SELECT l.id,l.occurred_at,l.movement_type,l.quantity_delta_base::text,
                l.source_type,l.source_id,l.reason,
                ii.id AS inventory_item_id,ii.sku,ii.name AS item_name,u.code AS base_uom_code,
                sl.id AS stock_location_id,sl.name AS stock_location_name,
                il.lot_code,il.expiry_date::text AS expiry_date,
                actor.full_name AS actor_name,
                COUNT(*) OVER()::integer AS total_count
           FROM gcims.stock_ledger l
           JOIN gcims.outlets o ON o.company_id=l.company_id AND o.id=l.outlet_id
           JOIN gcims.inventory_items ii ON ii.company_id=l.company_id AND ii.id=l.inventory_item_id
           JOIN gcims.uoms u ON u.id=ii.base_uom_id
           JOIN gcims.stock_locations sl ON sl.company_id=l.company_id AND sl.outlet_id=l.outlet_id AND sl.id=l.stock_location_id
           LEFT JOIN gcims.inventory_lots il ON il.company_id=l.company_id AND il.inventory_item_id=l.inventory_item_id
             AND il.stock_location_id=l.stock_location_id AND il.id=l.lot_id
           LEFT JOIN gcims.users actor ON actor.id=l.actor_user_id
          WHERE l.company_id=$1 AND l.outlet_id=$2
            AND ($3::date IS NULL OR l.occurred_at >= ($3::date::timestamp AT TIME ZONE o.timezone_name))
            AND ($4::date IS NULL OR l.occurred_at < (($4::date + 1)::timestamp AT TIME ZONE o.timezone_name))
            AND ($5::uuid IS NULL OR l.stock_location_id=$5)
            AND ($6::text IS NULL OR l.movement_type=$6)
            AND ($7::text IS NULL OR ii.name ILIKE '%'||$7||'%' OR ii.sku ILIKE '%'||$7||'%' OR il.lot_code ILIKE '%'||$7||'%')
          ORDER BY l.occurred_at DESC,l.id DESC
          LIMIT $8 OFFSET $9`,
        [companyId,outletId,from??null,to??null,locationId??null,movementType??null,q||null,limit,offset]
      ),
      pool.query(
        `SELECT id,name,code FROM gcims.stock_locations
          WHERE company_id=$1 AND outlet_id=$2 AND is_active ORDER BY name`, [companyId,outletId]
      )
    ]);
    return {
      data: ledgerResult.rows.map(({ total_count, ...row }) => row),
      total: Number(ledgerResult.rows[0]?.total_count ?? 0), limit, offset,
      locations: locationResult.rows
    };
  });
}
