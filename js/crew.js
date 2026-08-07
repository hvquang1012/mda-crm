// ============================================================
// Logic màn hình thầu phụ / công nhân (crew.html)
// Không đăng nhập — mọi thao tác xác thực bằng token trong URL
// (?t=<crew_link.token>), gọi qua các RPC crew_* trong supabase/schema.sql.
// ============================================================
import { initSupabase } from './supabase.js';
import { showToast, showScreen, escapeHtml, setOnlineDots } from './ui.js';
import { prepareImage } from './photos.js';

const { client: supabase, ready } = initSupabase();
const token = new URLSearchParams(location.search).get('t');

let state = {
  boot: null,          // kết quả crew_bootstrap
  selectedItemId: null,
  photoFiles: [],       // File[] đang chờ gửi
  tab: 'report'
};

async function boot() {
  if (!ready) { showScreen('crewError'); setErr('Chưa cấu hình Supabase — mở config.js.'); return; }
  if (!token) { showScreen('crewError'); setErr('Thiếu link — vui lòng dùng đúng link được gửi qua Zalo.'); return; }

  const { data, error } = await supabase.rpc('crew_bootstrap', { p_token: token });
  if (error || !data) {
    showScreen('crewError');
    setErr('Link không hợp lệ hoặc đã hết hạn. Liên hệ giám sát để lấy link mới.');
    return;
  }
  state.boot = data;
  renderHeader();
  renderItemPicker();
  showScreen('crewMain');
}

function setErr(msg) {
  const el = document.getElementById('crewErrorMsg');
  if (el) el.textContent = msg;
}

function renderHeader() {
  document.getElementById('crewProjectName').textContent = state.boot.project.name;
  document.getElementById('crewSubName').textContent =
    (state.boot.subcontractor.trade === 'da' ? 'Đội đá' : state.boot.subcontractor.trade === 'dien' ? 'Đội điện' : 'Đội thi công')
    + ' · ' + state.boot.subcontractor.name;
}

function renderItemPicker() {
  const wrap = document.getElementById('crewItemPicker');
  wrap.innerHTML = '';
  if (!state.boot.work_items.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có đầu việc nào được giao. Liên hệ giám sát.</div>';
    return;
  }
  state.boot.work_items.forEach(it => {
    const card = document.createElement('div');
    card.className = 'crew-item-card' + (state.selectedItemId === it.id ? ' selected' : '');
    const doneTxt = it.qty_plan ? `${it.qty_done}/${it.qty_plan} ${unitLabel(it.unit)}` : `${it.percent}%`;
    card.innerHTML = `
      <div class="task-top">
        <div class="task-name">${escapeHtml(it.name)}</div>
        <span class="badge ${it.status === 'done' ? 'ahead' : it.status}">${doneTxt}</span>
      </div>
      <div class="progress-track"><div class="progress-fill ${it.status === 'done' ? 'ahead' : it.status}" style="width:${it.percent}%"></div></div>
    `;
    card.onclick = () => selectItem(it.id);
    wrap.appendChild(card);
  });
}

function unitLabel(u) {
  return { m2: 'm²', diem: 'điểm', md: 'md', tron_goi: '' }[u] || u;
}

function selectItem(id) {
  state.selectedItemId = id;
  renderItemPicker();
  document.getElementById('crewForm').style.display = 'flex';
  document.getElementById('crewForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Ảnh ----
document.getElementById('crewPhotoInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (state.photoFiles.length >= 4) { showToast('Tối đa 4 ảnh mỗi lần báo', true); break; }
    state.photoFiles.push(f);
  }
  e.target.value = '';
  renderPhotoPreview();
});

function renderPhotoPreview() {
  const wrap = document.getElementById('crewPhotoPreview');
  wrap.innerHTML = '';
  state.photoFiles.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const url = URL.createObjectURL(f);
    div.innerHTML = `<img src="${url}"><button class="rm" data-i="${i}">✕</button>`;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('.rm').forEach(btn => {
    btn.onclick = () => { state.photoFiles.splice(+btn.dataset.i, 1); renderPhotoPreview(); };
  });
}

// ---- Gửi báo cáo ----
document.getElementById('crewSubmitBtn').onclick = async () => {
  if (!state.selectedItemId) { showToast('Chọn đầu việc trước', true); return; }
  const note = document.getElementById('crewNote').value.trim();
  const qty = document.getElementById('crewQty').value;
  const crewSize = document.getElementById('crewSize').value;

  if (!note) { showToast('Vui lòng nhập ghi chú', true); return; }
  if (!state.photoFiles.length) { showToast('Vui lòng chụp ít nhất 1 ảnh', true); return; }

  const btn = document.getElementById('crewSubmitBtn');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const uploadedFn = (await import('./photos.js')).uploadCrewPhoto;
    const photos = [];
    for (const f of state.photoFiles) {
      const p = await uploadedFn(supabase, token, f);
      photos.push(p);
    }
    const { error } = await supabase.rpc('crew_submit', {
      p_token: token,
      p_item_id: state.selectedItemId,
      p_qty_delta: qty ? Number(qty) : 0,
      p_crew_size: crewSize ? Number(crewSize) : null,
      p_note: note,
      p_photos: photos
    });
    if (error) throw error;

    showToast('Đã gửi — chờ giám sát duyệt');
    document.getElementById('crewNote').value = '';
    document.getElementById('crewQty').value = '';
    document.getElementById('crewSize').value = '';
    state.photoFiles = [];
    renderPhotoPreview();
    document.getElementById('crewForm').style.display = 'none';
    state.selectedItemId = null;
    renderItemPicker();
    loadHistory();
  } catch (e) {
    console.error(e);
    showToast('Gửi thất bại — kiểm tra kết nối và thử lại', true);
  } finally {
    btn.disabled = false; btn.textContent = 'GỬI BÁO CÁO';
  }
};

// ---- Lịch sử ----
async function loadHistory() {
  const { data, error } = await supabase.rpc('crew_my_reports', { p_token: token });
  const wrap = document.getElementById('crewHistoryList');
  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được lịch sử.</div>'; return; }
  if (!data || !data.length) { wrap.innerHTML = '<div class="empty-hint">Chưa có báo cáo nào.</div>'; return; }
  wrap.innerHTML = data.map(r => `
    <div class="crew-history-item">
      <div class="task-top">
        <div class="task-name">${escapeHtml(r.work_item_name)}</div>
        <span class="crew-status-pill ${r.status}">${statusLabel(r.status)}</span>
      </div>
      <div class="task-meta">${new Date(r.created_at).toLocaleString('vi-VN')} · ${r.qty_delta || 0} ${r.crew_size ? '· ' + r.crew_size + ' thợ' : ''}</div>
      <div class="approval-note">${escapeHtml(r.note)}</div>
      ${r.status === 'rejected' && r.reject_reason ? `<div class="task-meta" style="color:var(--danger)">Lý do trả lại: ${escapeHtml(r.reject_reason)}</div>` : ''}
    </div>
  `).join('');
}
function statusLabel(s) { return { pending: '⏳ Chờ duyệt', approved: '✅ Đã duyệt', rejected: '❌ Bị trả lại' }[s] || s; }

// ---- Báo vướng ----
document.getElementById('btnRaiseIssue').onclick = () => {
  document.getElementById('issueModal').classList.add('show');
  const sel = document.getElementById('issueItemSelect');
  sel.innerHTML = '<option value="">— Không gắn đầu việc cụ thể —</option>' +
    state.boot.work_items.map(it => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join('');
};
document.getElementById('btnIssueCancel').onclick = () => document.getElementById('issueModal').classList.remove('show');
document.getElementById('btnIssueSubmit').onclick = async () => {
  const desc = document.getElementById('issueDesc').value.trim();
  if (!desc) { showToast('Nhập mô tả vướng mắc', true); return; }
  const itemId = document.getElementById('issueItemSelect').value || null;
  const kind = document.getElementById('issueKind').value;
  const blocking = document.getElementById('issueBlocking').checked;
  const { error } = await supabase.rpc('crew_raise_issue', {
    p_token: token, p_item_id: itemId, p_kind: kind, p_description: desc,
    p_photos: [], p_is_blocking: blocking
  });
  if (error) { showToast('Gửi vướng mắc thất bại', true); return; }
  showToast('Đã gửi vướng mắc tới giám sát');
  document.getElementById('issueDesc').value = '';
  document.getElementById('issueModal').classList.remove('show');
};

// ---- Tabs ----
document.querySelectorAll('.crew-tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.crew-tabs button').forEach(b => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    state.tab = btn.dataset.tab;
    const reportPanel = document.getElementById('crewReportTab');
    const historyPanel = document.getElementById('crewHistoryTab');
    reportPanel.hidden = state.tab !== 'report';
    historyPanel.hidden = state.tab !== 'history';
    reportPanel.classList.toggle('active', state.tab === 'report');
    historyPanel.classList.toggle('active', state.tab === 'history');
    if (state.tab === 'history') loadHistory();
  };
});

setOnlineDots(navigator.onLine, ['crewOnlineDot']);
window.addEventListener('online', () => setOnlineDots(true, ['crewOnlineDot']));
window.addEventListener('offline', () => setOnlineDots(false, ['crewOnlineDot']));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

boot();
