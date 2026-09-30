-- ============================================================
-- SỬA NHIỀU ĐẦU VIỆC CÙNG LÚC — chạy SAU 009_timeline_chu_nha.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống đoạn tương ứng trong schema.sql.)
-- ============================================================
begin;

-- ============================================================
-- SỬA NHIỀU ĐẦU VIỆC CÙNG LÚC (chọn một số đầu việc, không phải cả hạng mục).
-- security invoker: RLS quyết định ai sửa được. Một câu lệnh = một giao dịch —
-- có id không sửa được (công trình không phụ trách / id sai) thì hoàn tác cả lô.
-- ============================================================
create or replace function shift_items_schedule(p_item_ids uuid[], p_days int)
returns void
language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 or p_days is null or p_days = 0 then return; end if;
  if abs(p_days) > 365 then raise exception 'invalid_shift'; end if;
  update work_items set planned_start = planned_start + p_days, planned_end = planned_end + p_days
    where id = any(p_item_ids);
  get diagnostics v_n = row_count;
  if v_n <> (select count(distinct x) from unnest(p_item_ids) x) then raise exception 'forbidden'; end if;
end;
$$;

-- Đặt ngày cụ thể cho nhiều đầu việc; p_start / p_end null = giữ nguyên ngày đó.
create or replace function set_items_schedule(p_item_ids uuid[], p_start date, p_end date)
returns void
language plpgsql security invoker set search_path = public as $$
declare v_n int;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 or (p_start is null and p_end is null) then return; end if;
  update work_items set planned_start = coalesce(p_start, planned_start), planned_end = coalesce(p_end, planned_end)
    where id = any(p_item_ids);
  get diagnostics v_n = row_count;
  if v_n <> (select count(distinct x) from unnest(p_item_ids) x) then raise exception 'forbidden'; end if;
  if exists (select 1 from work_items where id = any(p_item_ids) and planned_start > planned_end) then
    raise exception 'invalid_dates';
  end if;
end;
$$;

grant execute on function shift_items_schedule(uuid[], int) to authenticated;
grant execute on function set_items_schedule(uuid[], date, date) to authenticated;

commit;
