// ============================================================
// Xuất khối lượng nghiệm thu luỹ kế theo kỳ ra CSV (mở được trực tiếp
// bằng Excel, giữ đúng dấu tiếng Việt nhờ BOM UTF-8). Không vendor
// thư viện .xlsx (~900KB) cho một thao tác xuất số liệu đơn giản —
// nếu sau này cần định dạng .xlsx thật (nhiều sheet, công thức), có
// thể thêm SheetJS mà không đổi cấu trúc dữ liệu ở đây.
// ============================================================
import { state } from './state.js';
import { showToast, unitLabel } from '../ui.js';

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

  // Lọc công trình ngay ở server (!inner) — trước đây tải hết báo cáo đã
  // duyệt của mọi công trình rồi lọc ở máy.
  const { data, error } = await state.supabase
    .from('progress_reports')
    .select('approved_qty, report_date, work_items!inner(id, name, unit, seq, work_packages!inner(name, project_id, subcontractors(name)))')
    .eq('status', 'approved')
    .eq('work_items.work_packages.project_id', state.currentProjectId)
    .gte('report_date', from)
    .lte('report_date', to);

  if (error) { showToast('Không xuất được — lỗi tải dữ liệu', true); return; }

  const rows = data || [];
  if (!rows.length) { showToast('Không có dữ liệu đã duyệt trong khoảng ngày này', true); return; }

  // Gộp theo id đầu việc — gộp theo tên (bản trước) cộng sai khi hai đầu
  // việc trùng tên trong cùng hạng mục.
  const totals = new Map();
  rows.forEach(r => {
    const wi = r.work_items;
    const wp = wi.work_packages;
    if (!totals.has(wi.id)) {
      totals.set(wi.id, {
        subcontractor: wp.subcontractors?.name || '', package: wp.name,
        item: wi.name, seq: wi.seq || 0, unit: wi.unit, qty: 0
      });
    }
    totals.get(wi.id).qty += Number(r.approved_qty || 0);
  });

  const projectName = state.projects.find(p => p.id === state.currentProjectId)?.name || '';
  const header = ['Dự án', 'Đội thầu phụ', 'Hạng mục', 'Đầu việc', 'Đơn vị', 'Khối lượng đã nghiệm thu', 'Từ ngày', 'Đến ngày'];
  const sorted = [...totals.values()].sort((a, b) =>
    a.subcontractor.localeCompare(b.subcontractor, 'vi') || a.package.localeCompare(b.package, 'vi') || a.seq - b.seq);
  const lines = [header, ...sorted.map(t => [
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

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
