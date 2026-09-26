-- ============================================================
-- ĐẦU VIỆC "XONG" → ĐÓNG CẢNH BÁO CŨ + CẬP NHẬT HẠNG MỤC NGAY
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
--
-- Lỗi: cảnh báo "dự báo trễ" sinh lúc đầu việc đang làm dở vẫn treo mãi
-- sau khi đầu việc đã xong → công trình xong hết vẫn "🔴 Cần xử lý".
-- (Giống đoạn tương ứng trong schema.sql.)
-- ============================================================
begin;

create or replace function _on_item_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' then
    update alerts set acknowledged_at = now(), acknowledged_by = auth.uid()
    where work_item_id = new.id and acknowledged_at is null;
  end if;
  perform _refresh_package_status(new.work_package_id);
  return null;
end;
$$;

drop trigger if exists trg_work_items_status on work_items;
create trigger trg_work_items_status after update of status on work_items
  for each row when (new.status is distinct from old.status)
  execute function _on_item_status_change();

-- Dọn cảnh báo treo của đầu việc đã xong từ trước
update alerts a set acknowledged_at = now()
from work_items wi
where wi.id = a.work_item_id and wi.status = 'done' and a.acknowledged_at is null;

commit;
