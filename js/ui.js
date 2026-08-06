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

export function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 2200);
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
