// ============================================================
// Xuất khối lượng nghiệm thu luỹ kế theo kỳ ra CSV (mở được trực tiếp
// bằng Excel, giữ đúng dấu tiếng Việt nhờ BOM UTF-8). Không vendor
// thư viện .xlsx (~900KB) cho một thao tác xuất số liệu đơn giản —
// nếu sau này cần định dạng .xlsx thật (nhiều sheet, công thức), có
// thể thêm SheetJS mà không đổi cấu trúc dữ liệu ở đây.
// ============================================================
import { state } from './state.js';
import { showToast } from '../ui.js';

export function wireExportButton() {
  const btn = document.getElementById('btnExportCsv');
  if (!btn) return;
  btn.onclick = doExport;
}

async function doExport() {
  const from = document.getElementById('exportFrom').value;
  const to = document.getElementById('exportTo').value;
  if (!from || !to) { showToast('Chọn khoảng ngày trước', true); return; }
  if (!state.currentProjectId) { showToast('Chưa chọn dự án', true); return; }

  const { data, error } = await state.supabase
    .from('progress_reports')
    .select('approved_qty, report_date, work_items(name, unit, work_package_id, work_packages(name, project_id, subcontractors(name)))')
    .eq('status', 'approved')
    .gte('report_date', from)
    .lte('report_date', to);

  if (error) { showToast('Không xuất được — lỗi tải dữ liệu', true); return; }

  const rows = (data || []).filter(r => r.work_items?.work_packages?.project_id === state.currentProjectId);
  if (!rows.length) { showToast('Không có dữ liệu đã duyệt trong khoảng ngày này', true); return; }

  const totals = new Map(); // key: work_item id-ish (dùng tên ghép vì không select id) -> tổng
  rows.forEach(r => {
    const wp = r.work_items.work_packages;
    const key = [wp.subcontractors?.name, wp.name, r.work_items.name].join('|');
    if (!totals.has(key)) {
      totals.set(key, {
        subcontractor: wp.subcontractors?.name || '', package: wp.name,
        item: r.work_items.name, unit: r.work_items.unit, qty: 0
      });
    }
    totals.get(key).qty += Number(r.approved_qty || 0);
  });

  const projectName = state.projects.find(p => p.id === state.currentProjectId)?.name || '';
  const header = ['Dự án', 'Đội thầu phụ', 'Hạng mục', 'Đầu việc', 'Đơn vị', 'Khối lượng đã nghiệm thu', 'Từ ngày', 'Đến ngày'];
  const lines = [header, ...[...totals.values()].map(t => [
    projectName, t.subcontractor, t.package, t.item, unitLabel(t.unit), t.qty, from, to
  ])];

  const csv = lines.map(row => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nghiem-thu_${projectName.replace(/[^a-zA-Z0-9]+/g, '-')}_${from}_${to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Đã xuất file — mở bằng Excel');
}

function unitLabel(u) { return { m2: 'm²', diem: 'điểm', md: 'md', tron_goi: 'trọn gói' }[u] || u; }
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
