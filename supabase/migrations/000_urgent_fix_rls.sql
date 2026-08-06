-- ============================================================
-- VÁ KHẨN CẤP — chạy ngay trong Supabase > SQL Editor > New query > Run
-- nếu đã deploy bản mda-crm-pwa cũ và có thể đã gửi link cho khách.
--
-- Lỗ hổng: policy "public read projects" / "public read tasks" dùng
-- `using (true)` nghĩa là AI CŨNG đọc được TOÀN BỘ bảng projects/tasks
-- bằng anon key công khai trong config.js — kể cả share_token của
-- khách hàng khác. Migration này chặn ngay, không chờ viết lại app mới.
--
-- Sau khi chạy: link share cũ (?share=...) trên app cũ sẽ NGỪNG hoạt
-- động (client không đăng nhập không còn đọc được projects/tasks nữa).
-- Đây là đánh đổi chấp nhận được cho tới khi app mới (client.html qua
-- RPC client_view) lên thay thế.
-- ============================================================

drop policy if exists "public read projects" on projects;
drop policy if exists "public read tasks" on tasks;

-- Không tạo policy read thay thế ở đây — app cũ không cần nữa vì sắp
-- được thay bằng client.html + RPC client_view() trong bản mới.
