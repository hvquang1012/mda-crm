// ============================================================
// Kiểm thử khói giao diện: mở index.html (điện thoại + máy tính) và
// crew.html với backend giả lập, bấm qua các luồng chính, chụp ảnh màn
// hình và báo mọi lỗi JavaScript. Không cần Supabase thật.
//
//   python3 -m http.server 8765 &      # ở thư mục gốc repo
//   node tests/ui/smoke.mjs            # cần Playwright (npm i -g playwright)
// Ảnh chụp lưu ở tests/ui/out/ (đã .gitignore). Dòng cuối "ERRORS:" phải trống.
// ============================================================
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const mock = fs.readFileSync(path.join(DIR, 'mock-supabase.js'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch());
const errors = [];
async function page(url, w, h, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(url + ' PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(url + ' CONSOLE ' + m.text()); });
  await p.route('**/vendor/supabase-js@2.45.4.min.js', r => r.fulfill({ contentType: 'text/javascript', body: mock }));
  await p.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));
  await p.goto('http://localhost:8765/' + url);
  await p.waitForTimeout(800);
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: false });

let p = await page('index.html', 390, 844);
await shot(p, 'm-dashboard');
// Công trình xong hết: không tính "Cần xử lý", không cảnh báo im lặng / dự báo trễ
{
  const card = await p.$('[data-open-project=p3]');
  const txt = card ? await card.textContent() : '';
  if (!txt.includes('Đã xong') || txt.includes('Cần xử lý') || txt.includes('chưa có báo cáo') || txt.includes('dự báo trễ') || txt.includes('trễ 11')) errors.push('dashboard: công trình xong hết vẫn báo cần xử lý');
  if ((await p.textContent('.kpi.critical .kpi-value').catch(() => '0')) !== '2') errors.push('dashboard: KPI Cần xử lý đếm cả công trình đã xong');
}
// Cài đặt tài khoản: bấm tên → sửa tên + số; số sai không gửi, số +84 đổi về 0…
await p.click('#staffName'); await p.waitForTimeout(200);
await p.fill('#profileName', 'Quang MD'); await p.fill('#profilePhone', '+84 912 345 678');
if ((await p.getAttribute('#profileZalo', 'href')) !== 'https://zalo.me/0912345678') errors.push('profile: link Zalo sai');
await shot(p, 'm-profile');
await p.fill('#profilePhone', '123'); await p.click('#btnProfileSave'); await p.waitForTimeout(200);
if (!(await p.textContent('#profileError')) || (await p.evaluate(() => window.__calls)).some(c => c[0] === 'update' && c[1] === 'staff')) errors.push('profile: số sai vẫn lưu');
await p.fill('#profilePhone', '0912 345 678'); await p.click('#btnProfileSave'); await p.waitForTimeout(300);
if (!(await p.evaluate(() => window.__calls)).some(c => c[0] === 'update' && c[1] === 'staff' && c[2].phone === '0912345678' && c[2].full_name === 'Quang MD')) errors.push('profile: không lưu tên/số');
if (!(await p.textContent('#staffName')).startsWith('Quang MD')) errors.push('profile: tên đầu trang chưa đổi');
// Sáng/Tối: ép Tối → nền #0B0F19; Tự động → bỏ data-theme
await p.click('#staffName'); await p.waitForTimeout(150);
await p.click('[data-theme-opt=dark]'); await p.waitForTimeout(400);
if ((await p.evaluate(() => document.documentElement.dataset.theme)) !== 'dark' || (await p.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(11, 15, 25)') errors.push('theme: không chuyển sang Tối');
await shot(p, 'm-profile-dark');
await p.click('[data-theme-opt=auto]'); await p.waitForTimeout(400);
if ((await p.evaluate(() => document.documentElement.dataset.theme)) !== undefined) errors.push('theme: Tự động không bỏ data-theme');
await p.click('#btnProfileCancel');
await p.click('#nav-approvals'); await p.waitForTimeout(400); await shot(p, 'm-approvals');
// Khung ảnh: 3 ảnh + 6 ảnh → slide, 4 ảnh → lưới 2×2; vuốt slide cập nhật nhãn đếm
for (const [sel, want] of [['.pg-slider[data-n="3"]', 1], ['.pg-grid4', 1], ['.pg-slider[data-n="6"]', 1]])
  if ((await p.$$(sel)).length !== want) errors.push('gallery: thiếu ' + sel);
await p.$eval('.pg-slider[data-n="3"] .pg-track', t => t.scrollTo({ left: t.scrollWidth }));
await p.waitForTimeout(300);
if ((await p.textContent('.pg-slider[data-n="3"] .pg-count')) !== '3/3') errors.push('gallery: vuốt slide không cập nhật nhãn đếm');
await p.click('.pg-slider[data-n="3"] .pg-slide:nth-child(2) img'); await p.waitForTimeout(200);
if ((await p.textContent('.lightbox .lb-counter')) !== '2 / 3') errors.push('gallery: bấm ảnh 2 không mở đúng ảnh trong lightbox');
await p.click('.lightbox .lb-close');
await p.click('[data-action=reject]'); await p.waitForTimeout(200); await shot(p, 'm-reject'); await p.click('#btnRejectCancel');
await p.click('[data-action=approve]'); await p.waitForTimeout(300);
console.log('calls', JSON.stringify((await p.evaluate(() => window.__calls)).filter(c => c[0] === 'rpc' && c[1] !== 'dashboard_summary')));
await p.click('#nav-alerts'); await p.waitForTimeout(400); await shot(p, 'm-alerts');
await p.click('#nav-items'); await p.waitForTimeout(400); await shot(p, 'm-items');
// Đầu việc = dòng gọn; menu ⋯; trọn gói không hiện mã thô "tron_goi"
if (!(await p.$$('.package-card .wi-row')).length) errors.push('items: thiếu dòng đầu việc gọn');
if ((await p.textContent('#packagesList')).includes('tron_goi')) errors.push('items: còn hiện chữ tron_goi');
await p.click('.wi-row .wi-more'); await p.waitForTimeout(150);
if (!(await p.isVisible('.wi-row .wi-menu'))) errors.push('items: menu ⋯ không mở');
await shot(p, 'm-items-menu');
await p.click('body', { position: { x: 5, y: 300 } }); await p.waitForTimeout(100);
if (await p.isVisible('.wi-row .wi-menu')) errors.push('items: bấm ra ngoài không đóng menu');
// Chốt xong nhanh: 1 đầu việc qua menu ⋯, cả hạng mục qua menu ⋯ của hạng mục (chỉ đổi status)
await p.click('.wi-row .wi-more'); await p.click('.wi-row [data-action=done-item]'); await p.waitForTimeout(200);
p.once('dialog', dlg => dlg.accept());
await p.click('.package-card > .task-actions .wi-more'); await p.click('[data-action=done-package]'); await p.waitForTimeout(300);
{
  const ups = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'update' && c[1] === 'work_items');
  if (ups.length < 2 || ups.some(c => Object.keys(c[2]).join() !== 'status' || c[2].status !== 'done')) errors.push('items: chốt xong không gửi đúng status=done');
}
if ((await p.$$('.wi-row .badge.ahead')).length === 0 || !(await p.textContent('#packagesList')).includes('✓ Xong')) errors.push('items: đầu việc xong không hiện nhãn Xong');
await p.click('[data-action=toggle-edit]'); await p.waitForTimeout(200); await shot(p, 'm-items-edit');
await p.click('[data-action=paste-items]'); await p.fill('#pasteInput', 'Tên\tĐơn vị\tKL\nLắp lavabo\tđiểm\t3\t5/10/2026\t6/10/2026\nỐp tường\tm2\tabc\t1/1/2026\nCắt đá\tm²\t4,5\t2026-10-01'); await p.waitForTimeout(200); await shot(p, 'm-paste'); await p.click('#btnPasteCancel');
await p.click('[data-action=crew-link]'); await p.waitForTimeout(300); await shot(p, 'm-links'); await p.click('#btnCrewLinkCancel');
await p.click('#btnNewProject'); await p.fill('#wzName', 'Nhà test'); await p.click('#btnWizardNext');
await p.click('[data-add=da]'); await p.waitForTimeout(100); await p.selectOption('.wz-sub', 's1'); await shot(p, 'm-wizard2');
await p.click('#btnWizardNext'); await p.waitForTimeout(100); await shot(p, 'm-wizard3');
{ const rows = await p.$$eval('.wz-rows li', ls => ls.map(l => l.firstChild.textContent.trim()));
  if (rows.length !== new Set(rows).size) errors.push('wizard: mẫu vẫn lặp đầu việc ' + rows.join(', ')); }
await p.click('#btnWizardNext'); await p.waitForTimeout(500); await shot(p, 'm-wizard-done');

p = await page('index.html', 1440, 900);
await shot(p, 'd-dashboard');
await p.click('#nav-approvals'); await p.waitForTimeout(500); await shot(p, 'd-approvals');
await p.click('.pg-slider[data-n="6"] .pg-nav.next'); await p.waitForTimeout(500);
if (!/^2\//.test(await p.textContent('.pg-slider[data-n="6"] .pg-count'))) errors.push('gallery: nút › không chuyển ảnh');
await p.click('#nav-dashboard'); await p.waitForTimeout(300);
await p.click('[data-open-project]'); await p.waitForTimeout(500); await shot(p, 'd-timeline');
// Timeline: nút "Xong cả hạng mục" ở đầu đội còn việc dở, không mở hộp sửa đầu việc
{
  const n0 = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'update' && c[1] === 'work_items').length;
  const btns = await p.$$('.timeline-group-head [data-action=done-package]');
  if (btns.length !== 1) errors.push('timeline: số nút Xong cả hạng mục sai (' + btns.length + ')');
  p.once('dialog', dlg => dlg.accept());
  await btns[0]?.click(); await p.waitForTimeout(300);
  const ups = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'update' && c[1] === 'work_items').slice(n0);
  if (!ups.length || ups.some(c => Object.keys(c[2]).join() !== 'status' || c[2].status !== 'done')) errors.push('timeline: Xong cả hạng mục không gửi status=done');
  if (await p.isVisible('#itemModal.show')) errors.push('timeline: bấm nút lại mở hộp sửa đầu việc');
}
await p.click('#btnMembers'); await p.waitForTimeout(300); await shot(p, 'd-members');
if ((await p.getAttribute('#membersList .zalo-btn', 'href')) !== 'https://zalo.me/0912345678') errors.push('members: thiếu nút Zalo');

p = await page('crew.html?t=abc', 390, 844);
await shot(p, 'c-list');
await p.click('.crew-item-card'); await p.waitForTimeout(400);
await p.click('#crewQtyChips .chip[data-set]'); await p.click('#crewNoteChips .chip');
await shot(p, 'c-form');
await p.click('[data-tab=history]'); await p.waitForTimeout(400); await shot(p, 'c-history');
await p.click('.resend-btn'); await p.waitForTimeout(300); await shot(p, 'c-resend');
await p.click('#btnRaiseIssue'); await p.waitForTimeout(200); await shot(p, 'c-issue');

// Chế độ tối theo máy: dashboard, duyệt, màn thợ
p = await page('index.html', 390, 844, 'dark');
await shot(p, 'dk-dashboard');
await p.click('#nav-approvals'); await p.waitForTimeout(400); await shot(p, 'dk-approvals');
p = await page('index.html', 1440, 900, 'dark');
await p.click('#nav-items'); await p.waitForTimeout(500); await shot(p, 'dk-d-items');
p = await page('crew.html?t=abc', 390, 844, 'dark');
await shot(p, 'dk-c-list');

console.log('ERRORS:\n' + errors.join('\n'));
process.exitCode = errors.length ? 1 : 0;
await browser.close();
