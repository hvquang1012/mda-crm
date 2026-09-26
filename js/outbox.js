// ============================================================
// Hàng đợi báo cáo trên máy thợ (IndexedDB) — công trường mất sóng là
// chuyện hằng ngày; bắt thợ nhập lại cả báo cáo vì rớt mạng là lý do họ
// bỏ dùng app.
//
// Luồng 1 báo cáo:
//   1. Thợ bấm gửi → ảnh được NÉN NGAY (không cần mạng) → cất vào máy.
//   2. Có mạng → gửi từng ảnh (ảnh nào lên rồi thì ghi lại, lần sau
//      không gửi lại) → gọi crew_submit kèm client_ref. Máy chủ đã lưu
//      mà mạng rớt trước khi trả lời thì lần gửi lại nhận về đúng báo
//      cáo cũ, không tạo bản trùng.
//   3. (Nếu bật Dropbox) gửi ảnh GỐC thẳng lên Dropbox qua link tạm do
//      Edge Function dropbox-link cấp — chạy sau cùng, hỏng cũng không
//      sao vì dropbox-sync sẽ sao chép bản nén thay thế.
//
// Tin nhắn trò chuyện theo đầu việc (js/crew-chat.js) đi cùng hàng đợi
// này: job kind='message', gửi qua crew_send_message kèm client_ref — gặp
// lại client_ref cũ máy chủ trả tin cũ, không tạo bản trùng.
//
// Import lười từ crew.js — máy không mất mạng lần nào thì vẫn tải file này
// nhưng không tốn gì thêm. Trình duyệt không có IndexedDB → available()
// trả false, crew.js gửi thẳng như trước.
// ============================================================
import { uploadPreparedCrewPhoto } from './photos.js';

const DB_NAME = 'mda-outbox';
const STORE = 'jobs';
const MAX_ORIGINAL_ATTEMPTS = 5;
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;

// Lỗi không bao giờ tự hết khi gửi lại — dừng thử, để thợ thấy và xoá
const PERMANENT = ['invalid_or_expired_token', 'project_closed', 'item_not_in_scope', 'invalid_report_date', 'note_required', 'photo_required',
  'message_empty', 'message_too_long', 'photo_not_in_scope'];

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no_indexeddb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientRef' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('tx_abort'));
  }));
}
const putJob = (job) => tx('readwrite', s => s.put(job));
const deleteJob = (ref) => tx('readwrite', s => s.delete(ref));
const allJobs = () => tx('readonly', s => s.getAll());

export async function available() {
  try { await openDb(); return true; } catch (e) { return false; }
}

export function newClientRef() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// job: { token, itemId, itemName, qty, crewSize, note, reportDate,
//        prepared: [{mainBlob, thumbBlob, takenAt}], originals: [File] }
export async function queueReport(job) {
  const record = {
    clientRef: newClientRef(),
    token: job.token,
    itemId: job.itemId, itemName: job.itemName,
    qty: job.qty, crewSize: job.crewSize, note: job.note, reportDate: job.reportDate,
    photos: job.prepared.map(p => ({ ...p, uploaded: null })),
    originals: (job.originals || []).filter(f => f && f.size <= MAX_ORIGINAL_BYTES),
    reportId: null, storagePaths: [],
    createdAt: new Date().toISOString(),
    attempts: 0, originalAttempts: 0, lastError: null, dead: false
  };
  await putJob(record);
  return record.clientRef;
}

// job: { token, itemId, itemName, body, prepared: [{mainBlob, thumbBlob, takenAt}] }
export async function queueMessage(job) {
  const record = {
    kind: 'message',
    clientRef: newClientRef(),
    token: job.token,
    itemId: job.itemId, itemName: job.itemName,
    body: job.body || '',
    photos: (job.prepared || []).map(p => ({ ...p, uploaded: null })),
    messageId: null,
    createdAt: new Date().toISOString(),
    attempts: 0, lastError: null, dead: false
  };
  await putJob(record);
  return record;
}

// Tin nhắn chưa gửi xong của link này (itemId: chỉ 1 đầu việc)
export async function pendingMessages(token, itemId) {
  try {
    return (await allJobs()).filter(j => j.kind === 'message' && j.token === token && (!itemId || j.itemId === itemId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (e) { return []; }
}

// Báo cáo chưa gửi xong của đúng link này (để hiện "đang chờ gửi")
export async function pendingReports(token) {
  try {
    return (await allJobs()).filter(j => j.kind !== 'message' && j.token === token && !j.reportId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (e) { return []; }
}

export async function discard(clientRef) { await deleteJob(clientRef); }

let running = null;
// Gửi mọi thứ đang chờ. Gọi thoải mái (khi mở trang, khi có mạng lại,
// định kỳ) — lần gọi chồng lên nhau dùng chung một lượt chạy.
export function processOutbox(supabase, token, onProgress) {
  if (!running) {
    running = run(supabase, token, onProgress).finally(() => { running = null; });
  }
  return running;
}

async function run(supabase, token, onProgress) {
  let sent = 0, sentMessages = 0;
  let jobs;
  try { jobs = (await allJobs()).filter(j => j.token === token); } catch (e) { return { sent: 0, sentMessages: 0 }; }
  for (const job of jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!navigator.onLine) break;
    if (job.kind === 'message') {
      if (job.dead) continue;
      const ok = await sendMessage(supabase, job);
      if (ok) sentMessages++;
      else if (!job.dead) break;   // lỗi mạng — giữ thứ tự, chờ lần sau
      continue;
    }
    if (!job.reportId && !job.dead) {
      const ok = await sendReport(supabase, job, onProgress);
      if (ok) sent++;
      else if (!job.dead) break;   // lỗi mạng — dừng lượt này, chờ lần sau
    }
    if (job.reportId) await sendOriginals(supabase, job);
  }
  return { sent, sentMessages };
}

async function sendMessage(supabase, job) {
  try {
    for (const p of job.photos) {
      if (p.uploaded) continue;
      p.uploaded = await uploadPreparedCrewPhoto(supabase, job.token, p);
      await putJob(job);   // ảnh đã lên thì ghi lại, rớt mạng giữa chừng không gửi lại
    }
    const { data, error } = await supabase.rpc('crew_send_message', {
      p_token: job.token,
      p_item_id: job.itemId,
      p_body: job.body,
      p_photos: job.photos.map(p => p.uploaded),
      p_client_ref: job.clientRef
    });
    if (error) throw error;
    job.messageId = data;
    await deleteJob(job.clientRef);
    return true;
  } catch (e) {
    job.attempts++;
    const msg = String(e?.code || e?.message || e || '');
    job.lastError = msg;
    job.lastErrorText = e?.name === 'PhotoError' ? e.message : null;
    job.dead = PERMANENT.some(code => msg.includes(code));
    await putJob(job).catch(() => {});
    return false;
  }
}

async function sendReport(supabase, job, onProgress) {
  try {
    for (const [i, p] of job.photos.entries()) {
      if (p.uploaded) continue;
      onProgress?.(`Đang gửi ảnh ${i + 1}/${job.photos.length}...`);
      p.uploaded = await uploadPreparedCrewPhoto(supabase, job.token, p);
      await putJob(job);   // ảnh đã lên thì ghi lại ngay, mất mạng giữa chừng không gửi lại
    }
    onProgress?.('Đang lưu báo cáo...');
    const photos = job.photos.map(p => p.uploaded);
    const { data, error } = await supabase.rpc('crew_submit', {
      p_token: job.token,
      p_item_id: job.itemId,
      p_qty_delta: job.qty,
      p_crew_size: job.crewSize,
      p_note: job.note,
      p_photos: photos,
      p_report_date: job.reportDate,
      p_client_ref: job.clientRef
    });
    if (error) throw error;

    job.reportId = data;
    job.storagePaths = photos.map(p => p.path);
    job.photos = [];      // bản nén đã lên máy chủ — giải phóng bộ nhớ máy
    if (job.originals.length && window.MDA_CONFIG?.DROPBOX_ORIGINALS) await putJob(job);
    else await deleteJob(job.clientRef);
    return true;
  } catch (e) {
    job.attempts++;
    const msg = String(e?.code || e?.message || e || '');
    job.lastError = msg;
    // Lỗi ảnh (PhotoError) đã có sẵn câu tiếng Việt cho thợ đọc
    job.lastErrorText = e?.name === 'PhotoError' ? e.message : null;
    job.dead = PERMANENT.some(code => msg.includes(code));
    await putJob(job).catch(() => {});
    return false;
  }
}

// Mạng yếu / đang tiết kiệm dữ liệu thì để dành ảnh gốc (3–5MB/tấm) cho lần sau
function goodConnection() {
  const c = navigator.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !['slow-2g', '2g'].includes(c.effectiveType);
}

async function sendOriginals(supabase, job) {
  if (!job.originals.length || !window.MDA_CONFIG?.DROPBOX_ORIGINALS) { await deleteJob(job.clientRef); return; }
  if (!goodConnection()) return;
  try {
    const { data, error } = await supabase.functions.invoke('dropbox-link', {
      body: {
        action: 'request', token: job.token, report_id: job.reportId,
        photos: job.originals.map((f, i) => ({
          storage_path: job.storagePaths[i] || null,
          name: f.name || `anh-${i + 1}.jpg`,
          size: f.size
        }))
      }
    });
    if (error) throw error;
    const done = [];
    for (const [i, link] of (data?.links || []).entries()) {
      if (!link?.url) continue;
      const res = await fetch(link.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: job.originals[i]
      });
      if (res.ok) done.push(link.archive_id);
    }
    if (done.length) {
      await supabase.functions.invoke('dropbox-link', { body: { action: 'confirm', token: job.token, archive_ids: done } });
    }
    await deleteJob(job.clientRef);
  } catch (e) {
    job.originalAttempts++;
    // Bỏ qua sau vài lần — dropbox-sync sẽ tự sao chép bản nén thay thế.
    if (job.originalAttempts >= MAX_ORIGINAL_ATTEMPTS) await deleteJob(job.clientRef);
    else await putJob(job).catch(() => {});
  }
}
