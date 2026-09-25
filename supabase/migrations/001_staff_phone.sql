-- ============================================================
-- Số điện thoại nhân viên (hộp "Cài đặt tài khoản" + nút Zalo ở danh
-- sách "Ai phụ trách"). Chỉ thêm cột, không đụng dữ liệu cũ — chạy
-- trong Supabase > SQL Editor > New query > Run. Đã gộp vào schema.sql.
-- ============================================================
alter table staff add column if not exists phone text;
alter table staff drop constraint if exists staff_phone_check;
alter table staff add constraint staff_phone_check check (phone is null or phone ~ '^0[0-9]{9}$');

-- Vẫn chỉ tự sửa được dòng của mình (policy "staff update own profile");
-- role vẫn chỉ đổi qua set_staff_role().
grant update (full_name, phone) on staff to authenticated;
