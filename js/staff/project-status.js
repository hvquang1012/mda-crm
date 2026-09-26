// ============================================================
// Đóng / mở lại công trình — dùng chung cho tab Công việc và Tổng quan
// (module phụ, như wizard.js — không import chéo giữa các tab).
// Công trình đã đóng (status 'done'): ẩn khỏi Tổng quan, không sinh cảnh
// báo mới, cảnh báo đang mở tự đóng (trigger trg_projects_status).
// Dữ liệu giữ nguyên, mở lại được bất cứ lúc nào.
// ============================================================
import { state } from './state.js';
import { db } from '../ui.js';

// openItems: số đầu việc chưa xong (để nhắc trước khi đóng). Trả true nếu đã đổi.
export async function setProjectStatus(project, close, openItems = 0) {
  const msg = close
    ? `Đóng công trình "${project.name}"?\n\nCông trình sẽ ẩn khỏi Tổng quan và không còn cảnh báo. Dữ liệu, ảnh, báo cáo giữ nguyên — mở lại được bất cứ lúc nào.`
      + (openItems ? `\n\n⚠ Còn ${openItems} đầu việc chưa xong.` : '')
    : `Mở lại công trình "${project.name}"? Công trình sẽ hiện lại ở Tổng quan.`;
  if (!confirm(msg)) return false;
  const { error } = await db(
    state.supabase.from('projects').update({ status: close ? 'done' : 'active' }).eq('id', project.id),
    { successMsg: close ? 'Đã đóng công trình' : 'Đã mở lại công trình' });
  return !error;
}
