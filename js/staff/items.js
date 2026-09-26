// ============================================================
// Tab "Công việc" — quản lý dự án, hạng mục (work_packages), đầu việc
// (work_items), phụ thuộc (dependencies), và tạo link Zalo cho từng
// đội thầu phụ. Đây là màn hình lập kế hoạch, không phải nơi thầu
// phụ nhập tiến độ (họ dùng crew.html qua link riêng).
// ============================================================
import { state, isManager } from './state.js';
import { escapeHtml, showToast, displayDate, todayISO, db, rpcErrorText, shareLink, unitLabel as unitLabelFull } from '../ui.js';
import { renderTimeline } from '../timeline.js';
import { zaloLinkHtml } from './profile.js';
import { openProjectWizard, scheduleFromTemplate, crewLinkUrl, clientLinkUrl } from './wizard.js';

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
  // Để trong state — wizard.js (tạo công trình) dùng chung danh sách mẫu
  // Lọc trùng (seq, tên): mẫu từng bị seed 2 lần trên DB → công trình tạo
  // theo mẫu bị lặp đầu việc (dọn DB: supabase/migrations/003_don_trung.sql)
  state.templates = (tpl || []).map(t => {
    const seen = new Set();
    return { ...t, items: (items || []).filter(i => {
      const k = i.template_id === t.id && `${i.seq}|${i.name}`;
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    }) };
  });
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
    <div class="task-card wi-row" data-item-card="${it.id}">
      <div class="task-top" data-action="toggle-edit" data-item-id="${it.id}" title="Bấm để sửa nhanh khối lượng / ngày">
        <div class="task-name">${escapeHtml(it.name)}</div>
        <div class="task-meta">${displayDate(it.planned_start)} → ${displayDate(it.planned_end)} · ${itemQtyLabel(it)}</div>
      </div>
      <span class="badge ${it.status === 'done' ? 'ahead' : it.status}">${it.status === 'done' ? '✓ Xong' : it.percent + '%'}</span>
      <button class="icon-btn wi-more" data-action="menu" aria-expanded="false" aria-label="Thao tác đầu việc">⋯</button>
      <div class="progress-track thin"><div class="progress-fill ${it.status === 'done' ? 'ahead' : it.status}" style="width:${it.status === 'done' ? 100 : it.percent}%"></div></div>
      <div class="wi-menu" hidden>
        ${it.status === 'done'
          ? `<button class="icon-btn" data-action="undone-item" data-item-id="${it.id}">↺ Chưa xong</button>`
          : `<button class="icon-btn" data-action="done-item" data-item-id="${it.id}">✓ Đánh dấu xong</button>`}
        <button class="icon-btn" data-action="report-for" data-item-id="${it.id}" data-item-name="${escapeHtml(it.name)}">＋ Nhập thay</button>
        <button class="icon-btn" data-action="edit-item" data-item-id="${it.id}">✎ Sửa</button>
        <button class="icon-btn danger" data-action="delete-item" data-item-id="${it.id}">🗑 Xoá</button>
      </div>
      <div class="task-edit">
        <div class="row-inline">
          <div><span class="field-label">KL kế hoạch (${escapeHtml(unitLabelFull(it.unit))})</span><input type="number" inputmode="decimal" step="0.1" min="0" data-quick="qty_plan" value="${it.qty_plan ?? ''}"></div>
        </div>
        <div class="row-inline">
          <div><span class="field-label">Bắt đầu</span><input type="date" data-quick="planned_start" value="${it.planned_start || ''}"></div>
          <div><span class="field-label">Kết thúc</span><input type="date" data-quick="planned_end" value="${it.planned_end || ''}"></div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" data-action="toggle-edit" data-item-id="${it.id}">Đóng</button>
          <button class="btn btn-primary quick-save" data-action="quick-save" data-item-id="${it.id}">Lưu</button>
        </div>
      </div>
    </div>
  `).join('') || '<div class="empty-hint" style="padding:16px 0;">Chưa có đầu việc — bấm ＋ Đầu việc hoặc 📋 Dán từ Excel</div>';

  return `
    <div class="task-card package-card" data-package-id="${pkg.id}">
      <div class="task-top">
        <div>
          <div class="task-name">${tradeEmoji(pkg.trade)} ${escapeHtml(pkg.subcontractors?.name || pkg.name)}</div>
          <div class="task-meta">${escapeHtml(pkg.name)} · ${pkg.contract_qty || '—'} ${unitLabel(pkg.unit)} · ${displayDate(pkg.planned_start)} → ${displayDate(pkg.planned_end)}</div>
        </div>
        <span class="badge ${pkg.status === 'done' ? 'ahead' : pkg.status}">${STATUS_VI[pkg.status]}</span>
      </div>
      <div class="task-actions wrap">
        <button class="icon-btn strong" data-action="crew-link" data-package-id="${pkg.id}">🔗 Link cho đội</button>
        <button class="icon-btn" data-action="add-item" data-package-id="${pkg.id}">＋ Đầu việc</button>
        <button class="icon-btn" data-action="paste-items" data-package-id="${pkg.id}">📋 Dán từ Excel</button>
        <button class="icon-btn" data-action="shift" data-package-id="${pkg.id}">⇆ Dời lịch</button>
        <button class="icon-btn wi-more" data-action="menu" aria-expanded="false" aria-label="Thao tác khác của hạng mục">⋯</button>
        <div class="wi-menu" hidden>
          ${items.some(it => it.status !== 'done') ? `<button class="icon-btn" data-action="done-package" data-package-id="${pkg.id}">✓ Xong cả hạng mục</button>` : ''}
          <button class="icon-btn" data-action="save-template" data-package-id="${pkg.id}">💾 Lưu làm mẫu</button>
          <button class="icon-btn danger" data-action="delete-package" data-package-id="${pkg.id}">🗑 Xoá hạng mục</button>
        </div>
      </div>
      <div class="wi-list">${itemsHtml}</div>
    </div>
  `;
}

// "5/12 m²" · "0 điểm" · trọn gói không có KL → "trọn gói"
function itemQtyLabel(it) {
  if (it.unit === 'tron_goi' && !it.qty_plan) return 'trọn gói';
  return `${it.qty_done}${it.qty_plan ? '/' + it.qty_plan : ''} ${unitLabel(it.unit)}`;
}

const STATUS_VI = { notStarted: 'Chưa bắt đầu', onTrack: 'Đúng tiến độ', delayed: 'Trễ', ahead: 'Vượt', done: 'Xong' };
function tradeEmoji(t) { return t === 'da' ? '🪨' : t === 'dien' ? '⚡' : '🔧'; }
function unitLabel(u) { return { m2: 'm²', diem: 'điểm', md: 'md', tron_goi: 'trọn gói' }[u] ?? u ?? ''; }

function wirePackageCards(wrap) {
  const on = (action, fn) => wrap.querySelectorAll(`[data-action=${action}]`).forEach(b => { b.onclick = (e) => { e.stopPropagation(); if (b.closest('.wi-menu')) closeMenus(wrap); fn(b); }; });
  on('add-item', b => openItemModal(b.dataset.packageId));
  on('edit-item', b => openItemModal(null, b.dataset.itemId));
  on('delete-item', b => deleteItem(b.dataset.itemId));
  on('done-item', b => setItemsDone([b.dataset.itemId], true));
  on('undone-item', b => setItemsDone([b.dataset.itemId], false));
  on('done-package', b => markPackageDone(b.dataset.packageId));
  on('delete-package', b => deletePackage(b.dataset.packageId));
  on('crew-link', b => openCrewLinkModal(b.dataset.packageId));
  on('report-for', b => openStaffReportModal(b.dataset.itemId, b.dataset.itemName));
  on('paste-items', b => openPasteModal(b.dataset.packageId));
  on('shift', b => shiftPackage(b.dataset.packageId));
  on('save-template', b => savePackageAsTemplate(b.dataset.packageId));
  on('toggle-edit', b => wrap.querySelector(`[data-item-card="${b.dataset.itemId}"]`)?.classList.toggle('open'));
  on('menu', b => {
    const menu = b.parentElement.querySelector(':scope > .wi-menu');
    const willOpen = menu.hidden;
    closeMenus(wrap);
    menu.hidden = !willOpen;
    b.setAttribute('aria-expanded', String(willOpen));
  });
  if (!menusWired) {
    menusWired = true;
    document.addEventListener('click', e => { if (!e.target.closest('.wi-menu')) closeMenus(document); });
  }
  on('quick-save', b => quickSaveItem(b.dataset.itemId, wrap.querySelector(`[data-item-card="${b.dataset.itemId}"]`), b));
}

let menusWired = false;
function closeMenus(root) {
  root.querySelectorAll('.wi-menu:not([hidden])').forEach(m => { m.hidden = true; });
  root.querySelectorAll('.wi-more[aria-expanded=true]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// ---------- Sửa nhanh tại chỗ: KL kế hoạch + ngày ----------
async function quickSaveItem(itemId, card, btn) {
  const val = (f) => card.querySelector(`[data-quick="${f}"]`).value;
  const payload = {
    qty_plan: val('qty_plan') === '' ? null : Number(val('qty_plan')),
    planned_start: val('planned_start') || null,
    planned_end: val('planned_end') || null
  };
  if (payload.qty_plan !== null && payload.qty_plan < 0) { showToast('Khối lượng không được âm', true); return; }
  if (dateRangeInvalid(payload.planned_start, payload.planned_end)) { showToast('Ngày kết thúc phải từ ngày bắt đầu trở đi', true); return; }
  btn.disabled = true;
  const { error } = await db(state.supabase.from('work_items').update(payload).eq('id', itemId), { successMsg: 'Đã lưu' });
  btn.disabled = false;
  if (!error) renderPackages();
}

// ---------- Dời lịch cả hạng mục ----------
async function shiftPackage(packageId) {
  const pkg = currentPackages.find(p => p.id === packageId);
  const raw = prompt(`Dời toàn bộ lịch "${pkg?.subcontractors?.name || pkg?.name}" bao nhiêu ngày?\nSố dương = lùi lại (vào trễ), số âm = làm sớm hơn.`, '1');
  if (raw === null) return;
  const days = parseInt(raw, 10);
  if (!Number.isInteger(days) || days === 0) { showToast('Nhập số ngày khác 0', true); return; }
  // Đầu việc đội khác đang chờ hạng mục này (phụ thuộc) — báo để KTS dời theo
  const itemIds = (pkg.work_items || []).map(i => i.id);
  let warn = '';
  if (days > 0 && itemIds.length) {
    const { data } = await state.supabase.from('dependencies')
      .select('successor:successor_item_id(name, work_package_id)').in('predecessor_item_id', itemIds);
    const outside = (data || []).map(d => d.successor).filter(x => x && x.work_package_id !== packageId);
    if (outside.length) warn = `\n\n⚠ Có ${outside.length} đầu việc đội khác đang chờ hạng mục này (VD: "${outside[0].name}") — nhớ dời theo.`;
  }
  if (!confirm(`Dời ${itemIds.length} đầu việc ${days > 0 ? 'lùi' : 'sớm'} ${Math.abs(days)} ngày?${warn}`)) return;
  const { error } = await state.supabase.rpc('shift_package_schedule', { p_package_id: packageId, p_days: days });
  if (error) { showToast(rpcErrorText(error, 'Không dời được lịch'), true); return; }
  showToast(`Đã dời lịch ${days > 0 ? '+' : ''}${days} ngày`);
  renderPackages();
}

// ---------- Lưu hạng mục thành mẫu dùng lại ----------
async function savePackageAsTemplate(packageId) {
  const pkg = currentPackages.find(p => p.id === packageId);
  const items = [...(pkg?.work_items || [])].sort((a, b) => a.seq - b.seq);
  if (!items.length) { showToast('Hạng mục chưa có đầu việc để lưu làm mẫu', true); return; }
  const name = prompt('Tên mẫu (VD: Đá bếp chữ L + đảo):', pkg.name);
  if (!name || !name.trim()) return;
  const { data: tpl, error } = await state.supabase.from('work_package_templates').insert({ trade: pkg.trade, name: name.trim() }).select().single();
  if (error) { showToast(rpcErrorText(error, 'Không lưu được mẫu'), true); return; }
  const DAY = 86400000;
  const rows = items.map((it, i) => ({
    template_id: tpl.id, name: it.name, seq: i + 1, unit: it.unit,
    default_duration_days: it.planned_start && it.planned_end
      ? Math.max(1, Math.round((Date.parse(it.planned_end) - Date.parse(it.planned_start)) / DAY) + 1) : 3
  }));
  const { error: e2 } = await state.supabase.from('work_package_template_items').insert(rows);
  if (e2) {
    await state.supabase.from('work_package_templates').delete().eq('id', tpl.id);
    showToast('Không lưu được đầu việc của mẫu — đã huỷ', true); return;
  }
  await loadTemplates();
  showToast(`Đã lưu mẫu "${name.trim()}" (${rows.length} đầu việc)`);
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

  document.getElementById('btnNewProject').onclick = () => openProjectWizard({ onDone: () => renderProjectSelect() });

  document.getElementById('btnItemCancel').onclick = () => closeModal('itemModal');
  document.getElementById('btnItemSave').onclick = saveItem;

  document.getElementById('btnDependencies').onclick = openDependencyModal;
  document.getElementById('btnDepCancel').onclick = () => closeModal('depModal');
  document.getElementById('btnDepAdd').onclick = addDependency;

  document.getElementById('btnCrewLinkCancel').onclick = () => closeModal('crewLinkModal');
  document.getElementById('btnCrewLinkGenerate').onclick = generateCrewLink;

  document.getElementById('pasteInput').oninput = parsePaste;
  document.getElementById('btnPasteCancel').onclick = () => closeModal('pasteModal');
  document.getElementById('btnPasteSave').onclick = savePaste;

  const membersBtn = document.getElementById('btnMembers');
  if (membersBtn) {
    membersBtn.hidden = !isManager();
    membersBtn.onclick = openMembersModal;
  }
  document.getElementById('btnMembersClose').onclick = () => closeModal('membersModal');

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
  const matches = state.templates.filter(t => t.trade === trade);
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
    const tpl = state.templates.find(t => t.id === templateId);
    const rows = scheduleFromTemplate(tpl, plannedStart).map(r => ({ ...r, work_package_id: wp.id }));
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

// Chốt hoàn thành bằng tay — chỉ đổi status, KHÔNG đụng qty_done/percent
// (khối lượng chỉ cộng qua duyệt báo cáo). Trigger ở DB tự cập nhật hạng
// mục và đóng cảnh báo cũ của đầu việc vừa xong.
async function setItemsDone(ids, done) {
  if (!ids.length) return;
  let error;
  if (done) {
    ({ error } = await db(state.supabase.from('work_items').update({ status: 'done' }).in('id', ids),
      { successMsg: ids.length > 1 ? `Đã chốt xong ${ids.length} đầu việc` : 'Đã chốt xong' }));
  } else {
    // Mở lại: tạm "Đúng tiến độ" (hoặc "Chưa bắt đầu" nếu chưa có khối lượng) — lần kiểm tra tự động sau sẽ tính lại theo lịch
    const it = flatItems.find(i => i.id === ids[0]);
    ({ error } = await db(state.supabase.from('work_items').update({ status: it && Number(it.qty_done) > 0 ? 'onTrack' : 'notStarted' }).in('id', ids),
      { successMsg: 'Đã mở lại đầu việc' }));
  }
  if (!error) renderPackages();
}

async function markPackageDone(packageId) {
  const pkg = currentPackages.find(p => p.id === packageId);
  const open = (pkg?.work_items || []).filter(i => i.status !== 'done');
  if (!open.length) return;
  const partial = open.filter(i => Number(i.percent) < 100).length;
  const msg = `Chốt xong ${open.length} đầu việc còn lại của "${pkg.subcontractors?.name || pkg.name}"?`
    + (partial ? `\n\n${partial} đầu việc chưa đủ khối lượng đã duyệt — số khối lượng giữ nguyên, chỉ đổi trạng thái sang Xong.` : '');
  if (!confirm(msg)) return;
  await setItemsDone(open.map(i => i.id), true);
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
  if (!pkg) { showToast('Không tìm thấy hạng mục của đầu việc — tải lại trang', true); return; }
  const btn = document.getElementById('btnStaffReportSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const { uploadStaffPhoto } = await import('../photos.js');
    const photos = [];
    const files = Array.from(fileInput.files);
    for (const [i, f] of files.entries()) {
      btn.textContent = `Đang gửi ảnh ${i + 1}/${files.length}...`;
      photos.push(await uploadStaffPhoto(state.supabase, f, state.currentProjectId, pkg.subcontractor_id));
    }
    btn.textContent = 'Đang lưu...';
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
    showToast(e?.message || 'Lưu thất bại', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Lưu';
  }
}

function dateRangeInvalid(start, end) {
  return Boolean(start && end && end < start);
}

// ---------- Phụ thuộc giữa các đầu việc ----------
async function openDependencyModal() {
  const predSel = document.getElementById('depPredecessor');
  const succSel = document.getElementById('depSuccessor');
  // Gom theo đội — một dropdown dài 30 dòng lẫn lộn đá/điện rất khó chọn
  const options = currentPackages.map(pkg => `
    <optgroup label="${escapeHtml(`${tradeEmoji(pkg.trade)} ${pkg.subcontractors?.name || pkg.name}`)}">
      ${[...(pkg.work_items || [])].sort((a, b) => a.seq - b.seq).map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}
    </optgroup>`).join('');
  predSel.innerHTML = options; succSel.innerHTML = options;

  const { data } = await state.supabase.from('dependencies').select('*, predecessor:predecessor_item_id(name), successor:successor_item_id(name)')
    .in('predecessor_item_id', flatItems.map(i => i.id));
  const list = document.getElementById('depList');
  list.innerHTML = (data || []).map(d => `
    <div class="task-meta" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed var(--line);">
      <span>${escapeHtml(d.predecessor?.name)} → ${escapeHtml(d.successor?.name)}${d.lag_days ? ` (chờ ${d.lag_days} ngày)` : ''}</span>
      <button class="icon-btn danger" data-dep-id="${d.id}">🗑</button>
    </div>`).join('') || '<div class="empty-hint" style="padding:10px 0;">Chưa có phụ thuộc nào</div>';
  list.querySelectorAll('[data-dep-id]').forEach(b => b.onclick = async () => {
    const { error } = await db(state.supabase.from('dependencies').delete().eq('id', b.dataset.depId), { successMsg: 'Đã xoá phụ thuộc' });
    if (!error) openDependencyModal();
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

// ---------- Link Zalo cho thầu phụ: tạo mới + xem / thu hồi link cũ ----------
let crewLinkPkg = null;

async function openCrewLinkModal(packageId) {
  crewLinkPkg = currentPackages.find(p => p.id === packageId);
  document.getElementById('crewLinkPackageId').value = packageId;
  document.getElementById('crewLinkPackageLabel').textContent = crewLinkPkg?.subcontractors?.name || crewLinkPkg?.name || '';
  document.getElementById('crewLinkPersonName').value = '';
  document.getElementById('crewLinkModal').classList.add('show');
  await renderCrewLinkList();
}

async function renderCrewLinkList() {
  const list = document.getElementById('crewLinkList');
  list.innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  const { data, error } = await state.supabase.from('crew_links').select('*')
    .eq('project_id', state.currentProjectId).eq('subcontractor_id', crewLinkPkg.subcontractor_id)
    .order('created_at', { ascending: false });
  if (error) { list.innerHTML = '<div class="empty-hint compact">Không tải được danh sách link.</div>'; return; }
  const active = (data || []).filter(l => !l.revoked_at);
  const revoked = (data || []).length - active.length;
  list.innerHTML = active.map(l => `
    <div class="link-row">
      <div class="link-row-info">
        <div class="link-row-name">${escapeHtml(l.person_name || 'Không ghi tên')} · ${l.role === 'manager' ? 'Quản lý đội' : 'Công nhân'}</div>
        <div class="task-meta">Tạo ${displayDate(l.created_at.slice(0, 10))} · ${l.last_used_at ? 'dùng gần nhất ' + new Date(l.last_used_at).toLocaleString('vi-VN') : 'chưa mở lần nào'}</div>
      </div>
      <button class="icon-btn strong" data-share-link="${l.id}">📤 Gửi</button>
      <button class="icon-btn danger" data-revoke-link="${l.id}">Thu hồi</button>
    </div>`).join('') || '<div class="empty-hint compact">Chưa có link nào đang dùng</div>';
  if (revoked) list.insertAdjacentHTML('beforeend', `<div class="task-meta">${revoked} link đã thu hồi</div>`);

  list.querySelectorAll('[data-share-link]').forEach(b => b.onclick = () => {
    const l = data.find(x => x.id === b.dataset.shareLink);
    shareLink(crewLinkUrl(l.token), `Báo tiến độ — ${currentProject()?.name || ''}`);
  });
  list.querySelectorAll('[data-revoke-link]').forEach(b => b.onclick = async () => {
    if (!confirm('Thu hồi link này? Người đang giữ link sẽ không báo cáo được nữa (báo cáo cũ vẫn giữ nguyên).')) return;
    const { error: e } = await state.supabase.from('crew_links').update({ revoked_at: new Date().toISOString() }).eq('id', b.dataset.revokeLink);
    if (e) { showToast(rpcErrorText(e, 'Không thu hồi được'), true); return; }
    showToast('Đã thu hồi link');
    renderCrewLinkList();
  });
}

async function generateCrewLink() {
  const personName = document.getElementById('crewLinkPersonName').value.trim();
  const role = document.getElementById('crewLinkRole').value;
  const btn = document.getElementById('btnCrewLinkGenerate');
  btn.disabled = true;
  const { data, error } = await state.supabase.from('crew_links').insert({
    project_id: state.currentProjectId, subcontractor_id: crewLinkPkg.subcontractor_id,
    person_name: personName || null, role
  }).select().single();
  btn.disabled = false;
  if (error) { showToast(rpcErrorText(error, 'Không tạo được link'), true); return; }
  document.getElementById('crewLinkPersonName').value = '';
  await renderCrewLinkList();
  shareLink(crewLinkUrl(data.token), `Báo tiến độ — ${currentProject()?.name || ''}`);
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
  shareLink(clientLinkUrl(token), `Tiến độ công trình — ${currentProject()?.name || ''}`);
}

// ---------- Dán danh sách đầu việc từ Excel ----------
// Mỗi dòng: Tên ⇥ Đơn vị ⇥ Khối lượng ⇥ Bắt đầu ⇥ Kết thúc (chỉ Tên là bắt buộc).
// Copy nguyên vùng ô trong Excel / Google Sheets → dán vào là ra dấu Tab.
let pasteRows = [];
let pastePkgId = null;

function openPasteModal(packageId) {
  pastePkgId = packageId;
  const pkg = currentPackages.find(p => p.id === packageId);
  document.getElementById('pastePackageLabel').textContent = pkg?.subcontractors?.name || pkg?.name || '';
  document.getElementById('pasteInput').value = '';
  document.getElementById('pastePreview').innerHTML = '';
  document.getElementById('btnPasteSave').disabled = true;
  document.getElementById('pasteModal').classList.add('show');
}

const UNIT_ALIASES = { 'm2': 'm2', 'm²': 'm2', 'md': 'md', 'm': 'md', 'mét dài': 'md', 'met dai': 'md',
  'điểm': 'diem', 'diem': 'diem', 'đ': 'diem', 'cái': 'diem', 'bộ': 'diem',
  'trọn gói': 'tron_goi', 'tron goi': 'tron_goi', 'tron_goi': 'tron_goi', 'tg': 'tron_goi', 'gói': 'tron_goi' };

function parseUnit(v, fallback) {
  const k = String(v || '').trim().toLowerCase();
  if (!k) return { unit: fallback };
  return UNIT_ALIASES[k] ? { unit: UNIT_ALIASES[k] } : { unit: fallback, error: `đơn vị "${v}" lạ` };
}

// Nhận 25/9/2026, 25-09-26, 2026-09-25
function parseDateCell(v) {
  const t = String(v || '').trim();
  if (!t) return { date: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return okDate(+m[1], +m[2], +m[3], t);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) return okDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1], t);
  return { date: null, error: `ngày "${t}" không đọc được` };
}
function okDate(y, mo, d, raw) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { date: null, error: `ngày "${raw}" không có thật` };
  return { date: dt.toISOString().slice(0, 10) };
}

function parsePaste() {
  const pkg = currentPackages.find(p => p.id === pastePkgId);
  const lines = document.getElementById('pasteInput').value.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  pasteRows = lines.map(line => {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*[;|]\s*/);
    const errors = [];
    const name = (cols[0] || '').trim();
    if (!name) errors.push('thiếu tên');
    const u = parseUnit(cols[1], pkg?.unit || 'm2'); if (u.error) errors.push(u.error);
    const qtyRaw = String(cols[2] || '').trim().replace(/\s/g, '').replace(',', '.');
    const qty = qtyRaw === '' ? null : Number(qtyRaw);
    if (qtyRaw !== '' && !(qty >= 0)) errors.push(`khối lượng "${cols[2]}" không phải số`);
    const st = parseDateCell(cols[3]); if (st.error) errors.push(st.error);
    const en = parseDateCell(cols[4]); if (en.error) errors.push(en.error);
    if (st.date && en.date && en.date < st.date) errors.push('kết thúc trước bắt đầu');
    return { name, unit: u.unit, qty_plan: qty, qtyRaw: String(cols[2] || '').trim(), planned_start: st.date, planned_end: en.date || st.date, errors };
  });
  // Dòng đầu là tiêu đề cột ("Tên đầu việc | Đơn vị | ...") thì bỏ
  if (pasteRows.length && /^(tên|ten|đầu việc|hạng mục|stt)/i.test(pasteRows[0].name) && pasteRows[0].errors.length) pasteRows.shift();

  const bad = pasteRows.filter(r => r.errors.length).length;
  document.getElementById('pastePreview').innerHTML = pasteRows.length ? `
    <table class="paste-table">
      <thead><tr><th>Đầu việc</th><th>ĐV</th><th>KL</th><th>Lịch</th></tr></thead>
      <tbody>${pasteRows.map(r => `
        <tr class="${r.errors.length ? 'bad' : ''}">
          <td>${escapeHtml(r.name || '—')}${r.errors.length ? `<div class="paste-err">${escapeHtml(r.errors.join(', '))}</div>` : ''}</td>
          <td>${escapeHtml(unitLabelFull(r.unit))}</td>
          <td>${Number.isFinite(r.qty_plan) ? r.qty_plan : escapeHtml(r.qtyRaw)}</td>
          <td>${r.planned_start ? displayDate(r.planned_start) + (r.planned_end && r.planned_end !== r.planned_start ? ' → ' + displayDate(r.planned_end) : '') : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="field-hint">${pasteRows.length - bad} dòng hợp lệ${bad ? ` · <b>${bad} dòng lỗi (tô đỏ) sẽ bị bỏ qua</b>` : ''}</div>` : '';
  const btn = document.getElementById('btnPasteSave');
  btn.disabled = pasteRows.length - bad === 0;
  btn.textContent = `Thêm ${pasteRows.length - bad} đầu việc`;
}

async function savePaste() {
  const pkg = currentPackages.find(p => p.id === pastePkgId);
  const good = pasteRows.filter(r => !r.errors.length);
  if (!good.length) return;
  const startSeq = Math.max(0, ...(pkg?.work_items || []).map(i => i.seq || 0));
  const rows = good.map((r, i) => ({
    work_package_id: pastePkgId, name: r.name, unit: r.unit, qty_plan: r.qty_plan,
    planned_start: r.planned_start, planned_end: r.planned_end, seq: startSeq + i + 1
  }));
  const btn = document.getElementById('btnPasteSave');
  btn.disabled = true;
  const { error } = await db(state.supabase.from('work_items').insert(rows), { successMsg: `Đã thêm ${rows.length} đầu việc` });
  btn.disabled = false;
  if (error) return;
  closeModal('pasteModal');
  renderPackages();
}

// ---------- Thành viên công trình (chỉ quản lý) ----------
async function openMembersModal() {
  if (!state.currentProjectId) return;
  document.getElementById('membersProjectLabel').textContent = currentProject()?.name || '';
  document.getElementById('membersModal').classList.add('show');
  renderMembers();
}

async function renderMembers() {
  const wrap = document.getElementById('membersList');
  wrap.innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  const [{ data: staff, error: e1 }, { data: members, error: e2 }] = await Promise.all([
    state.supabase.from('staff').select('*').order('full_name'), // '*': chưa có cột phone vẫn chạy
    state.supabase.from('project_members').select('staff_id').eq('project_id', state.currentProjectId)
  ]);
  if (e1 || e2) { wrap.innerHTML = '<div class="empty-hint compact">Không tải được danh sách nhân viên.</div>'; return; }
  const inProject = new Set((members || []).map(m => m.staff_id));
  const isAdmin = state.staffRole === 'admin';
  const roleVi = { kts: 'KTS', staff: 'KTS', manager: 'Quản lý', admin: 'Quản trị' };
  wrap.innerHTML = (staff || []).map(u => {
    const seesAll = u.role === 'manager' || u.role === 'admin';
    return `
    <div class="member-row">
      <label class="member-check">
        <input type="checkbox" data-member="${u.id}" ${inProject.has(u.id) || seesAll ? 'checked' : ''} ${seesAll ? 'disabled' : ''}>
        <span>${escapeHtml(u.full_name || u.id.slice(0, 8))}${u.id === state.user.id ? ' (bạn)' : ''}</span>
      </label>
      ${zaloLinkHtml(u.phone)}
      ${isAdmin && u.id !== state.user.id ? `
        <select data-role="${u.id}" aria-label="Vai trò">
          ${['kts', 'manager', 'admin'].map(r => `<option value="${r}" ${(u.role === 'staff' ? 'kts' : u.role) === r ? 'selected' : ''}>${roleVi[r]}</option>`).join('')}
        </select>` : `<span class="member-role">${roleVi[u.role] || ''}</span>`}
    </div>`;
  }).join('');

  wrap.querySelectorAll('[data-member]').forEach(cb => cb.onchange = async () => {
    const q = cb.checked
      ? state.supabase.from('project_members').insert({ project_id: state.currentProjectId, staff_id: cb.dataset.member })
      : state.supabase.from('project_members').delete().eq('project_id', state.currentProjectId).eq('staff_id', cb.dataset.member);
    const { error } = await q;
    if (error) { cb.checked = !cb.checked; showToast(rpcErrorText(error), true); return; }
    showToast(cb.checked ? 'Đã giao công trình' : 'Đã bỏ khỏi công trình');
  });
  wrap.querySelectorAll('[data-role]').forEach(sel => sel.onchange = async () => {
    const { error } = await state.supabase.rpc('set_staff_role', { p_staff_id: sel.dataset.role, p_role: sel.value });
    if (error) { showToast(rpcErrorText(error), true); renderMembers(); return; }
    showToast('Đã đổi vai trò');
    renderMembers();
  });
}

export function currentProject() { return state.projects.find(p => p.id === state.currentProjectId); }
