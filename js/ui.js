// ============================================================
// Tiện ích UI dùng chung — tái sử dụng nguyên vẹn từ index.html bản cũ
// (mda-crm-pwa v1: escapeHtml, displayDate, todayISO, showToast,
//  showScreen, setOnlineDots), cộng thêm helper báo lỗi cho mutation.
// ============================================================

export const STATUS_LABEL = {
  onTrack: 'Đúng tiến độ', delayed: 'Trễ tiến độ', ahead: 'Vượt tiến độ',
  notStarted: 'Chưa bắt đầu', done: 'Hoàn thành'
};
export function statusClass(s) { return s === 'done' ? 'ahead' : s; }

export function displayDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}
export function todayISO() { return new Date().toISOString().slice(0, 10); }

// Số ngày còn lại tới `dateStr`. Âm nghĩa là đã trễ — KHÔNG kẹp về 0
// (bug đã có ở bản cũ: Math.max(0,...) che mất số ngày trễ thật sự).
export function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(dateStr + 'T00:00:00');
  return Math.round((end - today) / 86400000);
}

export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

export function showToast(msg, isError, ms = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

export function setOnlineDots(ok, ids) {
  (ids || ['staffOnlineDot', 'clientOnlineDot', 'crewOnlineDot']).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('off', !ok);
  });
}

// Bọc mọi lệnh ghi Supabase: luôn kiểm tra error và toast, thay vì
// im lặng bỏ qua như bản cũ (insert/update/delete không check error).
export async function db(promise, { successMsg, errorMsg } = {}) {
  const { data, error } = await promise;
  if (error) {
    console.error(error);
    showToast(errorMsg || ('Lỗi: ' + (error.message || 'không lưu được')), true);
    return { data: null, error };
  }
  if (successMsg) showToast(successMsg);
  return { data, error: null };
}

// Mã lỗi do các hàm SQL raise (xem supabase/schema.sql) → câu người
// dùng hiểu được. supabase.rpc() KHÔNG throw — luôn đọc { error } rồi
// đưa qua đây thay vì hiện error.message thô.
const RPC_ERROR_VI = {
  not_authenticated: 'Phiên đăng nhập đã hết — đăng nhập lại giúp',
  forbidden: 'Bạn không phụ trách công trình này',
  already_processed: 'Báo cáo đã được người khác duyệt / trả lại trước đó',
  report_not_found: 'Không tìm thấy báo cáo (có thể đã bị xử lý)',
  mixed_items: 'Nhóm báo cáo thuộc nhiều đầu việc khác nhau — tải lại trang',
  negative_qty: 'Khối lượng duyệt không được âm',
  empty_group: 'Chưa chọn báo cáo nào',
  admin_only: 'Chỉ quản trị viên được đổi vai trò',
  cannot_demote_self: 'Không tự hạ quyền của chính mình được',
  invalid_or_expired_token: 'Link đã hết hạn hoặc bị thu hồi — liên hệ giám sát',
  project_closed: 'Công trình đã bàn giao xong — link này đã khoá. Cần báo thêm thì liên hệ giám sát',
  item_not_in_scope: 'Đầu việc này không thuộc đội của bạn',
  note_required: 'Vui lòng nhập ghi chú',
  photo_required: 'Vui lòng chụp ít nhất 1 ảnh',
  description_required: 'Vui lòng mô tả vướng mắc',
  invalid_report_date: 'Báo cáo quá 7 ngày chưa gửi được — báo lại từ đầu',
  message_empty: 'Tin nhắn trống — gõ nội dung hoặc gửi ảnh',
  message_too_long: 'Tin nhắn quá dài (tối đa 2000 chữ) — chia làm nhiều tin',
  photo_not_in_scope: 'Ảnh không thuộc công trình của đội — chụp lại rồi gửi'
};
export function rpcErrorText(error, fallback = 'Thao tác thất bại — thử lại') {
  const msg = String(error?.message || '');
  const code = Object.keys(RPC_ERROR_VI).find(k => msg.includes(k));
  if (code) return RPC_ERROR_VI[code];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Mất kết nối mạng — thử lại';
  if (/row-level security|permission denied/i.test(msg)) return 'Bạn không có quyền với dữ liệu này';
  return fallback;
}

export function unitLabel(u) { return { m2: 'm²', diem: 'điểm', md: 'md', tron_goi: 'trọn gói' }[u] || u || ''; }
export function tradeLabel(t) { return { da: 'Đá', dien: 'Điện' }[t] || 'Khác'; }

// Số giờ/ngày đã trôi qua kể từ `iso` — "3 giờ", "2 ngày"
export function ageLabel(iso) {
  const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
  if (h < 1) return 'vừa xong';
  if (h < 24) return h + ' giờ';
  return Math.floor(h / 24) + ' ngày';
}

// Chia sẻ link qua Zalo / Messenger bằng bảng chia sẻ của điện thoại,
// máy không hỗ trợ thì copy.
export async function shareLink(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(url); showToast('Đã copy link — dán vào Zalo'); return 'copied'; }
  catch (e) { prompt('Copy link:', url); return 'prompted'; }
}
