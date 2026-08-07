// ============================================================
// Tab "Duyệt" — màn hình chính của giám sát. Vì công nhân cũng nhập
// trực tiếp, nhiều báo cáo trùng trong ngày cho cùng 1 đầu việc là
// bình thường → GỘP theo (work_item_id, report_date) thành 1 thẻ,
// giám sát chỉnh tổng khối lượng rồi duyệt 1 lần. Không gộp thì hộp
// duyệt ngập sau 2 tuần dùng thật.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, displayDate, db } from '../ui.js';
import { signStaffPhotoUrl } from '../photos.js';

let groupsCache = [];

export async function renderApprovals() {
  const wrap = document.getElementById('approvalsList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data: reports, error } = await state.supabase
    .from('progress_reports')
    .select('*, work_items(id,name,unit,work_package_id, work_packages(project_id,name,subcontractor_id, subcontractors(name), projects(name)))')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được danh sách chờ duyệt.</div>'; updatePendingBadge(0); return; }

  const groups = new Map();
  (reports || []).forEach(r => {
    const key = r.work_item_id + '|' + r.report_date;
    if (!groups.has(key)) groups.set(key, { key, work_item: r.work_items, report_date: r.report_date, reports: [] });
    groups.get(key).reports.push(r);
  });
  groupsCache = [...groups.values()];
  updatePendingBadge(reports ? reports.length : 0);

  if (!groupsCache.length) { wrap.innerHTML = '<div class="empty-hint">Không có báo cáo nào chờ duyệt 🎉</div>'; return; }

  wrap.innerHTML = groupsCache.map((g, gi) => renderGroupCard(g, gi)).join('');
  wireGroupCards(wrap);
  loadPhotosForGroups(wrap);
}

function renderGroupCard(g, gi) {
  const suggestedQty = g.reports.reduce((a, r) => a + Number(r.qty_delta || 0), 0);
  const reporters = [...new Set(g.reports.map(r => r.reporter_name))].join(', ');
  const notes = g.reports.map(r => `• ${escapeHtml(r.note)}`).join('<br>');
  const wp = g.work_item.work_packages;
  const allPhotos = g.reports.flatMap(r => (r.photos || []).map(p => ({ ...p, reportId: r.id })));
  const stale = allPhotos.some(p => p.taken_at && Math.abs(new Date(p.taken_at) - new Date(g.reports[0].created_at)) > 24 * 3600 * 1000);
  const maxCrew = Math.max(0, ...g.reports.map(r => r.crew_size || 0));

  return `
    <div class="approval-card" data-gi="${gi}">
      <div class="approval-head">
        <div>
          <div class="approval-item-name">${escapeHtml(g.work_item.name)}</div>
          <div class="approval-meta">${escapeHtml(wp?.projects?.name || '')} · ${escapeHtml(wp?.subcontractors?.name || '')} · ${displayDate(g.report_date)}</div>
        </div>
        ${stale ? '<span class="approval-stale-flag">⚠ ảnh cũ</span>' : ''}
      </div>
      <div class="photo-grid" data-photo-grid>
        ${allPhotos.map((p, pi) => `<img data-gi="${gi}" data-pi="${pi}" alt="ảnh hiện trường">`).join('')}
      </div>
      <div class="approval-note">${notes}</div>
      <div class="reported-by">Báo bởi: ${escapeHtml(reporters)}${maxCrew ? ' · ' + maxCrew + ' thợ có mặt' : ''}</div>
      <div class="approval-qty-row">
        <span class="field-label" style="margin:0;">Duyệt khối lượng:</span>
        <input type="number" class="approve-qty-input" data-gi="${gi}" value="${suggestedQty}" step="0.1">
        <span style="font-size:12.5px;color:var(--ink-soft);">${g.work_item.unit === 'm2' ? 'm²' : g.work_item.unit === 'diem' ? 'điểm' : g.work_item.unit}</span>
      </div>
      <div class="approval-actions">
        <button class="btn btn-danger" data-action="reject" data-gi="${gi}">✕ Trả lại</button>
        <button class="btn btn-primary" data-action="approve" data-gi="${gi}">✓ Duyệt</button>
      </div>
    </div>`;
}

// Ảnh gán qua thuộc tính DOM (không chèn vào chuỗi HTML) — path do đội thi
// công gửi lên, không được tin cậy để nội suy trực tiếp vào innerHTML.
async function loadPhotosForGroups(wrap) {
  const imgs = wrap.querySelectorAll('img[data-pi]');
  for (const img of imgs) {
    const g = groupsCache[+img.dataset.gi];
    if (!g) continue;
    const allPhotos = g.reports.flatMap(r => (r.photos || []).map(p => ({ ...p, reportId: r.id })));
    const p = allPhotos[+img.dataset.pi];
    if (!p || !p.path) continue;
    signStaffPhotoUrl(state.supabase, p.path).then(url => { if (url) img.src = url; });
    img.onclick = () => { if (img.src) window.open(img.src, '_blank'); };
  }
}

function wireGroupCards(wrap) {
  wrap.querySelectorAll('[data-action=approve]').forEach(btn => {
    btn.onclick = () => approveGroup(+btn.dataset.gi);
  });
  wrap.querySelectorAll('[data-action=reject]').forEach(btn => {
    btn.onclick = () => rejectGroup(+btn.dataset.gi);
  });
}

async function approveGroup(gi) {
  const g = groupsCache[gi];
  if (!g) return;
  const input = document.querySelector(`.approve-qty-input[data-gi="${gi}"]`);
  const total = input ? Number(input.value || 0) : g.reports.reduce((a, r) => a + Number(r.qty_delta || 0), 0);
  const ids = g.reports.map(r => r.id);

  try {
    await state.supabase.rpc('approve_report', { p_report_id: ids[0], p_approved_qty: total });
    for (let i = 1; i < ids.length; i++) {
      await state.supabase.rpc('approve_report', { p_report_id: ids[i], p_approved_qty: 0 });
    }
    showToast('Đã duyệt · +' + total);
    renderApprovals();
  } catch (e) {
    console.error(e);
    showToast('Duyệt thất bại — thử lại', true);
  }
}

async function rejectGroup(gi) {
  const g = groupsCache[gi];
  if (!g) return;
  const reason = prompt('Lý do trả lại (đội sẽ nhìn thấy):');
  if (reason === null) return;
  try {
    for (const r of g.reports) {
      await state.supabase.rpc('reject_report', { p_report_id: r.id, p_reason: reason || 'Không đạt yêu cầu' });
    }
    showToast('Đã trả lại');
    renderApprovals();
  } catch (e) {
    console.error(e);
    showToast('Thao tác thất bại — thử lại', true);
  }
}

function updatePendingBadge(count) {
  state.pendingCount = count;
  const dot = document.getElementById('approvalsNavDot');
  if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  const countEl = document.getElementById('approvalsCount');
  if (countEl) countEl.textContent = count > 0 ? String(count) : '';
}
