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
import { wireExportButton } from './export.js';
import { setupPush } from '../push.js';

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

document.getElementById('btnLogout').onclick = async () => {
  await supabase.auth.signOut();
  location.reload();
};

async function enterStaffApp() {
  showScreen('mainScreen');
  await loadStaffProfile();
  await initItemsTab();
  await renderProjectSelect();
  await switchTab('dashboard');
  subscribeRealtime();
  setupPush(supabase, state.user.id).catch(() => {});
  wireCheckNowButton();
  wireExportButton();
}

// Vai trò quyết định KTS chỉ thấy công trình được giao (RLS lọc ở DB,
// ở đây chỉ để ẩn/hiện nút quản trị).
async function loadStaffProfile() {
  const { data } = await supabase.from('staff').select('full_name, role').eq('id', state.user.id).maybeSingle();
  state.staffRole = data?.role === 'staff' ? 'kts' : (data?.role || 'kts');
  const roleVi = { kts: 'KTS', manager: 'Quản lý', admin: 'Quản trị' }[state.staffRole] || '';
  document.getElementById('staffName').textContent = (data?.full_name || state.user.email) + (roleVi ? ' · ' + roleVi : '');
  document.body.classList.toggle('is-manager', state.staffRole === 'manager' || state.staffRole === 'admin');
}

// ---------- Điều hướng tab ----------
const TABS = ['dashboard', 'approvals', 'items', 'alerts'];
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
  else if (tab === 'items') await renderPackages();
  else if (tab === 'alerts') await renderAlerts();
}
TABS.forEach(t => { document.getElementById('nav-' + t).onclick = () => switchTab(t); });
state.navigate = switchTab;

document.getElementById('projectSelect').addEventListener('change', async (e) => {
  state.currentProjectId = e.target.value;
  await renderPackages();
});

// ---------- Realtime: đổi ở bảng nào thì render lại tab đang mở ----------
function subscribeRealtime() {
  supabase.channel('mda-staff')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_reports' }, () => refreshActive(['approvals', 'dashboard']))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, () => refreshActive(['dashboard', 'items']))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, () => { refreshActive(['dashboard', 'alerts']); refreshIssuesBadge(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => refreshActive(['dashboard', 'alerts']))
    .subscribe(status => setOnlineDots(status === 'SUBSCRIBED', ['staffOnlineDot']));

  // Luôn cập nhật số đếm "chờ duyệt" / "vướng mắc" ở menu dù đang xem tab nào
  refreshApprovalsBadgeOnly();
  refreshIssuesBadge();
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
