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
// Thẻ "Đã xong" có nút Đóng công trình; bấm không mở timeline
{
  const n0 = (await p.evaluate(() => window.__calls)).length;
  p.once('dialog', dlg => dlg.accept());
  await p.click('[data-open-project=p3] [data-close-project]'); await p.waitForTimeout(300);
  const calls = (await p.evaluate(() => window.__calls)).slice(n0);
  if (!calls.some(c => c[0] === 'update' && c[1] === 'projects' && c[2].status === 'done')) errors.push('dashboard: nút Đóng công trình không gửi status=done');
  if (await p.isVisible('#tabPanel-items')) errors.push('dashboard: bấm Đóng công trình lại mở timeline');
  if ((await p.$$('[data-close-project]')).length !== 1) errors.push('dashboard: nút Đóng hiện ở công trình chưa xong');
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
// Cài đặt nhanh: ☾ đổi Tối ngay; ⚙ → cỡ chữ Lớn, English; tải lại vẫn giữ
await p.click('#btnProfileCancel').catch(() => {});
await p.click('#quickSettings .qs-toggle'); await p.waitForTimeout(400);
if ((await p.evaluate(() => document.documentElement.dataset.theme)) !== 'dark' || (await p.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(11, 15, 25)') errors.push('theme: nút ☾ không chuyển sang Tối');
await p.click('#quickSettings .qs-open'); await p.waitForTimeout(150);
await p.click('.qs-menu [data-qs=font][data-val=lg]'); await p.click('.qs-menu [data-qs=lang][data-val=en]'); await p.waitForTimeout(200);
await shot(p, 'm-quick-settings-dark');
if ((await p.evaluate(() => document.documentElement.dataset.font)) !== 'lg') errors.push('settings: cỡ chữ Lớn không áp');
if (!(await p.textContent('#nav-items')).includes('Tasks')) errors.push('settings: English không đổi tên tab');
{ // mở trang mới trên cùng máy: giữ cài đặt ngay từ đầu (script trong <head>)
  const p2 = await p.context().newPage();
  await p2.route('**/vendor/supabase-js@2.45.4.min.js', r => r.fulfill({ contentType: 'text/javascript', body: mock }));
  await p2.goto('http://localhost:8765/crew.html?t=abc'); await p2.waitForTimeout(800);
  if ((await p2.evaluate(() => document.documentElement.dataset.font + document.documentElement.lang)) !== 'lgen' || !(await p2.textContent('[data-tab=history]')).includes('History')) errors.push('settings: trang mới không giữ cài đặt');
  await shot(p2, 'm-crew-en-lg');
  await p2.close();
}
await p.keyboard.press('Escape');
await p.click('#quickSettings .qs-open'); await p.waitForTimeout(150);
await p.click('.qs-menu [data-qs=lang][data-val=vi]'); await p.click('.qs-menu [data-qs=font][data-val=md]'); await p.click('.qs-menu [data-qs=theme][data-val=auto]'); await p.waitForTimeout(400);
await p.keyboard.press('Escape');
if (!(await p.textContent('#nav-items')).includes('Công việc') || (await p.textContent('#btnLogout')) !== 'Đăng xuất') errors.push('settings: không trả về Tiếng Việt');
if ((await p.evaluate(() => document.documentElement.dataset.theme)) !== undefined) errors.push('theme: Tự động không bỏ data-theme');
// Trò chuyện: số chưa đọc trên menu; tab gom đầu việc có tin, chưa đọc lên đầu; mở luồng, gửi tin
if ((await p.textContent('#chatNavCount')).trim() !== '2' || !(await p.isVisible('#chatNavCount'))) errors.push('chat: menu không hiện số tin chưa đọc');
await p.click('#nav-chat'); await p.waitForTimeout(400); await shot(p, 'm-chat');
{
  const cards = await p.$$('.chat-inbox-card');
  if (cards.length !== 2 || !(await cards[0].evaluate(el => el.classList.contains('unread')))) errors.push('chat: hộp trò chuyện sai thứ tự / thiếu chưa đọc');
  const txt = await p.textContent('#chatInboxList');
  if (!txt.includes('Nhà anh Minh — Ocean Park · Đội đá Sơn') || !txt.includes('📷 Ảnh')) errors.push('chat: thẻ thiếu công trình · đội / tin cuối');
  if (await p.$('#chatInboxList script')) errors.push('chat: nội dung tin không được escape');
}
await p.click('.chat-inbox-card.unread'); await p.waitForTimeout(400);
if (!(await p.isVisible('#chatModal.show'))) errors.push('chat: bấm thẻ không mở luồng');
if ((await p.$$('#chatThread .chat-msg')).length !== 3) errors.push('chat: luồng không đủ 3 tin');
if (await p.$('#chatThread b')) errors.push('chat: tin nhắn không được escape');
if (!(await p.evaluate(() => window.__calls)).some(c => c[0] === 'rpc' && c[1] === 'chat_mark_read' && c[2].p_item_id === 'i1')) errors.push('chat: mở luồng không đánh dấu đã đọc');
await shot(p, 'm-chat-thread');
await p.fill('#chatInput', 'Mai 8h giao đá nhé');
await p.click('#btnChatSend'); await p.waitForTimeout(400);
{
  const ins = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'insert' && c[1] === 'item_messages');
  if (ins.length !== 1 || ins[0][2].body !== 'Mai 8h giao đá nhé' || ins[0][2].author_kind !== 'staff' || !ins[0][2].client_ref || ins[0][2].project_id !== 'p1') errors.push('chat: gửi tin không insert đúng');
  if (!(await p.textContent('#chatThread')).includes('Mai 8h giao đá nhé') || !(await p.$('#chatThread .chat-msg.mine'))) errors.push('chat: gửi xong không vẽ lại luồng');
  if (await p.inputValue('#chatInput')) errors.push('chat: gửi xong ô nhập chưa xoá');
}
await shot(p, 'm-chat-sent');
await p.click('#btnChatClose');
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
console.log('calls', JSON.stringify((await p.evaluate(() => window.__calls)).filter(c => c[0] === 'rpc' && !['dashboard_summary', 'chat_inbox', 'chat_mark_read'].includes(c[1]))));
await p.click('#nav-alerts'); await p.waitForTimeout(400); await shot(p, 'm-alerts');
await p.click('#nav-items'); await p.waitForTimeout(400); await shot(p, 'm-items');
// Đóng công trình: công trình đã đóng gom vào nhóm riêng; nút 🏁 Đóng ↔ ↺ Mở lại
if (!(await p.$('#projectSelect optgroup[label^="Đã đóng"] option[value=p4]'))) errors.push('items: thiếu nhóm Đã đóng trong danh sách công trình');
if ((await p.textContent('#btnCloseProject')).trim() !== '🏁 Đóng' || !(await p.isHidden('#projectClosedNote'))) errors.push('items: nút Đóng sai với công trình đang chạy');
{
  const n0 = (await p.evaluate(() => window.__calls)).length;
  p.once('dialog', dlg => { if (!dlg.message().includes('chưa xong')) errors.push('items: hộp xác nhận đóng không nhắc đầu việc chưa xong'); dlg.accept(); });
  await p.click('#btnCloseProject'); await p.waitForTimeout(300);
  if (!(await p.evaluate(() => window.__calls)).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects' && c[2].status === 'done')) errors.push('items: bấm Đóng không gửi status=done');
}
await p.selectOption('#projectSelect', 'p4'); await p.waitForTimeout(300);
if ((await p.textContent('#btnCloseProject')).trim() !== '↺ Mở lại' || !(await p.isVisible('#projectClosedNote'))) errors.push('items: công trình đã đóng không hiện Mở lại / dòng nhắc');
await shot(p, 'm-items-closed');
{
  const n0 = (await p.evaluate(() => window.__calls)).length;
  p.once('dialog', dlg => dlg.accept());
  await p.click('#btnCloseProject'); await p.waitForTimeout(300);
  if (!(await p.evaluate(() => window.__calls)).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects' && c[2].status === 'active')) errors.push('items: bấm Mở lại không gửi status=active');
}
await p.selectOption('#projectSelect', 'p1'); await p.waitForTimeout(300);
// Đầu việc = dòng gọn; menu ⋯; trọn gói không hiện mã thô "tron_goi"
if (!(await p.$$('.package-card .wi-row')).length) errors.push('items: thiếu dòng đầu việc gọn');
// Nút 💬 mỗi đầu việc, kèm số chưa đọc; bấm mở đúng luồng
if ((await p.$$('.wi-row [data-action=chat]')).length !== 4) errors.push('items: thiếu nút 💬 ở đầu việc');
if ((await p.textContent('[data-item-card=i1] [data-chat-count=i1]')).trim() !== '2') errors.push('items: nút 💬 không hiện số chưa đọc');
await p.click('[data-item-card=i1] [data-action=chat]'); await p.waitForTimeout(400);
if (!(await p.isVisible('#chatModal.show')) || (await p.textContent('#chatModalTitle')) !== 'Lắp đá mặt bếp') errors.push('items: 💬 không mở đúng luồng');
if (await p.isVisible('[data-item-card=i1] .wi-menu')) errors.push('items: bấm 💬 lại mở menu');
await p.click('#btnChatClose');
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
// Timeline: nút 💬 nằm cạnh dòng (không lồng trong nút dòng), bấm mở luồng chứ không mở hộp sửa
{
  if (await p.$('.timeline-row [data-action=chat]')) errors.push('timeline: nút 💬 lồng trong nút dòng');
  const btn = await p.$('.timeline-row-wrap [data-action=chat][data-item-id=i1]');
  if (!btn) errors.push('timeline: thiếu nút 💬');
  await btn?.click(); await p.waitForTimeout(400);
  if (!(await p.isVisible('#chatModal.show')) || await p.isVisible('#itemModal.show')) errors.push('timeline: 💬 không mở luồng / lại mở hộp sửa');
  await shot(p, 'd-chat-thread');
  await p.click('#btnChatClose');
}
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
// Link thợ của công trình đã đóng → màn hình báo khoá, không phải "hết hạn"
{
  const q = await page('crew.html?t=closed', 390, 844);
  if (!(await q.textContent('#crewErrorMsg')).includes('đã khoá')) errors.push('crew: link công trình đã đóng không báo khoá');
  await shot(q, 'c-closed');
  await q.context().close();
}
{
  const q = await page('client.html?t=closed', 390, 844);
  if (!(await q.textContent('#clientErrorMsg')).includes('đã đóng')) errors.push('client: link công trình đã đóng không báo khoá');
  await q.context().close();
}
await p.click('.crew-item-card'); await p.waitForTimeout(400);
await p.click('#crewQtyChips .chip[data-set]'); await p.click('#crewNoteChips .chip');
await shot(p, 'c-form');
await p.click('[data-tab=history]'); await p.waitForTimeout(400); await shot(p, 'c-history');
await p.click('.resend-btn'); await p.waitForTimeout(300); await shot(p, 'c-resend');
await p.click('#btnRaiseIssue'); await p.waitForTimeout(200); await shot(p, 'c-issue');
await p.click('#btnIssueCancel');

// Thợ: 💬 trên thẻ đầu việc (chấm tin mới), gửi tin lúc mất sóng → vào hàng đợi, có mạng lại tự gửi đúng 1 lần
{
  const q = await page('crew.html?t=abc', 390, 844);
  if (!(await q.$('.crew-item-card [data-chat] .chat-count.dot'))) errors.push('crew chat: thiếu chấm tin mới');
  const chatBtns = await q.$$('.crew-item-card [data-chat]');
  if (chatBtns.length !== 4) errors.push('crew chat: số nút 💬 sai (' + chatBtns.length + ')');
  // đầu việc i1 "Lắp đá mặt bếp" — tìm đúng thẻ
  const i1 = await q.evaluateHandle(() => [...document.querySelectorAll('.crew-item-card')].find(c => c.textContent.includes('Lắp đá mặt bếp')).querySelector('[data-chat]'));
  await i1.click(); await q.waitForTimeout(500);
  if (!(await q.isVisible('#crewChatModal.show'))) errors.push('crew chat: không mở khung trò chuyện');
  if (await q.isVisible('#crewForm')) errors.push('crew chat: bấm 💬 lại mở form báo cáo');
  if ((await q.$$('#crewChatList .chat-msg')).length !== 2) errors.push('crew chat: không hiện tin cũ');
  await shot(q, 'c-chat');
  const sendCalls = async () => (await q.evaluate(() => window.__calls)).filter(c => c[0] === 'rpc' && c[1] === 'crew_send_message');
  await q.context().setOffline(true);
  await q.fill('#crewChatInput', 'Thiếu 1 tấm đá đảo bếp');
  await q.click('#crewChatSend'); await q.waitForTimeout(500);
  if ((await sendCalls()).length !== 0) errors.push('crew chat: mất sóng vẫn gọi crew_send_message');
  if (!(await q.isVisible('#crewChatBanner')) || !(await q.$('#crewChatList .chat-msg.queued'))) errors.push('crew chat: mất sóng không hiện thanh cam / tin chờ gửi');
  await shot(q, 'c-chat-offline');
  await q.click('#crewChatClose'); await q.waitForTimeout(200);
  if (!(await q.isVisible('#crewOutboxBanner')) || !(await q.textContent('#crewOutboxBanner')).includes('1 tin nhắn')) errors.push('crew chat: đóng khung chat không còn thanh cam tin chờ gửi');
  await q.evaluate(() => [...document.querySelectorAll('.crew-item-card')].find(c => c.textContent.includes('Lắp đá mặt bếp')).querySelector('[data-chat]').click());
  await q.waitForTimeout(300);
  await q.context().setOffline(false);
  await q.waitForTimeout(1500);
  const calls = await sendCalls();
  if (calls.length !== 1 || !calls[0][2].p_client_ref || calls[0][2].p_body !== 'Thiếu 1 tấm đá đảo bếp') errors.push('crew chat: có mạng lại gửi ' + calls.length + ' lần (phải đúng 1, kèm client_ref)');
  if (await q.isVisible('#crewChatBanner') || await q.$('#crewChatList .chat-msg.queued')) errors.push('crew chat: gửi xong vẫn còn thanh cam');
  if (await q.isVisible('#crewOutboxBanner')) errors.push('crew chat: gửi xong thanh cam màn chính chưa tắt');
  if (!(await q.textContent('#crewChatList')).includes('Thiếu 1 tấm đá đảo bếp')) errors.push('crew chat: gửi xong không hiện tin');
  await shot(q, 'c-chat-sent');
  await q.click('#crewChatClose'); await q.waitForTimeout(200);
  if (await q.$('.crew-item-card [data-chat] .chat-count.dot')) errors.push('crew chat: đọc rồi vẫn còn chấm tin mới');
  await q.context().close();
}

// Chế độ tối theo máy: dashboard, duyệt, màn thợ
p = await page('index.html', 390, 844, 'dark');
await shot(p, 'dk-dashboard');
await p.click('#nav-approvals'); await p.waitForTimeout(400); await shot(p, 'dk-approvals');
p = await page('index.html', 1440, 900, 'dark');
await p.click('#nav-items'); await p.waitForTimeout(500); await shot(p, 'dk-d-items');
p = await page('crew.html?t=abc', 390, 844, 'dark');
await shot(p, 'dk-c-list');
if (!(await p.$('#quickSettings .qs-open'))) errors.push('crew: thiếu nút cài đặt');
await p.click('.crew-item-card [data-chat]'); await p.waitForTimeout(500); await shot(p, 'dk-c-chat');
p = await page('index.html', 390, 844, 'dark');
await p.click('#nav-chat'); await p.waitForTimeout(400); await shot(p, 'dk-chat');
await p.click('.chat-inbox-card'); await p.waitForTimeout(400); await shot(p, 'dk-chat-thread');

console.log('ERRORS:\n' + errors.join('\n'));
process.exitCode = errors.length ? 1 : 0;
await browser.close();
