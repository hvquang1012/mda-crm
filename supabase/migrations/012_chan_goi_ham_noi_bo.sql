-- ============================================================
-- VÁ KHẨN: CHẶN NGƯỜI KHÔNG ĐĂNG NHẬP GỌI HÀM NỘI BỘ — chạy SAU 010.
-- Chạy NGAY trên project thật. Phải chạy TRƯỚC 011_khao_sat.sql (011 tự cấp
-- quyền cho hàm mới của nó; chạy 012 sau 011 sẽ thu hồi mất survey_missing).
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống y hệt đoạn tương ứng trong schema.sql.)
--
-- Lỗi: Supabase cấp sẵn quyền gọi mọi hàm mới cho anon + authenticated;
-- schema chỉ thu hồi khỏi PUBLIC nên anon key công khai gọi được
-- messages_to_notify (nội dung tin nhắn), reports_to_notify,
-- dropbox_missing_copies (tên công trình, đường dẫn ảnh),
-- mark_reports_notified / mark_messages_notified / dropbox_expire_uploads (ghi).
-- Sửa: thu hồi hết, cấp lại đúng danh sách hàm app đang dùng.
-- ============================================================
begin;

-- QUYỀN GỌI HÀM. Postgres tự cấp EXECUTE cho PUBLIC khi tạo hàm, VÀ
-- Supabase có quyền mặc định cấp EXECUTE TƯỜNG MINH cho anon,
-- authenticated (không qua PUBLIC) — nên "revoke ... from public" một mình
-- KHÔNG đủ: bản trước để anon gọi được messages_to_notify (lộ nội dung tin
-- nhắn), dropbox_missing_copies, mark_reports_notified... bằng anon key.
-- Thu hồi tường minh khỏi public, anon, authenticated trên MỌI hàm (trừ hàm
-- của extension), rồi cấp lại đúng từng hàm ở danh sách bên dưới.
-- Hàm tạo sau này cũng không tự được cấp cho ai.
alter default privileges for role postgres revoke execute on functions from public;   -- dạng toàn cục: dạng theo schema không gỡ được PUBLIC
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;
-- Bảng chỉ hàm security definer / Edge Function ghi: authenticated không
-- có quyền gì (RLS cũng chặn, đây là lớp thứ hai).
revoke all on report_notifications from anon, authenticated;

-- Cấp lại đúng từng hàm (y hệt danh sách trong schema.sql)
grant execute on function crew_bootstrap(text) to anon, authenticated;
grant execute on function crew_submit(text, uuid, numeric, int, text, jsonb, text, date, uuid) to anon, authenticated;
grant execute on function crew_my_reports(text) to anon, authenticated;
grant execute on function crew_raise_issue(text, uuid, text, text, jsonb, boolean, text) to anon, authenticated;
grant execute on function client_view(text) to anon, authenticated;
grant execute on function approve_report(uuid, numeric) to authenticated;
grant execute on function reject_report(uuid, text) to authenticated;
grant execute on function approve_report_group(uuid[], numeric) to authenticated;
grant execute on function reject_report_group(uuid[], text) to authenticated;
grant execute on function compute_alerts() to authenticated; -- nút "Kiểm tra ngay" thủ công
grant execute on function dashboard_summary() to authenticated;
grant execute on function set_staff_role(uuid, text) to authenticated;
grant execute on function shift_package_schedule(uuid, int) to authenticated;
grant execute on function shift_items_schedule(uuid[], int) to authenticated;
grant execute on function set_items_schedule(uuid[], date, date) to authenticated;
grant execute on function is_manager() to authenticated;
grant execute on function can_access_project(uuid) to authenticated;
grant execute on function _package_project(uuid) to authenticated;
grant execute on function _item_project(uuid) to authenticated;
grant execute on function _path_project(text) to authenticated;
grant execute on function dropbox_expire_uploads() to service_role;
grant execute on function dropbox_moves_due(int) to service_role;
grant execute on function dropbox_missing_copies(int) to service_role;
grant execute on function reports_to_notify(interval) to service_role;
grant execute on function mark_reports_notified(uuid[]) to service_role;
grant execute on function notify_due() to service_role;
grant execute on function crew_messages(text, uuid, timestamptz) to anon, authenticated;
grant execute on function crew_send_message(text, uuid, text, jsonb, text, uuid) to anon, authenticated;
grant execute on function chat_inbox() to authenticated;
grant execute on function chat_mark_read(uuid) to authenticated;
grant execute on function messages_to_notify(interval) to service_role;
grant execute on function mark_messages_notified(uuid[]) to service_role;

commit;
