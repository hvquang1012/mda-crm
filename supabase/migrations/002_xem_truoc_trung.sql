-- ============================================================
-- XEM TRƯỚC (chỉ đọc, không đổi gì) — chạy trước 003_don_trung.sql.
-- Supabase > SQL Editor > New query > dán > Run.
--
-- Lỗi lặp: mẫu đầu việc đá/điện từng bị seed 2 lần → mỗi bước có 2 dòng
-- cùng seq → công trình tạo theo mẫu có mỗi đầu việc 2 lần nối tiếp.
-- Kết quả dưới đây liệt kê những gì 003 sẽ làm:
--   loai = 'mau'       : dòng mẫu thừa sẽ xoá
--   loai = 'xoa'       : đầu việc trùng sẽ xoá (chưa có báo cáo, chưa làm)
--   loai = 'giu_lai'   : đầu việc trùng nhưng ĐÃ có báo cáo → giữ nguyên
-- ============================================================
with tpl_dup as (
  select t.template_id, t.seq, t.name, count(*) - 1 as thua
  from work_package_template_items t
  group by 1, 2, 3 having count(*) > 1
),
ranked as (
  select wi.*,
    exists (select 1 from progress_reports pr where pr.work_item_id = wi.id) as co_bao_cao,
    exists (select 1 from issues i where i.work_item_id = wi.id) as co_vuong_mac,
    row_number() over (
      partition by wi.work_package_id, wi.name, wi.seq
      order by exists (select 1 from progress_reports pr where pr.work_item_id = wi.id) desc,
               wi.qty_done desc, wi.planned_start nulls last, wi.created_at, wi.id
    ) as rn
  from work_items wi
)
select 'mau' as loai, tp.name as cong_trinh_hoac_mau, null as hang_muc, d.name as dau_viec,
       d.seq, null::date as bat_dau, null::date as ket_thuc, d.thua as so_dong
from tpl_dup d join work_package_templates tp on tp.id = d.template_id
union all
select case when r.co_bao_cao or r.co_vuong_mac or r.qty_done <> 0 then 'giu_lai' else 'xoa' end,
       p.name, wp.name, r.name, r.seq, r.planned_start, r.planned_end, 1
from ranked r
join work_packages wp on wp.id = r.work_package_id
join projects p on p.id = wp.project_id
where r.rn > 1
order by 1, 2, 3, 5;
