-- ============================================================
-- ĐÓNG CÔNG TRÌNH — chạy SAU 004_xong_dong_canh_bao.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
--
-- 1. Đóng / tạm dừng công trình → mọi cảnh báo đang mở của nó tự đóng.
-- 2. compute_alerts(): bỏ qua công trình không còn 'active' (không sinh
--    cảnh báo mới, không tự đổi trạng thái đầu việc).
-- (Giống đoạn tương ứng trong schema.sql.)
-- ============================================================
begin;

-- Đóng / tạm dừng công trình → đóng mọi cảnh báo đang mở của nó (tab Cần
-- xử lý hết hiện). compute_alerts() bỏ qua công trình không 'active'.
create or replace function _on_project_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' then
    update alerts set acknowledged_at = now(), acknowledged_by = auth.uid()
    where project_id = new.id and acknowledged_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_projects_status on projects;
create trigger trg_projects_status after update of status on projects
  for each row when (new.status is distinct from old.status)
  execute function _on_project_status_change();

create or replace function compute_alerts()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r record;
begin
  -- Chỉ công trình đang chạy (status = 'active'): công trình đã đóng /
  -- tạm dừng không sinh cảnh báo, không tự đổi trạng thái đầu việc.

  -- 1. Không ra quân
  for r in
    select wi.id as item_id, wp.project_id, wi.name
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects pj on pj.id = wp.project_id and pj.status = 'active'
    where wi.status in ('onTrack','delayed','notStarted')
      and wi.planned_start is not null and wi.planned_start <= current_date
      and not exists (
        select 1 from progress_reports pr
        where pr.work_item_id = wi.id and pr.report_date >= current_date - 2
      )
      and not exists (
        select 1 from alerts a where a.work_item_id = wi.id and a.kind = 'no_crew'
          and a.created_at >= current_date - 2
      )
  loop
    insert into alerts(project_id, work_item_id, kind, severity, message)
    values (r.project_id, r.item_id, 'no_crew', 'warning',
      format('"%s" không có báo cáo tiến độ 2 ngày qua', r.name));
    v_count := v_count + 1;
  end loop;

  -- 2. Dự báo về đích trễ (theo tốc độ trung bình 7 ngày qua)
  for r in
    select wi.id as item_id, wp.project_id, wi.name, wi.qty_plan, wi.qty_done, wi.planned_end,
      (select coalesce(sum(pr.approved_qty), 0) from progress_reports pr
        where pr.work_item_id = wi.id and pr.status = 'approved' and pr.report_date >= current_date - 7
      ) as done_7d
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects pj on pj.id = wp.project_id and pj.status = 'active'
    where wi.qty_plan is not null and wi.qty_plan > 0
      and wi.status <> 'done'
      and wi.planned_end is not null
  loop
    if r.done_7d > 0 then
      declare
        v_remaining numeric := greatest(r.qty_plan - r.qty_done, 0);
        v_daily numeric := r.done_7d / 7.0;
        v_days_needed numeric := v_remaining / nullif(v_daily, 0);
        v_forecast_date date := current_date + ceil(v_days_needed)::int;
        v_delay_days int := v_forecast_date - r.planned_end;
      begin
        if v_delay_days > 0 and not exists (
          select 1 from alerts a where a.work_item_id = r.item_id and a.kind = 'forecast_delay'
            and a.created_at >= current_date - 1
        ) then
          insert into alerts(project_id, work_item_id, kind, severity, message)
          values (r.project_id, r.item_id, 'forecast_delay', 'critical',
            format('"%s" dự báo về đích trễ %s ngày (theo tốc độ 7 ngày qua)', r.name, v_delay_days));
          v_count := v_count + 1;
        end if;
      end;
    elsif current_date > r.planned_end and r.qty_done < r.qty_plan then
      -- Không có tiến độ nào trong 7 ngày qua và đã quá hạn — không thể
      -- ước tính ngày về đích theo tốc độ, nhưng vẫn phải báo vì đây là
      -- trường hợp nặng nhất (đứng yên + trễ hạn).
      if not exists (
        select 1 from alerts a where a.work_item_id = r.item_id and a.kind = 'forecast_delay'
          and a.created_at >= current_date - 1
      ) then
        insert into alerts(project_id, work_item_id, kind, severity, message)
        values (r.project_id, r.item_id, 'forecast_delay', 'critical',
          format('"%s" đã quá hạn %s ngày và không có tiến độ trong 7 ngày qua', r.name, current_date - r.planned_end));
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  -- 3. Chặn dây chuyền
  for r in
    select wi_p.name as pred_name, wi_s.name as succ_name, wp_s.project_id, wi_s.id as succ_item_id
    from dependencies d
    join work_items wi_p on wi_p.id = d.predecessor_item_id
    join work_items wi_s on wi_s.id = d.successor_item_id
    join work_packages wp_s on wp_s.id = wi_s.work_package_id
    join projects pj on pj.id = wp_s.project_id and pj.status = 'active'
    where wi_p.status <> 'done'
      and wi_s.planned_start is not null
      -- lag_days: đầu việc trước phải xong sớm hơn N ngày (VD chờ vữa
      -- khô) — nên cửa sổ cảnh báo lùi sớm hơn đúng N ngày.
      and wi_s.planned_start - d.lag_days <= current_date + 3
      and not exists (
        select 1 from alerts a where a.work_item_id = wi_s.id and a.kind = 'chain_block'
          and a.created_at >= current_date - 1
      )
  loop
    insert into alerts(project_id, work_item_id, kind, severity, message)
    values (r.project_id, r.succ_item_id, 'chain_block', 'critical',
      format('"%s" sắp tới hạn nhưng đang bị chặn bởi "%s" chưa xong', r.succ_name, r.pred_name));
    v_count := v_count + 1;
  end loop;

  -- 4. Vướng mắc treo quá 24h
  for r in
    select i.project_id, i.work_item_id, i.description
    from issues i
    join projects pj on pj.id = i.project_id and pj.status = 'active'
    where i.is_blocking and i.status = 'open' and i.created_at <= now() - interval '24 hours'
      and not exists (
        select 1 from alerts a where a.work_item_id is not distinct from i.work_item_id
          and a.kind = 'issue_pending' and a.created_at >= current_date - 1
      )
  loop
    insert into alerts(project_id, work_item_id, kind, severity, message)
    values (r.project_id, r.work_item_id, 'issue_pending', 'warning',
      format('Vướng mắc chưa xử lý quá 24h: %s', left(r.description, 140)));
    v_count := v_count + 1;
  end loop;

  -- 5. Lệch kế hoạch
  for r in
    select wi.id as item_id, wp.project_id, wi.name, wi.qty_plan, wi.qty_done,
      wi.planned_start, wi.planned_end
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects pj on pj.id = wp.project_id and pj.status = 'active'
    where wi.qty_plan is not null and wi.qty_plan > 0
      and wi.planned_start is not null and wi.planned_end is not null
      and wi.status <> 'done'
      and current_date >= wi.planned_start
  loop
    declare
      v_total_days int := greatest(r.planned_end - r.planned_start, 1);
      v_elapsed_days int := greatest(current_date - r.planned_start, 0);
      v_expected_pct numeric := least(100, 100.0 * v_elapsed_days / v_total_days);
      v_actual_pct numeric := 100.0 * r.qty_done / r.qty_plan;
      v_gap numeric := v_expected_pct - v_actual_pct;
      v_sev text;
    begin
      if v_gap > 20 then v_sev := 'critical';
      elsif v_gap > 10 then v_sev := 'warning';
      else v_sev := null;
      end if;
      if v_sev is not null and not exists (
        select 1 from alerts a where a.work_item_id = r.item_id and a.kind = 'plan_deviation'
          and a.created_at >= current_date - 1
      ) then
        insert into alerts(project_id, work_item_id, kind, severity, message)
        values (r.project_id, r.item_id, 'plan_deviation', v_sev,
          format('"%s" lệch kế hoạch %s%% (thực tế %s%% so với dự kiến %s%%)',
            r.name, round(v_gap), round(v_actual_pct), round(v_expected_pct)));
        v_count := v_count + 1;
      end if;
    end;
  end loop;

  -- 6. Cập nhật trạng thái đầu việc theo lịch. Chỉ đổi cột status
  -- (không động tới qty_done/percent — hai cột đó chỉ approve_report_group
  -- được cộng). Trước đây status không bao giờ tự thành "Trễ", dashboard
  -- và trang chủ nhà hiện "Đúng tiến độ" dù đã quá hạn.
  --   quá planned_end mà chưa xong               → delayed
  --   có khối lượng: thực tế thấp hơn dự kiến >10% → delayed
  --                  cao hơn >10%                 → ahead
  --                  còn lại (đã có khối lượng)   → onTrack
  -- Đầu việc 'done' giữ nguyên (giám sát chốt tay với đầu việc trọn gói).
  with calc as (
    select wi.id,
      case
        when wi.planned_end is not null and current_date > wi.planned_end then 'delayed'
        when wi.qty_plan is not null and wi.qty_plan > 0
             and wi.planned_start is not null and wi.planned_end is not null
             and current_date >= wi.planned_start then
          case
            when least(100, 100.0 * greatest(current_date - wi.planned_start, 0) / greatest(wi.planned_end - wi.planned_start, 1))
                 - 100.0 * wi.qty_done / wi.qty_plan > 10 then 'delayed'
            when 100.0 * wi.qty_done / wi.qty_plan
                 - least(100, 100.0 * greatest(current_date - wi.planned_start, 0) / greatest(wi.planned_end - wi.planned_start, 1)) > 10 then 'ahead'
            when wi.qty_done > 0 or wi.status = 'delayed' then 'onTrack'
            else wi.status
          end
        when wi.status = 'delayed' then 'onTrack'   -- đã dời lịch, hết trễ
        else wi.status
      end as new_status
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects pj on pj.id = wp.project_id and pj.status = 'active'
    where wi.status <> 'done'
  )
  update work_items wi set status = c.new_status
  from calc c
  where wi.id = c.id and wi.status is distinct from c.new_status;

  perform _refresh_package_status(wp.id) from work_packages wp;

  return v_count;
end;
$$;

commit;
