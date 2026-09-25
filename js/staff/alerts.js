// ============================================================
// Tab "Cần xử lý" — hai loại việc giám sát phải giải quyết:
//   1. Vướng mắc do đội báo (crew_raise_issue) — trước đây không có
//      màn hình nào hiện, giám sát chỉ biết khi thành cảnh báo sau 24h.
//   2. Cảnh báo tự động do compute_alerts() sinh ra (xem schema.sql),
//      xác nhận đã xem để ẩn khỏi dashboard, hoặc "Kiểm tra ngay".
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, ageLabel, rpcErrorText } from '../ui.js';
import { signStaffPhotoUrl } from '../photos.js';
import { openLightbox } from '../lightbox.js';
import { galleryHtml, wireGalleries } from '../gallery.js';

const ISSUE_KIND_VI = {
  blocked_handover: 'Chưa bàn giao mặt bằng', material: 'Thiếu vật tư', access: 'Không vào được công trình',
  safety: 'An toàn lao động', other: 'Khác'
};

export async function renderAlerts() {
  await Promise.all([renderIssues(), renderAlertList(), renderArchiveWarning()]);
}

// ---------- Vướng mắc ----------
async function renderIssues() {
  const wrap = document.getElementById('issuesList');
  if (!wrap) return;
  const { data, error } = await state.supabase
    .from('issues')
    .select('*, projects(name), work_items(name)')
    .eq('status', 'open')
    .order('is_blocking', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được vướng mắc.</div>'; return; }
  updateIssuesBadge((data || []).length);
  if (!data || !data.length) { wrap.innerHTML = '<div class="empty-hint compact">Không có vướng mắc nào đang mở 🎉</div>'; return; }

  wrap.innerHTML = data.map(i => `
    <div class="issue-card ${i.is_blocking ? 'blocking' : ''}" data-id="${i.id}">
      <div class="issue-head">
        <span class="issue-kind">${escapeHtml(ISSUE_KIND_VI[i.kind] || 'Khác')}</span>
        ${i.is_blocking ? '<span class="issue-flag">⛔ Đang chặn thi công</span>' : ''}
        <span class="issue-age">${ageLabel(i.created_at)}</span>
      </div>
      <div class="issue-project">${escapeHtml(i.projects?.name || '')}${i.work_items?.name ? ' · ' + escapeHtml(i.work_items.name) : ''}</div>
      <div class="approval-note">${escapeHtml(i.description)}</div>
      ${galleryHtml((i.photos || []).length, pi => `data-issue="${i.id}" data-pi="${pi}" alt="ảnh vướng mắc ${pi + 1}"`)}
      <div class="reported-by">Báo bởi: ${escapeHtml(i.raised_by_name)} · ${new Date(i.created_at).toLocaleString('vi-VN')}</div>
      <div class="issue-resolve">
        <input type="text" class="issue-note" data-id="${i.id}" placeholder="Cách xử lý (không bắt buộc) — VD: đã gọi NCC giao vật tư sáng mai">
        <button class="btn btn-primary" data-action="resolve" data-id="${i.id}">✓ Đã xử lý</button>
      </div>
    </div>`).join('');

  // Ảnh gán bằng thuộc tính DOM — path do đội gửi, không nội suy vào HTML
  const urls = new Map();
  wrap.querySelectorAll('img[data-issue]').forEach(img => {
    const issue = data.find(x => x.id === img.dataset.issue);
    const pi = +img.dataset.pi;
    if (!urls.has(issue.id)) urls.set(issue.id, issue.photos.map(() => null));
    const p = issue.photos[pi];
    if (p?.path) signStaffPhotoUrl(state.supabase, p.path).then(u => { if (u) { urls.get(issue.id)[pi] = u; img.src = u; } });
    img.onclick = () => openLightbox(urls.get(issue.id), pi);
  });
  wireGalleries(wrap);

  wrap.querySelectorAll('[data-action=resolve]').forEach(btn => {
    btn.onclick = async () => {
      const note = [...wrap.querySelectorAll('.issue-note')].find(x => x.dataset.id === btn.dataset.id)?.value.trim() || null;
      btn.disabled = true;
      const { error } = await state.supabase.from('issues').update({
        status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: state.user.id, resolution_note: note
      }).eq('id', btn.dataset.id);
      if (error) { btn.disabled = false; showToast(rpcErrorText(error, 'Không lưu được'), true); return; }
      showToast('Đã đóng vướng mắc');
      renderIssues();
    };
  });
}

export function updateIssuesBadge(count) {
  state.openIssuesCount = count;
  const dot = document.getElementById('alertsNavDot');
  if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  const el = document.getElementById('issuesCount');
  if (el) el.textContent = count > 0 ? String(count) : '';
}

// ---------- Cảnh báo tự động ----------
async function renderAlertList() {
  const wrap = document.getElementById('alertsList');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';

  const { data, error } = await state.supabase
    .from('alerts')
    .select('*, projects(name)')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(150);

  if (error) { wrap.innerHTML = '<div class="empty-hint">Không tải được cảnh báo.</div>'; return; }
  if (!data || !data.length) { wrap.innerHTML = '<div class="empty-hint compact">Không có cảnh báo nào 🎉</div>'; return; }

  // Nghiêm trọng lên trước, rồi mới nhất trước
  const rank = { critical: 0, warning: 1, info: 2 };
  data.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || new Date(b.created_at) - new Date(a.created_at));

  wrap.innerHTML = data.map(a => `
    <div class="alert-item ${a.severity}" data-id="${a.id}">
      <div class="msg">
        <strong>${escapeHtml(a.projects?.name || '')}</strong><br>
        ${escapeHtml(a.message)}
        <div style="font-size:10.5px;color:var(--ink-faint);margin-top:3px;">${new Date(a.created_at).toLocaleString('vi-VN')}</div>
      </div>
      <button class="ack" data-id="${a.id}" title="Đã xem">✓</button>
    </div>
  `).join('');

  wrap.querySelectorAll('.ack').forEach(btn => {
    btn.onclick = () => acknowledge([btn.dataset.id]);
  });
  const allBtn = document.getElementById('btnAckAll');
  if (allBtn) allBtn.onclick = () => {
    if (confirm(`Đánh dấu đã xem ${data.length} cảnh báo?`)) acknowledge(data.map(a => a.id));
  };
}

async function acknowledge(ids) {
  const { error } = await state.supabase.from('alerts')
    .update({ acknowledged_by: state.user.id, acknowledged_at: new Date().toISOString() })
    .in('id', ids);
  if (error) { showToast('Không xác nhận được', true); return; }
  renderAlertList();
}

// Ảnh không sao lưu được sang Dropbox (dropbox-sync thử 5 lần vẫn hỏng)
async function renderArchiveWarning() {
  const el = document.getElementById('archiveWarning');
  if (!el) return;
  const { count, error } = await state.supabase.from('photo_archive')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'failed').gte('attempts', 5);
  el.hidden = !!error || !count;
  if (!error && count) el.textContent = `⚠ ${count} ảnh chưa sao lưu được sang Dropbox — báo kỹ thuật kiểm tra kết nối Dropbox.`;
}

export function wireCheckNowButton() {
  const btn = document.getElementById('btnCheckAlertsNow');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Đang kiểm tra...';
    const { data, error } = await state.supabase.rpc('compute_alerts');
    btn.disabled = false; btn.textContent = 'Kiểm tra ngay';
    if (error) { showToast('Kiểm tra thất bại', true); return; }
    showToast(`Đã kiểm tra — ${data} cảnh báo mới`);
    renderAlertList();
  };
}

// Đếm vướng mắc mở cho chấm đỏ ở menu, dù đang xem tab nào
export async function refreshIssuesBadge() {
  const { count } = await state.supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'open');
  updateIssuesBadge(count || 0);
}
