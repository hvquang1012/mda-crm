// ============================================================
// Tab "Tổng quan" — dashboard đa công trình cho chỉ huy trưởng/ban
// giám đốc. Đây là màn hình mở đầu tiên mỗi sáng: công trình nào
// đang có vấn đề, đội nào đang bị cảnh báo.
// ============================================================
import { state } from './state.js';
import { escapeHtml, statusClass, daysUntil } from '../ui.js';

export async function renderDashboard() {
  const wrap = document.getElementById('dashboardList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data: projects, error: pErr } = await state.supabase
    .from('projects').select('*').eq('status', 'active').order('created_at', { ascending: false });
  if (pErr || !projects) { wrap.innerHTML = '<div class="empty-hint">Không tải được dự án.</div>'; return; }
  state.projects = projects;

  if (!projects.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có công trình nào. Bấm ＋ ở tab Công việc để tạo.</div>';
    return;
  }

  const { data: packages } = await state.supabase
    .from('work_packages')
    .select('*, subcontractors(name,trade), work_items(id,name,percent,status)')
    .in('project_id', projects.map(p => p.id));

  const { data: openAlerts } = await state.supabase
    .from('alerts').select('*').is('acknowledged_at', null)
    .in('project_id', projects.map(p => p.id));

  const alertsByItem = new Map();
  const alertsByProject = new Map();
  (openAlerts || []).forEach(a => {
    if (a.work_item_id) {
      if (!alertsByItem.has(a.work_item_id)) alertsByItem.set(a.work_item_id, []);
      alertsByItem.get(a.work_item_id).push(a);
    }
    if (!alertsByProject.has(a.project_id)) alertsByProject.set(a.project_id, []);
    alertsByProject.get(a.project_id).push(a);
  });

  wrap.innerHTML = projects.map(p => {
    const pkgs = (packages || []).filter(w => w.project_id === p.id);
    const projAlerts = alertsByProject.get(p.id) || [];
    const hasCritical = projAlerts.some(a => a.severity === 'critical');
    const hasWarning = projAlerts.some(a => a.severity === 'warning');
    const remain = daysUntil(p.end_date);
    const overallBadge = hasCritical
      ? `<span class="badge delayed">🔴 ${remain < 0 ? 'Trễ ' + Math.abs(remain) + ' ngày' : 'Có vấn đề'}</span>`
      : hasWarning
        ? `<span class="badge onTrack">🟡 Cần chú ý</span>`
        : `<span class="badge ahead">🟢 Đúng tiến độ</span>`;

    const wpRows = pkgs.map(wp => {
      const items = wp.work_items || [];
      const pct = items.length ? Math.round(items.reduce((a, it) => a + (it.percent || 0), 0) / items.length) : 0;
      const itemAlerts = items.flatMap(it => alertsByItem.get(it.id) || []);
      const warnMsg = itemAlerts[0] ? shortAlertLabel(itemAlerts[0]) : '';
      return `
        <div class="wp-row">
          <div class="wp-trade">${tradeLabel(wp.subcontractors?.trade)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(wp.subcontractors?.name || wp.name)}</div>
            <div class="wp-mini-track"><div class="wp-mini-fill ${statusClass(wp.status)}" style="width:${pct}%;background:var(--primary);"></div></div>
          </div>
          <div class="wp-pct">${pct}%</div>
          ${warnMsg ? `<span class="wp-warn">${warnMsg}</span>` : ''}
        </div>`;
    }).join('') || '<div class="empty-hint" style="padding:12px 0;">Chưa có hạng mục nào</div>';

    return `
      <div class="project-summary-card">
        <div class="project-summary-top">
          <div>
            <div class="project-summary-name">${escapeHtml(p.name)}</div>
            <div class="project-summary-client">${escapeHtml(p.client_name || '')} · còn ${remain} ngày</div>
          </div>
          ${overallBadge}
        </div>
        ${wpRows}
      </div>`;
  }).join('');
}

function tradeLabel(t) { return { da: 'Đá', dien: 'Điện' }[t] || 'Khác'; }
function shortAlertLabel(a) {
  const icon = { no_crew: '⚠ không ra quân', forecast_delay: '⏱ dự báo trễ', chain_block: '🚫 đang chặn', issue_pending: '❗ vướng mắc', plan_deviation: '📉 lệch KH' }[a.kind] || '⚠';
  return icon;
}
