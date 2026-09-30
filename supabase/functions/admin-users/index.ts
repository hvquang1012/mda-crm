// ============================================================
// Edge Function: admin-users
// Việc quản trị tài khoản nhân viên cần Auth Admin API (service_role)
// nên không làm được từ trình duyệt — màn "Nhân viên" (js/staff/team.js)
// gọi hàm này. Chỉ QUẢN TRỊ (staff.role = 'admin', còn active) được gọi.
//
// Hành động (body.action):
//   create          { email, full_name, phone?, role }  → tạo tài khoản, trả mật khẩu tạm MỘT lần
//   reset_password  { staff_id }                         → mật khẩu tạm mới, trả MỘT lần
//   sync_ban        { staff_id }                         → chặn / mở đăng nhập theo staff.active
//
// Khoá / mở khoá quyền trong DB làm bằng RPC set_staff_active() (trình
// duyệt gọi trực tiếp) — sync_ban chỉ làm theo cột active đã ghi, nên
// không thể dùng hàm này để khoá ai khác ngoài ý của DB.
// Không có hành động xoá: auth.users còn bị progress_reports tham chiếu.
//
// Vai trò và nhật ký đi qua client mang JWT của người gọi (set_staff_role
// kiểm quyền admin + trigger ghi audit_log đúng người làm).
//
// Deploy: supabase functions deploy admin-users
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY có sẵn)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BAN_FOREVER = '876000h'; // ~100 năm

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Mật khẩu tạm dễ đọc qua điện thoại: bỏ ký tự dễ nhầm (0/O, 1/l/I)
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(bytes, b => abc[b % abc.length]).join('');
  return `Md-${s.slice(0, 5)}-${s.slice(5)}`;
}

function normalizePhone(s: unknown): string | null | undefined {
  let d = String(s ?? '').replace(/[\s.\-()]/g, '');
  if (!d) return null;
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  else if (/^84\d{9}$/.test(d)) d = '0' + d.slice(2);
  return /^0\d{9}$/.test(d) ? d : undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  // Client mang JWT người gọi — RLS + kiểm quyền trong hàm SQL áp như trên app
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return json({ error: 'not_authenticated' }, 401);
  const { data: me } = await admin.from('staff').select('role, active').eq('id', user.id).maybeSingle();
  if (!me || me.role !== 'admin' || me.active === false) return json({ error: 'admin_only' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const audit = (action: string, targetId: string, detail: Record<string, unknown>) =>
    admin.from('audit_log').insert({ actor_id: user.id, action, target_id: targetId, detail });

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim().slice(0, 60);
    const role = String(body.role ?? 'kts');
    const phone = normalizePhone(body.phone);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
    if (!fullName) return json({ error: 'name_required' }, 400);
    if (!['kts', 'manager', 'admin'].includes(role)) return json({ error: 'invalid_role' }, 400);
    if (phone === undefined) return json({ error: 'invalid_phone' }, 400);

    const password = tempPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? '';
      if (/already|registered|exists/i.test(msg)) return json({ error: 'email_exists' }, 409);
      return json({ error: 'create_failed', detail: msg }, 500);
    }
    const id = created.user.id;
    // Trigger handle_new_staff đã tạo dòng staff (role mặc định kts)
    const { error: profErr } = await admin.from('staff').update({ full_name: fullName, phone, email }).eq('id', id);
    if (profErr) return json({ error: 'profile_failed', detail: profErr.message, id, password }, 500);
    if (role !== 'kts') {
      const { error: roleErr } = await asCaller.rpc('set_staff_role', { p_staff_id: id, p_role: role });
      if (roleErr) return json({ error: 'role_failed', detail: roleErr.message, id, password }, 500);
    }
    await audit('staff_created', id, { name: fullName, email, role });
    return json({ id, email, password });
  }

  const staffId = String(body.staff_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return json({ error: 'invalid_request' }, 400);
  const { data: target } = await admin.from('staff').select('id, full_name, email, active').eq('id', staffId).maybeSingle();
  if (!target) return json({ error: 'staff_not_found' }, 404);

  if (body.action === 'reset_password') {
    if (staffId === user.id) return json({ error: 'use_profile' }, 400);
    if (target.active === false) return json({ error: 'staff_inactive' }, 400);
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(staffId, { password });
    if (error) return json({ error: 'reset_failed', detail: error.message }, 500);
    await audit('password_reset', staffId, { name: target.full_name || target.email });
    return json({ id: staffId, email: target.email, password });
  }

  if (body.action === 'sync_ban') {
    if (staffId === user.id) return json({ error: 'cannot_deactivate_self' }, 400);
    const { error } = await admin.auth.admin.updateUserById(staffId, { ban_duration: target.active === false ? BAN_FOREVER : 'none' });
    if (error) return json({ error: 'ban_failed', detail: error.message }, 500);
    return json({ id: staffId, banned: target.active === false });
  }

  return json({ error: 'invalid_request' }, 400);
});
