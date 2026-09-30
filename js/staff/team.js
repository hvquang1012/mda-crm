// ============================================================
// Màn "Nhân viên" (quản lý / quản trị) — mở từ hộp Cài đặt tài khoản.
//   Danh sách: vai trò, Zalo, số công trình phụ trách, báo cáo đang chờ
//     duyệt, đã duyệt 30 ngày, lần đăng nhập gần nhất — staff_overview().
//   Quản trị: ＋ Nhân viên, đổi vai trò, khoá / mở khoá, cấp lại mật khẩu.
//   Nhật ký: ai làm gì (bảng audit_log, chỉ quản lý đọc được).
// Tạo tài khoản / chặn đăng nhập / mật khẩu cần Edge Function admin-users
// (service_role). Khoá quyền trong DB thì gọi thẳng set_staff_active() —
// Edge Function chưa cài thì người bị khoá vẫn không xem được gì.
// ============================================================
import { state, isManager } from './state.js';
import { escapeHtml, showToast, rpcErrorText, ageLabel } from '../ui.js';
import { ROLE_VI, roleIconHtml, zaloLinkHtml, normalizePhone } from './profile.js';

let view = 'staff';            // staff | log
let staffList = [];            // kết quả staff_overview() gần nhất
let logProjectId = '';         // lọc nhật ký theo công trình

const isAdmin = () => state.staffRole === 'admin';
// "3 giờ trước" — ageLabel trả "vừa xong" thì không thêm "trước"
const ago = (iso) => { const a = ageLabel(iso); return a === 'vừa xong' ? a : a + ' trước'; };
const $ = (id) => document.getElementById(id);
const closeModal = (id) => $(id).classList.remove('show');
const staffName = (id) => {
  const s = staffList.find(x => x.id === id);
  return s ? (s.full_name || s.email || 'Không tên') : 'Nhân viên cũ';
};

export async function openTeam() {
  if (!isManager()) return;
  view = 'staff';
  $('btnTeamAdd').hidden = !isAdmin();
  $('teamModal').classList.add('show');
  await renderTeam();
}

async function renderTeam() {
  document.querySelectorAll('[data-team-view]').forEach(b => b.classList.toggle('active', b.dataset.teamView === view));
  $('btnTeamAdd').hidden = !isAdmin() || view !== 'staff';
  if (view === 'staff') await renderStaff();
  else await renderLog();
}

// ---------- Danh sách ----------
async function renderStaff() {
  const wrap = $('teamBody');
  if (!staffList.length) wrap.innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  const { data, error } = await state.supabase.rpc('staff_overview');
  if (error) {
    wrap.innerHTML = `<div class="empty-hint compact">${/staff_overview|function/i.test(error.message || '')
      ? 'Máy chủ chưa cập nhật chức năng quản lý nhân viên — báo kỹ thuật chạy migrations/009.'
      : escapeHtml(rpcErrorText(error, 'Không tải được danh sách nhân viên.'))}</div>`;
    return;
  }
  staffList = data || [];
  const active = staffList.filter(s => s.active);
  const locked = staffList.filter(s => !s.active);
  wrap.innerHTML = active.map(staffCard).join('')
    + (locked.length ? `<div class="section-label" style="margin-top:14px;">Đã khoá (${locked.length})</div>${locked.map(staffCard).join('')}` : '');

  wrap.querySelectorAll('[data-role-of]').forEach(sel => sel.onchange = () => changeRole(sel.dataset.roleOf, sel.value));
  wrap.querySelectorAll('[data-lock]').forEach(b => b.onclick = () => setActive(b.dataset.lock, false));
  wrap.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => setActive(b.dataset.unlock, true));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPassword(b.dataset.reset));
}

function staffCard(s) {
  const me = s.id === state.user.id;
  const name = s.full_name || s.email || 'Không tên';
  const oldHours = s.oldest_pending_at ? (Date.now() - new Date(s.oldest_pending_at).getTime()) / 3600000 : 0;
  const pending = s.pending_reports > 0
    ? `<span class="${oldHours > 24 ? 'stat-warn' : ''}">📋 ${s.pending_reports} chờ duyệt · lâu nhất ${ageLabel(s.oldest_pending_at)}</span>`
    : '<span>📋 Không có báo cáo chờ</span>';
  const signIn = s.last_sign_in_at ? `vào app ${ago(s.last_sign_in_at)}` : 'chưa đăng nhập lần nào';
  const scope = s.role === 'kts' ? `🏗 ${s.projects} công trình` : '🏗 Thấy mọi công trình';
  const canEdit = isAdmin() && !me;
  return `
    <div class="staff-card${s.active ? '' : ' inactive'}">
      <div class="staff-card-head">
        <div class="staff-card-name">${roleIconHtml(s.role)}${escapeHtml(name)}${me ? ' (bạn)' : ''}</div>
        ${s.active ? zaloLinkHtml(s.phone) : ''}
      </div>
      <div class="staff-card-meta">${escapeHtml(s.email || '')}${s.email ? ' · ' : ''}${ROLE_VI[s.role] || ''}${s.active ? '' : ` · khoá ${ago(s.deactivated_at)}`}</div>
      ${s.active ? `
      <div class="staff-card-stats">
        <span>${scope}</span>${pending}
        <span>✔ ${s.reviewed_30d} báo cáo đã xử lý / 30 ngày</span>
        <span>🕘 ${signIn}</span>
      </div>` : ''}
      ${canEdit ? `
      <div class="staff-card-actions">
        ${s.active ? `
          <select data-role-of="${s.id}" aria-label="Vai trò">
            ${['kts', 'manager', 'admin'].map(r => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${ROLE_VI[r]}</option>`).join('')}
          </select>
          <button type="button" class="icon-btn" data-reset="${s.id}">Cấp lại mật khẩu</button>
          <button type="button" class="icon-btn danger" data-lock="${s.id}">Khoá</button>`
        : `<button type="button" class="icon-btn strong" data-unlock="${s.id}">Mở khoá</button>`}
      </div>` : ''}
    </div>`;
}

async function changeRole(id, role) {
  const { error } = await state.supabase.rpc('set_staff_role', { p_staff_id: id, p_role: role });
  if (error) showToast(rpcErrorText(error), true);
  else showToast(`Đã đổi ${staffName(id)} thành ${ROLE_VI[role]}`);
  await renderStaff();
}

async function setActive(id, active) {
  const name = staffName(id);
  if (!active && !confirm(`Khoá tài khoản "${name}"?\n\nNgười này không đăng nhập và không xem được công trình nào nữa. Báo cáo đã duyệt và lịch sử vẫn giữ nguyên. Mở khoá lại được bất cứ lúc nào.`)) return;
  const { error } = await state.supabase.rpc('set_staff_active', { p_staff_id: id, p_active: active });
  if (error) { showToast(rpcErrorText(error), true); return; }
  // Chặn / mở đăng nhập theo đúng cột active vừa ghi
  const res = await callAdmin({ action: 'sync_ban', staff_id: id });
  if (res.error) showToast(`${active ? 'Đã mở quyền' : 'Đã khoá quyền xem'} ${name}, nhưng ${active ? 'chưa mở' : 'chưa chặn'} được đăng nhập: ${res.error}`, true, 7000);
  else showToast(active ? `Đã mở khoá ${name}` : `Đã khoá ${name}`);
  await renderStaff();
}

async function resetPassword(id) {
  const name = staffName(id);
  if (!confirm(`Cấp mật khẩu mới cho "${name}"?\n\nMật khẩu cũ hết dùng được ngay.`)) return;
  const res = await callAdmin({ action: 'reset_password', staff_id: id });
  if (res.error) { showToast(res.error, true, 6000); return; }
  showPassword(res.data);
}

// ---------- Thêm nhân viên ----------
function openStaffForm() {
  ['staffFormName', 'staffFormEmail', 'staffFormPhone'].forEach(k => { $(k).value = ''; });
  $('staffFormRole').value = 'kts';
  $('staffFormError').textContent = '';
  $('staffFormModal').classList.add('show');
  $('staffFormName').focus();
}

async function saveStaffForm() {
  const err = $('staffFormError');
  const full_name = $('staffFormName').value.trim();
  const email = $('staffFormEmail').value.trim();
  const phone = normalizePhone($('staffFormPhone').value);
  const role = $('staffFormRole').value;
  if (!full_name) { err.textContent = 'Nhập tên nhân viên.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Email chưa đúng — dùng để đăng nhập.'; return; }
  if (phone === null) { err.textContent = 'Số điện thoại gồm 10 số, bắt đầu bằng 0.'; return; }
  const btn = $('btnStaffFormSave');
  btn.disabled = true;
  const res = await callAdmin({ action: 'create', full_name, email, phone: phone || null, role });
  btn.disabled = false;
  // Tài khoản đã tạo nhưng bước sau hỏng (tên / vai trò) — vẫn phải đưa mật khẩu
  if (res.data?.password) {
    closeModal('staffFormModal');
    showPassword({ ...res.data, email });
    if (res.error) showToast(`Đã tạo tài khoản nhưng: ${res.error} — sửa lại ở danh sách.`, true, 7000);
    await renderStaff();
    return;
  }
  err.textContent = res.error || 'Không tạo được tài khoản — thử lại.';
}

// ---------- Mật khẩu tạm: hiện MỘT lần ----------
function showPassword({ email, password }) {
  const text = `Tài khoản app tiến độ Minh Đức\nTrang: ${location.origin}${location.pathname}\nEmail: ${email}\nMật khẩu tạm: ${password}\nĐăng nhập xong bấm tên ở đầu trang để đổi mật khẩu.`;
  $('tempPassEmail').textContent = email || '';
  $('tempPassValue').textContent = password;
  $('btnTempPassShare').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); showToast('Đã copy — dán vào Zalo gửi nhân viên'); }
    catch (e) { prompt('Copy nội dung:', text); }
  };
  $('btnTempPassDone').onclick = () => { $('tempPassValue').textContent = ''; closeModal('passwordModal'); };
  $('passwordModal').classList.add('show');
}

// ---------- Nhật ký ----------
const ACTION_TEXT = {
  staff_created: d => `tạo tài khoản <b>${d.name}</b> (${ROLE_VI[d.role] || ''})`,
  staff_role: d => `đổi vai trò <b>${d.name}</b>: ${ROLE_VI[d.from] || d.from} → ${ROLE_VI[d.to] || d.to}`,
  staff_deactivated: d => `khoá tài khoản <b>${d.name}</b>`,
  staff_activated: d => `mở khoá tài khoản <b>${d.name}</b>`,
  password_reset: d => `cấp lại mật khẩu cho <b>${d.name}</b>`,
  member_added: d => `giao <b>${d.name}</b> phụ trách ${d.project}`,
  member_removed: d => `gỡ <b>${d.name}</b> khỏi ${d.project}`,
  project_created: d => `tạo công trình <b>${d.project}</b>`,
  project_closed: d => `đóng công trình <b>${d.project}</b>`,
  project_reopened: d => `mở lại công trình <b>${d.project}</b>`,
  project_deleted: d => `xoá công trình <b>${d.project}</b>`,
  crew_link_created: d => `cấp link thợ cho <b>${d.name || 'đội'}</b>${d.team ? ` (${d.team})` : ''} — ${d.project}`,
  crew_link_revoked: d => `thu hồi link thợ của <b>${d.name || 'đội'}</b>${d.team ? ` (${d.team})` : ''} — ${d.project}`,
  client_link_created: d => `cấp link chủ nhà — ${d.project}`,
  client_link_revoked: d => `thu hồi link chủ nhà — ${d.project}`
};

async function renderLog() {
  const wrap = $('teamBody');
  wrap.innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  if (!staffList.length) {
    const { data } = await state.supabase.rpc('staff_overview');
    staffList = data || [];
  }
  let q = state.supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(100);
  if (logProjectId) q = q.eq('project_id', logProjectId);
  const { data, error } = await q;
  if (error) { wrap.innerHTML = `<div class="empty-hint compact">${escapeHtml(rpcErrorText(error, 'Không tải được nhật ký.'))}</div>`; return; }

  const projects = [...(state.projects || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  wrap.innerHTML = `
    <select id="teamLogProject" aria-label="Lọc theo công trình">
      <option value="">Mọi công trình và nhân sự</option>
      ${projects.map(p => `<option value="${p.id}" ${p.id === logProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
    </select>
    ${(data || []).length ? (data || []).map(logRow).join('') : '<div class="empty-hint compact">Chưa có thao tác nào được ghi.</div>'}`;
  $('teamLogProject').onchange = (e) => { logProjectId = e.target.value; renderLog(); };
}

function logRow(r) {
  // Mọi giá trị trong detail là dữ liệu người dùng → escape trước khi ghép vào câu
  const d = Object.fromEntries(Object.entries(r.detail || {}).map(([k, v]) => [k, escapeHtml(v == null ? '' : String(v))]));
  const fmt = ACTION_TEXT[r.action];
  const who = r.actor_id ? escapeHtml(staffName(r.actor_id)) : 'Hệ thống';
  const t = new Date(r.created_at);
  const when = `${t.getDate()}/${t.getMonth() + 1} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return `<div class="log-row"><span class="log-time">${when}</span><span><b>${who}</b> ${fmt ? fmt(d) : escapeHtml(r.action)}</span></div>`;
}

// ---------- Gọi Edge Function admin-users ----------
// Trả { data } hoặc { error: câu tiếng Việt } (functions.invoke không throw
// với lỗi HTTP — body lỗi nằm trong error.context).
async function callAdmin(body) {
  const { data, error } = await state.supabase.functions.invoke('admin-users', { body });
  if (!error) return { data };
  let payload = null;
  try { payload = await error.context?.clone().json(); } catch (e) { /* không phải JSON */ }
  if (!payload) {
    return { error: /Failed to fetch|NetworkError/i.test(error.message || '') || !error.context
      ? 'mất kết nối mạng hoặc máy chủ chưa cài chức năng quản trị tài khoản (admin-users) — báo kỹ thuật'
      : 'máy chủ chưa cài chức năng quản trị tài khoản (admin-users) — báo kỹ thuật' };
  }
  return { data: payload, error: rpcErrorText({ message: payload.error || '' }, payload.detail || 'thao tác thất bại') };
}

// ---------- Nối nút (1 lần) ----------
document.querySelectorAll('[data-team-view]').forEach(b => b.onclick = () => { view = b.dataset.teamView; renderTeam(); });
$('btnTeamClose').onclick = () => closeModal('teamModal');
$('btnTeamAdd').onclick = openStaffForm;
$('btnStaffFormCancel').onclick = () => closeModal('staffFormModal');
$('btnStaffFormSave').onclick = saveStaffForm;
