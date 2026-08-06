// ============================================================
// Logic màn hình chủ nhà (client.html) — không đăng nhập, chỉ token.
// Toàn bộ dữ liệu đi qua RPC client_view() (đã lọc đúng 1 dự án, ẩn
// tên thầu phụ, chỉ ảnh đã duyệt). anon không có quyền SELECT trực
// tiếp trên bảng nào nên KHÔNG dùng được Realtime — thay bằng polling
// mỗi 45 giây, đủ nhanh cho nhu cầu xem tiến độ của chủ nhà.
// ============================================================
import { initSupabase } from './supabase.js';
import { showToast, showScreen, escapeHtml, displayDate, setOnlineDots, daysUntil } from './ui.js';

const { client: supabase, ready } = initSupabase();
const token = new URLSearchParams(location.search).get('t');
const STATUS_VI = { notStarted: 'Chưa bắt đầu', onTrack: 'Đúng tiến độ', delayed: 'Trễ tiến độ', ahead: 'Vượt tiến độ', done: 'Hoàn thành' };
const STATUS_CLASS = { notStarted: 'notStarted', onTrack: 'onTrack', delayed: 'delayed', ahead: 'ahead', done: 'ahead' };

let pollTimer = null;

async function boot() {
  if (!ready) { fail('Chưa cấu hình Supabase.'); return; }
  if (!token) { fail('Thiếu link — vui lòng dùng đúng link được gửi qua Zalo.'); return; }
  await refresh(true);
  pollTimer = setInterval(() => refresh(false), 45000);
}

function fail(msg) {
  showScreen('clientError');
  document.getElementById('clientErrorMsg').textContent = msg;
}

async function refresh(isFirst) {
  const { data, error } = await supabase.rpc('client_view', { p_token: token });
  if (error || !data) {
    if (isFirst) fail('Link không hợp lệ hoặc đã hết hạn. Liên hệ MD Architects để lấy link mới.');
    setOnlineDots(false, ['clientOnlineDot']);
    return;
  }
  setOnlineDots(true, ['clientOnlineDot']);
  render(data);
  if (isFirst) showScreen('clientMain');
}

function render(data) {
  document.getElementById('clientProjectName').textContent = data.project.name;
  document.getElementById('clientProjectAddr').textContent = data.project.address || '';

  const remain = daysUntil(data.project.end_date);
  const stages = data.stages || [];
  const avg = stages.length ? Math.round(stages.reduce((a, s) => a + (s.percent || 0), 0) / stages.length) : 0;
  const overall = stages.some(s => s.status === 'delayed') ? 'delayed'
    : (stages.length && stages.every(s => s.status === 'done' || s.status === 'ahead')) ? 'ahead' : 'onTrack';

  document.getElementById('clientStats').innerHTML = `
    <div class="stat-chip"><div class="k">CÒN LẠI</div><div class="v ${remain < 0 ? 'negative' : ''}">${remain < 0 ? Math.abs(remain) + ' ngày trễ' : remain + ' ngày'}</div></div>
    <div class="stat-chip"><div class="k">TRẠNG THÁI</div><div style="margin-top:2px;"><span class="badge ${STATUS_CLASS[overall]}">${STATUS_VI[overall]}</span></div></div>
    <div class="stat-chip"><div class="k">TIẾN ĐỘ TB</div><div class="v">${avg}<span style="font-size:12px;font-weight:500;">%</span></div></div>
  `;

  const stageWrap = document.getElementById('clientStageList');
  stageWrap.innerHTML = stages.length ? stages.map(s => `
    <div class="client-stage-card">
      <div class="task-top">
        <div>
          <div class="task-name">${escapeHtml(s.name)}</div>
          <div class="task-meta">${displayDate(s.planned_start)} → ${displayDate(s.planned_end)}</div>
        </div>
        <span class="badge ${STATUS_CLASS[s.status]}">${s.percent}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill ${STATUS_CLASS[s.status]}" style="width:${s.percent}%"></div></div>
    </div>
  `).join('') : '<div class="empty-hint">Chưa có giai đoạn nào được cập nhật.</div>';

  renderPhotos(data.photos || []);
}

async function renderPhotos(photos) {
  const wrap = document.getElementById('clientPhotoAlbum');
  if (!photos.length) { wrap.innerHTML = '<div class="empty-hint">Chưa có ảnh nào.</div>'; return; }

  const paths = photos.map(p => p.path);
  const { data, error } = await supabase.functions.invoke('get-photo-url', { body: { kind: 'client', token, paths } });
  const urls = (!error && data && data.urls) ? data.urls : paths.map(() => null);

  wrap.innerHTML = photos.map((p, i) => urls[i] ? `<img src="${urls[i]}" data-full="${urls[i]}">` : '').join('');
  wrap.querySelectorAll('img').forEach(img => {
    img.onclick = () => {
      document.getElementById('lightboxImg').src = img.dataset.full;
      document.getElementById('lightbox').classList.add('show');
    };
  });
}

document.getElementById('lightbox').onclick = () => document.getElementById('lightbox').classList.remove('show');

window.addEventListener('online', () => refresh(false));

boot();
