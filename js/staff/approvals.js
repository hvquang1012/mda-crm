// ============================================================
// Tab "Duyệt" — màn hình chính của giám sát. Vì công nhân cũng nhập
// trực tiếp, nhiều báo cáo trùng trong ngày cho cùng 1 đầu việc là
// bình thường → GỘP theo (work_item_id, report_date) thành 1 thẻ,
// giám sát chỉnh tổng khối lượng rồi duyệt 1 lần. Không gộp thì hộp
// duyệt ngập sau 2 tuần dùng thật.
//
// Mỗi thẻ duyệt/trả lại bằng MỘT lời gọi approve_report_group /
// reject_report_group (1 transaction) — hỏng thì cả nhóm giữ nguyên.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, displayDate, rpcErrorText, unitLabel, ageLabel } from '../ui.js';
import { signStaffPhotoUrl } from '../photos.js';
import { openLightbox } from '../lightbox.js';

let groupsCache = [];
const selected = new Set();       // key nhóm đang tick để duyệt hàng loạt
const photoUrls = new Map();      // key nhóm → [signed url | null]

const REJECT_REASONS = ['Ảnh không rõ / thiếu ảnh tổng thể', 'Khối lượng chưa đúng', 'Chưa đạt chất lượng, làm lại', 'Báo trùng'];

export async function renderApprovals() {
  const wrap = document.getElementById('approvalsList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data: reports, error } = await state.supabase
    .from('progress_reports')
    .select('*, work_items(id,name,unit,qty_plan,qty_done,work_package_id, work_packages(project_id,name,subcontractor_id, subcontractors(name), projects(name)))')
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
  // Bỏ tick những nhóm không còn (đã được xử lý ở máy khác)
  [...selected].forEach(k => { if (!groups.has(k)) selected.delete(k); });

  renderToolbar();
  renderCards();
}

function projectOf(g) { return g.work_item?.work_packages?.project_id; }
function visibleGroups() { return groupsCache.filter(g => !state.approvalsProjectFilter || projectOf(g) === state.approvalsProjectFilter); }

function renderToolbar() {
  const bar = document.getElementById('approvalsToolbar');
  if (!bar) return;
  const projects = new Map();
  groupsCache.forEach(g => {
    const id = projectOf(g);
    const name = g.work_item?.work_packages?.projects?.name || '—';
    projects.set(id, { name, n: (projects.get(id)?.n || 0) + 1 });
  });
  if (state.approvalsProjectFilter && !projects.has(state.approvalsProjectFilter)) state.approvalsProjectFilter = '';
  const nSel = [...selected].filter(k => visibleGroups().some(g => g.key === k)).length;
  bar.innerHTML = groupsCache.length ? `
    <select id="approvalsProjectFilter" aria-label="Lọc theo công trình">
      <option value="">Tất cả công trình (${groupsCache.length})</option>
      ${[...projects.entries()].map(([id, p]) => `<option value="${id}" ${id === state.approvalsProjectFilter ? 'selected' : ''}>${escapeHtml(p.name)} (${p.n})</option>`).join('')}
    </select>
    <label class="bulk-toggle"><input type="checkbox" id="approvalsSelectAll" ${nSel && nSel === visibleGroups().length ? 'checked' : ''}> Chọn tất cả</label>
    <button class="btn btn-primary" id="btnApproveSelected" ${nSel ? '' : 'disabled'}>✓ Duyệt ${nSel || ''} thẻ đã chọn</button>
  ` : '';
  const sel = document.getElementById('approvalsProjectFilter');
  if (sel) sel.onchange = () => { state.approvalsProjectFilter = sel.value; renderToolbar(); renderCards(); };
  const all = document.getElementById('approvalsSelectAll');
  if (all) all.onchange = () => {
    visibleGroups().forEach(g => all.checked ? selected.add(g.key) : selected.delete(g.key));
    renderToolbar(); renderCards();
  };
  const bulk = document.getElementById('btnApproveSelected');
  if (bulk) bulk.onclick = approveSelected;
}

function renderCards() {
  const wrap = document.getElementById('approvalsList');
  const list = visibleGroups();
  if (!groupsCache.length) { wrap.innerHTML = '<div class="empty-hint">Không có báo cáo nào chờ duyệt 🎉</div>'; return; }
  if (!list.length) { wrap.innerHTML = '<div class="empty-hint">Công trình này không còn báo cáo chờ duyệt.</div>'; return; }
  wrap.innerHTML = list.map(renderGroupCard).join('');
  wireGroupCards(wrap);
  loadPhotos(wrap);
}

function groupPhotos(g) { return g.reports.flatMap(r => (r.photos || []).map(p => ({ ...p, reportId: r.id }))); }

function renderGroupCard(g) {
  const suggestedQty = g.reports.reduce((a, r) => a + Number(r.qty_delta || 0), 0);
  const reporters = [...new Set(g.reports.map(r => r.reporter_name))].join(', ');
  const notes = g.reports.map(r => `• ${escapeHtml(r.note)}`).join('<br>');
  const wi = g.work_item;
  const wp = wi.work_packages;
  const allPhotos = groupPhotos(g);
  const stale = allPhotos.some(p => p.taken_at && Math.abs(new Date(p.taken_at) - new Date(g.reports[0].created_at)) > 24 * 3600 * 1000);
  const maxCrew = Math.max(0, ...g.reports.map(r => r.crew_size || 0));
  const remaining = wi.qty_plan ? Math.max(0, Number(wi.qty_plan) - Number(wi.qty_done || 0)) : null;
  const over = remaining !== null && suggestedQty > remaining;
  const k = escapeHtml(g.key);

  return `
    <div class="approval-card ${selected.has(g.key) ? 'selected' : ''}" data-key="${k}">
      <div class="approval-head">
        <label class="approval-check" title="Chọn để duyệt hàng loạt">
          <input type="checkbox" data-action="select" data-key="${k}" ${selected.has(g.key) ? 'checked' : ''}>
        </label>
        <div style="flex:1;min-width:0;">
          <div class="approval-item-name">${escapeHtml(wi.name)}</div>
          <div class="approval-meta">${escapeHtml(wp?.projects?.name || '')} · ${escapeHtml(wp?.subcontractors?.name || '')} · ${displayDate(g.report_date)} · gửi ${ageLabel(g.reports[0].created_at)} trước</div>
        </div>
        ${stale ? '<span class="approval-stale-flag" title="Ngày chụp ảnh lệch hơn 1 ngày so với lúc gửi">⚠ ảnh cũ</span>' : ''}
      </div>
      <div class="photo-grid">
        ${allPhotos.map((p, pi) => `<img data-key="${k}" data-pi="${pi}" alt="ảnh hiện trường ${pi + 1}">`).join('')}
      </div>
      <div class="approval-note">${notes}</div>
      <div class="reported-by">Báo bởi: ${escapeHtml(reporters)}${maxCrew ? ' · ' + maxCrew + ' thợ có mặt' : ''}${g.reports.length > 1 ? ' · ' + g.reports.length + ' báo cáo gộp' : ''}</div>
      <div class="approval-qty-row">
        <span class="field-label" style="margin:0;">Duyệt khối lượng:</span>
        <input type="number" inputmode="decimal" class="approve-qty-input" data-key="${k}" value="${suggestedQty}" step="0.1" min="0">
        <span style="font-size:12.5px;color:var(--ink-soft);">${escapeHtml(unitLabel(wi.unit))}</span>
      </div>
      ${remaining !== null ? `<div class="task-meta ${over ? 'qty-over' : ''}">Đã nghiệm thu ${wi.qty_done || 0}/${wi.qty_plan} · còn lại ${remaining}${over ? ' — đề xuất vượt phần còn lại' : ''}</div>` : ''}
      <div class="approval-actions">
        <button class="btn btn-danger" data-action="reject" data-key="${k}">✕ Trả lại</button>
        <button class="btn btn-primary" data-action="approve" data-key="${k}">✓ Duyệt</button>
      </div>
    </div>`;
}

// Ảnh gán qua thuộc tính DOM (không chèn vào chuỗi HTML) — path do đội thi
// công gửi lên, không được tin cậy để nội suy trực tiếp vào innerHTML.
function loadPhotos(wrap) {
  wrap.querySelectorAll('img[data-pi]').forEach(img => {
    const g = groupsCache.find(x => x.key === img.dataset.key);
    if (!g) return;
    const photos = groupPhotos(g);
    const pi = +img.dataset.pi;
    const p = photos[pi];
    if (!photoUrls.has(g.key)) photoUrls.set(g.key, photos.map(() => null));
    const cache = photoUrls.get(g.key);
    if (cache[pi]) img.src = cache[pi];
    else if (p?.path) signStaffPhotoUrl(state.supabase, p.path).then(url => { if (url) { cache[pi] = url; img.src = url; } });
    img.onclick = () => openLightbox(photoUrls.get(g.key) || [], pi);
  });
}

function wireGroupCards(wrap) {
  wrap.querySelectorAll('[data-action=approve]').forEach(btn => { btn.onclick = () => approveOne(btn.dataset.key, btn); });
  wrap.querySelectorAll('[data-action=reject]').forEach(btn => { btn.onclick = () => openRejectSheet(btn.dataset.key); });
  wrap.querySelectorAll('[data-action=select]').forEach(cb => {
    cb.onchange = () => {
      cb.checked ? selected.add(cb.dataset.key) : selected.delete(cb.dataset.key);
      cb.closest('.approval-card')?.classList.toggle('selected', cb.checked);
      renderToolbar();
    };
  });
}

function qtyFor(key) {
  const input = [...document.querySelectorAll('.approve-qty-input')].find(i => i.dataset.key === key);
  const g = groupsCache.find(x => x.key === key);
  const v = input && input.value !== '' ? Number(input.value) : g.reports.reduce((a, r) => a + Number(r.qty_delta || 0), 0);
  return v;
}

async function approveGroup(key) {
  const g = groupsCache.find(x => x.key === key);
  if (!g) return { error: { message: 'report_not_found' } };
  const total = qtyFor(key);
  if (!Number.isFinite(total) || total < 0) return { error: { message: 'negative_qty' } };
  const { error } = await state.supabase.rpc('approve_report_group', {
    p_report_ids: g.reports.map(r => r.id), p_total: total
  });
  return { error, total, unit: g.work_item.unit };
}

async function approveOne(key, btn) {
  btn.disabled = true;
  const { error, total, unit } = await approveGroup(key);
  if (error) {
    console.error(error);
    showToast(rpcErrorText(error, 'Duyệt thất bại — thử lại'), true);
    btn.disabled = false;
    if (/already_processed|report_not_found/.test(error.message || '')) renderApprovals();
    return;
  }
  selected.delete(key);
  showToast(`Đã duyệt · +${total} ${unitLabel(unit)}`);
  renderApprovals();
}

async function approveSelected() {
  const keys = [...selected].filter(k => visibleGroups().some(g => g.key === k));
  if (!keys.length) return;
  if (!confirm(`Duyệt ${keys.length} thẻ với khối lượng đang hiện trên từng thẻ?`)) return;
  const btn = document.getElementById('btnApproveSelected');
  if (btn) btn.disabled = true;
  let ok = 0; const failed = [];
  for (const [i, key] of keys.entries()) {
    if (btn) btn.textContent = `Đang duyệt ${i + 1}/${keys.length}...`;
    const { error } = await approveGroup(key);
    if (error) failed.push(rpcErrorText(error)); else { ok++; selected.delete(key); }
  }
  showToast(failed.length ? `Duyệt ${ok}/${keys.length} thẻ — ${failed.length} thẻ lỗi: ${failed[0]}` : `Đã duyệt ${ok} thẻ`, failed.length > 0);
  renderApprovals();
}

// ---------- Trả lại: chọn nhanh lý do thay cho prompt() ----------
function openRejectSheet(key) {
  const g = groupsCache.find(x => x.key === key);
  if (!g) return;
  const modal = document.getElementById('rejectModal');
  document.getElementById('rejectItemName').textContent = g.work_item.name;
  const input = document.getElementById('rejectReason');
  input.value = '';
  document.getElementById('rejectReasonChips').innerHTML = REJECT_REASONS
    .map(r => `<button type="button" class="chip" data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('');
  document.querySelectorAll('#rejectReasonChips .chip').forEach(c => {
    c.onclick = () => { input.value = input.value ? input.value + '; ' + c.dataset.reason : c.dataset.reason; input.focus(); };
  });
  document.getElementById('btnRejectCancel').onclick = () => modal.classList.remove('show');
  const confirmBtn = document.getElementById('btnRejectConfirm');
  confirmBtn.disabled = false;
  confirmBtn.onclick = async () => {
    const reason = input.value.trim();
    if (!reason) { showToast('Chọn hoặc nhập lý do — đội sẽ đọc lý do này', true); return; }
    confirmBtn.disabled = true;
    const { error } = await state.supabase.rpc('reject_report_group', {
      p_report_ids: g.reports.map(r => r.id), p_reason: reason
    });
    confirmBtn.disabled = false;
    if (error) { console.error(error); showToast(rpcErrorText(error), true); return; }
    modal.classList.remove('show');
    selected.delete(key);
    showToast('Đã trả lại — đội sẽ thấy lý do trong mục Lịch sử');
    renderApprovals();
  };
  modal.classList.add('show');
}

function updatePendingBadge(count) {
  state.pendingCount = count;
  const dot = document.getElementById('approvalsNavDot');
  if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  const countEl = document.getElementById('approvalsCount');
  if (countEl) countEl.textContent = count > 0 ? String(count) : '';
}
