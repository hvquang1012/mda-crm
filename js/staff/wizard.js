// ============================================================
// Tạo công trình 3 bước trong MỘT cửa sổ — thay cho 3–4 modal rời
// (dự án → từng đội → từng đầu việc → từng link):
//   1. Thông tin công trình
//   2. Chọn các đội + mẫu đầu việc (nhiều đội cùng lúc)
//   3. Xem trước lịch tự dàn theo mẫu → Tạo
// Tạo xong hiện sẵn link cho từng đội + link chủ nhà, bấm là gửi Zalo.
//
// Module phụ của tab Công việc (chỉ items.js import) — đọc templates /
// subcontractors qua state, không import chéo module tab khác.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, displayDate, todayISO, rpcErrorText, shareLink, tradeLabel } from '../ui.js';

const DAY_MS = 86400000;
function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }

// Dàn lịch nối tiếp theo mẫu: đầu việc N ngày chiếm đúng N ngày (bản
// trước cộng thừa 1 ngày mỗi đầu việc — mẫu 7 bước dài ra 7 ngày).
export function scheduleFromTemplate(tpl, startISO) {
  let cursor = startISO || todayISO();
  return (tpl?.items || []).map(ti => {
    const days = Math.max(1, ti.default_duration_days || 1);
    const row = { name: ti.name, seq: ti.seq, unit: ti.unit, planned_start: cursor, planned_end: addDays(cursor, days - 1) };
    cursor = addDays(cursor, days);
    return row;
  });
}

export function crewLinkUrl(tokenValue) {
  return location.origin + location.pathname.replace(/index\.html$/, '') + 'crew.html?t=' + tokenValue;
}
export function clientLinkUrl(tokenValue) {
  return location.origin + location.pathname.replace(/index\.html$/, '') + 'client.html?t=' + tokenValue;
}

let step = 1;
let info = {};
let teams = [];
let onDoneCb = null;

export function openProjectWizard({ onDone } = {}) {
  onDoneCb = onDone;
  step = 1;
  const start = todayISO();
  info = { name: '', client_name: '', address: '', start_date: start, end_date: addDays(start, 60) };
  teams = [];
  render();
  document.getElementById('wizardModal').classList.add('show');
}

function close() { document.getElementById('wizardModal').classList.remove('show'); }

function render() {
  const body = document.getElementById('wizardBody');
  document.querySelectorAll('#wizardSteps [data-step]').forEach(el => {
    el.classList.toggle('active', +el.dataset.step === step);
    el.classList.toggle('done', +el.dataset.step < step);
  });
  const back = document.getElementById('btnWizardBack');
  const next = document.getElementById('btnWizardNext');
  back.textContent = step === 1 ? 'Huỷ' : '← Quay lại';
  next.textContent = step === 3 ? '✓ Tạo công trình' : 'Tiếp →';
  back.onclick = () => { if (step === 1) close(); else { collect(); step--; render(); } };
  next.onclick = onNext;
  next.disabled = false;

  if (step === 1) body.innerHTML = renderInfo();
  else if (step === 2) { body.innerHTML = renderTeams(); wireTeams(); }
  else body.innerHTML = renderPreview();
}

function renderInfo() {
  return `
    <div><span class="field-label">Tên công trình *</span><input type="text" id="wzName" value="${escapeHtml(info.name)}" placeholder="VD: Nhà anh Minh — Vinhomes Ocean Park"></div>
    <div><span class="field-label">Tên chủ nhà</span><input type="text" id="wzClient" value="${escapeHtml(info.client_name)}"></div>
    <div><span class="field-label">Địa chỉ</span><input type="text" id="wzAddress" value="${escapeHtml(info.address)}"></div>
    <div class="row-inline">
      <div><span class="field-label">Bắt đầu</span><input type="date" id="wzStart" value="${info.start_date}"></div>
      <div><span class="field-label">Dự kiến bàn giao</span><input type="date" id="wzEnd" value="${info.end_date}"></div>
    </div>`;
}

function subOptions(trade, selectedId) {
  const subs = state.subcontractors.filter(s => s.trade === trade || s.id === selectedId);
  return '<option value="">＋ Đội mới (nhập tên bên dưới)</option>' +
    subs.map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
}
function tplOptions(trade, selectedId) {
  const list = (state.templates || []).filter(t => t.trade === trade);
  return '<option value="">— Không dùng mẫu —</option>' +
    list.map(t => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${escapeHtml(t.name)} (${t.items.length} đầu việc)</option>`).join('');
}

function renderTeams() {
  const rows = teams.map((t, i) => `
    <div class="wz-team" data-i="${i}">
      <div class="wz-team-head">
        <select class="wz-trade" data-i="${i}">
          ${['da', 'dien', 'khac'].map(tr => `<option value="${tr}" ${tr === t.trade ? 'selected' : ''}>${tradeLabel(tr)}</option>`).join('')}
        </select>
        <button type="button" class="icon-btn danger wz-remove" data-i="${i}" aria-label="Bỏ đội">✕</button>
      </div>
      <select class="wz-sub" data-i="${i}">${subOptions(t.trade, t.subId)}</select>
      <input type="text" class="wz-newsub" data-i="${i}" placeholder="Tên đội mới" value="${escapeHtml(t.newSubName || '')}" ${t.subId ? 'hidden' : ''}>
      <select class="wz-tpl" data-i="${i}">${tplOptions(t.trade, t.templateId)}</select>
      <input type="text" class="wz-pkgname" data-i="${i}" placeholder="Tên hạng mục (VD: Đá bếp + lavabo)" value="${escapeHtml(t.pkgName || '')}">
    </div>`).join('');
  return `
    <div class="field-hint" style="margin-top:0;">Thêm các đội thầu phụ sẽ vào công trình. Chọn mẫu để tự tạo sẵn đầu việc và lịch — sửa sau vẫn được. Có thể bỏ qua bước này.</div>
    ${rows || '<div class="empty-hint compact">Chưa có đội nào</div>'}
    <div class="chip-row">
      <button type="button" class="chip" data-add="da">＋ Đội đá</button>
      <button type="button" class="chip" data-add="dien">＋ Đội điện</button>
      <button type="button" class="chip" data-add="khac">＋ Đội khác</button>
    </div>`;
}

function defaultTemplateId(trade) { return (state.templates || []).find(t => t.trade === trade)?.id || ''; }

function wireTeams() {
  const body = document.getElementById('wizardBody');
  body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    collect();
    const trade = b.dataset.add;
    teams.push({ trade, subId: '', newSubName: '', templateId: defaultTemplateId(trade), pkgName: '' });
    render();
  });
  body.querySelectorAll('.wz-remove').forEach(b => b.onclick = () => { collect(); teams.splice(+b.dataset.i, 1); render(); });
  body.querySelectorAll('.wz-trade').forEach(sel => sel.onchange = () => {
    collect();
    const t = teams[+sel.dataset.i];
    t.subId = ''; t.templateId = defaultTemplateId(t.trade);
    render();
  });
  body.querySelectorAll('.wz-sub').forEach(sel => sel.onchange = () => {
    body.querySelector(`.wz-newsub[data-i="${sel.dataset.i}"]`).hidden = !!sel.value;
  });
}

// Đọc lại giá trị đang nhập trên màn hình vào info / teams
function collect() {
  if (step === 1) {
    info.name = document.getElementById('wzName').value.trim();
    info.client_name = document.getElementById('wzClient').value.trim();
    info.address = document.getElementById('wzAddress').value.trim();
    info.start_date = document.getElementById('wzStart').value;
    info.end_date = document.getElementById('wzEnd').value;
  } else if (step === 2) {
    const q = (cls, i) => document.querySelector(`.${cls}[data-i="${i}"]`);
    teams.forEach((t, i) => {
      t.trade = q('wz-trade', i).value;
      t.subId = q('wz-sub', i).value;
      t.newSubName = q('wz-newsub', i).value.trim();
      t.templateId = q('wz-tpl', i).value;
      t.pkgName = q('wz-pkgname', i).value.trim();
    });
  }
}

function teamLabel(t) {
  return t.subId ? (state.subcontractors.find(s => s.id === t.subId)?.name || '') : t.newSubName;
}
function teamPackageName(t) {
  return t.pkgName || (t.trade === 'da' ? 'Thi công đá' : t.trade === 'dien' ? 'Thi công điện' : 'Hạng mục');
}
function teamRows(t) {
  return scheduleFromTemplate((state.templates || []).find(x => x.id === t.templateId), info.start_date);
}

function renderPreview() {
  const teamsHtml = teams.map(t => {
    const rows = teamRows(t);
    const end = rows.length ? rows[rows.length - 1].planned_end : null;
    const over = end && info.end_date && end > info.end_date;
    return `
      <div class="wz-preview-team">
        <div class="task-name">${escapeHtml(tradeLabel(t.trade))} · ${escapeHtml(teamLabel(t))}</div>
        <div class="task-meta">${escapeHtml(teamPackageName(t))} · ${rows.length} đầu việc${end ? ` · xong dự kiến ${displayDate(end)}` : ''}</div>
        ${over ? `<div class="field-hint warn">⚠ Lịch theo mẫu vượt ngày bàn giao ${displayDate(info.end_date)} — sửa ngày sau ở tab Timeline</div>` : ''}
        ${rows.length ? `<ol class="wz-rows">${rows.map(r => `<li>${escapeHtml(r.name)} <span>${displayDate(r.planned_start)} → ${displayDate(r.planned_end)}</span></li>`).join('')}</ol>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="wz-summary">
      <div class="task-name">${escapeHtml(info.name)}</div>
      <div class="task-meta">${escapeHtml(info.client_name || '')}${info.address ? ' · ' + escapeHtml(info.address) : ''} · ${displayDate(info.start_date)} → ${displayDate(info.end_date)}</div>
    </div>
    ${teamsHtml || '<div class="empty-hint compact">Chưa thêm đội nào — thêm sau ở tab Công việc cũng được.</div>'}
    <div class="field-hint">Bấm Tạo: hệ thống tạo công trình, hạng mục, đầu việc và link Zalo cho từng đội trong một lần.</div>`;
}

function onNext() {
  collect();
  if (step === 1) {
    if (!info.name) { showToast('Nhập tên công trình', true); return; }
    if (!info.start_date || !info.end_date) { showToast('Nhập đủ ngày bắt đầu và bàn giao', true); return; }
    if (info.end_date < info.start_date) { showToast('Ngày bàn giao phải sau ngày bắt đầu', true); return; }
  }
  if (step === 2) {
    const bad = teams.findIndex(t => !t.subId && !t.newSubName);
    if (bad >= 0) { showToast(`Đội thứ ${bad + 1}: chọn đội có sẵn hoặc nhập tên đội mới`, true); return; }
  }
  if (step < 3) { step++; render(); return; }
  create();
}

async function create() {
  const btn = document.getElementById('btnWizardNext');
  btn.disabled = true;
  const sb = state.supabase;
  const progress = (msg) => { btn.textContent = msg; };

  progress('Đang tạo công trình...');
  const { data: project, error: pErr } = await sb.from('projects').insert(info).select().single();
  if (pErr) { btn.disabled = false; btn.textContent = '✓ Tạo công trình'; showToast(rpcErrorText(pErr, 'Không tạo được công trình'), true); return; }

  const links = [];
  const problems = [];
  for (const [i, t] of teams.entries()) {
    progress(`Đang tạo đội ${i + 1}/${teams.length}...`);
    let subId = t.subId;
    if (!subId) {
      const { data, error } = await sb.from('subcontractors').insert({ name: t.newSubName, trade: t.trade }).select().single();
      if (error) { problems.push(`${t.newSubName}: không tạo được đội`); continue; }
      subId = data.id; state.subcontractors.push(data);
    }
    const rows = teamRows(t);
    const { data: wp, error: wpErr } = await sb.from('work_packages').insert({
      project_id: project.id, subcontractor_id: subId, trade: t.trade, name: teamPackageName(t),
      unit: rows[0]?.unit || 'm2',
      planned_start: rows[0]?.planned_start || info.start_date,
      planned_end: rows.length ? rows[rows.length - 1].planned_end : info.end_date
    }).select().single();
    if (wpErr) { problems.push(`${teamLabel(t)}: không tạo được hạng mục`); continue; }
    if (rows.length) {
      const { error } = await sb.from('work_items').insert(rows.map(r => ({ ...r, work_package_id: wp.id })));
      if (error) problems.push(`${teamLabel(t)}: không tạo được đầu việc — thêm tay sau`);
    }
    const { data: link, error: lErr } = await sb.from('crew_links').insert({
      project_id: project.id, subcontractor_id: subId, role: 'manager'
    }).select().single();
    if (lErr) problems.push(`${teamLabel(t)}: không tạo được link`);
    else links.push({ label: `${tradeLabel(t.trade)} · ${teamLabel(t)}`, url: crewLinkUrl(link.token) });
  }
  const { data: cl } = await sb.from('client_links').insert({ project_id: project.id }).select().single();

  state.currentProjectId = project.id;
  renderResult(project, links, cl ? clientLinkUrl(cl.token) : null, problems);
  onDoneCb?.(project);
}

function renderResult(project, links, clientUrl, problems) {
  const body = document.getElementById('wizardBody');
  document.querySelectorAll('#wizardSteps [data-step]').forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
  const all = [...links, ...(clientUrl ? [{ label: '🏠 Chủ nhà (xem tiến độ, ảnh đã duyệt)', url: clientUrl }] : [])];
  body.innerHTML = `
    <div class="notice-success">✓ Đã tạo "${escapeHtml(project.name)}"</div>
    ${problems.length ? `<div class="notice-warning">${problems.map(escapeHtml).join('<br>')}</div>` : ''}
    <div class="field-label">Gửi link cho từng bên qua Zalo</div>
    ${all.map((l, i) => `
      <div class="wz-link">
        <div class="wz-link-label">${escapeHtml(l.label)}</div>
        <button type="button" class="btn btn-ghost" data-share="${i}">📤 Gửi</button>
      </div>`).join('') || '<div class="empty-hint compact">Chưa có link nào</div>'}`;
  body.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
    const l = all[+b.dataset.share];
    const r = await shareLink(l.url, `${project.name} — ${l.label}`);
    if (r !== 'cancelled') b.textContent = '✓ Đã gửi';
  });
  const back = document.getElementById('btnWizardBack');
  const next = document.getElementById('btnWizardNext');
  back.textContent = 'Đóng'; back.onclick = close;
  next.disabled = false; next.textContent = 'Xem công trình →'; next.onclick = () => { close(); };
}
