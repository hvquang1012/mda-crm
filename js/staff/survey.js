// ============================================================
// View "📐 Khảo sát" của tab Công việc: checklist số đo hiện trạng theo
// công trình + sửa mẫu checklist (chỉ quản lý).
//
// Module phụ — CHỈ items.js import (như wizard.js); đọc/ghi qua state,
// không import module tab khác.
//
// Định nghĩa "đủ" phải khớp TỪNG CHỮ với survey_missing() trong
// supabase/schema.sql: số 0 và số âm là số đo hợp lệ; Rộng × Cao phải
// cả hai > 0; chữ không rỗng; "Không áp dụng" phải có lý do. Cổng chặn
// thật nằm ở DB (trigger trg_projects_phase) — ở đây chỉ để hiện trạng thái.
// ============================================================
import { state, isManager } from './state.js';
import { escapeHtml, showToast, rpcErrorText } from '../ui.js';

let tplItems = [];          // mục checklist đang dùng (active), sắp theo seq
let answers = new Map();    // item_id → dòng survey_answers
let photoCount = new Map(); // item_id → số ảnh gắn vào mục
let missing = [];           // kết quả survey_missing() lần gần nhất
let wrapEl = null;
let projectRef = null;

// Mục bắt buộc còn thiếu (RPC survey_missing). Trả mảng [{id, label, reason}],
// hoặc null khi lỗi (đã báo toast).
export async function surveyMissing(projectId) {
  const { data, error } = await state.supabase.rpc('survey_missing', { p_project_id: projectId });
  if (error) { showToast(rpcErrorText(error, 'Không kiểm tra được số liệu khảo sát'), true); return null; }
  return Array.isArray(data) ? data : [];
}

// Trạng thái 1 mục — CÙNG quy tắc với survey_missing():
// 'ok' đủ · 'value' thiếu số/chữ · 'photo' thiếu ảnh
export function answerStatus(item, ans, nPhotos) {
  if (!ans) return 'value';
  if (ans.na) return 'ok';
  const v = ans.value && typeof ans.value === 'object' && !Array.isArray(ans.value) ? ans.value : {};
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  let filled;
  if (item.kind === 'number') filled = isNum(v.n);
  else if (item.kind === 'size') filled = isNum(v.w) && isNum(v.h) && v.w > 0 && v.h > 0;
  else filled = typeof v.t === 'string' && v.t.trim() !== '';
  if (!filled) return 'value';
  if (item.photo_required && !(nPhotos > 0)) return 'photo';
  return 'ok';
}

// "2650" · "-20" · "5,5" (phẩy thập phân kiểu Việt) · "2.650" (chấm hàng nghìn)
// → số; ô trống → null; gõ sai → NaN
export function parseMeasure(raw) {
  let s = String(raw ?? '').trim().replace(/\s/g, '').replace(/^\+/, '');
  if (s === '') return null;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

const STATUS_HTML = {
  ok: '<span class="survey-status ok">✓ Đủ</span>',
  value: '<span class="survey-status warn">⚠ Thiếu số</span>',
  photo: '<span class="survey-status warn">📷 Thiếu ảnh</span>'
};
function statusHtml(item) {
  const st = answerStatus(item, answers.get(item.id), photoCount.get(item.id) || 0);
  if (item.required) return STATUS_HTML[st];
  // Mục không bắt buộc không chặn cổng: chỉ hiện ✓ khi đã điền, nhắc nhẹ khi thiếu ảnh
  if (st === 'ok') return STATUS_HTML.ok;
  if (st === 'photo') return '<span class="survey-status muted">📷 Nên có ảnh</span>';
  return '<span class="survey-status muted">Tuỳ chọn</span>';
}

// ---------- Vẽ toàn bộ view ----------
// opts.missing: danh sách thiếu vừa kiểm khi bấm "Chuyển sang lên phương án" → hiện + cuộn tới mục đầu
export async function renderSurvey(wrap, project, opts = {}) {
  if (!wrap || !project) return;
  // Đang gõ dở trong view này (realtime vẽ lại tab) → không xoá chữ đang gõ
  if (!opts.missing && wrap.dataset.project === project.id && wrap.contains(document.activeElement)) return;
  wrapEl = wrap; projectRef = project;
  if (wrap.dataset.project !== project.id) wrap.innerHTML = '<div class="empty-hint">Đang tải khảo sát...</div>';
  wrap.dataset.project = project.id;

  const sb = state.supabase;
  const [r1, r2, r3, miss] = await Promise.all([
    sb.from('survey_checklist_items').select('*').eq('active', true).order('seq'),
    sb.from('survey_answers').select('*').eq('project_id', project.id),
    sb.from('survey_photos').select('id, item_id').eq('project_id', project.id),
    opts.missing ? Promise.resolve(opts.missing) : surveyMissing(project.id)
  ]);
  if (projectRef !== project) return; // đã đổi công trình trong lúc tải
  if (r1.error || r2.error || r3.error) {
    wrap.innerHTML = '<div class="empty-hint">Không tải được số liệu khảo sát. Kiểm tra mạng rồi mở lại.</div>';
    return;
  }
  tplItems = (r1.data || []).filter(i => i.active !== false).sort((a, b) => (a.seq - b.seq) || a.label.localeCompare(b.label));
  answers = new Map((r2.data || []).map(a => [a.item_id, a]));
  photoCount = new Map();
  (r3.data || []).forEach(p => { if (p.item_id) photoCount.set(p.item_id, (photoCount.get(p.item_id) || 0) + 1); });
  missing = miss || [];

  const sections = [];
  tplItems.forEach(it => {
    let s = sections.find(x => x.name === it.section);
    if (!s) sections.push(s = { name: it.section, items: [] });
    s.items.push(it);
  });

  wrap.innerHTML = `
    <div class="survey-head">
      <div class="survey-progress" id="surveyProgress"></div>
      ${isManager() ? '<button type="button" class="icon-btn" id="btnSurveyTemplate">⚙ Sửa mẫu khảo sát</button>' : ''}
    </div>
    <div id="surveyMissingNotice"></div>
    ${sections.map(s => `
      <div class="section-label">${escapeHtml(s.name)}</div>
      ${s.items.map(itemHtml).join('')}`).join('') || '<div class="empty-hint">Mẫu khảo sát chưa có mục nào.</div>'}`;

  renderProgress();
  if (opts.missing?.length) renderMissingNotice(opts.missing, true);
  wireSurvey(wrap);
}

function renderProgress() {
  const el = document.getElementById('surveyProgress');
  if (!el) return;
  const total = tplItems.filter(i => i.required).length;
  const done = Math.max(0, total - missing.length);
  const pct = total ? Math.round(100 * done / total) : 100;
  el.innerHTML = `
    <div class="survey-progress-text">Đã đủ <b>${done}/${total}</b> mục bắt buộc</div>
    <div class="progress-track thin"><div class="progress-fill ${done === total ? 'ahead' : 'onTrack'}" style="width:${pct}%"></div></div>`;
}

function renderMissingNotice(list, scroll) {
  const box = document.getElementById('surveyMissingNotice');
  if (!box) return;
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="notice-warning survey-missing">
      Chưa chuyển sang lên phương án được — còn thiếu ${list.length} mục bắt buộc:
      <ul>${list.map(m => `<li><button type="button" class="link-btn" data-goto-item="${escapeHtml(m.id)}">${escapeHtml(m.label)}</button> — ${m.reason === 'photo' ? '📷 thiếu ảnh' : '⚠ thiếu số liệu'}</li>`).join('')}</ul>
      Điền đủ, hoặc bấm "Không áp dụng" kèm lý do.
    </div>`;
  box.querySelectorAll('[data-goto-item]').forEach(b => { b.onclick = () => focusItem(b.dataset.gotoItem); });
  if (scroll) focusItem(list[0].id);
}

function focusItem(id) {
  const card = wrapEl?.querySelector(`[data-survey-item="${CSS.escape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
}

function itemHtml(it) {
  const a = answers.get(it.id) || {};
  const v = a.value && typeof a.value === 'object' ? a.value : {};
  const na = !!a.na;
  const unit = it.unit ? `<span class="survey-unit">${escapeHtml(it.unit)}</span>` : '';
  const numVal = (x) => (typeof x === 'number' ? String(x) : '');
  let inputs;
  if (it.kind === 'number') {
    inputs = `<div class="survey-num">
      <button type="button" class="icon-btn survey-sign" data-action="sign" aria-label="Đổi dấu âm / dương">±</button>
      <input type="text" inputmode="decimal" autocomplete="off" data-f="n" value="${numVal(v.n)}" aria-label="${escapeHtml(it.label)}" placeholder="Số đo">
      ${unit}</div>`;
  } else if (it.kind === 'size') {
    inputs = `<div class="survey-num">
      <input type="text" inputmode="numeric" autocomplete="off" data-f="w" value="${numVal(v.w)}" placeholder="Rộng" aria-label="Rộng">
      <span class="survey-x">×</span>
      <input type="text" inputmode="numeric" autocomplete="off" data-f="h" value="${numVal(v.h)}" placeholder="Cao" aria-label="Cao">
      ${unit}</div>`;
  } else {
    inputs = `<textarea rows="2" data-f="t" placeholder="Mô tả" aria-label="${escapeHtml(it.label)}">${escapeHtml(typeof v.t === 'string' ? v.t : '')}</textarea>`;
  }
  return `
    <div class="task-card survey-item" data-survey-item="${it.id}">
      <div class="survey-item-top">
        <div class="survey-item-label">
          <div class="task-name">${escapeHtml(it.label)}${it.required ? '<span class="survey-req" title="Bắt buộc">*</span>' : ''}</div>
          ${it.hint ? `<div class="field-hint">${escapeHtml(it.hint)}</div>` : ''}
        </div>
        <span data-status>${statusHtml(it)}</span>
      </div>
      <div class="survey-inputs"${na ? ' hidden' : ''}>${inputs}</div>
      <div class="survey-na"${na ? '' : ' hidden'}>
        <input type="text" data-f="na_reason" maxlength="300" value="${escapeHtml(a.na_reason || '')}" placeholder="Lý do không áp dụng (bắt buộc)" aria-label="Lý do không áp dụng">
      </div>
      <div class="survey-item-foot">
        <button type="button" class="chip${na ? ' active' : ''}" data-action="na" aria-pressed="${na}">Không áp dụng</button>
        <span class="survey-err" data-err hidden></span>
        <button type="button" class="icon-btn survey-retry" data-action="retry" hidden>Chưa lưu · Thử lại</button>
      </div>
    </div>`;
}

function wireSurvey(wrap) {
  wrap.querySelectorAll('[data-survey-item]').forEach(card => {
    const id = card.dataset.surveyItem;
    card.querySelectorAll('[data-f]').forEach(inp => { inp.addEventListener('change', () => saveItem(id)); });
    card.querySelector('[data-action=sign]')?.addEventListener('click', () => {
      const inp = card.querySelector('[data-f=n]');
      const s = inp.value.trim();
      inp.value = s.startsWith('-') ? s.slice(1) : '-' + s;
      if (s.replace('-', '') === '') { inp.focus(); return; } // chưa có số: chờ gõ tiếp, rời ô thì tự lưu
      saveItem(id);
    });
    card.querySelector('[data-action=na]').addEventListener('click', (e) => {
      const b = e.currentTarget;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('active', on);
      card.querySelector('.survey-inputs').hidden = on;
      card.querySelector('.survey-na').hidden = !on;
      if (on) {
        const r = card.querySelector('[data-f=na_reason]');
        if (r.value.trim()) saveItem(id); else { showError(card, 'Nhập lý do không áp dụng'); r.focus(); }
      } else saveItem(id);
    });
    card.querySelector('[data-action=retry]').addEventListener('click', () => saveItem(id));
  });
  document.getElementById('btnSurveyTemplate')?.addEventListener('click', openTemplateModal);
}

function showError(card, msg) {
  const el = card.querySelector('[data-err]');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// Đọc ô nhập của 1 mục → dòng survey_answers, hoặc { error } nếu gõ sai (không gửi)
function readCard(card, item) {
  const na = card.querySelector('[data-action=na]').getAttribute('aria-pressed') === 'true';
  const reason = card.querySelector('[data-f=na_reason]').value.trim();
  let value = null;
  let error = null;
  if (item.kind === 'number') {
    const n = parseMeasure(card.querySelector('[data-f=n]').value);
    if (Number.isNaN(n)) error = 'Số đo không hợp lệ — chỉ gõ số (VD 2650, -20, 5,5)';
    else if (n !== null) value = { n };
  } else if (item.kind === 'size') {
    const w = parseMeasure(card.querySelector('[data-f=w]').value);
    const h = parseMeasure(card.querySelector('[data-f=h]').value);
    if (Number.isNaN(w) || Number.isNaN(h)) error = 'Rộng / cao chỉ gõ số (mm)';
    else if ((w !== null && w <= 0) || (h !== null && h <= 0)) error = 'Rộng và cao phải lớn hơn 0';
    else if (w !== null || h !== null) value = { ...(w !== null ? { w } : {}), ...(h !== null ? { h } : {}) };
  } else {
    const t = card.querySelector('[data-f=t]').value.trim();
    if (t) value = { t };
  }
  if (na) {
    if (!reason) return { error: 'Nhập lý do không áp dụng' };
    // Đang "Không áp dụng": số gõ dở sai thì bỏ qua, giữ số cũ đã lưu
    if (error) value = answers.get(item.id)?.value ?? null;
    return { row: { value, na: true, na_reason: reason } };
  }
  if (error) return { error };
  return { row: { value, na: false, na_reason: null } };
}

// Tự lưu khi rời ô. Lỗi → giữ nguyên số đã gõ, hiện "Chưa lưu · Thử lại".
async function saveItem(itemId) {
  const card = wrapEl?.querySelector(`[data-survey-item="${CSS.escape(itemId)}"]`);
  const item = tplItems.find(i => i.id === itemId);
  const project = projectRef;
  if (!card || !item || !project) return;
  const retry = card.querySelector('[data-action=retry]');
  const { row, error: bad } = readCard(card, item);
  if (bad) { showError(card, bad); retry.hidden = true; return; }
  showError(card, '');
  const payload = { project_id: project.id, item_id: itemId, ...row };  // updated_by do trigger DB đặt
  card.classList.add('saving');
  const { error } = await state.supabase.from('survey_answers').upsert(payload, { onConflict: 'project_id,item_id' });
  card.classList.remove('saving');
  if (projectRef !== project) return;
  if (error) {
    console.error(error);
    showError(card, rpcErrorText(error, 'Không lưu được'));
    retry.hidden = false;
    return;
  }
  retry.hidden = true;
  answers.set(itemId, { ...answers.get(itemId), ...payload });
  // Số vừa lưu hiện lại đúng như máy chủ nhận (VD "2.650" → 2650)
  if (item.kind === 'number' && row.value) card.querySelector('[data-f=n]').value = String(row.value.n);
  card.querySelector('[data-status]').innerHTML = statusHtml(item);
  const m = await surveyMissing(project.id);
  if (m && projectRef === project) {
    missing = m;
    renderProgress();
    const box = document.getElementById('surveyMissingNotice');
    if (box?.innerHTML.trim()) renderMissingNotice(m, false);
  }
}

// ---------- Sửa mẫu khảo sát (chỉ quản lý — RLS chặn ở DB bằng is_manager()) ----------
let tplAll = [];
let tplDirty = false;

async function openTemplateModal() {
  if (!isManager()) return;
  const modal = document.getElementById('surveyTemplateModal');
  tplDirty = false;
  document.getElementById('btnSurveyTplClose').onclick = () => {
    modal.classList.remove('show');
    if (tplDirty && wrapEl && projectRef) { wrapEl.dataset.project = ''; renderSurvey(wrapEl, projectRef); }
  };
  document.getElementById('btnSurveyTplAdd').onclick = () => addTemplateRow();
  modal.classList.add('show');
  await loadTemplateList();
}

async function loadTemplateList() {
  const list = document.getElementById('surveyTemplateList');
  list.innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  const { data, error } = await state.supabase.from('survey_checklist_items').select('*').order('seq');
  if (error) { list.innerHTML = '<div class="empty-hint compact">Không tải được mẫu khảo sát.</div>'; return; }
  tplAll = (data || []).slice().sort((a, b) => (a.seq - b.seq) || a.label.localeCompare(b.label));
  list.innerHTML = tplAll.map(t => tplRowHtml(t, false)).join('') || '<div class="empty-hint compact">Chưa có mục nào</div>';
  wireTemplateRows(list);
}

const KIND_VI = { number: 'Một số', size: 'Rộng × Cao', text: 'Mô tả chữ' };

function tplRowHtml(t, open) {
  const flags = [t.required ? 'Bắt buộc' : '', t.photo_required ? 'Bắt buộc ảnh' : '', t.active === false ? 'Đã tắt' : ''].filter(Boolean).join(' · ');
  return `
    <details class="tpl-row${t.active === false ? ' off' : ''}" data-tpl-id="${t.id || ''}"${open ? ' open' : ''}>
      <summary><span class="tpl-seq">${escapeHtml(String(t.seq ?? ''))}</span>
        <span class="tpl-sum"><b>${escapeHtml(t.label || 'Mục mới')}</b><small>${escapeHtml(t.section || '')}${flags ? ' · ' + escapeHtml(flags) : ''}</small></span></summary>
      <div class="tpl-form">
        <div><span class="field-label">Tên mục</span><input type="text" data-t="label" maxlength="120" value="${escapeHtml(t.label || '')}"></div>
        <div class="row-inline">
          <div><span class="field-label">Nhóm</span><input type="text" data-t="section" maxlength="40" value="${escapeHtml(t.section || 'Chung')}"></div>
          <div class="tpl-narrow"><span class="field-label">Thứ tự</span><input type="number" inputmode="numeric" step="1" data-t="seq" value="${escapeHtml(String(t.seq ?? 0))}"></div>
        </div>
        <div class="row-inline">
          <div><span class="field-label">Loại ô nhập</span>
            <select data-t="kind">${Object.entries(KIND_VI).map(([k, l]) => `<option value="${k}"${t.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="tpl-narrow"><span class="field-label">Đơn vị</span><input type="text" data-t="unit" maxlength="20" value="${escapeHtml(t.unit || '')}" placeholder="mm"></div>
        </div>
        <div><span class="field-label">Cách đo (gợi ý dưới ô nhập)</span><input type="text" data-t="hint" maxlength="200" value="${escapeHtml(t.hint || '')}"></div>
        <div class="tpl-checks">
          <label><input type="checkbox" data-t="required"${t.required ? ' checked' : ''}> Bắt buộc</label>
          <label><input type="checkbox" data-t="photo_required"${t.photo_required ? ' checked' : ''}> Bắt buộc ảnh</label>
          <label><input type="checkbox" data-t="active"${t.active !== false ? ' checked' : ''}> Đang dùng</label>
        </div>
        <button type="button" class="btn btn-primary" data-action="tpl-save">${t.id ? 'Lưu mục này' : '＋ Thêm vào mẫu'}</button>
      </div>
    </details>`;
}

function wireTemplateRows(root) {
  root.querySelectorAll('[data-action=tpl-save]').forEach(b => { b.onclick = () => saveTemplateRow(b.closest('.tpl-row'), b); });
}

function addTemplateRow() {
  const list = document.getElementById('surveyTemplateList');
  if (list.querySelector('.tpl-row[data-tpl-id=""]')) { list.querySelector('.tpl-row[data-tpl-id=""]').open = true; return; }
  const seq = Math.max(0, ...tplAll.map(t => t.seq || 0)) + 10;
  list.querySelector('.empty-hint')?.remove();
  list.insertAdjacentHTML('beforeend', tplRowHtml({ seq, section: 'Chung', kind: 'number', unit: 'mm', active: true }, true));
  const row = list.lastElementChild;
  wireTemplateRows(row.parentElement);
  row.scrollIntoView({ block: 'nearest' });
  row.querySelector('[data-t=label]').focus();
}

async function saveTemplateRow(row, btn) {
  const val = (k) => row.querySelector(`[data-t=${k}]`);
  const label = val('label').value.trim();
  if (!label) { showToast('Nhập tên mục', true); val('label').focus(); return; }
  const seq = parseInt(val('seq').value, 10);
  const payload = {
    label,
    section: val('section').value.trim() || 'Chung',
    seq: Number.isInteger(seq) ? seq : 0,
    kind: val('kind').value,
    unit: val('unit').value.trim() || null,
    hint: val('hint').value.trim() || null,
    required: val('required').checked,
    photo_required: val('photo_required').checked,
    active: val('active').checked
  };
  const id = row.dataset.tplId;
  btn.disabled = true;
  const { data, error } = id
    ? await state.supabase.from('survey_checklist_items').update(payload).eq('id', id).select('id')
    : await state.supabase.from('survey_checklist_items').insert(payload).select('id');
  btn.disabled = false;
  if (error) { showToast(rpcErrorText(error, 'Không lưu được mẫu'), true); return; }
  if (!data?.length) { showToast('Chỉ quản lý được sửa mẫu khảo sát', true); return; }
  tplDirty = true;
  showToast(id ? 'Đã lưu mục mẫu' : 'Đã thêm mục vào mẫu');
  await loadTemplateList();
}
