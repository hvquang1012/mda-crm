// ============================================================
// Tab "Tổng quan" — màn hình mở đầu tiên mỗi sáng của quản lý / KTS:
//   1. 4 con số: công trình đang chạy · đang trễ · chờ duyệt · vướng mắc
//   2. Công trình xếp theo rủi ro (trễ nhất lên đầu), thanh "kế hoạch vs
//      thực tế" có trọng số theo thời lượng — bấm để mở Timeline
//   3. Đội thầu phụ cần chú ý
//   4. Hoạt động báo cáo 14 ngày
// Toàn bộ số liệu từ MỘT lời gọi dashboard_summary() (schema.sql) — RLS
// lọc sẵn: KTS chỉ thấy công trình mình phụ trách.
// ============================================================
import { state, isManager } from './state.js';
import { escapeHtml, displayDate, tradeLabel } from '../ui.js';

const ALERT_LABEL = {
  no_crew: 'không ra quân', forecast_delay: 'dự báo trễ', chain_block: 'đang bị chặn',
  issue_pending: 'vướng mắc treo', plan_deviation: 'lệch kế hoạch'
};

// Ngưỡng giống compute_alerts(): lệch >10% cần chú ý, >20% nghiêm trọng
// Đầu việc xong hết thì không còn gì để xử lý — kể cả khi đã quá ngày bàn giao
function riskOf(p) {
  if (p.item_count > 0 && p.done_items === p.item_count) return 'done';
  if (p.days_left < 0 || p.gap > 20 || p.critical_alerts > 0 || p.blocking_issues > 0) return 'critical';
  if (p.gap > 10 || p.warning_alerts > 0 || p.open_issues > 0 || p.delayed_items > 0) return 'warning';
  return 'good';
}
const RISK_LABEL = { critical: '🔴 Cần xử lý', warning: '🟡 Cần chú ý', good: '🟢 Đúng tiến độ', done: '✅ Đã xong' };
const RISK_RANK = { critical: 0, warning: 1, good: 2, done: 3 };

let lastData = null;

export async function renderDashboard() {
  const wrap = document.getElementById('dashboardList');
  if (!wrap) return;
  if (!lastData) wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data, error } = await state.supabase.rpc('dashboard_summary');
  if (error || !data) { wrap.innerHTML = '<div class="empty-hint">Không tải được số liệu tổng quan.</div>'; return; }
  lastData = data;
  render(wrap, data);
}

function render(wrap, data) {
  const all = (data.projects || []).map(p => ({ ...p, risk: riskOf(p) }));
  const mine = all.filter(p => p.is_mine);
  // Quản lý mặc định xem tất cả; KTS chỉ thấy công trình của mình nên bộ lọc thừa
  const showScope = isManager() && mine.length > 0 && mine.length < all.length;
  const projects = (showScope && state.dashboardScope === 'mine' ? mine : all)
    .sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || b.gap - a.gap || a.days_left - b.days_left);

  if (!all.length) {
    wrap.innerHTML = `<div class="empty-hint">${isManager()
      ? 'Chưa có công trình nào đang chạy. Bấm ＋ Dự án ở tab Công việc để tạo.'
      : 'Bạn chưa được giao công trình nào. Tự tạo ở tab Công việc, hoặc nhờ quản lý giao.'}</div>`;
    return;
  }

  const sum = (k) => projects.reduce((a, p) => a + (p[k] || 0), 0);
  const late = projects.filter(p => p.risk === 'critical').length;
  const subs = (data.subcontractors || []).filter(s => s.delayed_items > 0 || s.idle_items > 0 || s.rejected_30d > 0).slice(0, 5);

  wrap.innerHTML = `
    ${showScope ? `
      <div class="seg-switch" role="group" aria-label="Phạm vi">
        <button type="button" data-scope="all" class="${state.dashboardScope !== 'mine' ? 'active' : ''}">Tất cả (${all.length})</button>
        <button type="button" data-scope="mine" class="${state.dashboardScope === 'mine' ? 'active' : ''}">Của tôi (${mine.length})</button>
      </div>` : ''}
    <div class="kpi-row">
      ${kpi('Đang chạy', projects.length, 'công trình', null, 'items')}
      ${kpi('Cần xử lý', late, 'công trình', late ? 'critical' : null, null)}
      ${kpi('Chờ duyệt', sum('pending_reports'), 'báo cáo', sum('pending_reports') ? 'warning' : null, 'approvals')}
      ${kpi('Vướng mắc', sum('open_issues'), sum('blocking_issues') ? `${sum('blocking_issues')} đang chặn` : 'đang mở', sum('blocking_issues') ? 'critical' : sum('open_issues') ? 'warning' : null, 'alerts')}
    </div>

    <div class="dash-grid">
      <section class="dash-main">
        <div class="section-label">Công trình — rủi ro cao lên trước</div>
        <div id="dashboardProjects">${projects.map(projectCard).join('')}</div>
      </section>
      <aside class="dash-side">
        <div class="section-label">Hoạt động báo cáo 14 ngày</div>
        <div class="dash-panel">${activityChart(data.activity || [])}</div>
        <div class="section-label">Đội thầu phụ cần chú ý</div>
        <div class="dash-panel">${subs.length ? subsTable(subs) : '<div class="empty-hint compact">Các đội đều ổn 👍</div>'}</div>
        <div class="dash-legend">
          <span><i class="lg-plan"></i>Kế hoạch đáng đạt hôm nay</span>
          <span><i class="lg-actual"></i>Thực tế đã nghiệm thu</span>
        </div>
      </aside>
    </div>`;

  wrap.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { state.dashboardScope = b.dataset.scope; render(wrap, lastData); });
  wrap.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => state.navigate(el.dataset.goto));
  wrap.querySelectorAll('[data-open-project]').forEach(el => {
    const open = () => {
      state.currentProjectId = el.dataset.openProject;
      state.itemsView = 'timeline';
      const sel = document.getElementById('projectSelect');
      if (sel) sel.value = state.currentProjectId;
      state.navigate('items');
    };
    el.onclick = (e) => { if (!e.target.closest('[data-goto-approvals]')) open(); };
    el.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
  wrap.querySelectorAll('[data-goto-approvals]').forEach(el => el.onclick = (e) => {
    e.stopPropagation();
    state.approvalsProjectFilter = el.dataset.gotoApprovals;
    state.navigate('approvals');
  });
  wireActivityHover(wrap, data.activity || []);
}

function kpi(label, value, unit, tone, goto) {
  return `
    <${goto ? 'button type="button"' : 'div'} class="kpi ${tone || ''}" ${goto ? `data-goto="${goto}"` : ''}>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-unit">${escapeHtml(unit)}</div>
    </${goto ? 'button' : 'div'}>`;
}

// Thanh kép: nền = kế hoạch đáng đạt hôm nay, lõi = thực tế. Lõi ngắn hơn
// nền bao nhiêu là chậm bấy nhiêu — đọc được mà không cần số.
function dualBar(actual, planned, risk) {
  return `
    <div class="dual-bar" role="img" aria-label="Thực tế ${actual}%, kế hoạch ${planned}%">
      <div class="dual-plan" style="width:${Math.min(100, planned)}%"></div>
      <div class="dual-actual ${risk}" style="width:${Math.min(100, actual)}%"></div>
    </div>`;
}

function gapLabel(gap) {
  if (gap > 0) return `<span class="gap behind">chậm ${gap}%</span>`;
  if (gap < 0) return `<span class="gap ahead">vượt ${-gap}%</span>`;
  return '<span class="gap">đúng kế hoạch</span>';
}

function projectCard(p) {
  const done = p.risk === 'done';
  const days = done ? 'đã xong hết đầu việc' : p.days_left < 0 ? `<b class="neg">trễ ${-p.days_left} ngày</b>` : `còn ${p.days_left} ngày`;
  const chips = [
    p.pending_reports ? `<button type="button" class="dash-chip" data-goto-approvals="${p.id}">✅ ${p.pending_reports} chờ duyệt</button>` : '',
    p.blocking_issues ? `<span class="dash-chip critical">⛔ ${p.blocking_issues} vướng chặn</span>` : p.open_issues ? `<span class="dash-chip warning">❗ ${p.open_issues} vướng mắc</span>` : '',
    p.delayed_items ? `<span class="dash-chip warning">⏱ ${p.delayed_items} đầu việc trễ</span>` : ''
  ].join('');
  const quiet = p.last_report_date ? Math.round((Date.parse(state_today()) - Date.parse(p.last_report_date)) / 86400000) : null;
  const pkgRows = (p.packages || []).map(k => `
    <div class="wp-row">
      <div class="wp-trade">${tradeLabel(k.trade)}</div>
      <div style="flex:1;min-width:0;">
        <div class="wp-name">${escapeHtml(k.sub_name || k.name)}</div>
        ${dualBar(k.actual_pct, k.planned_pct, riskOf({ ...k, gap: k.planned_pct - k.actual_pct, days_left: 0 }))}
      </div>
      <div class="wp-pct">${k.actual_pct}%</div>
      ${k.top_alert && k.status !== 'done' ? `<span class="wp-warn">${ALERT_LABEL[k.top_alert] || ''}</span>` : ''}
    </div>`).join('') || '<div class="empty-hint compact">Chưa có hạng mục nào</div>';

  return `
    <div class="project-summary-card risk-${p.risk}" data-open-project="${p.id}" tabindex="0" role="button" aria-label="Mở timeline ${escapeHtml(p.name)}">
      <div class="project-summary-top">
        <div style="min-width:0;">
          <div class="project-summary-name">${escapeHtml(p.name)}</div>
          <div class="project-summary-client">${escapeHtml(p.client_name || '')}${p.client_name ? ' · ' : ''}bàn giao ${displayDate(p.end_date)} · ${days}</div>
        </div>
        <span class="risk-badge ${p.risk}">${RISK_LABEL[p.risk]}</span>
      </div>
      <div class="proj-progress">
        <div class="proj-pct">${p.actual_pct}<small>%</small></div>
        <div style="flex:1;min-width:0;">
          ${dualBar(p.actual_pct, p.planned_pct, p.risk)}
          <div class="proj-progress-meta">Kế hoạch hôm nay ${p.planned_pct}% · ${gapLabel(p.gap)} · ${p.done_items}/${p.item_count} đầu việc xong</div>
        </div>
      </div>
      ${chips ? `<div class="dash-chips">${chips}</div>` : ''}
      ${!done && quiet !== null && quiet >= 3 ? `<div class="proj-quiet">⚠ ${quiet} ngày chưa có báo cáo nào</div>` : ''}
      <div class="proj-packages">${pkgRows}</div>
    </div>`;
}

function state_today() { return lastData?.today || new Date().toISOString().slice(0, 10); }

function subsTable(subs) {
  return `
    <table class="dash-table">
      <thead><tr><th>Đội</th><th title="Đầu việc đang trễ">Trễ</th><th title="Đầu việc tới lịch nhưng 3 ngày không báo">Không ra quân</th><th title="Báo cáo bị trả lại / tổng, 30 ngày">Bị trả lại</th></tr></thead>
      <tbody>${subs.map(s => `
        <tr>
          <td><div class="wp-name">${escapeHtml(s.name)}</div><div class="task-meta" style="margin:0;">${tradeLabel(s.trade)} · ${s.projects} công trình</div></td>
          <td class="${s.delayed_items ? 'bad' : ''}">${s.delayed_items}</td>
          <td class="${s.idle_items ? 'bad' : ''}">${s.idle_items}</td>
          <td>${s.rejected_30d}/${s.reports_30d}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// Cột 14 ngày: một chuỗi (báo cáo đã gửi), không cần chú giải — tiêu đề
// đã gọi tên. Rê/chạm để xem số gửi và số đã duyệt của từng ngày.
function activityChart(days) {
  if (!days.length) return '<div class="empty-hint compact">Chưa có dữ liệu</div>';
  const W = 280, H = 84, pad = 2;
  const max = Math.max(1, ...days.map(d => d.submitted));
  const bw = (W - pad * (days.length - 1)) / days.length;
  const total = days.reduce((a, d) => a + d.submitted, 0);
  const bars = days.map((d, i) => {
    const h = d.submitted ? Math.max(3, Math.round((d.submitted / max) * (H - 4))) : 0;
    const x = i * (bw + pad);
    return `
      <g class="act-col" data-i="${i}">
        <rect class="act-hit" x="${x}" y="0" width="${bw + pad}" height="${H}"></rect>
        ${h ? `<rect class="act-bar" x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="3"></rect>` : `<rect class="act-zero" x="${x}" y="${H - 1}" width="${bw}" height="1"></rect>`}
      </g>`;
  }).join('');
  const first = days[0].d;
  return `
    <div class="act-wrap">
      <div class="act-head"><b>${total}</b> báo cáo gửi · cao nhất ${max}/ngày</div>
      <svg class="act-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Số báo cáo gửi mỗi ngày trong 14 ngày">${bars}</svg>
      <div class="act-axis"><span>${displayDate(first)}</span><span>hôm nay</span></div>
      <div class="act-tip" hidden></div>
      <table class="sr-only"><caption>Báo cáo theo ngày</caption><tr><th>Ngày</th><th>Gửi</th><th>Đã duyệt</th></tr>
        ${days.map(d => `<tr><td>${displayDate(d.d)}</td><td>${d.submitted}</td><td>${d.approved}</td></tr>`).join('')}</table>
    </div>`;
}

function wireActivityHover(wrap, days) {
  const box = wrap.querySelector('.act-wrap');
  if (!box) return;
  const tip = box.querySelector('.act-tip');
  box.querySelectorAll('.act-col').forEach(col => {
    const show = () => {
      const d = days[+col.dataset.i];
      box.querySelectorAll('.act-col').forEach(c => c.classList.toggle('on', c === col));
      tip.hidden = false;
      tip.innerHTML = `<b>${displayDate(d.d)}</b> · ${d.submitted} gửi · ${d.approved} đã duyệt`;
    };
    col.addEventListener('mouseenter', show);
    col.addEventListener('click', show);
  });
  box.addEventListener('mouseleave', () => {
    tip.hidden = true;
    box.querySelectorAll('.act-col').forEach(c => c.classList.remove('on'));
  });
}
