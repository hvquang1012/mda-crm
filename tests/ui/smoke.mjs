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
async function page(url, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
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
await p.click('#nav-approvals'); await p.waitForTimeout(400); await shot(p, 'm-approvals');
await p.click('[data-action=reject]'); await p.waitForTimeout(200); await shot(p, 'm-reject'); await p.click('#btnRejectCancel');
await p.click('[data-action=approve]'); await p.waitForTimeout(300);
console.log('calls', JSON.stringify((await p.evaluate(() => window.__calls)).filter(c => c[0] === 'rpc' && c[1] !== 'dashboard_summary')));
await p.click('#nav-alerts'); await p.waitForTimeout(400); await shot(p, 'm-alerts');
await p.click('#nav-items'); await p.waitForTimeout(400); await shot(p, 'm-items');
await p.click('[data-action=toggle-edit]'); await p.waitForTimeout(200); await shot(p, 'm-items-edit');
await p.click('[data-action=paste-items]'); await p.fill('#pasteInput', 'Tên\tĐơn vị\tKL\nLắp lavabo\tđiểm\t3\t5/10/2026\t6/10/2026\nỐp tường\tm2\tabc\t1/1/2026\nCắt đá\tm²\t4,5\t2026-10-01'); await p.waitForTimeout(200); await shot(p, 'm-paste'); await p.click('#btnPasteCancel');
await p.click('[data-action=crew-link]'); await p.waitForTimeout(300); await shot(p, 'm-links'); await p.click('#btnCrewLinkCancel');
await p.click('#btnNewProject'); await p.fill('#wzName', 'Nhà test'); await p.click('#btnWizardNext');
await p.click('[data-add=da]'); await p.waitForTimeout(100); await p.selectOption('.wz-sub', 's1'); await shot(p, 'm-wizard2');
await p.click('#btnWizardNext'); await p.waitForTimeout(100); await shot(p, 'm-wizard3');
await p.click('#btnWizardNext'); await p.waitForTimeout(500); await shot(p, 'm-wizard-done');

p = await page('index.html', 1440, 900);
await shot(p, 'd-dashboard');
await p.click('[data-open-project]'); await p.waitForTimeout(500); await shot(p, 'd-timeline');
await p.click('#btnMembers'); await p.waitForTimeout(300); await shot(p, 'd-members');

p = await page('crew.html?t=abc', 390, 844);
await shot(p, 'c-list');
await p.click('.crew-item-card'); await p.waitForTimeout(400);
await p.click('#crewQtyChips .chip[data-set]'); await p.click('#crewNoteChips .chip');
await shot(p, 'c-form');
await p.click('[data-tab=history]'); await p.waitForTimeout(400); await shot(p, 'c-history');
await p.click('.resend-btn'); await p.waitForTimeout(300); await shot(p, 'c-resend');
await p.click('#btnRaiseIssue'); await p.waitForTimeout(200); await shot(p, 'c-issue');

console.log('ERRORS:\n' + errors.join('\n'));
process.exitCode = errors.length ? 1 : 0;
await browser.close();
