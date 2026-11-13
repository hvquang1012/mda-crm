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
// Menu ⚙ của nhân viên có mục Thông báo (trạng thái + nút/hướng dẫn theo máy)
await p.click('#quickSettings .qs-open'); await p.waitForTimeout(200);
if (!(await p.textContent('.qs-menu [data-qs-extra]')).includes('Thông báo')) errors.push('menu ⚙: thiếu mục Thông báo');
await p.click('#quickSettings .qs-open');
// Logo: điện thoại chỉ hiện biểu tượng; máy tính hiện logo ngang trắng
if (!(await p.isVisible('#mainScreen .logo-mark')) || (await p.isVisible('#mainScreen .logo-wide'))) errors.push('logo: điện thoại phải chỉ hiện biểu tượng');
{
  const pd = await page('index.html', 1440, 900);
  if (!(await pd.isVisible('#mainScreen .logo-wide')) || (await pd.isVisible('#mainScreen .logo-mark'))) errors.push('logo: máy tính phải hiện logo ngang');
  await pd.context().close();
  for (const scheme of ['light', 'dark']) {
    const pe = await page('crew.html', 390, 844, scheme);   // thiếu token → màn lỗi có logo
    const on = await pe.isVisible('.logo-on-' + scheme), off = await pe.isVisible('.logo-on-' + (scheme === 'light' ? 'dark' : 'light'));
    if (!on || off) errors.push('logo: màn lỗi thợ sai bản logo ở chế độ ' + scheme);
    await shot(pe, 'logo-crew-error-' + scheme);
    await pe.context().close();
  }
}
// Công trình xong hết: không tính "Cần xử lý", không cảnh báo im lặng / dự báo trễ
{
  const card = await p.$('[data-open-project=p3]');
  const txt = card ? await card.textContent() : '';
  if (!txt.includes('Đã xong') || txt.includes('Cần xử lý') || txt.includes('chưa có báo cáo') || txt.includes('dự báo trễ') || txt.includes('trễ 11')) errors.push('dashboard: công trình xong hết vẫn báo cần xử lý');
  // P1 đang khảo sát + p3 đã xong không tính → chỉ còn P2
  if ((await p.textContent('.kpi.critical .kpi-value').catch(() => '0')) !== '1') errors.push('dashboard: KPI Cần xử lý đếm cả công trình đã xong / đang khảo sát');
}
// Công trình đang khảo sát: chip giai đoạn, không 0% / trễ / còn n ngày
{
  const card = await p.$('[data-open-project=p1]');
  const txt = card ? await card.textContent() : '';
  if (!txt.includes('📐 Đang khảo sát') || !txt.includes('Chưa vào thi công')) errors.push('dashboard: thẻ công trình khảo sát thiếu chip giai đoạn / "Chưa vào thi công"');
  if (/\d+%|còn \d+ ngày|trễ \d+|Cần xử lý|Cần chú ý|chưa có báo cáo/.test(txt)) errors.push('dashboard: thẻ công trình khảo sát vẫn hiện % / ngày / rủi ro: ' + txt);
  await shot(p, 'm-dashboard-survey');
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
if ((await p.textContent('#staffName')).trim() !== 'Quang MD') errors.push('profile: tên đầu trang chưa đổi / còn chữ vai trò');
if (!(await p.$('#staffName img.role-ic[src*="role-admin"]'))) errors.push('profile: thiếu icon vai trò');
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
// ---- Khảo sát hiện trạng (plan 011): P1 đang ở giai đoạn Khảo sát ----
{
  const calls = async () => p.evaluate(() => window.__calls);
  const upserts = async () => (await calls()).filter(c => c[0] === 'upsert' && c[1] === 'survey_answers');
  const card = (id) => `[data-survey-item=${id}]`;
  const status = async (id) => (await p.textContent(card(id) + ' [data-status]')).trim();
  const blurFill = async (sel, v) => { await p.fill(sel, v); await p.press(sel, 'Tab'); await p.waitForTimeout(250); };
  if (!(await p.isVisible('#surveyView .survey-item')) || await p.isVisible('#packagesList')) errors.push('survey: P1 đang khảo sát không tự mở view Khảo sát');
  if ((await p.getAttribute('#btnItemsSurveyView', 'aria-pressed')) !== 'true') errors.push('survey: nút 📐 Khảo sát không sáng');
  if (await p.isVisible('#btnNewPackage') || await p.isVisible('#btnSelectMode') || await p.isVisible('#itemsExportSection')) errors.push('survey: view Khảo sát vẫn hiện Thêm đội / Chọn nhiều / xuất CSV');
  const bar = await p.textContent('#phaseBar');
  if (!bar.includes('Khảo sát') || !bar.includes('Lên phương án') || !bar.includes('Thi công') || !(await p.$('#phaseBar .phase-step.active[aria-current=step]'))) errors.push('survey: thanh giai đoạn thiếu bước / bước hiện tại');
  if ((await p.$$('[data-survey-item]')).length !== 8) errors.push('survey: số mục checklist sai (mục đã tắt phải ẩn)');
  if (await p.$('#surveyView .field-hint b')) errors.push('survey: gợi ý mục không được escape');
  if (!(await p.textContent('#surveyProgress')).includes('0/5')) errors.push('survey: tiến độ ban đầu phải 0/5');
  if (!(await p.isVisible('#btnSurveyTemplate'))) errors.push('survey: quản trị không thấy nút Sửa mẫu');
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push('survey: cuộn ngang ở 390px');
  await shot(p, 'm-survey');
  // Gõ số → tự lưu khi rời ô (upsert, không gửi updated_by); "2.650" hiểu là 2650
  await blurFill(card('sc10') + ' [data-f=n]', '2.650');
  {
    const u = (await upserts()).pop();
    if (!u || u[2].project_id !== 'p1' || u[2].item_id !== 'sc10' || u[2].value?.n !== 2650 || u[2].na !== false || 'updated_by' in u[2] || u[3]?.onConflict !== 'project_id,item_id') errors.push('survey: gõ số không upsert đúng: ' + JSON.stringify(u));
    if (!(await status('sc10')).includes('✓') || !(await p.textContent('#surveyProgress')).includes('1/5')) errors.push('survey: lưu xong không cập nhật ✓ / tiến độ 1/5');
    if ((await p.inputValue(card('sc10') + ' [data-f=n]')) !== '2650') errors.push('survey: số đã lưu không hiện lại 2650');
  }
  // Còn thiếu → bấm chuyển: hiện danh sách thiếu, KHÔNG gửi update projects
  {
    const n0 = (await calls()).length;
    await p.click('#phaseBar [data-phase-go=design]'); await p.waitForTimeout(400);
    if ((await calls()).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects')) errors.push('survey: còn thiếu mà vẫn gửi update projects');
    const notice = await p.textContent('#surveyMissingNotice');
    if (!notice.includes('4 mục') || !notice.includes('Độ nghiêng tường') || !notice.includes('Cửa thang máy')) errors.push('survey: không hiện đủ danh sách mục thiếu: ' + notice);
    await shot(p, 'm-survey-missing');
  }
  // Số 0 là số đo hợp lệ
  await blurFill(card('sc40') + ' [data-f=n]', '0');
  if (!(await status('sc40')).includes('✓')) errors.push('survey: gõ 0 vào Độ nghiêng tường vẫn báo thiếu');
  // Nút ± cho số âm (bàn phím số iPhone không có dấu trừ)
  await blurFill(card('sc20') + ' [data-f=n]', '20');
  await p.click(card('sc20') + ' [data-action=sign]'); await p.waitForTimeout(250);
  if ((await upserts()).pop()?.[2].value?.n !== -20) errors.push('survey: nút ± không lưu số âm');
  // Gõ sai → báo ngay ở mục, không gửi
  {
    const n = (await upserts()).length;
    await blurFill(card('sc20') + ' [data-f=n]', 'abc');
    if ((await upserts()).length !== n || !(await p.isVisible(card('sc20') + ' [data-err]'))) errors.push('survey: số sai vẫn gửi / không báo lỗi');
    await blurFill(card('sc20') + ' [data-f=n]', '-20');
    await blurFill(card('sc50') + ' [data-f=w]', '0');
    if ((await upserts()).length !== n + 1 || !(await p.textContent(card('sc50') + ' [data-err]')).includes('lớn hơn 0')) errors.push('survey: rộng = 0 vẫn gửi / không báo lỗi');
    // Không áp dụng mà chưa có lý do → không gửi
    await p.click(card('sc50') + ' [data-action=na]'); await p.waitForTimeout(150);
    if ((await upserts()).length !== n + 1 || !(await p.isVisible(card('sc50') + ' [data-f=na_reason]')) || await p.isVisible(card('sc50') + ' [data-f=w]')) errors.push('survey: Không áp dụng chưa lý do vẫn gửi / không đổi ô nhập');
    await blurFill(card('sc50') + ' [data-f=na_reason]', 'Nhà phố không có thang máy');
    const u = (await upserts()).pop();
    if (u?.[2].na !== true || u[2].na_reason !== 'Nhà phố không có thang máy' || !(await status('sc50')).includes('✓')) errors.push('survey: Không áp dụng + lý do không lưu đúng');
  }
  // Mục bắt buộc ảnh: có chữ nhưng chưa có ảnh → 📷 thiếu ảnh
  await blurFill(card('sc30') + ' [data-f=t]', 'Dầm D1 220×400');
  if (!(await status('sc30')).includes('📷')) errors.push('survey: mục bắt buộc ảnh chưa có ảnh không báo 📷');
  await p.click(card('sc30') + ' [data-action=na]'); await blurFill(card('sc30') + ' [data-f=na_reason]', 'Trần phẳng, không có dầm');
  if (!(await p.textContent('#surveyProgress')).includes('5/5')) errors.push('survey: đủ hết mà tiến độ chưa 5/5');
  await shot(p, 'm-survey-done');
  // Sửa mẫu khảo sát (quản trị): hiện cả mục đã tắt, lưu = update survey_checklist_items
  await p.click('#btnSurveyTemplate'); await p.waitForTimeout(300);
  if (!(await p.isVisible('#surveyTemplateModal.show')) || (await p.$$('#surveyTemplateList .tpl-row')).length !== 9) errors.push('survey: hộp sửa mẫu không mở / thiếu mục');
  if (await p.$('#surveyTemplateModal [data-action*=delete]')) errors.push('survey: hộp sửa mẫu không được có nút xoá');
  await p.click('#surveyTemplateList .tpl-row:first-child summary');
  await p.fill('#surveyTemplateList .tpl-row:first-child [data-t=hint]', 'Đo 3 điểm, ghi số nhỏ nhất');
  await shot(p, 'm-survey-template');
  await p.click('#surveyTemplateList .tpl-row:first-child [data-action=tpl-save]'); await p.waitForTimeout(300);
  if (!(await calls()).some(c => c[0] === 'update' && c[1] === 'survey_checklist_items' && c[2].hint === 'Đo 3 điểm, ghi số nhỏ nhất' && c[2].required === true)) errors.push('survey: lưu mẫu không gửi update đúng');
  await p.click('#btnSurveyTplClose'); await p.waitForTimeout(300);
  // Khảo sát / lên phương án: khoá "＋ Thêm đội", "＋ Đầu việc" (P1 đã lỡ có đội)
  await p.click('#btnItemsListView'); await p.waitForTimeout(300);
  // aria-disabled: Playwright không bấm nút "đã khoá" → force (người dùng thật vẫn chạm được để thấy lý do)
  await p.click('#btnNewPackage', { force: true }); await p.waitForTimeout(200);
  if (await p.isVisible('#packageModal.show') || !(await p.textContent('#toast')).includes('Thi công')) errors.push('survey: nút Thêm đội không bị khoá ở Khảo sát');
  await p.click('.package-card [data-action=add-item]', { force: true }); await p.waitForTimeout(200);
  if (await p.isVisible('#itemModal.show')) errors.push('survey: nút ＋ Đầu việc không bị khoá ở Khảo sát');
  await shot(p, 'm-survey-locked');
  // Đủ → chuyển Lên phương án → Thi công (đổi giai đoạn qua giao diện, mock ghi lại phase)
  {
    const n0 = (await calls()).length;
    p.once('dialog', dlg => dlg.accept());
    await p.click('#phaseBar [data-phase-go=design]'); await p.waitForTimeout(500);
    if (!(await calls()).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects' && c[2].phase === 'design')) errors.push('survey: đủ rồi mà không chuyển sang design');
    if (!(await p.textContent('#phaseBar')).includes('Bắt đầu thi công') || !(await p.$('#phaseBar .phase-step.done'))) errors.push('survey: thanh giai đoạn không sang Lên phương án');
    await p.click('#btnNewPackage', { force: true }); await p.waitForTimeout(200);
    if (await p.isVisible('#packageModal.show')) errors.push('survey: Lên phương án vẫn thêm đội được');
    await shot(p, 'm-phase-design');
    p.once('dialog', dlg => dlg.accept());
    await p.click('#phaseBar [data-phase-go=construction]'); await p.waitForTimeout(500);
    if (!(await calls()).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects' && c[2].phase === 'construction')) errors.push('survey: không chuyển sang Thi công');
    if (!(await p.textContent('#phaseBar')).includes('Về lên phương án')) errors.push('survey: thanh giai đoạn Thi công thiếu link lùi');
    await p.click('#btnNewPackage'); await p.waitForTimeout(200);
    if (!(await p.isVisible('#packageModal.show'))) errors.push('survey: sang Thi công rồi mà Thêm đội không mở form');
    await p.click('#btnPkgCancel');
  }
}
// Đóng công trình: công trình đã đóng gom vào nhóm riêng; nút Đóng ↔ Mở lại
if (!(await p.$('#projectSelect optgroup[label^="Đã đóng"] option[value=p4]'))) errors.push('items: thiếu nhóm Đã đóng trong danh sách công trình');
if (((await p.textContent('#btnCloseProject')).trim() !== 'Đóng' || !(await p.$('#btnCloseProject img[src*="close-project"]'))) || !(await p.isHidden('#projectClosedNote'))) errors.push('items: nút Đóng sai với công trình đang chạy');
{
  const n0 = (await p.evaluate(() => window.__calls)).length;
  p.once('dialog', dlg => { if (!dlg.message().includes('chưa xong')) errors.push('items: hộp xác nhận đóng không nhắc đầu việc chưa xong'); dlg.accept(); });
  await p.click('#btnCloseProject'); await p.waitForTimeout(300);
  if (!(await p.evaluate(() => window.__calls)).slice(n0).some(c => c[0] === 'update' && c[1] === 'projects' && c[2].status === 'done')) errors.push('items: bấm Đóng không gửi status=done');
}
await p.selectOption('#projectSelect', 'p4'); await p.waitForTimeout(300);
if (((await p.textContent('#btnCloseProject')).trim() !== 'Mở lại' || !(await p.$('#btnCloseProject img[src*="reopen-project"]'))) || !(await p.isVisible('#projectClosedNote'))) errors.push('items: công trình đã đóng không hiện Mở lại / dòng nhắc');
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
// Wizard "Bắt đầu từ khảo sát" (mặc định): 1 bước, chỉ insert projects, mở thẳng view Khảo sát
{
  const n0 = (await p.evaluate(() => window.__calls)).length;
  await p.click('#btnNewProject'); await p.fill('#wzName', 'Nhà khảo sát');
  if ((await p.$$('#wizardSteps li:not([hidden])')).length !== 1 || !(await p.textContent('#btnWizardNext')).includes('Tạo công trình')) errors.push('wizard khảo sát: không còn đúng 1 bước');
  if ((await p.getAttribute('#wizardBody [data-phase=survey]', 'aria-pressed')) !== 'true') errors.push('wizard: mặc định phải là Bắt đầu từ khảo sát');
  await shot(p, 'm-wizard-survey');
  await p.click('#btnWizardNext'); await p.waitForTimeout(600);
  const ins = (await p.evaluate(() => window.__calls)).slice(n0).filter(c => c[0] === 'insert');
  if (ins.length !== 1 || ins[0][1] !== 'projects' || ins[0][2].phase !== 'survey') errors.push('wizard khảo sát: phải đúng 1 insert projects phase=survey: ' + JSON.stringify(ins.map(c => c[1])));
  if (await p.isVisible('#wizardModal.show')) errors.push('wizard khảo sát: tạo xong chưa đóng');
  if (!(await p.isVisible('#surveyView .survey-item')) || !(await p.$eval('#projectSelect', s => s.selectedOptions[0]?.textContent.includes('Nhà khảo sát')))) errors.push('wizard khảo sát: tạo xong không mở view Khảo sát của công trình mới');
}
// Wizard "Thi công ngay": 3 bước như cũ
{
  await p.click('#btnNewProject'); await p.fill('#wzName', 'Nhà test'); await p.click('#wizardBody [data-phase=construction]');
  if ((await p.$$('#wizardSteps li:not([hidden])')).length !== 3 || (await p.inputValue('#wzName')) !== 'Nhà test') errors.push('wizard thi công ngay: không đủ 3 bước / mất tên đã gõ');
  await p.click('#btnWizardNext');
}
const nWz = (await p.evaluate(() => window.__calls)).length;
await p.click('[data-add=da]'); await p.waitForTimeout(100); await p.selectOption('.wz-sub', 's1'); await shot(p, 'm-wizard2');
await p.click('#btnWizardNext'); await p.waitForTimeout(100); await shot(p, 'm-wizard3');
{ const rows = await p.$$eval('.wz-rows li', ls => ls.map(l => l.firstChild.textContent.trim()));
  if (rows.length !== new Set(rows).size) errors.push('wizard: mẫu vẫn lặp đầu việc ' + rows.join(', ')); }
await p.click('#btnWizardNext'); await p.waitForTimeout(500); await shot(p, 'm-wizard-done');
{
  const ins = (await p.evaluate(() => window.__calls)).slice(nWz).filter(c => c[0] === 'insert').map(c => c[1] + (c[1] === 'projects' ? ':' + c[2].phase : ''));
  for (const t of ['projects:construction', 'work_packages', 'work_items', 'crew_links', 'client_links']) if (!ins.includes(t)) errors.push('wizard thi công ngay: thiếu insert ' + t + ' (' + ins.join(', ') + ')');
}

p = await page('index.html?p1=construction', 1440, 900);   // luồng thi công cũ: P1 đã vào thi công
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
// Chọn nhiều đầu việc: chạm dòng = tích (không mở hộp sửa), thanh thao tác đếm đúng, Đặt ngày gọi RPC nguyên lô
for (const view of ['timeline', 'list']) {
  if (view === 'list') { await p.click('#btnItemsListView'); await p.waitForTimeout(200); }
  const tag = `chọn nhiều (${view}): `;
  await p.click('#btnSelectMode'); await p.waitForTimeout(200);
  if (!(await p.isVisible('#selectBar'))) errors.push(tag + 'không hiện thanh thao tác');
  if (!(await p.$eval('#btnSelDates', b => b.disabled))) errors.push(tag + 'chưa chọn mà nút vẫn bấm được');
  const rowSel = view === 'timeline' ? '.timeline-row' : '.select-row';
  const rows = await p.$$(rowSel);
  if (rows.length < 2) { errors.push(tag + 'cần >= 2 dòng, có ' + rows.length); }
  else {
    await p.locator(rowSel).nth(0).click(); await p.waitForTimeout(100); await p.locator(rowSel).nth(1).click(); await p.waitForTimeout(150);
    if (await p.isVisible('#itemModal.show')) errors.push(tag + 'chạm dòng lại mở hộp sửa');
    if (!(await p.textContent('#selectCount')).includes('2')) errors.push(tag + 'đếm sai: ' + await p.textContent('#selectCount'));
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push(tag + 'cuộn ngang');
    await shot(p, 'd-select-' + view);
    await p.click('#btnSelDates'); await p.waitForTimeout(150);
    await p.fill('#setDatesStart', '2026-10-05');
    await p.click('#btnSetDatesSave'); await p.waitForTimeout(400);
    const c = (await p.evaluate(() => window.__calls)).filter(x => x[0] === 'rpc' && x[1] === 'set_items_schedule').pop();
    if (!c || c[2].p_item_ids.length !== 2 || c[2].p_start !== '2026-10-05' || c[2].p_end !== null) errors.push(tag + 'Đặt ngày gửi sai: ' + JSON.stringify(c));
    if (await p.isVisible('#selectBar')) errors.push(tag + 'xong rồi vẫn ở chế độ chọn');
  }
}
await p.click('#btnItemsTimelineView');
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
// Timeline chủ nhà: chỉ đọc, không nút bấm, có giai đoạn chưa có lịch, không cuộn ngang
{
  const q = await page('client.html?t=ok', 375, 800);
  await q.waitForSelector('#clientStageList .timeline-row', { timeout: 3000 }).catch(() => errors.push('client: không vẽ timeline giai đoạn'));
  if ((await q.$$('#clientStageList .timeline-row')).length !== 2) errors.push('client: timeline phải có đúng 2 giai đoạn đã lên lịch');
  if ((await q.$$('#clientStageList button')).length) errors.push('client: timeline chủ nhà không được có nút bấm');
  if (!(await q.textContent('#clientStageList')).includes('Chưa có lịch (1)')) errors.push('client: thiếu nhóm "Chưa có lịch"');
  if (await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push('client: timeline gây cuộn ngang ở 375px');
  await shot(q, 'client-timeline');
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

// View Khảo sát ở máy tính + chế độ tối (P1 mặc định đang khảo sát)
for (const [w, h, scheme, tag] of [[1440, 900, 'light', 'd'], [390, 844, 'dark', 'dk-m'], [1440, 900, 'dark', 'dk-d']]) {
  const q = await page('index.html', w, h, scheme);
  await q.click('#nav-items'); await q.waitForTimeout(500);
  if (!(await q.isVisible('#surveyView .survey-item'))) errors.push(`survey (${tag}): không mở view Khảo sát`);
  if (await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push(`survey (${tag}): cuộn ngang`);
  await shot(q, tag + '-survey');
  await q.click('#nav-dashboard'); await q.waitForTimeout(400); await shot(q, tag + '-dashboard-survey');
  await q.context().close();
}

console.log('ERRORS:\n' + errors.join('\n'));
process.exitCode = errors.length ? 1 : 0;
await browser.close();
