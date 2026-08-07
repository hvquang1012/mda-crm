// Trạng thái dùng chung giữa các module màn hình nhân viên (tránh vòng
// lặp import — mỗi module chỉ đọc/ghi qua object này).
export const state = {
  supabase: null,
  user: null,
  staffRole: 'staff',
  projects: [],           // toàn bộ dự án active, dùng cho dashboard + project switcher
  subcontractors: [],
  currentProjectId: null, // dự án đang chọn ở tab "Công việc"
  activeTab: 'dashboard'
};
