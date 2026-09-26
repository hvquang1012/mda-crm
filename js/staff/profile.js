// ============================================================
// Hộp "Cài đặt tài khoản" (bấm tên ở đầu trang): tự đổi tên hiển thị
// và số điện thoại. DB chỉ cho authenticated update(full_name, phone)
// trên dòng của chính mình — role vẫn chỉ đổi qua set_staff_role().
// Số lưu dạng 0xxxxxxxxx (ràng buộc staff_phone_check) để dựng link
// Zalo ở danh sách nhân viên.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, rpcErrorText } from '../ui.js';

// '' = xoá số; '0xxxxxxxxx' = hợp lệ; null = sai định dạng
export function normalizePhone(s) {
  let d = String(s || '').replace(/[\s.\-()]/g, '');
  if (!d) return '';
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  else if (/^84\d{9}$/.test(d)) d = '0' + d.slice(2);
  return /^0\d{9}$/.test(d) ? d : null;
}

export const zaloUrl = phone => `https://zalo.me/${phone}`;

export function zaloLinkHtml(phone) {
  if (!phone) return '';
  return `<a class="zalo-btn" href="${zaloUrl(escapeHtml(phone))}" target="_blank" rel="noopener" title="Nhắn Zalo ${escapeHtml(phone)}">Zalo</a>`;
}

export const ROLE_VI = { kts: 'KTS', staff: 'KTS', manager: 'Quản lý', admin: 'Quản trị' };
const ROLE_ICON = { kts: 'kts', staff: 'kts', manager: 'manager', admin: 'admin' };

// Icon vai trò (assets/icons/role-*.svg) — thay chữ "Quản trị" cho gọn đầu trang
export function roleIconHtml(role) {
  const k = ROLE_ICON[role];
  return k ? `<img class="role-ic" src="assets/icons/role-${k}.svg" alt="${ROLE_VI[role]}" title="${ROLE_VI[role]}">` : '';
}

export function renderStaffName() {
  const btn = document.getElementById('staffName');
  const roleVi = ROLE_VI[state.staffRole] || '';
  btn.innerHTML = roleIconHtml(state.staffRole) + `<span class="header-user-name">${escapeHtml(state.profile?.full_name || state.user.email)}</span>`;
  btn.title = btn.ariaLabel = (roleVi ? roleVi + ' — ' : '') + 'Cài đặt tài khoản';
}

export function openProfileModal() {
  const modal = document.getElementById('profileModal');
  const name = document.getElementById('profileName');
  const phone = document.getElementById('profilePhone');
  const err = document.getElementById('profileError');
  const zalo = document.getElementById('profileZalo');
  name.value = state.profile?.full_name || '';
  phone.value = state.profile?.phone || '';
  err.textContent = '';

  const preview = () => {
    const p = normalizePhone(phone.value);
    zalo.hidden = !p;
    if (p) { zalo.href = zaloUrl(p); zalo.textContent = `Mở Zalo ${p} ↗`; }
  };
  phone.oninput = () => { err.textContent = ''; preview(); };
  preview();

  const close = () => modal.classList.remove('show');
  document.getElementById('btnProfileCancel').onclick = close;
  document.getElementById('btnProfileSave').onclick = async () => {
    const full_name = name.value.trim();
    const p = normalizePhone(phone.value);
    if (!full_name) { err.textContent = 'Nhập tên hiển thị.'; name.focus(); return; }
    if (p === null) { err.textContent = 'Số điện thoại gồm 10 số, bắt đầu bằng 0 (VD: 0912 345 678).'; phone.focus(); return; }
    const btn = document.getElementById('btnProfileSave');
    btn.disabled = true;
    const { error } = await state.supabase.from('staff')
      .update({ full_name, phone: p || null }).eq('id', state.user.id);
    btn.disabled = false;
    if (error) {
      // Chưa chạy migrations/001_staff_phone.sql trên Supabase
      if (/phone/.test(error.message || '') && /column|schema/i.test(error.message || '')) err.textContent = 'Máy chủ chưa cập nhật để lưu số điện thoại — báo kỹ thuật.';
      else err.textContent = rpcErrorText(error, 'Không lưu được — thử lại');
      return;
    }
    state.profile = { ...state.profile, full_name, phone: p || null };
    renderStaffName();
    close();
    showToast('Đã lưu');
  };

  modal.classList.add('show');
}
