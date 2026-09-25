// ============================================================
// Logic màn hình thầu phụ / công nhân (crew.html)
// Không đăng nhập — mọi thao tác xác thực bằng token trong URL
// (?t=<crew_link.token>), gọi qua các RPC crew_* trong supabase/schema.sql.
//
// Báo cáo đi qua hàng đợi trên máy (js/outbox.js): mất sóng vẫn bấm gửi
// được, có mạng lại tự gửi. Ghi chú / số lượng đang gõ dở được lưu nháp
// theo từng đầu việc.
// ============================================================
import { initSupabase } from './supabase.js';
import { showToast, showScreen, escapeHtml, setOnlineDots, displayDate, unitLabel, rpcErrorText } from './ui.js';

const { client: supabase, ready } = initSupabase();
const token = new URLSearchParams(location.search).get('t');

const MAX_PHOTOS = 4;
const NOTE_CHIPS = ['Đang thi công bình thường', 'Đã hoàn thiện phần này', 'Chờ vật tư', 'Chờ mặt bằng', 'Dọn dẹp vệ sinh'];

let state = {
  boot: null,          // kết quả crew_bootstrap
  selectedItemId: null,
  photoFiles: [],      // File[] đang chờ gửi
  issueFiles: [],      // File[] ảnh kèm vướng mắc
  tab: 'report',
  outbox: null         // module js/outbox.js (import lười), null nếu máy không hỗ trợ
};

// Ngày theo giờ máy thợ (VN), không phải UTC — báo lúc 6h sáng vẫn là hôm nay
function localDateISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function boot() {
  if (!ready) { showScreen('crewError'); setErr('Chưa cấu hình Supabase — mở config.js.'); return; }
  if (!token) { showScreen('crewError'); setErr('Thiếu link — vui lòng dùng đúng link được gửi qua Zalo.'); return; }

  let { data, error } = await supabase.rpc('crew_bootstrap', { p_token: token });
  // Mở app lúc mất sóng (trang lấy từ cache của service worker): dùng
  // danh sách đầu việc lần trước để thợ vẫn báo được, gửi sau.
  const offline = error && (!navigator.onLine || /fetch|network/i.test(error.message || ''));
  if (offline) {
    const cached = loadCachedBoot();
    if (cached) { data = cached; error = null; showToast('Đang mất sóng — báo cáo sẽ lưu trong máy và tự gửi sau'); }
  }
  if (error || !data) {
    showScreen('crewError');
    setErr(navigator.onLine
      ? 'Link không hợp lệ hoặc đã hết hạn. Liên hệ giám sát để lấy link mới.'
      : 'Không có mạng — mở lại khi có sóng. Báo cáo đã bấm gửi trước đó vẫn nằm an toàn trong máy.');
    return;
  }
  state.boot = data;
  if (!offline) cacheBoot(data);
  renderHeader();
  renderItemPicker();
  showScreen('crewMain');

  try {
    const mod = await import('./outbox.js');
    if (await mod.available()) state.outbox = mod;
  } catch (e) { /* máy cũ không có IndexedDB — gửi thẳng như trước */ }
  // Tải sẵn bộ nén ảnh để service worker cất vào cache — lần đầu bấm gửi
  // lúc mất sóng vẫn nén được (trước đây chỉ tải lúc bấm gửi).
  if (navigator.onLine) import('./photos.js').catch(() => {});
  flushOutbox();
}

function setErr(msg) {
  const el = document.getElementById('crewErrorMsg');
  if (el) el.textContent = msg;
}

function loadCachedBoot() {
  try { return JSON.parse(localStorage.getItem('mda-boot:' + token) || 'null'); } catch (e) { return null; }
}

function cacheBoot(data) {
  try { localStorage.setItem('mda-boot:' + token, JSON.stringify(data)); } catch (e) { /* hết chỗ — bỏ qua */ }
}

function renderHeader() {
  document.getElementById('crewProjectName').textContent = state.boot.project.name;
  document.getElementById('crewSubName').textContent =
    (state.boot.subcontractor.trade === 'da' ? 'Đội đá' : state.boot.subcontractor.trade === 'dien' ? 'Đội điện' : 'Đội thi công')
    + ' · ' + state.boot.subcontractor.name;
}

// ---- Danh sách đầu việc: việc trong lịch hôm nay lên đầu ----
function itemGroup(it, today) {
  if (it.status === 'done') return 'done';
  if (it.planned_start && it.planned_start <= today && (!it.planned_end || it.planned_end >= today)) return 'today';
  if (it.planned_end && it.planned_end < today) return 'late';
  return 'later';
}

function remainingOf(it) {
  return it.qty_plan ? Math.max(0, Number(it.qty_plan) - Number(it.qty_done || 0)) : null;
}

function renderItemPicker() {
  const wrap = document.getElementById('crewItemPicker');
  wrap.innerHTML = '';
  const items = state.boot.work_items || [];
  if (!items.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có đầu việc nào được giao. Liên hệ giám sát.</div>';
    return;
  }
  const today = localDateISO();
  const groups = { late: [], today: [], later: [], done: [] };
  items.forEach(it => groups[itemGroup(it, today)].push(it));
  const titles = { late: '⏰ Đã quá hạn — ưu tiên làm', today: '📅 Trong lịch hôm nay', later: 'Sắp tới', done: '' };

  ['late', 'today', 'later'].forEach(g => {
    if (!groups[g].length) return;
    const label = document.createElement('div');
    label.className = 'crew-group-label' + (g === 'late' ? ' late' : '');
    label.textContent = titles[g];
    wrap.appendChild(label);
    groups[g].forEach(it => wrap.appendChild(itemCard(it)));
  });
  if (groups.done.length) {
    const det = document.createElement('details');
    det.className = 'crew-done-group';
    det.innerHTML = `<summary>✅ Đã xong (${groups.done.length})</summary>`;
    groups.done.forEach(it => det.appendChild(itemCard(it)));
    wrap.appendChild(det);
  }
}

function itemCard(it) {
  const card = document.createElement('div');
  card.className = 'crew-item-card' + (state.selectedItemId === it.id ? ' selected' : '');
  const remaining = remainingOf(it);
  const doneTxt = it.qty_plan ? `${it.qty_done}/${it.qty_plan} ${unitLabel(it.unit)}` : `${it.percent}%`;
  const hasDraft = !!loadDraft(it.id)?.note;
  card.innerHTML = `
    <div class="task-top">
      <div class="task-name">${escapeHtml(it.name)}</div>
      <span class="badge ${it.status === 'done' ? 'ahead' : it.status}">${doneTxt}</span>
    </div>
    <div class="progress-track"><div class="progress-fill ${it.status === 'done' ? 'ahead' : it.status}" style="width:${it.percent}%"></div></div>
    <div class="task-meta">${it.planned_start ? displayDate(it.planned_start) + ' → ' + displayDate(it.planned_end) : 'Chưa có lịch'}${remaining !== null && it.status !== 'done' ? ` · còn ${remaining} ${unitLabel(it.unit)}` : ''}${hasDraft ? ' · ✏️ có nháp' : ''}</div>
  `;
  card.onclick = () => selectItem(it.id);
  return card;
}

// Xác nhận đã gửi phải NHÌN THẤY được — toast 2 giây dễ lỡ, nhất là
// khi form vừa đóng lại và trang nhảy. Thông báo nằm yên trên đầu danh
// sách tới khi thợ chọn đầu việc khác.
function showSentNotice(text, tone = 'ok') {
  const el = document.getElementById('crewSentBanner');
  if (!el) return;
  el.textContent = text;
  el.className = 'crew-sent-banner ' + tone;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideSentNotice() {
  const el = document.getElementById('crewSentBanner');
  if (el) el.hidden = true;
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function currentItem() { return (state.boot.work_items || []).find(i => i.id === state.selectedItemId); }

function selectItem(id) {
  if (state.selectedItemId && state.selectedItemId !== id) saveDraft();
  state.selectedItemId = id;
  hideSentNotice();
  renderItemPicker();
  const it = currentItem();
  document.getElementById('crewFormItemName').textContent = it ? it.name : '';
  const draft = loadDraft(id) || {};
  document.getElementById('crewNote').value = draft.note || '';
  document.getElementById('crewQty').value = draft.qty || '';
  const size = document.getElementById('crewSize');
  if (!size.value) size.value = lastCrewSize() || '';
  renderQtyChips();
  updateQtyHint();
  const form = document.getElementById('crewForm');
  form.style.display = 'flex';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Nháp theo đầu việc (localStorage) ----
function draftKey(itemId) { return `mda-draft:${token}:${itemId}`; }
function loadDraft(itemId) {
  try { return JSON.parse(localStorage.getItem(draftKey(itemId)) || 'null'); } catch (e) { return null; }
}
function saveDraft() {
  if (!state.selectedItemId) return;
  const note = document.getElementById('crewNote').value;
  const qty = document.getElementById('crewQty').value;
  try {
    if (note || qty) localStorage.setItem(draftKey(state.selectedItemId), JSON.stringify({ note, qty }));
    else localStorage.removeItem(draftKey(state.selectedItemId));
  } catch (e) { /* bỏ qua */ }
}
function clearDraft(itemId) { try { localStorage.removeItem(draftKey(itemId)); } catch (e) { /* bỏ qua */ } }
function lastCrewSize() { try { return localStorage.getItem('mda-crewsize:' + token); } catch (e) { return null; } }

let draftTimer = null;
['crewNote', 'crewQty'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
    if (id === 'crewQty') updateQtyHint();
  });
});

// ---- Nhập nhanh số lượng / ghi chú ----
function renderQtyChips() {
  const wrap = document.getElementById('crewQtyChips');
  const it = currentItem();
  if (!it || it.unit === 'tron_goi') { wrap.innerHTML = ''; return; }
  const remaining = remainingOf(it);
  const chips = [1, 5, 10].map(n => `<button type="button" class="chip" data-add="${n}">+${n}</button>`);
  if (remaining) chips.push(`<button type="button" class="chip" data-set="${remaining}">Xong phần còn lại (${remaining})</button>`);
  wrap.innerHTML = chips.join('');
  wrap.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => {
      const input = document.getElementById('crewQty');
      const cur = Number(input.value || 0);
      input.value = c.dataset.set ? c.dataset.set : Math.round((cur + Number(c.dataset.add)) * 10) / 10;
      updateQtyHint(); saveDraft();
    };
  });
}

function updateQtyHint() {
  const hint = document.getElementById('crewQtyHint');
  const it = currentItem();
  const qty = Number(document.getElementById('crewQty').value || 0);
  const remaining = it ? remainingOf(it) : null;
  if (it && remaining !== null && qty > remaining) {
    hint.textContent = `⚠ Nhiều hơn phần còn lại (${remaining} ${unitLabel(it.unit)}) — kiểm tra lại số`;
    hint.className = 'field-hint warn';
  } else {
    hint.textContent = it?.unit === 'tron_goi' ? 'Hạng mục trọn gói — để trống, ghi rõ việc đã làm ở ghi chú' : '';
    hint.className = 'field-hint';
  }
}

document.getElementById('crewNoteChips').innerHTML = NOTE_CHIPS
  .map(t => `<button type="button" class="chip" data-note="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('');
document.querySelectorAll('#crewNoteChips .chip').forEach(c => {
  c.onclick = () => {
    const ta = document.getElementById('crewNote');
    ta.value = ta.value.trim() ? ta.value.trim() + '. ' + c.dataset.note : c.dataset.note;
    saveDraft();
  };
});

// ---- Ảnh ----
function acceptImages(files, list, max) {
  for (const f of files) {
    if (list.length >= max) { showToast(`Tối đa ${max} ảnh mỗi lần`, true); break; }
    // Chặn ngay lúc chọn, đừng để thợ gõ xong ghi chú rồi mới báo lỗi.
    // Không dựa hẳn vào f.type: Windows để trống type cho .heic/.dng,
    // kiểm tra thật bằng byte đầu file diễn ra lúc gửi (js/convert.js).
    if (!/^image\//i.test(f.type || '') && !/\.(jpe?g|png|heic|heif|dng|tiff?|webp)$/i.test(f.name || '')) {
      showToast(`"${f.name}" không phải ảnh`, true);
      continue;
    }
    list.push(f);
  }
}

document.getElementById('crewPhotoInput').addEventListener('change', (e) => {
  acceptImages(Array.from(e.target.files || []), state.photoFiles, MAX_PHOTOS);
  e.target.value = '';
  renderPreview('crewPhotoPreview', state.photoFiles);
});
document.getElementById('issuePhotoInput').addEventListener('change', (e) => {
  acceptImages(Array.from(e.target.files || []), state.issueFiles, 3);
  e.target.value = '';
  renderPreview('issuePhotoPreview', state.issueFiles);
});

function renderPreview(wrapId, list) {
  const wrap = document.getElementById(wrapId);
  wrap.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
  wrap.innerHTML = '';
  list.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const url = URL.createObjectURL(f);
    div.innerHTML = `<img src="${url}"><button class="rm" data-i="${i}" aria-label="Bỏ ảnh">✕</button>`;
    // Máy tính không xem trước được HEIC/DNG — thay bằng nhãn thay vì để
    // ô ảnh vỡ, ảnh vẫn gửi được vì được chuyển đổi lúc gửi.
    div.querySelector('img').onerror = (ev) => {
      ev.target.remove();
      div.insertAdjacentHTML('afterbegin', '<span class="thumb-fallback">Ảnh iPhone<br>đã chọn</span>');
    };
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('.rm').forEach(btn => {
    btn.onclick = () => { list.splice(+btn.dataset.i, 1); renderPreview(wrapId, list); };
  });
}

// ---- Gửi báo cáo ----
document.getElementById('crewSubmitBtn').onclick = async () => {
  const it = currentItem();
  if (!it) { showToast('Chọn đầu việc trước', true); return; }
  const note = document.getElementById('crewNote').value.trim();
  const qty = document.getElementById('crewQty').value;
  const crewSize = document.getElementById('crewSize').value;

  if (!note) { showToast('Vui lòng nhập ghi chú', true); return; }
  if (!state.photoFiles.length) { showToast('Vui lòng chụp ít nhất 1 ảnh', true); return; }
  const remaining = remainingOf(it);
  if (remaining !== null && Number(qty || 0) > remaining &&
      !confirm(`Số lượng ${qty} nhiều hơn phần còn lại (${remaining}). Vẫn gửi?`)) return;

  const btn = document.getElementById('crewSubmitBtn');
  btn.disabled = true;
  try {
    const { prepareImage } = await import('./photos.js');
    const prepared = [];
    for (const [i, f] of state.photoFiles.entries()) {
      // Ảnh HEIC/RAW phải chuyển đổi trước khi gửi, mất vài giây mỗi
      // tấm — không đếm số thì thợ tưởng treo máy và bấm lại.
      btn.textContent = `Đang nén ảnh ${i + 1}/${state.photoFiles.length}...`;
      prepared.push(await prepareImage(f));
    }
    if (crewSize) { try { localStorage.setItem('mda-crewsize:' + token, crewSize); } catch (e) { /* bỏ qua */ } }
    const payload = {
      token, itemId: it.id, itemName: it.name,
      qty: qty ? Number(qty) : 0, crewSize: crewSize ? Number(crewSize) : null,
      note, reportDate: localDateISO(), prepared,
      originals: window.MDA_CONFIG?.DROPBOX_ORIGINALS ? [...state.photoFiles] : []
    };

    if (state.outbox) {
      await state.outbox.queueReport(payload);
      resetForm(it.id);
      if (!navigator.onLine) {
        showSentNotice(`📤 Mất sóng — báo cáo "${it.name}" đã lưu trong máy, sẽ tự gửi khi có mạng.`, 'queued');
      } else {
        await flushOutbox((msg) => { btn.textContent = msg; }, true, it.name);
      }
    } else {
      await sendDirect(payload, (msg) => { btn.textContent = msg; });
      resetForm(it.id);
      showSentNotice(`✅ Đã gửi báo cáo "${it.name}" lúc ${nowHM()} — chờ giám sát duyệt. Xem lại ở tab Lịch sử.`);
      loadHistory();
    }
  } catch (e) {
    console.error(e);
    // Hiện đúng lý do (ảnh HEIC, link hết hạn, mất sóng...) thay vì một
    // câu chung — thợ ở công trường không mở được console để xem.
    showToast(e?.name === 'PhotoError' ? e.message : rpcErrorText(e, 'Gửi thất bại — kiểm tra kết nối và thử lại'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'GỬI BÁO CÁO';
  }
};

// Máy không có IndexedDB: gửi thẳng như bản trước
async function sendDirect(p, onProgress) {
  const { uploadPreparedCrewPhoto } = await import('./photos.js');
  const photos = [];
  for (const [i, prep] of p.prepared.entries()) {
    onProgress(`Đang gửi ảnh ${i + 1}/${p.prepared.length}...`);
    photos.push(await uploadPreparedCrewPhoto(supabase, token, prep));
  }
  onProgress('Đang lưu báo cáo...');
  const { error } = await supabase.rpc('crew_submit', {
    p_token: token, p_item_id: p.itemId, p_qty_delta: p.qty, p_crew_size: p.crewSize,
    p_note: p.note, p_photos: photos, p_report_date: p.reportDate
  });
  if (error) throw error;
}

function resetForm(itemId) {
  clearDraft(itemId);
  document.getElementById('crewNote').value = '';
  document.getElementById('crewQty').value = '';
  state.photoFiles = [];
  renderPreview('crewPhotoPreview', state.photoFiles);
  document.getElementById('crewForm').style.display = 'none';
  state.selectedItemId = null;
  renderItemPicker();
}

// ---- Hàng đợi: gửi những báo cáo còn nằm trong máy ----
async function flushOutbox(onProgress, fromSubmit = false, itemName = '') {
  if (!state.outbox) return;
  const before = (await state.outbox.pendingReports(token)).length;
  if (before && navigator.onLine) {
    const { sent } = await state.outbox.processOutbox(supabase, token, onProgress);
    const left = await state.outbox.pendingReports(token);
    if (sent) {
      showSentNotice(sent === 1 && fromSubmit && itemName
        ? `✅ Đã gửi báo cáo "${itemName}" lúc ${nowHM()} — chờ giám sát duyệt. Xem lại ở tab Lịch sử.`
        : `✅ Đã gửi ${sent} báo cáo lúc ${nowHM()} — chờ giám sát duyệt. Xem lại ở tab Lịch sử.`);
      refreshBoot();
      if (state.tab === 'history') loadHistory();
    } else if (fromSubmit && left.length) {
      const dead = left.find(j => j.dead);
      if (dead) showToast(errText(dead), true);
      else showSentNotice('📤 Sóng yếu — báo cáo đã lưu trong máy, sẽ tự gửi lại khi có mạng.', 'queued');
    }
  } else if (navigator.onLine && state.outbox) {
    // Không còn báo cáo chờ nhưng có thể còn ảnh gốc chờ lên Dropbox
    state.outbox.processOutbox(supabase, token);
  }
  renderOutboxBanner();
}

function errText(job) { return job.lastErrorText || rpcErrorText({ message: job.lastError }); }

async function renderOutboxBanner() {
  const el = document.getElementById('crewOutboxBanner');
  if (!el || !state.outbox) return;
  const jobs = await state.outbox.pendingReports(token);
  if (!jobs.length) { el.hidden = true; return; }
  const dead = jobs.filter(j => j.dead);
  el.hidden = false;
  el.innerHTML = `
    <div>📤 <b>${jobs.length} báo cáo</b> đang nằm trong máy, chưa gửi được${dead.length ? ` (${dead.length} bị từ chối: ${escapeHtml(errText(dead[0]))})` : ' — sẽ tự gửi khi có sóng'}.</div>
    <div class="outbox-actions">
      <button class="btn btn-primary" id="btnOutboxRetry">Gửi ngay</button>
      ${dead.length ? '<button class="btn btn-ghost" id="btnOutboxDiscard">Bỏ báo cáo lỗi</button>' : ''}
    </div>`;
  document.getElementById('btnOutboxRetry').onclick = () => {
    if (!navigator.onLine) { showToast('Vẫn chưa có mạng', true); return; }
    flushOutbox(null, true);
  };
  const discard = document.getElementById('btnOutboxDiscard');
  if (discard) discard.onclick = async () => {
    if (!confirm('Xoá các báo cáo bị từ chối khỏi máy? (cần báo lại từ đầu)')) return;
    for (const j of dead) await state.outbox.discard(j.clientRef);
    renderOutboxBanner();
  };
}

async function refreshBoot() {
  const { data, error } = await supabase.rpc('crew_bootstrap', { p_token: token });
  if (error || !data) return;
  state.boot = data;
  cacheBoot(data);
  renderItemPicker();
}

// ---- Lịch sử ----
async function loadHistory() {
  const wrap = document.getElementById('crewHistoryList');
  const queued = state.outbox ? await state.outbox.pendingReports(token) : [];
  const queuedHtml = queued.map(j => `
    <div class="crew-history-item">
      <div class="task-top">
        <div class="task-name">${escapeHtml(j.itemName)}</div>
        <span class="crew-status-pill queued">📤 Chờ gửi</span>
      </div>
      <div class="task-meta">${new Date(j.createdAt).toLocaleString('vi-VN')} · ${j.qty || 0}${j.crewSize ? ' · ' + j.crewSize + ' thợ' : ''}</div>
      <div class="approval-note">${escapeHtml(j.note)}</div>
    </div>`).join('');

  const { data, error } = await supabase.rpc('crew_my_reports', { p_token: token });
  if (error) { wrap.innerHTML = queuedHtml + '<div class="empty-hint">Không tải được lịch sử (kiểm tra mạng).</div>'; return; }
  if ((!data || !data.length) && !queued.length) { wrap.innerHTML = '<div class="empty-hint">Chưa có báo cáo nào.</div>'; return; }
  wrap.innerHTML = queuedHtml + (data || []).map(r => `
    <div class="crew-history-item">
      <div class="task-top">
        <div class="task-name">${escapeHtml(r.work_item_name)}</div>
        <span class="crew-status-pill ${r.status}">${statusLabel(r.status)}</span>
      </div>
      <div class="task-meta">${new Date(r.created_at).toLocaleString('vi-VN')} · ${r.qty_delta || 0} ${r.crew_size ? '· ' + r.crew_size + ' thợ' : ''}</div>
      <div class="approval-note">${escapeHtml(r.note)}</div>
      ${r.status === 'rejected' && r.reject_reason ? `<div class="task-meta" style="color:var(--danger)">Lý do trả lại: ${escapeHtml(r.reject_reason)}</div>` : ''}
      ${r.status === 'rejected' && r.work_item_id ? `<button class="btn btn-ghost resend-btn" data-id="${r.id}">↻ Sửa & gửi lại</button>` : ''}
    </div>
  `).join('');
  wrap.querySelectorAll('.resend-btn').forEach(btn => {
    btn.onclick = () => resendRejected((data || []).find(r => r.id === btn.dataset.id));
  });
}
function statusLabel(s) { return { pending: '⏳ Chờ duyệt', approved: '✅ Đã duyệt', rejected: '❌ Bị trả lại' }[s] || s; }

// Báo cáo bị trả lại → mở form điền sẵn, thợ sửa rồi gửi báo cáo MỚI
// (báo cáo cũ giữ nguyên — progress_reports chỉ ghi thêm).
function resendRejected(r) {
  if (!r) return;
  if (!(state.boot.work_items || []).some(i => i.id === r.work_item_id)) { showToast('Đầu việc này không còn được giao cho đội', true); return; }
  switchTab('report');
  selectItem(r.work_item_id);
  document.getElementById('crewNote').value = r.note || '';
  document.getElementById('crewQty').value = r.qty_delta || '';
  updateQtyHint(); saveDraft();
  showToast('Đã điền lại — sửa theo lý do trả lại và chụp ảnh mới');
}

// ---- Báo vướng ----
document.getElementById('btnRaiseIssue').onclick = () => {
  document.getElementById('issueModal').classList.add('show');
  const sel = document.getElementById('issueItemSelect');
  sel.innerHTML = '<option value="">— Không gắn đầu việc cụ thể —</option>' +
    state.boot.work_items.map(it => `<option value="${it.id}" ${it.id === state.selectedItemId ? 'selected' : ''}>${escapeHtml(it.name)}</option>`).join('');
};
document.getElementById('btnIssueCancel').onclick = () => document.getElementById('issueModal').classList.remove('show');
document.getElementById('btnIssueSubmit').onclick = async () => {
  const desc = document.getElementById('issueDesc').value.trim();
  if (!desc) { showToast('Nhập mô tả vướng mắc', true); return; }
  if (!navigator.onLine) { showToast('Cần có mạng để gửi vướng mắc — gọi điện cho giám sát nếu gấp', true); return; }
  const btn = document.getElementById('btnIssueSubmit');
  btn.disabled = true;
  try {
    const photos = [];
    if (state.issueFiles.length) {
      const { uploadCrewPhoto } = await import('./photos.js');
      for (const [i, f] of state.issueFiles.entries()) {
        btn.textContent = `Đang gửi ảnh ${i + 1}/${state.issueFiles.length}...`;
        photos.push(await uploadCrewPhoto(supabase, token, f));
      }
    }
    btn.textContent = 'Đang gửi...';
    const { error } = await supabase.rpc('crew_raise_issue', {
      p_token: token,
      p_item_id: document.getElementById('issueItemSelect').value || null,
      p_kind: document.getElementById('issueKind').value,
      p_description: desc,
      p_photos: photos,
      p_is_blocking: document.getElementById('issueBlocking').checked
    });
    if (error) throw error;
    showToast('Đã gửi vướng mắc tới giám sát');
    document.getElementById('issueDesc').value = '';
    document.getElementById('issueBlocking').checked = false;
    state.issueFiles = [];
    renderPreview('issuePhotoPreview', state.issueFiles);
    document.getElementById('issueModal').classList.remove('show');
  } catch (e) {
    console.error(e);
    showToast(e?.name === 'PhotoError' ? e.message : rpcErrorText(e, 'Gửi vướng mắc thất bại'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi';
  }
};

// ---- Tabs ----
function switchTab(tab) {
  document.querySelectorAll('.crew-tabs button').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  state.tab = tab;
  const reportPanel = document.getElementById('crewReportTab');
  const historyPanel = document.getElementById('crewHistoryTab');
  reportPanel.hidden = tab !== 'report';
  historyPanel.hidden = tab !== 'history';
  reportPanel.classList.toggle('active', tab === 'report');
  historyPanel.classList.toggle('active', tab === 'history');
  if (tab === 'history') loadHistory();
}
document.querySelectorAll('.crew-tabs button').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });

setOnlineDots(navigator.onLine, ['crewOnlineDot']);
window.addEventListener('online', () => { setOnlineDots(true, ['crewOnlineDot']); flushOutbox(); });
window.addEventListener('offline', () => setOnlineDots(false, ['crewOnlineDot']));
// Sóng chập chờn không phải lúc nào cũng bắn sự kiện "online" — thử lại định kỳ
setInterval(() => { if (navigator.onLine) flushOutbox(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) flushOutbox(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

boot();
