// ============================================================
// Bootstrap màn hình nhân viên (index.html): đăng nhập, điều hướng
// tab, realtime, đăng ký Web Push.
// ============================================================
import { initSupabase } from '../supabase.js';
import { showToast, showScreen, setOnlineDots } from '../ui.js';
import { state } from './state.js';
import { renderDashboard } from './dashboard.js';
import { renderApprovals } from './approvals.js';
import { renderAlerts, wireCheckNowButton, refreshIssuesBadge } from './alerts.js';
import { initItemsTab, renderProjectSelect, renderPackages } from './items.js';
import { renderChat, refreshChatBadge, onRealtimeMessage } from './chat.js';
import { wireExportButton } from './export.js';
import { setupPush, pushState } from '../push.js';
import { renderStaffName, openProfileModal } from './profile.js';

const { client: supabase, ready } = initSupabase();
state.supabase = supabase;

async function boot() {
  if (!ready) {
    showScreen('loginScreen');
    document.getElementById('loginError').textContent = 'Chưa cấu hình Supabase — mở config.js để điền URL & Key.';
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { state.user = session.user; await enterStaffApp(); }
  else { showScreen('loginScreen'); }
}

document.getElementById('btnLogin').onclick = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  if (!email || !password) { errBox.textContent = 'Nhập đầy đủ email và mật khẩu.'; return; }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { errBox.textContent = 'Sai email hoặc mật khẩu.'; return; }
  state.user = data.user;
  await enterStaffApp();
};

document.getElementById('staffName').onclick = openProfileModal;

document.getElementById('btnLogout').onclick = async () => {
  await supabase.auth.signOut();
  location.reload();
};

async function enterStaffApp() {
  showScreen('mainScreen');
  await loadStaffProfile();
  await initItemsTab();
  await renderProjectSelect();
  await switchTab(tabFromHash() || 'dashboard');
  subscribeRealtime();
  initPushButton();
  wireCheckNowButton();
  wireExportButton();
}

// Vai trò quyết định KTS chỉ thấy công trình được giao (RLS lọc ở DB,
// ở đây chỉ để ẩn/hiện nút quản trị).
async function loadStaffProfile() {
  // select('*') — chưa chạy migration thêm cột phone thì vẫn không lỗi
  const { data } = await supabase.from('staff').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = data || {};
  state.staffRole = data?.role === 'staff' ? 'kts' : (data?.role || 'kts');
  renderStaffName();
  document.body.classList.toggle('is-manager', state.staffRole === 'manager' || state.staffRole === 'admin');
}

// ---------- Thông báo đẩy ----------
// iPhone/Chrome chỉ cho xin quyền khi người dùng bấm — nên cần nút riêng.
// Đã cho phép rồi thì đăng ký lại lặng lẽ (máy đổi endpoint, đăng nhập lại).
function initPushButton() {
  const btn = document.getElementById('btnPush');
  const st = pushState();
  if (st === 'granted') { setupPush(supabase, state.user.id).catch(() => {}); return; }
  if (st === 'unsupported') return;
  btn.hidden = false;
  btn.onclick = async () => {
    const now = pushState();
    if (now === 'needs-install') {
      showToast('iPhone: bấm Chia sẻ → "Thêm vào MH chính", rồi mở app từ màn hình chính để bật thông báo.', false, 8000);
      return;
    }
    if (now === 'denied') {
      showToast('Máy đang chặn thông báo — vào Cài đặt của trình duyệt cho phép lại.', false, 6000);
      return;
    }
    const ok = await setupPush(supabase, state.user.id).catch(() => false);
    if (ok) { btn.hidden = true; showToast('Đã bật — sẽ báo khi có báo cáo mới.', false); }
    else if (pushState() === 'denied') showToast('Bạn đã chặn thông báo.', true);
    else showToast('Chưa bật được thông báo, thử lại sau.', true);
  };
}

// ---------- Điều hướng tab ----------
const TABS = ['dashboard', 'approvals', 'items', 'chat', 'alerts'];
async function switchTab(tab) {
  state.activeTab = tab;
  TABS.forEach(t => {
    const panel = document.getElementById('tabPanel-' + t);
    const active = t === tab;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
    document.getElementById('nav-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') await renderDashboard();
  else if (tab === 'approvals') await renderApprovals();
  else if (tab === 'items') await renderProjectSelect();   // tải lại danh sách: công trình có thể vừa đóng ở Tổng quan
  else if (tab === 'chat') await renderChat();
  else if (tab === 'alerts') await renderAlerts();
}
TABS.forEach(t => { document.getElementById('nav-' + t).onclick = () => switchTab(t); });
state.navigate = switchTab;

function tabFromHash() {
  const tab = location.hash.slice(1);
  return TABS.includes(tab) ? tab : null;
}
// Bấm thông báo khi app đang mở → service worker nhắn tab cần mở
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open-tab' && TABS.includes(e.data.tab) && state.user) switchTab(e.data.tab);
});

document.getElementById('projectSelect').addEventListener('change', async (e) => {
  state.currentProjectId = e.target.value;
  await renderPackages();
});

// ---------- Realtime: đổi ở bảng nào thì render lại tab đang mở ----------
function subscribeRealtime() {
  supabase.channel('mda-staff')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_reports' }, (p) => {
      refreshActive(['approvals', 'dashboard']);
      if (p.eventType === 'INSERT' && p.new?.status === 'pending' && p.new?.staff_id !== state.user.id) announceNewReport(p.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, () => refreshActive(['dashboard', 'items']))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, () => { refreshActive(['dashboard', 'alerts']); refreshIssuesBadge(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => refreshActive(['dashboard', 'alerts']))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'item_messages' }, (p) => onRealtimeMessage(p.new))
    .subscribe(status => setOnlineDots(status === 'SUBSCRIBED', ['staffOnlineDot']));

  // Luôn cập nhật số đếm "chờ duyệt" / "vướng mắc" ở menu dù đang xem tab nào
  refreshApprovalsBadgeOnly();
  refreshIssuesBadge();
  refreshChatBadge();
}

// Đang mở app thì báo ngay trên màn hình (gom các báo cáo đến liền nhau)
let newReports = [];
let announceTimer = null;
function announceNewReport(r) {
  newReports.push(r);
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const names = [...new Set(newReports.map(x => x.reporter_name))].join(', ');
    showToast(`📋 ${names} vừa gửi ${newReports.length} báo cáo chờ duyệt`, false, 5000);
    newReports = [];
  }, 1500);
}

let debounceTimer = null;
function refreshActive(relevantTabs) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (relevantTabs.includes(state.activeTab)) switchTab(state.activeTab);
    else if (relevantTabs.includes('approvals')) refreshApprovalsBadgeOnly();
  }, 400);
}

async function refreshApprovalsBadgeOnly() {
  const { count } = await supabase.from('progress_reports').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  state.pendingCount = count || 0;
  const dot = document.getElementById('approvalsNavDot');
  if (dot) dot.style.display = state.pendingCount > 0 ? 'block' : 'none';
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

boot();
