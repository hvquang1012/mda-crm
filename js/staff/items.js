// ============================================================
// Tab "Công việc" — quản lý dự án, hạng mục (work_packages), đầu việc
// (work_items), phụ thuộc (dependencies), và tạo link Zalo cho từng
// đội thầu phụ. Đây là màn hình lập kế hoạch, không phải nơi thầu
// phụ nhập tiến độ (họ dùng crew.html qua link riêng).
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, displayDate, todayISO, db } from '../ui.js';
import { renderTimeline } from '../timeline.js';

let templates = [];        // work_package_templates + items, load 1 lần
let currentPackages = [];  // work_packages của currentProjectId, kèm work_items lồng bên trong
let flatItems = [];        // toàn bộ work_items của dự án hiện tại, dùng cho picker phụ thuộc

// ---------- Bootstrap ----------
export async function initItemsTab() {
  await loadSubcontractors();
  await loadTemplates();
  wireStaticButtons();
}

async function loadSubcontractors() {
  const { data } = await state.supabase.from('subcontractors').select('*').eq('active', true).order('name');
  state.subcontractors = data || [];
}

async function loadTemplates() {
  const { data: tpl } = await state.supabase.from('work_package_templates').select('*');
  const { data: items } = await state.supabase.from('work_package_template_items').select('*').order('seq');
  templates = (tpl || []).map(t => ({ ...t, items: (items || []).filter(i => i.template_id === t.id) }));
}

// ---------- Project switcher ----------
export async function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  if (!sel) return;
  const { data } = await state.supabase.from('projects').select('*').order('created_at', { ascending: false });
  state.projects = data || [];
  if (!state.currentProjectId && state.projects.length) state.currentProjectId = state.projects[0].id;
  sel.innerHTML = state.projects.map(p => `<option value="${p.id}" ${p.id === state.currentProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  await renderPackages();
}

// ---------- Danh sách hạng mục + đầu việc ----------
export async function renderPackages() {
  const wrap = document.getElementById('packagesList');
  if (!wrap || !state.currentProjectId) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data, error } = await state.supabase
    .from('work_packages')
    .select('*, subcontractors(name,trade,id), work_items(*)')
    .eq('project_id', state.currentProjectId)
    .order('created_at');

  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được hạng mục.</div>'; return; }
  currentPackages = data || [];
  flatItems = currentPackages.flatMap(p => (p.work_items || []).map(it => ({ ...it, packageName: p.name, subName: p.subcontractors?.name })));

  renderCurrentPackages();
}

function renderCurrentPackages() {
  const wrap = document.getElementById('packagesList');
  if (!wrap) return;
  syncItemsView();

  if (!currentPackages.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có hạng mục nào. Bấm ＋ để thêm đội thầu phụ vào công trình.</div>';
    return;
  }

  if (state.itemsView === 'timeline') {
    const groups = currentPackages.map(pkg => ({
      id: pkg.id,
      title: `${tradeEmoji(pkg.trade)} ${pkg.subcontractors?.name || pkg.name}`,
      subtitle: pkg.name,
      rows: [...(pkg.work_items || [])].sort((a, b) => a.seq - b.seq).map(it => ({
        id: it.id,
        name: it.name,
        start: it.planned_start,
        end: it.planned_end,
        qtyPlan: it.qty_plan,
        qtyDone: it.qty_done,
        percent: it.percent,
        status: it.status,
        meta: it.qty_plan ? `${it.qty_done}/${it.qty_plan} ${unitLabel(it.unit)}` : `${it.percent}%`
      }))
    }));
    wrap.innerHTML = renderTimeline(groups, { project: currentProject() });
    wireTimelineRows(wrap);
  } else {
    wrap.innerHTML = currentPackages.map(pkg => renderPackageCard(pkg)).join('');
    wirePackageCards(wrap);
  }
}

function syncItemsView() {
  const timeline = state.itemsView === 'timeline';
  document.getElementById('packagesList')?.classList.toggle('timeline-view', timeline);
  const listButton = document.getElementById('btnItemsListView');
  const timelineButton = document.getElementById('btnItemsTimelineView');
  listButton?.classList.toggle('active', !timeline);
  timelineButton?.classList.toggle('active', timeline);
  listButton?.setAttribute('aria-pressed', String(!timeline));
  timelineButton?.setAttribute('aria-pressed', String(timeline));
  const exportSection = document.getElementById('itemsExportSection');
  if (exportSection) exportSection.style.display = timeline ? 'none' : 'block';
}

function wireTimelineRows(wrap) {
  wrap.querySelectorAll('[data-item-id]').forEach(row => {
    row.onclick = () => openItemModal(null, row.dataset.itemId);
  });
}

function renderPackageCard(pkg) {
  const items = (pkg.work_items || []).sort((a, b) => a.seq - b.seq);
  const itemsHtml = items.map(it => `
    <div class="task-card" data-item-id="${it.id}">
      <div class="task-top">
        <div>
          <div class="task-name">${escapeHtml(it.name)}</div>
          <div class="task-meta">${displayDate(it.planned_start)} → ${displayDate(it.planned_end)} · ${it.qty_done}${it.qty_plan ? '/' + it.qty_plan : ''} ${unitLabel(it.unit)}</div>
        </div>
        <span class="badge ${it.status === 'done' ? 'ahead' : it.status}">${it.percent}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill ${it.status === 'done' ? 'ahead' : it.status}" style="width:${it.percent}%"></div></div>
      <div class="task-actions">
        <button class="icon-btn" data-action="report-for" data-item-id="${it.id}" data-item-name="${escapeHtml(it.name)}">＋ Nhập thay</button>
        <button class="icon-btn" data-action="edit-item" data-item-id="${it.id}">✎ Sửa</button>
        <button class="icon-btn danger" data-action="delete-item" data-item-id="${it.id}">🗑</button>
      </div>
    </div>
  `).join('') || '<div class="empty-hint" style="padding:16px 0;">Chưa có đầu việc</div>';

  return `
    <div class="task-card" style="border-color:var(--primary);" data-package-id="${pkg.id}">
      <div class="task-top">
        <div>
          <div class="task-name">${tradeEmoji(pkg.trade)} ${escapeHtml(pkg.subcontractors?.name || pkg.name)}</div>
          <div class="task-meta">${escapeHtml(pkg.name)} · ${pkg.contract_qty || '—'} ${unitLabel(pkg.unit)}</div>
        </div>
        <span class="badge ${pkg.status === 'done' ? 'ahead' : pkg.status}">${STATUS_VI[pkg.status]}</span>
      </div>
      <div class="task-actions">
        <button class="icon-btn" data-action="crew-link" data-package-id="${pkg.id}">🔗 Link cho đội</button>
        <button class="icon-btn" data-action="add-item" data-package-id="${pkg.id}">＋ Đầu việc</button>
        <button class="icon-btn danger" data-action="delete-package" data-package-id="${pkg.id}">🗑 Xoá hạng mục</button>
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">${itemsHtml}</div>
    </div>
  `;
}

const STATUS_VI = { notStarted: 'Chưa bắt đầu', onTrack: 'Đúng tiến độ', delayed: 'Trễ', ahead: 'Vượt', done: 'Xong' };
function tradeEmoji(t) { return t === 'da' ? '🪨' : t === 'dien' ? '⚡' : '🔧'; }
function unitLabel(u) { return { m2: 'm²', diem: 'điểm', md: 'md', tron_goi: '' }[u] || u; }

function wirePackageCards(wrap) {
  wrap.querySelectorAll('[data-action=add-item]').forEach(b => b.onclick = () => openItemModal(b.dataset.packageId));
  wrap.querySelectorAll('[data-action=edit-item]').forEach(b => b.onclick = () => openItemModal(null, b.dataset.itemId));
  wrap.querySelectorAll('[data-action=delete-item]').forEach(b => b.onclick = () => deleteItem(b.dataset.itemId));
  wrap.querySelectorAll('[data-action=delete-package]').forEach(b => b.onclick = () => deletePackage(b.dataset.packageId));
  wrap.querySelectorAll('[data-action=crew-link]').forEach(b => b.onclick = () => openCrewLinkModal(b.dataset.packageId));
  wrap.querySelectorAll('[data-action=report-for]').forEach(b => b.onclick = () => openStaffReportModal(b.dataset.itemId, b.dataset.itemName));
}

// ---------- Thêm hạng mục (work_package) ----------
function wireStaticButtons() {
  document.getElementById('btnItemsListView').onclick = () => {
    state.itemsView = 'list';
    renderCurrentPackages();
  };
  document.getElementById('btnItemsTimelineView').onclick = () => {
    state.itemsView = 'timeline';
    renderCurrentPackages();
  };

  document.getElementById('btnNewPackage').onclick = openPackageModal;
  document.getElementById('btnPkgCancel').onclick = () => closeModal('packageModal');
  document.getElementById('btnPkgSave').onclick = savePackage;
  document.getElementById('pkgTrade').onchange = fillTemplateOptions;

  document.getElementById('btnNewProject').onclick = openProjectModal;
  document.getElementById('btnProjCancel').onclick = () => closeModal('projectModal');
  document.getElementById('btnProjSave').onclick = saveProject;

  document.getElementById('btnItemCancel').onclick = () => closeModal('itemModal');
  document.getElementById('btnItemSave').onclick = saveItem;

  document.getElementById('btnDependencies').onclick = openDependencyModal;
  document.getElementById('btnDepCancel').onclick = () => closeModal('depModal');
  document.getElementById('btnDepAdd').onclick = addDependency;

  document.getElementById('btnCrewLinkCancel').onclick = () => closeModal('crewLinkModal');
  document.getElementById('btnCrewLinkGenerate').onclick = generateCrewLink;
  document.getElementById('btnCrewLinkCopy').onclick = copyCrewLink;

  document.getElementById('btnClientLink').onclick = generateClientLink;

  document.getElementById('btnStaffReportCancel').onclick = () => closeModal('staffReportModal');
  document.getElementById('btnStaffReportSave').onclick = saveStaffReport;
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function openPackageModal() {
  document.getElementById('pkgSubcontractorExisting').innerHTML = '<option value="">— Tạo đội mới —</option>' +
    state.subcontractors.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('pkgNewSubName').value = '';
  document.getElementById('pkgName').value = '';
  document.getElementById('pkgContractQty').value = '';
  const start = todayISO();
  const projectEnd = currentProject()?.end_date || '';
  document.getElementById('pkgPlannedStart').value = start;
  document.getElementById('pkgPlannedEnd').value = projectEnd >= start ? projectEnd : start;
  fillTemplateOptions();
  document.getElementById('packageModal').classList.add('show');
}

function fillTemplateOptions() {
  const trade = document.getElementById('pkgTrade').value;
  const sel = document.getElementById('pkgTemplate');
  const matches = templates.filter(t => t.trade === trade);
  sel.innerHTML = '<option value="">— Không dùng mẫu, tự nhập đầu việc —</option>' +
    matches.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

async function savePackage() {
  const trade = document.getElementById('pkgTrade').value;
  const existingSubId = document.getElementById('pkgSubcontractorExisting').value;
  const newSubName = document.getElementById('pkgNewSubName').value.trim();
  const name = document.getElementById('pkgName').value.trim() || (trade === 'da' ? 'Thi công đá' : trade === 'dien' ? 'Thi công điện' : 'Hạng mục');
  const contractQty = document.getElementById('pkgContractQty').value;
  const unit = document.getElementById('pkgUnit').value;
  const plannedStart = document.getElementById('pkgPlannedStart').value || null;
  const plannedEnd = document.getElementById('pkgPlannedEnd').value || null;
  const templateId = document.getElementById('pkgTemplate').value;

  if (!existingSubId && !newSubName) { showToast('Chọn đội có sẵn hoặc nhập tên đội mới', true); return; }
  if (dateRangeInvalid(plannedStart, plannedEnd)) { showToast('Ngày kết thúc hạng mục phải từ ngày bắt đầu trở đi', true); return; }

  let subId = existingSubId;
  if (!subId) {
    const { data, error } = await state.supabase.from('subcontractors').insert({ name: newSubName, trade }).select().single();
    if (error) { showToast('Không tạo được đội thầu phụ', true); return; }
    subId = data.id;
    state.subcontractors.push(data);
  }

  const { data: wp, error: wpErr } = await state.supabase.from('work_packages').insert({
    project_id: state.currentProjectId, subcontractor_id: subId, trade, name,
    contract_qty: contractQty ? Number(contractQty) : null, unit,
    planned_start: plannedStart, planned_end: plannedEnd
  }).select().single();
  if (wpErr) { showToast('Không tạo được hạng mục', true); return; }

  if (templateId) {
    const tpl = templates.find(t => t.id === templateId);
    let cursor = plannedStart ? new Date(plannedStart) : new Date();
    const rows = tpl.items.map(ti => {
      const start = new Date(cursor);
      const end = new Date(cursor); end.setDate(end.getDate() + ti.default_duration_days);
      cursor = new Date(end); cursor.setDate(cursor.getDate() + 1);
      return {
        work_package_id: wp.id, name: ti.name, seq: ti.seq, unit: ti.unit,
        planned_start: start.toISOString().slice(0, 10), planned_end: end.toISOString().slice(0, 10)
      };
    });
    const { error: itemsErr } = await state.supabase.from('work_items').insert(rows);
    if (itemsErr) {
      const { error: cleanupErr } = await state.supabase.from('work_packages').delete().eq('id', wp.id);
      showToast(cleanupErr ? 'Không tạo được checklist; hạng mục rỗng đã được giữ lại' : 'Không tạo được checklist; đã hoàn tác hạng mục', true);
      return;
    }
  }

  showToast('Đã tạo hạng mục');
  closeModal('packageModal');
  renderPackages();
}

async function deletePackage(id) {
  if (!confirm('Xoá cả hạng mục và toàn bộ đầu việc bên trong?')) return;
  await db(state.supabase.from('work_packages').delete().eq('id', id), { successMsg: 'Đã xoá' });
  renderPackages();
}

// ---------- Đầu việc (work_item) ----------
function openItemModal(packageId, itemId) {
  const editing = flatItems.find(i => i.id === itemId);
  document.getElementById('itemModalTitle').textContent = editing ? 'Sửa đầu việc' : 'Thêm đầu việc';
  document.getElementById('itemId').value = itemId || '';
  document.getElementById('itemPackageId').value = packageId || (editing && currentPackages.find(p => (p.work_items || []).some(i => i.id === itemId))?.id) || '';
  document.getElementById('itemName').value = editing ? editing.name : '';
  document.getElementById('itemUnit').value = editing ? editing.unit : 'm2';
  document.getElementById('itemQtyPlan').value = editing ? (editing.qty_plan || '') : '';
  document.getElementById('itemPlannedStart').value = editing ? (editing.planned_start || '') : todayISO();
  document.getElementById('itemPlannedEnd').value = editing ? (editing.planned_end || '') : todayISO();
  document.getElementById('itemStatus').value = editing ? editing.status : 'notStarted';
  document.getElementById('itemModal').classList.add('show');
}

async function saveItem() {
  const id = document.getElementById('itemId').value;
  const packageId = document.getElementById('itemPackageId').value;
  const name = document.getElementById('itemName').value.trim();
  if (!name) { showToast('Nhập tên đầu việc', true); return; }
  const payload = {
    name, unit: document.getElementById('itemUnit').value,
    qty_plan: document.getElementById('itemQtyPlan').value ? Number(document.getElementById('itemQtyPlan').value) : null,
    planned_start: document.getElementById('itemPlannedStart').value || null,
    planned_end: document.getElementById('itemPlannedEnd').value || null,
    status: document.getElementById('itemStatus').value
  };
  if (dateRangeInvalid(payload.planned_start, payload.planned_end)) {
    showToast('Ngày kết thúc đầu việc phải từ ngày bắt đầu trở đi', true);
    return;
  }
  let result;
  if (id) {
    result = await db(state.supabase.from('work_items').update(payload).eq('id', id), { successMsg: 'Đã lưu' });
  } else {
    result = await db(state.supabase.from('work_items').insert({ ...payload, work_package_id: packageId }), { successMsg: 'Đã thêm' });
  }
  if (result.error) return;
  closeModal('itemModal');
  renderPackages();
}

async function deleteItem(id) {
  if (!confirm('Xoá đầu việc này?')) return;
  await db(state.supabase.from('work_items').delete().eq('id', id), { successMsg: 'Đã xoá' });
  renderPackages();
}

// ---------- Nhập thay cho đội không dùng app ----------
function openStaffReportModal(itemId, itemName) {
  document.getElementById('staffReportItemId').value = itemId;
  document.getElementById('staffReportItemName').textContent = itemName;
  document.getElementById('staffReportQty').value = '';
  document.getElementById('staffReportCrewSize').value = '';
  document.getElementById('staffReportNote').value = '';
  document.getElementById('staffReportPhoto').value = '';
  document.getElementById('staffReportModal').classList.add('show');
}

async function saveStaffReport() {
  const itemId = document.getElementById('staffReportItemId').value;
  const note = document.getElementById('staffReportNote').value.trim();
  const qty = document.getElementById('staffReportQty').value;
  const crewSize = document.getElementById('staffReportCrewSize').value;
  const fileInput = document.getElementById('staffReportPhoto');
  if (!note) { showToast('Nhập ghi chú', true); return; }
  if (!fileInput.files.length) { showToast('Chọn ít nhất 1 ảnh', true); return; }

  const item = flatItems.find(i => i.id === itemId);
  const pkg = currentPackages.find(p => (p.work_items || []).some(i => i.id === itemId));
  const btn = document.getElementById('btnStaffReportSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { uploadStaffPhoto } = await import('../photos.js');
    const photos = [];
    for (const f of fileInput.files) {
      photos.push(await uploadStaffPhoto(state.supabase, f, state.currentProjectId, pkg.subcontractor_id));
    }
    const { error } = await state.supabase.from('progress_reports').insert({
      work_item_id: itemId, reporter_kind: 'staff', staff_id: state.user.id,
      reporter_name: state.user.email, qty_delta: qty ? Number(qty) : 0,
      crew_size: crewSize ? Number(crewSize) : null, note, photos, status: 'pending'
    });
    if (error) throw error;
    showToast('Đã nhập — báo cáo này cũng cần duyệt như bình thường');
    closeModal('staffReportModal');
  } catch (e) {
    console.error(e);
    showToast('Lưu thất bại', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
}

// ---------- Dự án ----------
function openProjectModal() {
  document.getElementById('projName').value = '';
  document.getElementById('projClient').value = '';
  document.getElementById('projAddress').value = '';
  document.getElementById('projStart').value = todayISO();
  const end = new Date(); end.setDate(end.getDate() + 60);
  document.getElementById('projEnd').value = end.toISOString().slice(0, 10);
  document.getElementById('projectModal').classList.add('show');
}

async function saveProject() {
  const name = document.getElementById('projName').value.trim();
  if (!name) { showToast('Nhập tên dự án', true); return; }
  const startDate = document.getElementById('projStart').value;
  const endDate = document.getElementById('projEnd').value;
  if (!startDate || !endDate) { showToast('Nhập đủ ngày bắt đầu và dự kiến xong', true); return; }
  if (dateRangeInvalid(startDate, endDate)) { showToast('Ngày kết thúc dự án phải từ ngày bắt đầu trở đi', true); return; }
  const { data, error } = await state.supabase.from('projects').insert({
    name, client_name: document.getElementById('projClient').value.trim(),
    address: document.getElementById('projAddress').value.trim(),
    start_date: startDate,
    end_date: endDate
  }).select().single();
  if (error) { showToast('Không tạo được dự án', true); return; }
  closeModal('projectModal');
  state.currentProjectId = data.id;
  showToast('Đã tạo dự án');
  renderProjectSelect();
}

function dateRangeInvalid(start, end) {
  return Boolean(start && end && end < start);
}

// ---------- Phụ thuộc giữa các đầu việc ----------
async function openDependencyModal() {
  const predSel = document.getElementById('depPredecessor');
  const succSel = document.getElementById('depSuccessor');
  const options = flatItems.map(i => `<option value="${i.id}">${escapeHtml(i.subName)} — ${escapeHtml(i.name)}</option>`).join('');
  predSel.innerHTML = options; succSel.innerHTML = options;

  const { data } = await state.supabase.from('dependencies').select('*, predecessor:predecessor_item_id(name), successor:successor_item_id(name)')
    .in('predecessor_item_id', flatItems.map(i => i.id));
  const list = document.getElementById('depList');
  list.innerHTML = (data || []).map(d => `
    <div class="task-meta" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed var(--line);">
      <span>${escapeHtml(d.predecessor?.name)} → ${escapeHtml(d.successor?.name)}</span>
      <button class="icon-btn danger" data-dep-id="${d.id}">🗑</button>
    </div>`).join('') || '<div class="empty-hint" style="padding:10px 0;">Chưa có phụ thuộc nào</div>';
  list.querySelectorAll('[data-dep-id]').forEach(b => b.onclick = async () => {
    await state.supabase.from('dependencies').delete().eq('id', b.dataset.depId);
    openDependencyModal();
  });

  document.getElementById('depModal').classList.add('show');
}

async function addDependency() {
  const pred = document.getElementById('depPredecessor').value;
  const succ = document.getElementById('depSuccessor').value;
  const lag = Number(document.getElementById('depLagDays').value || 0);
  if (pred === succ) { showToast('Hai đầu việc phải khác nhau', true); return; }
  const { error } = await state.supabase.from('dependencies').insert({ predecessor_item_id: pred, successor_item_id: succ, lag_days: lag });
  if (error) { showToast('Không thêm được — có thể đã tồn tại', true); return; }
  showToast('Đã thêm phụ thuộc');
  openDependencyModal();
}

// ---------- Link Zalo cho thầu phụ ----------
let lastCrewLink = null;

function openCrewLinkModal(packageId) {
  const pkg = currentPackages.find(p => p.id === packageId);
  document.getElementById('crewLinkPackageId').value = packageId;
  document.getElementById('crewLinkPackageLabel').textContent = pkg?.subcontractors?.name || pkg?.name || '';
  document.getElementById('crewLinkPersonName').value = '';
  document.getElementById('crewLinkResult').style.display = 'none';
  document.getElementById('crewLinkModal').classList.add('show');
}

async function generateCrewLink() {
  const packageId = document.getElementById('crewLinkPackageId').value;
  const pkg = currentPackages.find(p => p.id === packageId);
  const personName = document.getElementById('crewLinkPersonName').value.trim();
  const role = document.getElementById('crewLinkRole').value;

  const { data, error } = await state.supabase.from('crew_links').insert({
    project_id: state.currentProjectId, subcontractor_id: pkg.subcontractor_id,
    person_name: personName || null, role
  }).select().single();
  if (error) { showToast('Không tạo được link', true); return; }

  lastCrewLink = location.origin + location.pathname.replace(/index\.html$/, '') + 'crew.html?t=' + data.token;
  document.getElementById('crewLinkUrl').textContent = lastCrewLink;
  document.getElementById('crewLinkResult').style.display = 'block';
}

async function copyCrewLink() {
  if (!lastCrewLink) return;
  try { await navigator.clipboard.writeText(lastCrewLink); showToast('Đã copy link — dán vào Zalo gửi cho đội'); }
  catch (e) { prompt('Copy link gửi qua Zalo:', lastCrewLink); }
}

// ---------- Link cho chủ nhà ----------
async function generateClientLink() {
  if (!state.currentProjectId) return;
  const { data: existing } = await state.supabase.from('client_links').select('*')
    .eq('project_id', state.currentProjectId).is('revoked_at', null).limit(1).maybeSingle();

  let token = existing?.token;
  if (!token) {
    const { data, error } = await state.supabase.from('client_links').insert({ project_id: state.currentProjectId }).select().single();
    if (error) { showToast('Không tạo được link khách', true); return; }
    token = data.token;
  }
  const url = location.origin + location.pathname.replace(/index\.html$/, '') + 'client.html?t=' + token;
  try { await navigator.clipboard.writeText(url); showToast('Đã copy link khách — dán vào Zalo gửi chủ nhà'); }
  catch (e) { prompt('Copy link gửi khách:', url); }
}

export function currentProject() { return state.projects.find(p => p.id === state.currentProjectId); }
