// Giả lập supabase-js cho kiểm thử giao diện (không mạng, không đụng DB thật).
// tests/ui/smoke.mjs thay vendor/supabase-js bằng file này khi chạy.
(function () {
  const today = new Date().toISOString().slice(0, 10);
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const P1 = 'p1', P2 = 'p2';
  const items = [
    { id: 'i1', work_package_id: 'wp1', name: 'Lắp đá mặt bếp', seq: 1, unit: 'm2', qty_plan: 12, qty_done: 5, percent: 42, status: 'delayed', planned_start: d(-5), planned_end: d(2) },
    { id: 'i2', work_package_id: 'wp1', name: 'Mài, đánh bóng', seq: 2, unit: 'm2', qty_plan: 12, qty_done: 0, percent: 0, status: 'notStarted', planned_start: d(3), planned_end: d(5) },
    { id: 'i3', work_package_id: 'wp2', name: 'Kéo dây, đấu hộp', seq: 1, unit: 'diem', qty_plan: 40, qty_done: 40, percent: 100, status: 'done', planned_start: d(-10), planned_end: d(-3) },
    { id: 'i4', work_package_id: 'wp1', name: 'Nghiệm thu', seq: 3, unit: 'tron_goi', qty_plan: null, qty_done: 0, percent: 0, status: 'notStarted', planned_start: d(6), planned_end: d(6) },
  ];
  const tables = {
    staff: [{ id: 'u1', full_name: 'Quang (Quản trị)', role: 'admin' }, { id: 'u2', full_name: 'KTS Lan', role: 'kts', phone: '0912345678' }],
    project_members: [{ project_id: P1, staff_id: 'u2' }],
    projects: [
      { id: P1, name: 'Nhà anh Minh — Ocean Park', client_name: 'Anh Minh', start_date: d(-20), end_date: d(25), status: 'active', created_at: '2026-09-01' },
      { id: P2, name: 'Căn hộ chị Hoa', client_name: 'Chị Hoa', start_date: d(-40), end_date: d(-2), status: 'active', created_at: '2026-08-01' }],
    subcontractors: [{ id: 's1', name: 'Đội đá Sơn', trade: 'da', active: true }, { id: 's2', name: 'Điện Hùng', trade: 'dien', active: true }],
    work_package_templates: [{ id: 't1', trade: 'da', name: 'Thi công đá — mẫu chuẩn' }],
    work_package_template_items: [
      { id: 'ti1', template_id: 't1', name: 'Khảo sát', seq: 1, unit: 'm2', default_duration_days: 1 },
      { id: 'ti1b', template_id: 't1', name: 'Khảo sát', seq: 1, unit: 'm2', default_duration_days: 1 }, // mẫu bị seed 2 lần
      { id: 'ti2', template_id: 't1', name: 'Lắp đặt', seq: 2, unit: 'm2', default_duration_days: 3 },
      { id: 'ti2b', template_id: 't1', name: 'Lắp đặt', seq: 2, unit: 'm2', default_duration_days: 3 }],
    work_packages: [
      { id: 'wp1', project_id: P1, subcontractor_id: 's1', trade: 'da', name: 'Đá bếp', unit: 'm2', contract_qty: 12, planned_start: d(-5), planned_end: d(5), status: 'delayed', created_at: '1', subcontractors: { id: 's1', name: 'Đội đá Sơn', trade: 'da' }, work_items: [items[0], items[1], items[3]] },
      { id: 'wp2', project_id: P1, subcontractor_id: 's2', trade: 'dien', name: 'Điện', unit: 'diem', contract_qty: 40, planned_start: d(-10), planned_end: d(-3), status: 'done', created_at: '2', subcontractors: { id: 's2', name: 'Điện Hùng', trade: 'dien' }, work_items: [items[2]] }],
    progress_reports: [
      { id: 'r1', work_item_id: 'i1', report_date: today, reporter_name: 'anh Sơn', qty_delta: 2, crew_size: 3, note: 'Lắp xong khu bếp chính', photos: [{ path: 'p1/s1/a.jpg' }, { path: 'p1/s1/b.jpg' }], status: 'pending', created_at: new Date(Date.now() - 3 * 3600e3).toISOString(),
        work_items: { id: 'i1', name: 'Lắp đá mặt bếp', unit: 'm2', qty_plan: 12, qty_done: 5, work_package_id: 'wp1', work_packages: { project_id: P1, name: 'Đá bếp', subcontractor_id: 's1', subcontractors: { name: 'Đội đá Sơn' }, projects: { name: 'Nhà anh Minh — Ocean Park' } } } },
      { id: 'r2', work_item_id: 'i1', report_date: today, reporter_name: 'Tuấn', qty_delta: 1.5, crew_size: 2, note: 'Cắt đá đảo bếp', photos: [{ path: 'p1/s1/c.jpg' }], status: 'pending', created_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
        work_items: { id: 'i1', name: 'Lắp đá mặt bếp', unit: 'm2', qty_plan: 12, qty_done: 5, work_package_id: 'wp1', work_packages: { project_id: P1, name: 'Đá bếp', subcontractor_id: 's1', subcontractors: { name: 'Đội đá Sơn' }, projects: { name: 'Nhà anh Minh — Ocean Park' } } } },
      // Thêm nhóm 4 ảnh và 6 ảnh để kiểm bố cục khung ảnh (lưới 2×2 / slide)
      { id: 'r3', work_item_id: 'i2', report_date: today, reporter_name: 'anh Sơn', qty_delta: 3, crew_size: 2, note: 'Mài thô xong khu bếp', photos: ['d', 'e', 'f', 'g'].map(n => ({ path: `p1/s1/${n}.jpg` })), status: 'pending', created_at: new Date(Date.now() - 1 * 3600e3).toISOString(),
        work_items: { id: 'i2', name: 'Mài, đánh bóng', unit: 'm2', qty_plan: 12, qty_done: 0, work_package_id: 'wp1', work_packages: { project_id: P1, name: 'Đá bếp', subcontractor_id: 's1', subcontractors: { name: 'Đội đá Sơn' }, projects: { name: 'Nhà anh Minh — Ocean Park' } } } },
      { id: 'r4', work_item_id: 'i3', report_date: today, reporter_name: 'Điện Hùng', qty_delta: 4, crew_size: 2, note: 'Đấu hộp tầng 2', photos: ['h', 'i', 'j', 'k', 'l', 'm'].map(n => ({ path: `p1/s2/${n}.jpg` })), status: 'pending', created_at: new Date(Date.now() - 0.5 * 3600e3).toISOString(),
        work_items: { id: 'i3', name: 'Kéo dây, đấu hộp', unit: 'diem', qty_plan: 40, qty_done: 36, work_package_id: 'wp2', work_packages: { project_id: P1, name: 'Điện', subcontractor_id: 's2', subcontractors: { name: 'Điện Hùng' }, projects: { name: 'Nhà anh Minh — Ocean Park' } } } }],
    issues: [{ id: 'is1', project_id: P1, kind: 'material', description: 'Thiếu keo dán đá, cần gấp', photos: [{ path: 'p1/s1/x.jpg' }], is_blocking: true, status: 'open', raised_by_name: 'anh Sơn', created_at: new Date(Date.now() - 26 * 3600e3).toISOString(), projects: { name: 'Nhà anh Minh — Ocean Park' }, work_items: { name: 'Lắp đá mặt bếp' } }],
    alerts: [{ id: 'a1', project_id: P2, severity: 'critical', kind: 'forecast_delay', message: '"Ốp đá lavabo" đã quá hạn 2 ngày', created_at: new Date().toISOString(), projects: { name: 'Căn hộ chị Hoa' } }],
    crew_links: [{ id: 'cl1', token: 'abc', project_id: P1, subcontractor_id: 's1', person_name: 'anh Sơn', role: 'manager', created_at: '2026-09-10T00:00:00Z', last_used_at: new Date().toISOString() }],
    client_links: [], dependencies: [], photo_archive: []
  };
  const act = Array.from({ length: 14 }, (_, i) => ({ d: d(i - 13), submitted: [2, 3, 0, 5, 4, 6, 1, 0, 3, 4, 7, 5, 2, 3][i], approved: [2, 2, 0, 4, 4, 5, 1, 0, 3, 3, 6, 4, 1, 0][i] }));
  const rpcs = {
    dashboard_summary: { today, projects: [
      { id: P1, name: 'Nhà anh Minh — Ocean Park', client_name: 'Anh Minh', end_date: d(25), days_left: 25, is_mine: true, actual_pct: 48, planned_pct: 62, gap: 14, item_count: 3, done_items: 1, delayed_items: 1, pending_reports: 2, open_issues: 1, blocking_issues: 1, critical_alerts: 0, warning_alerts: 1, last_report_date: today,
        packages: [{ id: 'wp1', name: 'Đá bếp', trade: 'da', sub_name: 'Đội đá Sơn', actual_pct: 21, planned_pct: 60, delayed_items: 1, top_alert: 'plan_deviation' }, { id: 'wp2', name: 'Điện', trade: 'dien', sub_name: 'Điện Hùng', actual_pct: 100, planned_pct: 100, delayed_items: 0 }] },
      { id: P2, name: 'Căn hộ chị Hoa', client_name: 'Chị Hoa', end_date: d(-2), days_left: -2, is_mine: false, actual_pct: 91, planned_pct: 100, gap: 9, item_count: 8, done_items: 7, delayed_items: 1, pending_reports: 0, open_issues: 0, blocking_issues: 0, critical_alerts: 1, warning_alerts: 0, last_report_date: d(-4), packages: [] }],
      subcontractors: [{ id: 's1', name: 'Đội đá Sơn', trade: 'da', projects: 2, delayed_items: 2, idle_items: 1, reports_30d: 14, rejected_30d: 2 }], activity: act },
    crew_bootstrap: { crew_link_id: 'cl1', project: { id: P1, name: 'Nhà anh Minh — Ocean Park' }, subcontractor: { id: 's1', name: 'Đội đá Sơn', trade: 'da' }, person_name: 'anh Sơn', role: 'manager', work_items: items.map(i => ({ ...i })) },
    crew_my_reports: [{ id: 'r9', work_item_id: 'i1', work_item_name: 'Lắp đá mặt bếp', report_date: d(-1), qty_delta: 2, crew_size: 3, note: 'lắp mặt bếp', photos: [], status: 'rejected', reject_reason: 'Ảnh không rõ', created_at: new Date().toISOString() }],
    approve_report_group: 3.5, compute_alerts: 0, crew_submit: 'new-report-id'
  };
  window.__calls = [];
  function builder(table) {
    let rows = (tables[table] || []).slice(); let op = 'select'; let payload = null; let single = false; let head = false;
    const b = {
      select(_c, opts) { if (opts?.head) head = true; return b; },
      eq(col, v) { if (!col.includes('.')) rows = rows.filter(r => !(col in r) || r[col] === v); return b; },
      is(col, v) { rows = rows.filter(r => (r[col] ?? null) === v); return b; },
      in(col, vs) { rows = rows.filter(r => !(col in r) || vs.includes(r[col])); return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; }, limit() { return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      insert(p) { op = 'insert'; payload = p; window.__calls.push(['insert', table, p]); return b; },
      update(p) { op = 'update'; payload = p; window.__calls.push(['update', table, p]); return b; },
      delete() { op = 'delete'; window.__calls.push(['delete', table]); return b; },
      upsert(p) { op = 'upsert'; payload = p; return b; },
      then(res, rej) {
        let data = rows;
        if (op === 'insert') data = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: 'new-' + Math.random().toString(36).slice(2, 7), token: 'tok' + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString(), ...p }));
        if (single) data = data[0] || null;
        return Promise.resolve({ data: head ? null : data, error: null, count: rows.length }).then(res, rej);
      }
    };
    return b;
  }
  window.supabase = { createClient() { return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'quang@x.vn' } } } }), signOut: async () => ({}) },
    from: builder,
    rpc: async (name, args) => { window.__calls.push(['rpc', name, args]); return { data: rpcs[name] ?? null, error: null }; },
    channel() { const c = { on() { return c; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return c; } }; return c; },
    storage: { from() { return {
      // Mỗi path một màu + chữ riêng để nhìn ra ảnh nào đang hiện trong slide/lightbox
      createSignedUrl: async (path) => {
        const n = path.split('/').pop().replace('.jpg', ''); const hue = [...n].reduce((a, c) => a + c.charCodeAt(0) * 47, 0) % 360;
        return { data: { signedUrl: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue} 35% 62%)"/><text x="200" y="170" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${n}</text></svg>`) }, error: null };
      },
      uploadToSignedUrl: async () => ({ error: null }), upload: async () => ({ error: null }) }; } },
    functions: { invoke: async (n) => ({ data: { paths: ['p1/s1/x.jpg', 'p1/s1/x-thumb.jpg'], tokens: ['a', 'b'] }, error: null }) }
  }; } };
})();
