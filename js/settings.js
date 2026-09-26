// ============================================================
// Cài đặt nhanh trên thanh đầu trang (dùng chung index/crew/client):
// nút ☀/☾ đổi nhanh sáng↔tối + nút ⚙ mở menu Giao diện · Cỡ chữ · Ngôn ngữ.
// Lưu trên máy (localStorage). Script nhỏ trong <head> mỗi trang đọc lại
// lúc mở để không chớp màu / nhảy cỡ chữ.
//
// Ngôn ngữ: tiếng Việt là gốc viết trong HTML. Phần tử có data-i18n="key"
// được đổi chữ theo DICT.en; bản tiếng Việt cất ở dataset.vi để đổi lại.
// Chỉ dịch khung chung (menu, tab, nút chung) — nội dung chi tiết vẫn tiếng Việt.
// ============================================================

const KEYS = { theme: 'mda-theme', font: 'mda-font', lang: 'mda-lang' };
const ALLOWED = { theme: ['auto', 'light', 'dark'], font: ['sm', 'md', 'lg'], lang: ['vi', 'en'] };
const DEFAULTS = { theme: 'auto', font: 'md', lang: 'vi' };

function read(kind) {
  try { const v = localStorage.getItem(KEYS[kind]); return ALLOWED[kind].includes(v) ? v : DEFAULTS[kind]; }
  catch { return DEFAULTS[kind]; }
}
function write(kind, v) {
  try { if (v === DEFAULTS[kind]) localStorage.removeItem(KEYS[kind]); else localStorage.setItem(KEYS[kind], v); }
  catch { /* chế độ ẩn danh */ }
}

const DICT = {
  en: {
    'nav.dashboard': 'Overview', 'nav.approvals': 'Approve', 'nav.items': 'Tasks',
    'nav.chat': 'Chat', 'nav.alerts': 'To do',
    'crew.report': 'Report', 'crew.history': 'History',
    'client.stages': 'Construction stages',
    'logout': 'Log out',
    'qs.title': 'Settings', 'qs.theme': 'Appearance', 'qs.font': 'Text size', 'qs.lang': 'Language',
    'qs.auto': 'Auto', 'qs.light': '☀ Light', 'qs.dark': '☾ Dark',
    'qs.sm': 'Small', 'qs.md': 'Medium', 'qs.lg': 'Large',
    'qs.open': 'Settings', 'qs.toggle': 'Toggle light/dark'
  },
  vi: {
    'qs.title': 'Cài đặt', 'qs.theme': 'Giao diện', 'qs.font': 'Cỡ chữ', 'qs.lang': 'Ngôn ngữ',
    'qs.auto': 'Tự động', 'qs.light': '☀ Sáng', 'qs.dark': '☾ Tối',
    'qs.sm': 'Nhỏ', 'qs.md': 'Vừa', 'qs.lg': 'Lớn',
    'qs.open': 'Cài đặt', 'qs.toggle': 'Đổi sáng/tối'
  }
};

export function currentLang() { return read('lang'); }
export function t(key, viFallback) {
  const lang = currentLang();
  return DICT[lang]?.[key] ?? (lang === 'vi' ? viFallback : undefined) ?? DICT.vi[key] ?? viFallback ?? key;
}

export function applyI18n(root = document) {
  const lang = currentLang();
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    // Chỉ thay nút chữ đầu tiên — giữ nguyên icon/chấm đếm nằm bên trong
    const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!node) return;
    if (el.dataset.vi === undefined) el.dataset.vi = node.textContent;
    node.textContent = lang === 'vi' ? el.dataset.vi : (DICT[lang][el.dataset.i18n] ?? el.dataset.vi);
  });
}

// ---------- Sáng / Tối ----------
export function currentTheme() { return read('theme'); }
function effectiveDark() {
  const t = currentTheme();
  return t === 'dark' || (t === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}
export function applyTheme(opt) {
  const root = document.documentElement;
  root.classList.add('theme-anim');
  if (opt === 'light' || opt === 'dark') root.dataset.theme = opt; else delete root.dataset.theme;
  write('theme', opt);
  setTimeout(() => root.classList.remove('theme-anim'), 350);
  syncButtons();
}

// ---------- Cỡ chữ ----------
export function applyFont(opt) {
  const root = document.documentElement;
  if (opt === 'md') delete root.dataset.font; else root.dataset.font = opt;
  write('font', opt);
  syncButtons();
}

export function applyLang(opt) { write('lang', opt); applyI18n(); syncButtons(); }

// ---------- Nút trên thanh đầu trang + menu ----------
let menuEl = null;
const toggles = [];

function syncButtons() {
  const dark = effectiveDark();
  toggles.forEach(b => { b.textContent = dark ? '☀' : '☾'; b.title = b.ariaLabel = t('qs.toggle'); });
  document.querySelectorAll('.qs-open').forEach(b => { b.title = b.ariaLabel = t('qs.open'); });
  if (!menuEl) return;
  const cur = { theme: currentTheme(), font: read('font'), lang: currentLang() };
  menuEl.querySelectorAll('[data-qs]').forEach(b => {
    const on = cur[b.dataset.qs] === b.dataset.val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  menuEl.querySelectorAll('[data-qs-label]').forEach(el => { el.textContent = t(el.dataset.qsLabel); });
}

function group(kind, opts) {
  return `<div class="qs-group"><div class="qs-label" data-qs-label="qs.${kind}"></div>
    <div class="seg-switch" role="group">${opts.map(([v, label]) =>
      `<button type="button" data-qs="${kind}" data-val="${v}" data-qs-label="${label}"></button>`).join('')}</div></div>`;
}

function buildMenu() {
  menuEl = document.createElement('div');
  menuEl.className = 'qs-menu';
  menuEl.hidden = true;
  menuEl.setAttribute('role', 'dialog');
  menuEl.innerHTML = `<div class="qs-title" data-qs-label="qs.title"></div>`
    + group('theme', [['auto', 'qs.auto'], ['light', 'qs.light'], ['dark', 'qs.dark']])
    + group('font', [['sm', 'qs.sm'], ['md', 'qs.md'], ['lg', 'qs.lg']])
    + `<div class="qs-group"><div class="qs-label" data-qs-label="qs.lang"></div>
        <div class="seg-switch" role="group">
          <button type="button" data-qs="lang" data-val="vi">Tiếng Việt</button>
          <button type="button" data-qs="lang" data-val="en">English</button></div></div>`;
  menuEl.onclick = e => {
    const b = e.target.closest('[data-qs]');
    if (!b) return;
    ({ theme: applyTheme, font: applyFont, lang: applyLang })[b.dataset.qs](b.dataset.val);
  };
  document.body.appendChild(menuEl);
  document.addEventListener('click', e => {
    if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest('.qs-open')) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', closeMenu);
}

function closeMenu() { if (menuEl) menuEl.hidden = true; }

function openMenu(anchor) {
  if (!menuEl.hidden) { closeMenu(); return; }
  menuEl.hidden = false;
  syncButtons();
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = (r.bottom + 8) + 'px';
  if (window.innerWidth > 520) {
    menuEl.style.left = 'auto';
    menuEl.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
  } else { menuEl.style.left = ''; menuEl.style.right = ''; }
}

// container: phần tử rỗng trên thanh đầu trang (#quickSettings)
export function mountQuickSettings(container) {
  if (!container) return;
  if (!menuEl) buildMenu();
  container.classList.add('qs-slot');
  container.innerHTML = `<button type="button" class="logout-btn qs-btn qs-toggle"></button>`
    + `<button type="button" class="logout-btn qs-btn qs-open">⚙</button>`;
  const toggle = container.querySelector('.qs-toggle');
  const open = container.querySelector('.qs-open');
  toggles.push(toggle);
  toggle.onclick = () => applyTheme(effectiveDark() ? 'light' : 'dark');
  open.onclick = () => openMenu(open);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncButtons);
  applyI18n();
  syncButtons();
}
