// Trạng thái dùng chung giữa các module màn hình nhân viên (tránh vòng
// lặp import — mỗi module chỉ đọc/ghi qua object này).
export const state = {
  supabase: null,
  user: null,
  profile: {},           // dòng staff của người đang đăng nhập (full_name, phone…)
  staffRole: 'kts',       // kts | manager | admin — đọc từ bảng staff lúc đăng nhập
  projects: [],           // toàn bộ dự án thấy được, dùng cho dashboard + project switcher
  subcontractors: [],
  templates: [],          // mẫu đầu việc kèm items — items.js nạp, wizard.js dùng chung
  currentProjectId: null, // dự án đang chọn ở tab "Công việc"
  itemsView: 'list',      // list | timeline — giữ khi realtime render lại
  activeTab: 'dashboard',
  pendingCount: 0,        // số báo cáo chờ duyệt — hiện chấm đỏ ở bottom nav
  openIssuesCount: 0,     // số vướng mắc chưa xử lý — chấm đỏ tab "Cần xử lý"
  approvalsProjectFilter: '', // lọc hộp duyệt theo công trình ('' = tất cả)
  dashboardScope: 'all',  // all | mine — bộ lọc dashboard cho KTS
  chatUnread: {},         // work_item_id → số tin chưa đọc (chat.js nạp, items.js vẽ nút 💬)
  chatUnreadTotal: 0,
  // chat.js gán — tab Công việc mở luồng trò chuyện mà không import chat.js
  openChat: async (_itemId) => {},
  // main.js gán hàm chuyển tab vào đây để dashboard mở tab khác mà
  // không import chéo giữa các module tab.
  navigate: async (_tab) => {}
};

export function isManager() { return state.staffRole === 'manager' || state.staffRole === 'admin'; }
