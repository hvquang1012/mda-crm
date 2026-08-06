// ============================================================
// Tab "Cảnh báo" — danh sách 5 loại cảnh báo tự động do compute_alerts()
// sinh ra (xem supabase/schema.sql), có thể xác nhận đã xử lý (ẩn khỏi
// dashboard) hoặc bấm "Kiểm tra ngay" để chạy lại thủ công.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast } from '../ui.js';

export async function renderAlerts() {
  const wrap = document.getElementById('alertsList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data, error } = await state.supabase
    .from('alerts')
    .select('*, projects(name)')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được cảnh báo.</div>'; return; }
  if (!data || !data.length) { wrap.innerHTML = '<div class="empty-hint">Không có cảnh báo nào 🎉</div>'; return; }

  wrap.innerHTML = data.map(a => `
    <div class="alert-item ${a.severity}" data-id="${a.id}">
      <div class="msg">
        <strong>${escapeHtml(a.projects?.name || '')}</strong><br>
        ${escapeHtml(a.message)}
        <div style="font-size:10.5px;color:var(--ink-faint);margin-top:3px;">${new Date(a.created_at).toLocaleString('vi-VN')}</div>
      </div>
      <button class="ack" data-id="${a.id}" title="Đã xử lý">✓</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.ack').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await state.supabase.from('alerts')
        .update({ acknowledged_by: state.user.id, acknowledged_at: new Date().toISOString() })
        .eq('id', btn.dataset.id);
      if (error) { showToast('Không xác nhận được', true); return; }
      renderAlerts();
    };
  });
}

export function wireCheckNowButton() {
  const btn = document.getElementById('btnCheckAlertsNow');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Đang kiểm tra...';
    const { data, error } = await state.supabase.rpc('compute_alerts');
    btn.disabled = false; btn.textContent = 'Kiểm tra ngay';
    if (error) { showToast('Kiểm tra thất bại', true); return; }
    showToast(`Đã kiểm tra — ${data} cảnh báo mới`);
    renderAlerts();
  };
}
