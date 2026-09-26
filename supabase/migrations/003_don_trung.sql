-- ============================================================
-- DỌN ĐẦU VIỆC LẶP — chạy SAU khi xem 002_xem_truoc_trung.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
--
-- 1. Mẫu: xoá dòng mẫu trùng (template_id, seq, name), thêm khoá duy nhất
--    để không bao giờ trùng lại.
-- 2. Công trình: trong mỗi hạng mục, đầu việc cùng tên + cùng seq (dấu vết
--    của mẫu bị nhân đôi) chỉ giữ 1 bản. CHỈ xoá bản chưa có báo cáo,
--    chưa có vướng mắc và qty_done = 0 — bản đã báo cáo luôn giữ lại.
-- 3. Hạng mục vừa dọn: dàn lại lịch nối tiếp theo seq từ ngày bắt đầu sớm
--    nhất, mỗi đầu việc giữ nguyên số ngày của nó.
-- ============================================================
begin;

-- 1. Mẫu
delete from work_package_template_items a
using work_package_template_items b
where a.template_id = b.template_id and a.seq = b.seq and a.name = b.name
  and a.ctid > b.ctid;
create unique index if not exists uq_template_item
  on work_package_template_items(template_id, seq, name);

-- 2. Đầu việc trùng
create temp table _dup on commit drop as
select r.id, r.work_package_id
from (
  select wi.id, wi.work_package_id, wi.qty_done,
    row_number() over (
      partition by wi.work_package_id, wi.name, wi.seq
      order by exists (select 1 from progress_reports pr where pr.work_item_id = wi.id) desc,
               wi.qty_done desc, wi.planned_start nulls last, wi.created_at, wi.id
    ) as rn
  from work_items wi
) r
where r.rn > 1
  and r.qty_done = 0
  and not exists (select 1 from progress_reports pr where pr.work_item_id = r.id)
  and not exists (select 1 from issues i where i.work_item_id = r.id);

delete from work_items where id in (select id from _dup);

-- 3. Dàn lại lịch các hạng mục vừa dọn
with pk as (select distinct work_package_id from _dup),
base as (
  select wi.work_package_id, min(wi.planned_start) as s0
  from work_items wi join pk using (work_package_id)
  group by 1
),
ord as (
  select wi.id, wi.work_package_id,
    greatest(coalesce(wi.planned_end - wi.planned_start, 0) + 1, 1) as d,
    row_number() over (partition by wi.work_package_id order by wi.seq, wi.planned_start, wi.created_at, wi.id) as rn
  from work_items wi join pk using (work_package_id)
  where wi.planned_start is not null
),
cum as (
  select id, work_package_id, d,
    coalesce(sum(d) over (partition by work_package_id order by rn rows between unbounded preceding and 1 preceding), 0) as off
  from ord
)
update work_items w
set planned_start = b.s0 + c.off::int,
    planned_end   = b.s0 + c.off::int + c.d - 1
from cum c join base b using (work_package_id)
where w.id = c.id;

select (select count(*) from _dup) as dau_viec_da_xoa,
       (select count(distinct work_package_id) from _dup) as hang_muc_da_dan_lai_lich;

commit;
