// Trạng thái dùng chung giữa các module màn hình nhân viên (tránh vòng
// lặp import — mỗi module chỉ đọc/ghi qua object này).
export const state = {
  supabase: null,
  user: null,
  staffRole: 'kts',       // kts | manager | admin — đọc từ bảng staff lúc đăng nhập
  projects: [],           // toàn bộ dự án thấy được, dùng cho dashboard + project switcher
  subcontractors: [],
  currentProjectId: null, // dự án đang chọn ở tab "Công việc"
  itemsView: 'list',      // list | timeline — giữ khi realtime render lại
  activeTab: 'dashboard',
  pendingCount: 0,        // số báo cáo chờ duyệt — hiện chấm đỏ ở bottom nav
  openIssuesCount: 0,     // số vướng mắc chưa xử lý — chấm đỏ tab "Cần xử lý"
  approvalsProjectFilter: '', // lọc hộp duyệt theo công trình ('' = tất cả)
  dashboardScope: 'all',  // all | mine — bộ lọc dashboard cho KTS
  // main.js gán hàm chuyển tab vào đây để dashboard mở tab khác mà
  // không import chéo giữa các module tab.
  navigate: async (_tab) => {}
};

export function isManager() { return state.staffRole === 'manager' || state.staffRole === 'admin'; }
