import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_AUTH?: string;
  DEV_USER_EMAIL?: string;
}

type SessionUser = { id: string; email: string; displayName: string; role: 'admin' | 'user'; canTransfer: boolean };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const err = (message: string, status = 400) => json({ error: message }, status);
const asInt = (value: unknown, label: string, min = 1) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${label} ต้องเป็นจำนวนเต็มตั้งแต่ ${min} ขึ้นไป`);
  return n;
};
const uid = () => crypto.randomUUID();

async function identify(request: Request, env: Env): Promise<{ email: string; name: string } | null> {
  if (env.APP_ENV === 'development' && env.DEV_AUTH === 'true') {
    const email = (env.DEV_USER_EMAIL || 'admin@example.com').toLowerCase();
    return { email, name: email.split('@')[0] };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || env.ACCESS_TEAM_DOMAIN.startsWith('YOUR_') || env.ACCESS_AUD.startsWith('REPLACE_')) return null;
  const assertion = request.headers.get('cf-access-jwt-assertion');
  if (!assertion) return null;
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(assertion, jwks, { issuer, audience: env.ACCESS_AUD });
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
    return { email: payload.email.toLowerCase(), name: typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0] };
  } catch {
    return null;
  }
}

async function requireUser(request: Request, env: Env): Promise<SessionUser | Response> {
  const identity = await identify(request, env);
  if (!identity) return err('กรุณาเข้าสู่ระบบด้วย Google ผ่าน Cloudflare Access', 401);
  const row = await env.DB.prepare('SELECT id,email,display_name,role,can_transfer,is_active FROM users WHERE email = ? COLLATE NOCASE').bind(identity.email).first<{id:string;email:string;display_name:string;role:'admin'|'user';can_transfer:number;is_active:number}>();
  if (!row || row.is_active !== 1) return err('บัญชีนี้ยังไม่ได้รับอนุญาต กรุณาติดต่อ Admin', 403);
  return { id: row.id, email: row.email, displayName: row.display_name || identity.name, role: row.role, canTransfer: row.can_transfer === 1 || row.role === 'admin' };
}
function isResponse(value: SessionUser | Response): value is Response { return value instanceof Response; }
function adminOnly(user: SessionUser) { return user.role === 'admin'; }
async function logAction(env: Env, user: SessionUser, action: string, detail = '') {
  await env.DB.prepare('INSERT INTO activity_logs (id,user_id,user_email,action,detail) VALUES (?,?,?,?,?)')
    .bind(uid(), user.id, user.email, action, detail.slice(0, 2000)).run();
}
async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/health') return json({ ok: true, service: 'btt-stock-management', env: env.APP_ENV });
  const user = await requireUser(request, env);
  if (isResponse(user)) return user;

  if (path === '/api/me' && request.method === 'GET') return json({ user });

  if (path === '/api/dashboard' && request.method === 'GET') {
    const [counts, locations, lowStock, pending, overdue] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS item_count FROM assets WHERE status='active'`).first(),
      env.DB.prepare(`SELECT location_code, COALESCE(SUM(quantity),0) AS quantity FROM stock_balances GROUP BY location_code`).all(),
      env.DB.prepare(`SELECT a.id,a.name,a.stock_min,COALESCE(SUM(b.quantity),0) AS total_qty FROM assets a LEFT JOIN stock_balances b ON b.asset_id=a.id WHERE a.status='active' GROUP BY a.id HAVING total_qty < a.stock_min ORDER BY (a.stock_min-total_qty) DESC LIMIT 10`).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM approval_requests WHERE status='pending'`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM borrow_transactions WHERE status IN ('borrowed','partially_returned','overdue') AND expected_return_date IS NOT NULL AND expected_return_date < date('now')`).first()
    ]);
    const reserved = await env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM stock_reservations WHERE status='active'`).first<{quantity:number}>();
    const onLoan = await env.DB.prepare(`SELECT COALESCE(SUM(quantity-quantity_returned),0) AS quantity FROM borrow_transactions WHERE status IN ('borrowed','partially_returned','overdue')`).first<{quantity:number}>();
    const physical = await env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM stock_balances`).first<{quantity:number}>();
    return json({ counts: { item_count: counts?.item_count ?? 0, physical_qty: Number(physical?.quantity ?? 0) + Number(onLoan?.quantity ?? 0) }, locations: locations.results, lowStock: lowStock.results, pendingApprovals: pending?.count ?? 0, overdueBorrows: overdue?.count ?? 0, reserved: reserved?.quantity ?? 0, onLoan: onLoan?.quantity ?? 0 });
  }

  if (path === '/api/assets' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const category = (url.searchParams.get('category') || '').trim().slice(0, 100);
    const status = url.searchParams.get('status') === 'inactive' ? 'inactive' : 'active';
    const rows = await env.DB.prepare(`
      SELECT a.id,a.name,a.image_url,a.stock_max,a.stock_min,a.unit_price_minor,a.item_type,a.status,a.remark,
             c.name AS category,l.name AS default_location,
             COALESCE(SUM(CASE WHEN b.location_code='BTT' THEN b.quantity ELSE 0 END),0) AS btt_qty,
             COALESCE(SUM(CASE WHEN b.location_code='TKE' THEN b.quantity ELSE 0 END),0) AS tke_qty,
             COALESCE(SUM(b.quantity),0) AS warehouse_qty
      FROM assets a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN locations l ON l.id=a.default_location_id
      LEFT JOIN stock_balances b ON b.asset_id=a.id
      WHERE a.status=? AND (?='' OR a.id LIKE '%'||?||'%' OR a.name LIKE '%'||?||'%' OR c.name LIKE '%'||?||'%')
        AND (?='' OR c.name=?)
      GROUP BY a.id ORDER BY a.name COLLATE NOCASE LIMIT 500`).bind(status,q,q,q,q,category,category).all();
    const ids = rows.results.map((r: Record<string, unknown>) => r.id as string);
    let reservations: Record<string, number> = {};
    let borrowed: Record<string, number> = {};
    if (ids.length) {
      const r = await env.DB.prepare(`SELECT asset_id, SUM(quantity) AS qty FROM stock_reservations WHERE status='active' GROUP BY asset_id`).all<{asset_id:string;qty:number}>();
      reservations = Object.fromEntries(r.results.map(x => [x.asset_id, x.qty]));
      const b = await env.DB.prepare(`SELECT asset_id, SUM(quantity-quantity_returned) AS qty FROM borrow_transactions WHERE status IN ('borrowed','partially_returned','overdue') GROUP BY asset_id`).all<{asset_id:string;qty:number}>();
      borrowed = Object.fromEntries(b.results.map(x => [x.asset_id, x.qty]));
    }
    return json({ assets: rows.results.map((a: Record<string, unknown>) => { const reservedQty=reservations[String(a.id)]||0; const loanQty=borrowed[String(a.id)]||0; const warehouseQty=Number(a.warehouse_qty)||0; return {...a,total_qty:warehouseQty+loanQty,reserved_qty:reservedQty,on_loan_qty:loanQty,available_qty:Math.max(0,warehouseQty-reservedQty)}; }) });
  }

  if (path === '/api/categories' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,name FROM categories ORDER BY name').all();
    return json({ categories: rows.results });
  }

  if (path === '/api/movements' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT m.*,a.name AS asset_name,u.email AS user_email FROM stock_movements m JOIN assets a ON a.id=m.asset_id JOIN users u ON u.id=m.performed_by ORDER BY m.created_at DESC LIMIT 200`).all();
    return json({ movements: rows.results });
  }

  if (path === '/api/assets' && request.method === 'POST') {
    if (!adminOnly(user)) return err('ต้องเป็น Admin เพื่อเพิ่มสินค้า', 403);
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const categoryName = String(body.category || '').trim();
    const locationCode = body.location === 'TKE' ? 'TKE' : 'BTT';
    const stockMin = asInt(body.stockMin ?? 0, 'Stock Min', 0);
    const stockMax = asInt(body.stockMax ?? 0, 'Stock Max', 0);
    const qty = asInt(body.quantity ?? 0, 'จำนวนตั้งต้น', 0);
    const price = Math.round(Number(body.unitPrice ?? 0) * 100);
    if (!/^[A-Z0-9._-]{2,50}$/.test(id)) return err('รหัสสินค้าต้องใช้ A-Z, 0-9, จุด, ขีดกลาง หรือขีดล่าง');
    if (!name || name.length > 200) return err('กรุณาระบุชื่อสินค้าไม่เกิน 200 ตัวอักษร');
    if (!Number.isFinite(price) || price < 0) return err('ราคาไม่ถูกต้อง');
    const itemType = body.itemType === 'consumable' ? 'consumable' : 'returnable';
    const cat = categoryName ? await env.DB.prepare('SELECT id FROM categories WHERE name=? COLLATE NOCASE').bind(categoryName).first<{id:number}>() : null;
    const loc = await env.DB.prepare('SELECT id FROM locations WHERE name=? COLLATE NOCASE').bind(String(body.defaultLocation || '')).first<{id:number}>();
    try {
      const statements = [
        env.DB.prepare(`INSERT INTO assets (id,name,category_id,default_location_id,qr_value,stock_min,stock_max,unit_price_minor,item_type,requires_approval,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,name,cat?.id ?? null,loc?.id ?? null,id,stockMin,stockMax,price,itemType,body.requiresApproval===true?1:0,String(body.remark || '').slice(0,1000)),
        env.DB.prepare(`INSERT INTO stock_balances (asset_id,location_code,quantity) VALUES (?,?,?)`).bind(id,locationCode,qty)
      ];
      if (qty > 0) statements.push(env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,to_location,quantity,before_quantity,after_quantity,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(uid(),id,'opening',locationCode,qty,0,qty,'ยอดตั้งต้นจากการสร้างสินค้า',user.id));
      await env.DB.batch(statements);
      await logAction(env,user,'asset.create',`${id} ${name}`);
      return json({ ok: true, id }, 201);
    } catch (e) {
      return err(e instanceof Error && e.message.includes('UNIQUE') ? 'รหัสสินค้านี้มีอยู่แล้ว' : 'บันทึกสินค้าไม่สำเร็จ', 409);
    }
  }

  if (path === '/api/stock/adjust' && request.method === 'POST') {
    if (!adminOnly(user)) return err('ต้องเป็น Admin เพื่อปรับสต็อก', 403);
    const body = await request.json() as Record<string, unknown>;
    const assetId = String(body.assetId || '').trim().toUpperCase();
    const location = body.location === 'TKE' ? 'TKE' : 'BTT';
    const delta = Number(body.delta);
    const reason = String(body.reason || '').trim();
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) return err('จำนวนปรับต้องเป็นจำนวนเต็มที่ไม่ใช่ศูนย์');
    if (!reason) return err('กรุณาระบุเหตุผลการปรับสต็อก');
    const current = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(assetId,location).first<{quantity:number}>();
    if (!current) return err('ไม่พบสินค้า/ยอดสต็อกในสถานที่นี้',404);
    const next = current.quantity + delta;
    if (next < 0) return err('ยอดสต็อกไม่สามารถติดลบได้');
    const movementId = uid();
    await env.DB.batch([
      env.DB.prepare(`UPDATE stock_balances SET quantity=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id=? AND location_code=?`).bind(next,assetId,location),
      env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,quantity,before_quantity,after_quantity,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(movementId,assetId,'adjustment',location,Math.abs(delta),current.quantity,next,reason,user.id)
    ]);
    await logAction(env,user,'stock.adjust',`${assetId} ${location}: ${current.quantity} -> ${next}; ${reason}`);
    return json({ ok: true, before: current.quantity, after: next });
  }

  if (path === '/api/stock/transfer' && request.method === 'POST') {
    const body = await request.json() as Record<string, unknown>;
    const assetId = String(body.assetId || '').trim().toUpperCase();
    const from = body.from === 'TKE' ? 'TKE' : 'BTT';
    const to = from === 'BTT' ? 'TKE' : 'BTT';
    const quantity = asInt(body.quantity,'จำนวนโอน');
    const reason = String(body.reason || 'โอนระหว่างคลัง').trim();
    if (!user.canTransfer) return err('บัญชีนี้ไม่มีสิทธิ์โอนสต็อก',403);
    const src = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(assetId,from).first<{quantity:number}>();
    const dst = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(assetId,to).first<{quantity:number}>();
    if (!src || src.quantity < quantity) return err('สต็อกต้นทางไม่เพียงพอ');
    await env.DB.batch([
      env.DB.prepare(`UPDATE stock_balances SET quantity=quantity-?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id=? AND location_code=? AND quantity>=?`).bind(quantity,assetId,from,quantity),
      env.DB.prepare(`INSERT INTO stock_balances (asset_id,location_code,quantity) VALUES (?,?,?) ON CONFLICT(asset_id,location_code) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(assetId,to,quantity),
      env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,to_location,quantity,before_quantity,after_quantity,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid(),assetId,'transfer_out',from,to,quantity,src.quantity,src.quantity-quantity,reason,user.id),
      env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,to_location,quantity,before_quantity,after_quantity,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid(),assetId,'transfer_in',from,to,quantity,dst?.quantity ?? 0,(dst?.quantity ?? 0)+quantity,reason,user.id)
    ]);
    await logAction(env,user,'stock.transfer',`${assetId}: ${from} -> ${to}, ${quantity}`);
    return json({ ok: true, from, to, quantity });
  }

  if (path === '/api/approvals' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT r.*,a.name AS asset_name,u.email AS requester_email FROM approval_requests r JOIN assets a ON a.id=r.asset_id JOIN users u ON u.id=r.requested_by ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`).all();
    return json({ requests: rows.results });
  }

  if (path === '/api/approvals' && request.method === 'POST') {
    const body = await request.json() as Record<string, unknown>;
    const assetId = String(body.assetId || '').trim().toUpperCase();
    const location = body.location === 'TKE' ? 'TKE' : 'BTT';
    const quantity = asInt(body.quantity,'จำนวน');
    const requestType = body.requestType === 'consume' ? 'consume' : 'borrow';
    const stock = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(assetId,location).first<{quantity:number}>();
    const reserved = await env.DB.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM stock_reservations WHERE asset_id=? AND location_code=? AND status='active'`).bind(assetId,location).first<{quantity:number}>();
    const available = (stock?.quantity ?? 0) - (reserved?.quantity ?? 0);
    if (available < quantity) return err('สต็อกพร้อมจองไม่เพียงพอ');
    const requestId = uid();
    const item = await env.DB.prepare('SELECT item_type,requires_approval FROM assets WHERE id=? AND status=\'active\'').bind(assetId).first<{item_type:string;requires_approval:number}>();
    if (!item) return err('ไม่พบสินค้าที่เปิดใช้งาน',404);
    if (requestType === 'consume' && item.item_type !== 'consumable') return err('สินค้านี้ถูกตั้งค่าเป็นอุปกรณ์ที่ต้องคืน');
    if (requestType === 'borrow' && item.item_type !== 'returnable') return err('สินค้านี้ถูกตั้งค่าเป็นวัสดุสิ้นเปลือง');
    if (item.requires_approval !== 1) {
      const currentQty = stock?.quantity ?? 0;
      if (currentQty < quantity + (reserved?.quantity ?? 0)) return err('สต็อกพร้อมใช้ไม่เพียงพอ');
      const transactionId = uid();
      const afterQty = currentQty - quantity;
      const statements = [
        env.DB.prepare(`UPDATE stock_balances SET quantity=quantity-?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id=? AND location_code=? AND quantity>=?`).bind(quantity,assetId,location,quantity),
        env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,quantity,before_quantity,after_quantity,reference_id,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid(),assetId,requestType,location,quantity,currentQty,afterQty,transactionId,requestType==='consume'?'เบิกวัสดุสิ้นเปลือง':'ยืมอุปกรณ์',user.id)
      ];
      if (requestType === 'borrow') statements.push(env.DB.prepare(`INSERT INTO borrow_transactions (id,asset_id,location_code,project_name,borrower_name,quantity,expected_return_date,remark,created_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(transactionId,assetId,location,String(body.projectName||''),String(body.borrowerName||user.displayName),quantity,body.expectedReturnDate?String(body.expectedReturnDate):null,String(body.remark||''),user.id));
      await env.DB.batch(statements);
      await logAction(env,user,requestType==='consume'?'stock.consume':'borrow.create',`${transactionId} ${assetId} x${quantity}`);
      return json({ok:true,transactionId,status:'completed',requiresApproval:false},201);
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO approval_requests (id,asset_id,location_code,quantity,request_type,project_name,borrower_name,expected_return_date,remark,requested_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(requestId,assetId,location,quantity,requestType,String(body.projectName||''),String(body.borrowerName||user.displayName),body.expectedReturnDate ? String(body.expectedReturnDate) : null,String(body.remark||''),user.id),
      env.DB.prepare(`INSERT INTO stock_reservations (id,asset_id,location_code,quantity,request_id,created_by) VALUES (?,?,?,?,?,?)`).bind(uid(),assetId,location,quantity,requestId,user.id)
    ]);
    await logAction(env,user,'approval.request',`${requestId} ${assetId} x${quantity}`);
    return json({ ok: true, requestId, status: 'pending' },201);
  }

  const approvalMatch = path.match(/^\/api\/approvals\/([0-9a-f-]+)\/decision$/i);
  if (approvalMatch && request.method === 'POST') {
    if (!adminOnly(user)) return err('ต้องเป็น Admin เพื่ออนุมัติคำขอ',403);
    const body = await request.json() as Record<string, unknown>;
    const decision = body.decision === 'approved' ? 'approved' : 'rejected';
    const requestId = approvalMatch[1];
    const req = await env.DB.prepare(`SELECT * FROM approval_requests WHERE id=? AND status='pending'`).bind(requestId).first<Record<string, unknown>>();
    if (!req) return err('ไม่พบคำขอที่รออนุมัติ',404);
    const reserved = await env.DB.prepare(`SELECT id,quantity FROM stock_reservations WHERE request_id=? AND status='active'`).bind(requestId).first<{id:string;quantity:number}>();
    if (decision === 'approved') {
      const stock = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(req.asset_id,req.location_code).first<{quantity:number}>();
      if (!stock || stock.quantity < Number(req.quantity)) return err('สต็อกจริงไม่เพียงพอ จึงอนุมัติไม่ได้');
      const movementType = req.request_type === 'consume' ? 'consume' : 'borrow';
      const txId = uid();
      const statements = [
        env.DB.prepare(`UPDATE stock_balances SET quantity=quantity-?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id=? AND location_code=? AND quantity>=?`).bind(req.quantity,req.asset_id,req.location_code,req.quantity),
        env.DB.prepare(`UPDATE stock_reservations SET status='consumed',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=? AND status='active'`).bind(requestId),
        env.DB.prepare(`UPDATE approval_requests SET status='approved',decided_by=?,decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),decision_note=? WHERE id=? AND status='pending'`).bind(user.id,String(body.note||''),requestId),
        env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,quantity,before_quantity,after_quantity,reference_id,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid(),req.asset_id,movementType,req.location_code,req.quantity,stock.quantity,stock.quantity-Number(req.quantity),requestId,'อนุมัติคำขอเบิก/ยืม',user.id)
      ];
      if (req.request_type === 'borrow') statements.push(env.DB.prepare(`INSERT INTO borrow_transactions (id,asset_id,location_code,project_name,borrower_name,quantity,expected_return_date,remark,created_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(txId,req.asset_id,req.location_code,req.project_name,req.borrower_name,req.quantity,req.expected_return_date,req.remark,user.id));
      await env.DB.batch(statements);
    } else {
      await env.DB.batch([
        env.DB.prepare(`UPDATE stock_reservations SET status='released',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=? AND status='active'`).bind(requestId),
        env.DB.prepare(`UPDATE approval_requests SET status='rejected',decided_by=?,decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),decision_note=? WHERE id=? AND status='pending'`).bind(user.id,String(body.note||''),requestId)
      ]);
    }
    await logAction(env,user,`approval.${decision}`,requestId);
    return json({ ok:true,status:decision });
  }

  if (path === '/api/borrows/return' && request.method === 'POST') {
    const body = await request.json() as Record<string, unknown>;
    const borrowId = String(body.borrowId || '');
    const quantity = asInt(body.quantity,'จำนวนคืน');
    const condition = ['good','damaged','lost'].includes(String(body.condition)) ? String(body.condition) : 'good';
    const tx = await env.DB.prepare(`SELECT * FROM borrow_transactions WHERE id=? AND status IN ('borrowed','partially_returned','overdue')`).bind(borrowId).first<Record<string, unknown>>();
    if (!tx) return err('ไม่พบรายการยืมที่ยังเปิดอยู่',404);
    const remaining = Number(tx.quantity)-Number(tx.quantity_returned);
    if (quantity > remaining) return err(`คืนได้ไม่เกิน ${remaining} ชิ้น`);
    const countAsReturned = condition === 'good' ? quantity : 0;
    const nextReturned = Number(tx.quantity_returned)+quantity;
    const nextStatus = nextReturned === Number(tx.quantity) ? (condition === 'damaged' ? 'damaged' : condition === 'lost' ? 'lost' : 'returned') : 'partially_returned';
    const currentStock = await env.DB.prepare('SELECT quantity FROM stock_balances WHERE asset_id=? AND location_code=?').bind(tx.asset_id,tx.location_code).first<{quantity:number}>();
    const after = (currentStock?.quantity ?? 0) + countAsReturned;
    const statements = [
      env.DB.prepare(`INSERT INTO borrow_returns (id,borrow_id,quantity,condition,note,received_by) VALUES (?,?,?,?,?,?)`).bind(uid(),borrowId,quantity,condition,String(body.note||''),user.id),
      env.DB.prepare(`UPDATE borrow_transactions SET quantity_returned=?,status=? WHERE id=?`).bind(nextReturned,nextStatus,borrowId)
    ];
    if (countAsReturned) {
      statements.push(env.DB.prepare(`INSERT INTO stock_balances (asset_id,location_code,quantity) VALUES (?,?,?) ON CONFLICT(asset_id,location_code) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(tx.asset_id,tx.location_code,countAsReturned));
      statements.push(env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,to_location,quantity,before_quantity,after_quantity,reference_id,reason,performed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid(),tx.asset_id,'return',tx.location_code,countAsReturned,currentStock?.quantity ?? 0,after,borrowId,'รับคืนอุปกรณ์สภาพดี',user.id));
    } else {
      statements.push(env.DB.prepare(`INSERT INTO stock_movements (id,asset_id,movement_type,from_location,quantity,reference_id,reason,performed_by) VALUES (?,?,?,?,?,?,?,?)`).bind(uid(),tx.asset_id,condition === 'lost' ? 'loss' : 'damage',tx.location_code,quantity,borrowId,String(body.note||condition),user.id));
    }
    await env.DB.batch(statements);
    await logAction(env,user,'borrow.return',`${borrowId} x${quantity} ${condition}`);
    return json({ok:true,remaining:remaining-quantity,status:nextStatus});
  }

  return err('ไม่พบ API endpoint',404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':'same-origin','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});
      try { return await api(request,env); }
      catch (error) {
        console.error(JSON.stringify({level:'error',path:url.pathname,message:error instanceof Error?error.message:'unknown'}));
        return err(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดภายในระบบ',500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
