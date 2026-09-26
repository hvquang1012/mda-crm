// ============================================================
// Trò chuyện theo đầu việc — phía thợ (crew.html). Tải lười khi bấm 💬
// trên thẻ đầu việc, máy không mở chat thì không tốn thêm gì.
//
// Đọc/gửi qua RPC crew_messages / crew_send_message (token trong URL).
// Gửi đi qua hàng đợi js/outbox.js: mất sóng vẫn bấm gửi được, tin nằm
// trong máy (thanh cam "đang chờ gửi"), có mạng lại crew.js tự gửi. Mỗi
// tin mang client_ref sinh ở máy — gửi lại không tạo bản trùng.
// Ảnh: nén bằng js/photos.js, lên Storage qua Edge Function crew-upload,
// xem lại qua get-photo-url (kind=crew).
// ============================================================
import { showToast, escapeHtml, rpcErrorText } from './ui.js';

const MAX_PHOTOS = 4;
const POLL_MS = 15000;

let ctx = null;          // { supabase, token, item, outbox, markSeen }
let messages = [];       // tin đã lên máy chủ (crew_messages)
let files = [];          // ảnh đang chọn trong ô soạn
let pollTimer = null;
let wired = false;
const signed = new Map(); // path → URL đã ký (hết hạn sau 1 giờ, đủ cho 1 lần mở)

export async function openCrewChat(opts) {
  ctx = opts;
  messages = [];
  files = [];
  wireOnce();
  document.getElementById('crewChatTitle').textContent = opts.item.name;
  document.getElementById('crewChatInput').value = '';
  renderPreview();
  document.getElementById('crewChatList').innerHTML = '<div class="empty-hint compact">Đang tải...</div>';
  document.getElementById('crewChatModal').classList.add('show');
  await load();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (navigator.onLine && isOpen()) load(true); }, POLL_MS);
}

// crew.js gọi sau khi hàng đợi gửi xong (có mạng lại)
export async function refreshCrewChat() {
  if (isOpen()) await load();
}

function isOpen() { return !!ctx && document.getElementById('crewChatModal').classList.contains('show'); }

function close() {
  document.getElementById('crewChatModal').classList.remove('show');
  clearInterval(pollTimer);
  ctx?.onClose?.();
}

async function load(incremental = false) {
  if (!ctx) return;
  const itemId = ctx.item.id;
  if (navigator.onLine) {
    const since = incremental && messages.length ? messages[messages.length - 1].created_at : null;
    const { data, error } = await ctx.supabase.rpc('crew_messages', { p_token: ctx.token, p_item_id: itemId, p_since: since });
    if (ctx?.item.id !== itemId) return;   // đã chuyển sang đầu việc khác
    if (error) {
      if (!incremental) showToast(rpcErrorText(error, 'Không tải được tin nhắn — kiểm tra mạng'), true);
    } else {
      const known = new Set(messages.map(m => m.id));
      messages = (since ? messages.concat((data || []).filter(m => !known.has(m.id))) : (data || []));
      if (incremental && !(data || []).length) return;   // không có gì mới — khỏi vẽ lại
      saveCache(itemId);
    }
  } else if (!messages.length) {
    messages = loadCache(itemId);   // mất sóng: xem lại tin lần trước
  }
  await render();
}

// Lưu 50 tin gần nhất trong máy — mở luồng lúc mất sóng vẫn đọc lại được
function cacheKey(itemId) { return `mda-chat:${ctx.token}:${itemId}`; }
function saveCache(itemId) {
  try { localStorage.setItem(cacheKey(itemId), JSON.stringify(messages.slice(-50))); } catch (e) { /* hết chỗ — bỏ qua */ }
}
function loadCache(itemId) {
  try { return JSON.parse(localStorage.getItem(cacheKey(itemId)) || '[]'); } catch (e) { return []; }
}

async function render() {
  const list = document.getElementById('crewChatList');
  const queued = ctx.outbox ? await ctx.outbox.pendingMessages(ctx.token, ctx.item.id) : [];
  const onServer = new Set(messages.map(m => m.client_ref).filter(Boolean));
  const waiting = queued.filter(j => !onServer.has(j.clientRef));
  renderBanner(waiting);

  if (!messages.length && !waiting.length) {
    list.innerHTML = '<div class="empty-hint compact">Chưa có tin nào. Hỏi giám sát về đầu việc này ở đây — kèm ảnh nếu cần.</div>';
    return;
  }
  list.innerHTML = messages.map((m, mi) => msgHtml(m, mi)).join('') + waiting.map(queuedHtml).join('');
  list.querySelectorAll('[data-discard]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Bỏ tin này khỏi máy?')) return;
      await ctx.outbox.discard(b.dataset.discard);
      render();
    };
  });
  list.scrollTop = list.scrollHeight;
  signPhotos(list);

  const last = messages[messages.length - 1];
  if (last) ctx.markSeen?.(ctx.item.id, last.created_at);
}

function timeLabel(iso) {
  const d = new Date(iso);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === new Date().toDateString() ? hm : `${hm} ${d.getDate()}/${d.getMonth() + 1}`;
}

// Ảnh chỉ đánh số (data-mi/data-pi) — path gán qua DOM, không nội suy vào HTML
function photosHtml(photos, mi) {
  if (!photos?.length) return '';
  return `<div class="chat-photos">${photos.map((_, pi) => `<img data-mi="${mi}" data-pi="${pi}" alt="ảnh ${pi + 1}" loading="lazy">`).join('')}</div>`;
}

function msgHtml(m, mi) {
  const who = m.mine ? '' : `<div class="chat-author">${escapeHtml(m.author_name)}${m.author_kind === 'staff' ? ' · Giám sát' : ''}</div>`;
  return `
    <div class="chat-msg ${m.mine ? 'mine' : ''} ${m.author_kind === 'staff' ? 'staff' : ''}">
      ${who}
      <div class="chat-bubble">
        ${m.body ? `<div class="chat-text">${escapeHtml(m.body)}</div>` : ''}
        ${photosHtml(m.photos, mi)}
      </div>
      <div class="chat-time">${timeLabel(m.created_at)}</div>
    </div>`;
}

function queuedHtml(j) {
  const err = j.dead ? (j.lastErrorText || rpcErrorText({ message: j.lastError })) : '';
  return `
    <div class="chat-msg mine queued">
      <div class="chat-bubble">
        ${j.body ? `<div class="chat-text">${escapeHtml(j.body)}</div>` : ''}
        ${j.photos?.length ? `<div class="chat-text">📷 ${j.photos.length} ảnh</div>` : ''}
      </div>
      <div class="chat-time">${j.dead
        ? `<span class="chat-pill error">❌ ${escapeHtml(err)}</span> <button type="button" class="icon-btn" data-discard="${escapeHtml(j.clientRef)}">Bỏ</button>`
        : '<span class="chat-pill queued">⏳ Chờ gửi</span>'}</div>
    </div>`;
}

function renderBanner(waiting) {
  const el = document.getElementById('crewChatBanner');
  const live = waiting.filter(j => !j.dead);
  if (!live.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `📤 <b>${live.length} tin</b> đang nằm trong máy, chưa gửi được — sẽ tự gửi khi có sóng.`;
}

// Ảnh trong luồng: đổi path → URL xem được (Edge Function get-photo-url, kiểm tra token)
async function signPhotos(root) {
  const shown = messages;
  const imgs = [...root.querySelectorAll('img[data-mi]')].map(im => {
    const photos = shown[+im.dataset.mi]?.photos || [];
    const p = photos[+im.dataset.pi] || {};
    return { im, photos, pi: +im.dataset.pi, show: p.thumb_path || p.path };
  });
  const need = [...new Set(imgs.flatMap(x => [x.show, ...x.photos.map(p => p?.path)]).filter(p => p && !signed.has(p)))].slice(0, 60);
  if (need.length) {
    const { data, error } = await ctx.supabase.functions.invoke('get-photo-url', { body: { kind: 'crew', token: ctx.token, paths: need } });
    if (!error) need.forEach((p, i) => signed.set(p, data?.urls?.[i] || null));
  }
  imgs.forEach(({ im, photos, pi, show }) => {
    const url = signed.get(show);
    if (url) im.src = url;
    im.onclick = async () => {
      const { openLightbox } = await import('./lightbox.js');
      openLightbox(photos.map(p => signed.get(p?.path) || null), pi);
    };
  });
}

// ---- Soạn tin ----
function renderPreview() {
  const wrap = document.getElementById('crewChatPreview');
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

async function send() {
  const input = document.getElementById('crewChatInput');
  const body = input.value.trim();
  if (!body && !files.length) { showToast('Gõ nội dung hoặc chọn ảnh', true); return; }
  if (body.length > 2000) { showToast(rpcErrorText({ message: 'message_too_long' }), true); return; }
  const btn = document.getElementById('crewChatSend');
  btn.disabled = true;
  try {
    let prepared = [];
    if (files.length) {
      const { prepareImage } = await import('./photos.js');
      for (const [i, f] of files.entries()) {
        btn.textContent = `Nén ảnh ${i + 1}/${files.length}...`;
        prepared.push(await prepareImage(f));
      }
    }
    btn.textContent = 'Đang gửi...';
    const { supabase, token, item, outbox } = ctx;

    if (outbox) {
      const job = await outbox.queueMessage({ token, itemId: item.id, itemName: item.name, body, prepared });
      input.value = ''; files = []; prepared = []; renderPreview();
      await render();   // hiện ngay tin "⏳ Chờ gửi"
      if (navigator.onLine) {
        // Lượt gửi đang chạy dở (bắt đầu trước khi xếp tin này) không có tin mới — chạy thêm 1 lượt
        for (let i = 0; i < 2; i++) {
          await outbox.processOutbox(supabase, token);
          const left = (await outbox.pendingMessages(token, item.id)).find(j => j.clientRef === job.clientRef);
          if (!left || left.dead || !navigator.onLine) {
            if (left?.dead) showToast(left.lastErrorText || rpcErrorText({ message: left.lastError }), true);
            break;
          }
        }
      }
      await load();
    } else {
      // Máy không có IndexedDB: gửi thẳng, cần có mạng
      if (!navigator.onLine) { showToast('Máy này không lưu tạm được — cần có mạng để gửi tin', true); return; }
      const { uploadPreparedCrewPhoto } = await import('./photos.js');
      const photos = [];
      for (const p of prepared) photos.push(await uploadPreparedCrewPhoto(supabase, token, p));
      const { error } = await supabase.rpc('crew_send_message', {
        p_token: token, p_item_id: item.id, p_body: body, p_photos: photos,
        p_client_ref: crypto.randomUUID ? crypto.randomUUID() : null
      });
      if (error) { showToast(rpcErrorText(error, 'Gửi tin thất bại — thử lại'), true); return; }
      input.value = ''; files = []; renderPreview();
      await load();
    }
  } catch (e) {
    console.error(e);
    showToast(e?.name === 'PhotoError' ? e.message : rpcErrorText(e, 'Gửi tin thất bại — thử lại'), true);
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi';
  }
}

function wireOnce() {
  if (wired) return;
  wired = true;
  document.getElementById('crewChatClose').onclick = close;
  document.getElementById('crewChatSend').onclick = send;
  document.getElementById('crewChatPhotoInput').addEventListener('change', (e) => {
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
