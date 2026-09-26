// ============================================================
// Tab "Trò chuyện" + khung trò chuyện theo đầu việc (nhân viên).
//
// Mỗi đầu việc có 1 luồng tin nhắn giữa nhân viên và thợ (thợ nhắn từ
// crew.html qua RPC crew_send_message). Tab gom mọi đầu việc có tin,
// đầu việc có tin chưa đọc lên trước (RPC chat_inbox — RLS lọc công
// trình KTS phụ trách). Tab Công việc mở luồng qua state.openChat() —
// không import chéo giữa các tab.
//
// item_messages chỉ ghi thêm: nhân viên chỉ insert, không sửa/xoá.
// ============================================================
import { state } from './state.js';
import { escapeHtml, showToast, ageLabel, rpcErrorText } from '../ui.js';
import { uploadStaffPhoto, signStaffPhotoUrl } from '../photos.js';
import { openLightbox } from '../lightbox.js';

const MAX_PHOTOS = 4;

let inbox = [];          // kết quả chat_inbox() lần gần nhất
let thread = null;       // { item: {id, name, project_id, subcontractor_id, project_name, sub_name}, messages: [] }
let files = [];          // ảnh đang chọn trong ô soạn
let wired = false;
const signed = new Map(); // path → URL đã ký

// ---------- Tab Trò chuyện ----------
export async function renderChat() {
  const wrap = document.getElementById('chatInboxList');
  if (!wrap) return;
  if (!inbox.length) wrap.innerHTML = '<div class="empty-hint">Đang tải...</div>';
  const ok = await loadInbox();
  if (!ok) { wrap.innerHTML = '<div class="empty-hint">Không tải được trò chuyện.</div>'; return; }
  if (!inbox.length) {
    wrap.innerHTML = '<div class="empty-hint">Chưa có trò chuyện nào. Bấm 💬 ở đầu việc (tab Công việc) để nhắn đội thi công.</div>';
    return;
  }
  wrap.innerHTML = inbox.map(c => `
    <button type="button" class="chat-inbox-card ${c.unread ? 'unread' : ''}" data-open-chat="${escapeHtml(c.work_item_id)}">
      <span class="chat-inbox-top">
        <span class="chat-inbox-item">${escapeHtml(c.item_name)}</span>
        ${c.unread ? `<span class="chat-count">${c.unread}</span>` : ''}
      </span>
      <span class="chat-inbox-meta">${escapeHtml(c.project_name)} · ${escapeHtml(c.sub_name)}</span>
      <span class="chat-inbox-last">
        <span class="chat-inbox-text">${escapeHtml(c.last_author)}: ${c.last_body ? escapeHtml(c.last_body) : '📷 Ảnh'}</span>
        <span class="chat-inbox-age">${ageLabel(c.last_at)}</span>
      </span>
    </button>`).join('');
  wrap.querySelectorAll('[data-open-chat]').forEach(b => { b.onclick = () => openThread(b.dataset.openChat); });
}

async function loadInbox() {
  const { data, error } = await state.supabase.rpc('chat_inbox');
  if (error) { console.error(error); return false; }
  inbox = data || [];
  state.chatUnread = Object.fromEntries(inbox.filter(c => c.unread).map(c => [c.work_item_id, c.unread]));
  state.chatUnreadTotal = inbox.reduce((s, c) => s + (c.unread || 0), 0);
  paintCounts();
  return true;
}

// Số chưa đọc ở menu dưới + nút 💬 ở tab Công việc (vẽ thẳng vào DOM theo data-chat-count)
export async function refreshChatBadge() {
  if (await loadInbox() && state.activeTab === 'chat') renderChat();
}

function paintCounts() {
  const nav = document.getElementById('chatNavCount');
  if (nav) {
    nav.textContent = state.chatUnreadTotal > 99 ? '99+' : String(state.chatUnreadTotal);
    nav.hidden = !state.chatUnreadTotal;
  }
  document.querySelectorAll('[data-chat-count]').forEach(el => {
    const n = state.chatUnread[el.dataset.chatCount] || 0;
    el.textContent = n;
    el.hidden = !n;
  });
}

// ---------- Khung trò chuyện 1 đầu việc ----------
export async function openThread(itemId) {
  wireOnce();
  files = [];
  renderPreview();
  document.getElementById('chatInput').value = '';
  document.getElementById('chatThread').innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  document.getElementById('chatModalTitle').textContent = '';
  document.getElementById('chatModalMeta').textContent = '';
  document.getElementById('chatModal').classList.add('show');

  const { data: it, error } = await state.supabase
    .from('work_items')
    .select('id, name, work_packages(project_id, subcontractor_id, name, subcontractors(name), projects(name))')
    .eq('id', itemId).maybeSingle();
  if (error || !it) {
    document.getElementById('chatThread').innerHTML = '<div class="empty-hint compact">Không mở được đầu việc này (có thể đã bị xoá hoặc bạn không phụ trách).</div>';
    return;
  }
  const wp = it.work_packages || {};
  thread = {
    item: {
      id: it.id, name: it.name, project_id: wp.project_id, subcontractor_id: wp.subcontractor_id,
      project_name: wp.projects?.name || '', sub_name: wp.subcontractors?.name || ''
    },
    messages: []
  };
  document.getElementById('chatModalTitle').textContent = it.name;
  document.getElementById('chatModalMeta').textContent = `${thread.item.project_name} · ${thread.item.sub_name}`;
  await loadThread();
}
state.openChat = openThread;

function isOpen() { return !!thread && document.getElementById('chatModal')?.classList.contains('show'); }

function closeThread() {
  document.getElementById('chatModal').classList.remove('show');
  thread = null;
}

async function loadThread() {
  if (!thread) return;
  const itemId = thread.item.id;
  const { data, error } = await state.supabase
    .from('item_messages')
    .select('id, author_kind, staff_id, author_name, body, photos, created_at')
    .eq('work_item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (thread?.item.id !== itemId) return;   // đã mở luồng khác
  if (error) { document.getElementById('chatThread').innerHTML = '<div class="empty-hint compact">Không tải được tin nhắn.</div>'; return; }
  thread.messages = (data || []).slice().reverse();
  renderThread();
  markRead(itemId);
}

async function markRead(itemId) {
  const { error } = await state.supabase.rpc('chat_mark_read', { p_item_id: itemId });
  if (error) { console.error(error); return; }
  refreshChatBadge();
}

function timeLabel(iso) {
  const d = new Date(iso);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === new Date().toDateString() ? hm : `${hm} ${d.getDate()}/${d.getMonth() + 1}`;
}

function renderThread() {
  const list = document.getElementById('chatThread');
  if (!thread.messages.length) {
    list.innerHTML = '<div class="empty-hint compact">Chưa có tin nào. Nhắn đội thi công về đầu việc này — thợ thấy ngay trong link báo cáo của đội.</div>';
    return;
  }
  list.innerHTML = thread.messages.map((m, mi) => {
    const mine = m.author_kind === 'staff' && m.staff_id === state.user?.id;
    return `
      <div class="chat-msg ${mine ? 'mine' : ''} ${m.author_kind === 'staff' ? 'staff' : ''}">
        ${mine ? '' : `<div class="chat-author">${escapeHtml(m.author_name)}${m.author_kind === 'crew' ? ' · ' + escapeHtml(thread.item.sub_name) : ''}</div>`}
        <div class="chat-bubble">
          ${m.body ? `<div class="chat-text">${escapeHtml(m.body)}</div>` : ''}
          ${(m.photos || []).length ? `<div class="chat-photos">${m.photos.map((_, pi) => `<img data-mi="${mi}" data-pi="${pi}" alt="ảnh ${pi + 1}" loading="lazy">`).join('')}</div>` : ''}
        </div>
        <div class="chat-time">${timeLabel(m.created_at)}</div>
      </div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;

  // Ảnh gán bằng thuộc tính DOM — path do người gửi đặt, không nội suy vào HTML
  list.querySelectorAll('img[data-mi]').forEach(img => {
    const photos = thread.messages[+img.dataset.mi].photos || [];
    const p = photos[+img.dataset.pi];
    const show = p?.thumb_path || p?.path;
    if (show) sign(show).then(url => { if (url) img.src = url; });
    img.onclick = async () => {
      const urls = await Promise.all(photos.map(x => x?.path ? sign(x.path) : null));
      openLightbox(urls, +img.dataset.pi);
    };
  });
}

async function sign(path) {
  if (!signed.has(path)) signed.set(path, signStaffPhotoUrl(state.supabase, path));
  return signed.get(path);
}

// ---------- Soạn + gửi ----------
function renderPreview() {
  const wrap = document.getElementById('chatPreview');
  if (!wrap) return;
  wrap.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
  wrap.innerHTML = '';
  files.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${URL.createObjectURL(f)}"><button class="rm" data-i="${i}" aria-label="Bỏ ảnh">✕</button>`;
    div.querySelector('img').onerror = (ev) => {
      ev.target.remove();
      div.insertAdjacentHTML('afterbegin', '<span class="thumb-fallback">Ảnh iPhone<br>đã chọn</span>');
    };
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('.rm').forEach(btn => { btn.onclick = () => { files.splice(+btn.dataset.i, 1); renderPreview(); }; });
}

function newClientRef() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function send() {
  if (!thread) return;
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body && !files.length) { showToast('Gõ nội dung hoặc chọn ảnh', true); return; }
  if (body.length > 2000) { showToast(rpcErrorText({ message: 'message_too_long' }), true); return; }
  const btn = document.getElementById('btnChatSend');
  btn.disabled = true;
  const item = thread.item;
  try {
    const photos = [];
    for (const [i, f] of files.entries()) {
      btn.textContent = `Ảnh ${i + 1}/${files.length}...`;
      // Thư mục của đúng đội — thợ xem lại được qua get-photo-url
      photos.push(await uploadStaffPhoto(state.supabase, f, item.project_id, item.subcontractor_id));
    }
    btn.textContent = 'Đang gửi...';
    const { error } = await state.supabase.from('item_messages').insert({
      work_item_id: item.id, project_id: item.project_id,
      author_kind: 'staff', staff_id: state.user.id,
      author_name: state.profile?.full_name || state.user.email || 'Giám sát',
      body, photos, client_ref: newClientRef()
    });
    // 23505 = trùng client_ref: lần bấm trước đã lưu rồi
    if (error && error.code !== '23505') { showToast(rpcErrorText(error, 'Gửi tin thất bại — thử lại'), true); return; }
    input.value = '';
    files = [];
    renderPreview();
    await loadThread();   // vẽ lại từ DB, không chờ realtime
  } catch (e) {
    console.error(e);
    showToast(e?.name === 'PhotoError' ? e.message : 'Gửi ảnh thất bại — thử lại', true);
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi';
  }
}

function wireOnce() {
  if (wired) return;
  wired = true;
  document.getElementById('btnChatClose').onclick = closeThread;
  document.getElementById('btnChatSend').onclick = send;
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    // Máy tính: Enter gửi, Shift+Enter xuống dòng
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); send(); }
  });
  document.getElementById('chatPhotoInput').addEventListener('change', (e) => {
    for (const f of Array.from(e.target.files || [])) {
      if (files.length >= MAX_PHOTOS) { showToast(`Tối đa ${MAX_PHOTOS} ảnh mỗi tin`, true); break; }
      if (!/^image\//i.test(f.type || '') && !/\.(jpe?g|png|heic|heif|dng|tiff?|webp)$/i.test(f.name || '')) {
        showToast(`"${f.name}" không phải ảnh`, true); continue;
      }
      files.push(f);
    }
    e.target.value = '';
    renderPreview();
  });
}

// ---------- Realtime (main.js gọi khi có tin mới) ----------
let toastTimer = null;
export function onRealtimeMessage(row) {
  if (!row) return;
  if (isOpen() && row.work_item_id === thread.item.id) {
    loadThread();   // đang xem đúng luồng — tải lại + đánh dấu đã đọc
    return;
  }
  const mine = row.author_kind === 'staff' && row.staff_id === state.user?.id;
  if (!mine) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(async () => {
      await refreshChatBadge();
      const c = inbox.find(x => x.work_item_id === row.work_item_id);
      showToast(`💬 ${row.author_name} nhắn${c ? ` ở “${c.item_name}”` : ''}`, false, 4000);
    }, 600);
  } else {
    refreshChatBadge();
  }
}
