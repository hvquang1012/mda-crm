-- ============================================================
-- KHẢO SÁT HIỆN TRẠNG (plan 011, PR 2) — chạy SAU 010_sua_nhieu_dau_viec.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống y hệt các đoạn tương ứng trong schema.sql.)
--   · projects.phase: Khảo sát → Lên phương án → Thi công (công trình cũ = Thi công)
--   · checklist khảo sát + cổng chặn trg_projects_phase (survey_incomplete)
--   · bảng ảnh hiện trạng, file mặt bằng quét (giao diện ở PR sau)
--   · compute_alerts / dashboard_summary chỉ tính công trình đang Thi công
-- ============================================================
begin;

-- Giai đoạn công trình: survey (Khảo sát) → design (Lên phương án) →
-- construction (Thi công). Tách khỏi status (active/done/paused) — không
-- chạm khoá link / trg_projects_status. Công trình cũ mặc định Thi công.
-- Rời 'survey' khi checklist chưa đủ → trigger trg_projects_phase chặn.
alter table projects add column if not exists phase text not null default 'construction';
alter table projects drop constraint if exists projects_phase_check;
alter table projects add constraint projects_phase_check check (phase in ('survey','design','construction'));

-- ---------- KHẢO SÁT HIỆN TRẠNG (chỉ nhân viên; thợ, chủ nhà không thấy) ----------
-- Mẫu checklist dùng chung mọi công trình — chỉ quản lý/admin sửa (KTS
-- không được tự gỡ cờ bắt buộc để lách cổng). Không xoá: tắt active.
create table if not exists survey_checklist_items (
  id uuid primary key default gen_random_uuid(),
  seq int not null default 0,
  section text not null default 'Chung',          -- nhóm hiển thị: "Kết cấu", "Cửa", "Kỹ thuật"...
  label text not null,
  kind text not null default 'number' check (kind in ('number','size','text')),
  unit text,                                       -- 'mm', 'mm/2m', null cho text
  hint text,                                       -- cách đo, hiện dưới ô nhập
  required boolean not null default false,
  photo_required boolean not null default false,  -- bắt buộc có ≥1 ảnh gắn vào mục
  active boolean not null default true,           -- ẩn thay vì xoá, giữ câu trả lời cũ
  created_at timestamptz default now()
);

-- Câu trả lời của từng công trình. updated_by do trigger đặt = auth.uid()
-- (client không gửi cột này — không tin được client).
create table if not exists survey_answers (
  project_id uuid not null references projects(id) on delete cascade,
  item_id uuid not null references survey_checklist_items(id) on delete restrict,
  value jsonb,                 -- number: {"n": 2650} · size: {"w": 900, "h": 2100} · text: {"t": "..."}
  na boolean not null default false,   -- "Không áp dụng"
  na_reason text,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz default now(),
  primary key (project_id, item_id),
  constraint survey_answers_na_reason check (not na or length(trim(coalesce(na_reason,''))) > 0)
);

-- Ảnh hiện trạng (ảnh gốc đã nén + ảnh vẽ đè số đo). Ràng buộc đường dẫn
-- thuộc đúng công trình thêm ở dưới, sau khi khai báo _path_project().
create table if not exists survey_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  item_id uuid references survey_checklist_items(id) on delete set null,  -- gắn vào mục checklist (tuỳ chọn)
  area text,                          -- phòng / khu vực: "Bếp", "WC tầng 2"
  path text not null,                 -- ảnh gốc đã nén (prepareImage)
  thumb_path text not null,
  annotated_path text,                -- ảnh đã vẽ đè số đo (null = chưa vẽ)
  annotated_thumb_path text,
  annotations jsonb not null default '[]'::jsonb,   -- toạ độ chuẩn hoá 0..1, để mở ra sửa lại
  note text,
  taken_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_survey_photos_project on survey_photos(project_id);

-- File mặt bằng quét từ app ngoài (Polycam, Magicplan…) — chỉ lưu và
-- mở/tải, không đọc số đo, không tham gia cổng chặn. Không có update:
-- tải nhầm thì xoá, tải lại.
create table if not exists survey_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,                 -- tên gốc của file, để hiển thị
  path text not null,                 -- {project_id}/survey/files/... (tên đã làm sạch)
  mime text,
  size_bytes bigint,
  note text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists idx_survey_files_project on survey_files(project_id);

-- Ảnh / file khảo sát phải nằm trong thư mục của đúng công trình
-- (đặt sau _path_project() — bảng tạo ở mục BẢNG DỮ LIỆU khi hàm chưa có).
alter table survey_photos drop constraint if exists survey_photos_path_scope;
alter table survey_photos add constraint survey_photos_path_scope check (
  _path_project(path) = project_id and _path_project(thumb_path) = project_id
  and (annotated_path is null or _path_project(annotated_path) = project_id)
  and (annotated_thumb_path is null or _path_project(annotated_thumb_path) = project_id));
alter table survey_files drop constraint if exists survey_files_path_scope;
alter table survey_files add constraint survey_files_path_scope check (_path_project(path) = project_id);

-- ============================================================
-- KHẢO SÁT HIỆN TRẠNG — kiểm thiếu + cổng chặn rời giai đoạn Khảo sát.
-- Định nghĩa "đủ" CHỈ nằm ở survey_missing(); js/staff/survey.js phải
-- khớp từng chữ (số 0 / số âm là số đo hợp lệ).
-- ============================================================

-- Người sửa câu trả lời = người đang đăng nhập, bất kể client gửi gì
create or replace function _survey_answers_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by = auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_survey_answers_stamp on survey_answers;
create trigger trg_survey_answers_stamp before insert or update on survey_answers
  for each row execute function _survey_answers_stamp();
drop trigger if exists trg_survey_answers_updated on survey_answers;
create trigger trg_survey_answers_updated before update on survey_answers
  for each row execute function set_updated_at();
drop trigger if exists trg_survey_photos_updated on survey_photos;
create trigger trg_survey_photos_updated before update on survey_photos
  for each row execute function set_updated_at();

-- Mục bắt buộc còn thiếu của 1 công trình → [{id, label, reason}]
-- (reason: 'value' = chưa có số / chữ · 'photo' = chưa có ảnh). '[]' khi đủ.
-- Mục active + required là ĐỦ khi có câu trả lời và:
--   na = true (lý do đã có constraint survey_answers_na_reason), hoặc
--   number: value.n là số (kể cả 0, số âm) · size: w, h là số > 0 ·
--   text: value.t không rỗng;
--   và nếu photo_required (không na): có ≥1 survey_photos gắn đúng mục.
-- Mục không bắt buộc không bao giờ chặn (cờ "bắt buộc ảnh" của nó chỉ là nhắc).
-- security invoker: RLS lọc theo người gọi. Cổng chặn dùng _survey_missing_count().
create or replace function survey_missing(p_project_id uuid) returns json
language sql stable security invoker set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', x.id, 'label', x.label, 'reason', x.reason) order by x.seq, x.label), '[]'::json)
  from (
    select c.id, c.label, c.seq,
      case
        when a.item_id is null then 'value'
        when a.na then null
        when not coalesce(case c.kind
            when 'number' then jsonb_typeof(a.value->'n') = 'number'
            when 'size' then case when jsonb_typeof(a.value->'w') = 'number' and jsonb_typeof(a.value->'h') = 'number'
                                  then (a.value->>'w')::numeric > 0 and (a.value->>'h')::numeric > 0 else false end
            else length(trim(coalesce(a.value->>'t', ''))) > 0
          end, false) then 'value'
        when c.photo_required and not exists (
          select 1 from survey_photos ph where ph.project_id = p_project_id and ph.item_id = c.id) then 'photo'
        else null
      end as reason
    from survey_checklist_items c
    left join survey_answers a on a.project_id = p_project_id and a.item_id = c.id
    where c.active and c.required
  ) x
  where x.reason is not null;
$$;

-- Bản đếm cho cổng chặn: security definer nên đếm đúng bất kể RLS của
-- người đổi giai đoạn. Dùng lại survey_missing() (chạy bằng quyền chủ hàm)
-- để định nghĩa "đủ" chỉ ở một chỗ. KHÔNG grant cho ai.
create or replace function _survey_missing_count(p_project_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select json_array_length(survey_missing(p_project_id));
$$;

-- Cổng: rời 'survey' khi còn thiếu → survey_incomplete. Lùi giai đoạn tự
-- do; insert công trình thẳng vào design/construction không bị chặn.
create or replace function _on_project_phase_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.phase = 'survey' and new.phase <> 'survey' and _survey_missing_count(new.id) > 0 then
    raise exception 'survey_incomplete';
  end if;
  return new;
end; $$;
drop trigger if exists trg_projects_phase on projects;
create trigger trg_projects_phase before update of phase on projects
  for each row when (new.phase is distinct from old.phase)
  execute function _on_project_phase_change();

-- ---------- Cảnh báo: bỏ qua công trình chưa vào thi công ----------
create or replace function compute_alerts()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r record;
begin
  -- Chỉ công trình đang chạy (status = 'active') VÀ đã vào thi công
  -- (phase = 'construction'): công trình đã đóng / tạm dừng, hoặc còn đang
  -- khảo sát / lên phương án, không sinh cảnh báo, không tự đổi trạng
  -- thái đầu việc — kể cả khi đã lỡ có đầu việc.

  -- 1. Không ra quân
  for r in
    select wi.id as item_id, wp.project_id, wi.name
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects pj on pj.id = wp.project_id and pj.status = 'active' and pj.phase = 'construction'
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
    join projects pj on pj.id = wp.project_id and pj.status = 'active' and pj.phase = 'construction'
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
    join projects pj on pj.id = wp_s.project_id and pj.status = 'active' and pj.phase = 'construction'
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
    join projects pj on pj.id = i.project_id and pj.status = 'active' and pj.phase = 'construction'
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
    join projects pj on pj.id = wp.project_id and pj.status = 'active' and pj.phase = 'construction'
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
    join projects pj on pj.id = wp.project_id and pj.status = 'active' and pj.phase = 'construction'
    where wi.status <> 'done'
  )
  update work_items wi set status = c.new_status
  from calc c
  where wi.id = c.id and wi.status is distinct from c.new_status;

  perform _refresh_package_status(wp.id) from work_packages wp;

  return v_count;
end;
$$;

-- ---------- Tổng quan: thêm giai đoạn, chỉ tính đầu việc công trình đang thi công ----------
create or replace function dashboard_summary()
returns json
language sql stable security invoker set search_path = public as $$
  with items as (
    select wi.id, wi.work_package_id, wp.project_id, wp.subcontractor_id, wi.status,
      case when wi.status = 'done' then 100 else wi.percent end::numeric as pct,
      greatest(coalesce(wi.planned_end - wi.planned_start, 0) + 1, 1) as weight,
      wi.planned_start,
      case
        when wi.planned_start is null or wi.planned_end is null then null
        when current_date < wi.planned_start then 0
        else least(100, 100.0 * (current_date - wi.planned_start) / greatest(wi.planned_end - wi.planned_start, 1))
      end as plan_pct
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    join projects p on p.id = wp.project_id
    -- Công trình đang khảo sát / lên phương án: đầu việc (nếu lỡ có) không
    -- tính vào %, số trễ, chấm điểm đội — thẻ chỉ hiện "Chưa vào thi công".
    where p.status = 'active' and p.phase = 'construction'
  ),
  reports as (
    select pr.id, pr.status, pr.report_date, pr.created_at, pr.approved_at, wp.project_id, wp.subcontractor_id, pr.work_item_id
    from progress_reports pr
    join work_items wi on wi.id = pr.work_item_id
    join work_packages wp on wp.id = wi.work_package_id
  ),
  proj as (
    select p.id, p.name, p.client_name, p.start_date, p.end_date, p.phase,
      p.end_date - current_date as days_left,
      (p.created_by = auth.uid() or exists (
        select 1 from project_members m where m.project_id = p.id and m.staff_id = auth.uid()
      )) as is_mine,
      round(coalesce(sum(i.pct * i.weight) / nullif(sum(i.weight), 0), 0)) as actual_pct,
      round(coalesce(sum(coalesce(i.plan_pct, i.pct) * i.weight) / nullif(sum(i.weight), 0), 0)) as planned_pct,
      count(i.id) as item_count,
      count(i.id) filter (where i.status = 'done') as done_items,
      count(i.id) filter (where i.status = 'delayed') as delayed_items
    from projects p
    left join items i on i.project_id = p.id
    where p.status = 'active'
    group by p.id
  ),
  pkg as (
    select wp.id, wp.project_id, wp.name, wp.trade, s.name as sub_name, wp.status,
      round(coalesce(sum(i.pct * i.weight) / nullif(sum(i.weight), 0), 0)) as actual_pct,
      round(coalesce(sum(coalesce(i.plan_pct, i.pct) * i.weight) / nullif(sum(i.weight), 0), 0)) as planned_pct,
      count(i.id) filter (where i.status = 'delayed') as delayed_items,
      (select a.kind from alerts a join work_items wi on wi.id = a.work_item_id
        where wi.work_package_id = wp.id and a.acknowledged_at is null
        order by (a.severity = 'critical') desc, a.created_at desc limit 1) as top_alert
    from work_packages wp
    join subcontractors s on s.id = wp.subcontractor_id
    left join items i on i.work_package_id = wp.id
    where wp.project_id in (select id from proj)
    group by wp.id, s.name
  )
  select json_build_object(
    'generated_at', now(),
    'today', current_date,
    'projects', coalesce((
      select json_agg(json_build_object(
        'id', pr.id, 'name', pr.name, 'client_name', pr.client_name, 'phase', pr.phase,
        'start_date', pr.start_date, 'end_date', pr.end_date, 'days_left', pr.days_left,
        'is_mine', pr.is_mine,
        'actual_pct', pr.actual_pct, 'planned_pct', pr.planned_pct,
        'gap', pr.planned_pct - pr.actual_pct,
        'item_count', pr.item_count, 'done_items', pr.done_items, 'delayed_items', pr.delayed_items,
        'pending_reports', (select count(*) from reports r where r.project_id = pr.id and r.status = 'pending'),
        'open_issues', (select count(*) from issues x where x.project_id = pr.id and x.status = 'open'),
        'blocking_issues', (select count(*) from issues x where x.project_id = pr.id and x.status = 'open' and x.is_blocking),
        'critical_alerts', (select count(*) from alerts a where a.project_id = pr.id and a.acknowledged_at is null and a.severity = 'critical'),
        'warning_alerts', (select count(*) from alerts a where a.project_id = pr.id and a.acknowledged_at is null and a.severity = 'warning'),
        'last_report_date', (select max(r.report_date) from reports r where r.project_id = pr.id),
        'packages', coalesce((
          select json_agg(json_build_object(
            'id', k.id, 'name', k.name, 'trade', k.trade, 'sub_name', k.sub_name, 'status', k.status,
            'actual_pct', k.actual_pct, 'planned_pct', k.planned_pct,
            'delayed_items', k.delayed_items, 'top_alert', k.top_alert
          ) order by k.planned_pct - k.actual_pct desc, k.name)
          from pkg k where k.project_id = pr.id
        ), '[]'::json)
      ) order by pr.planned_pct - pr.actual_pct desc, pr.end_date)
      from proj pr
    ), '[]'::json),
    'subcontractors', coalesce((
      select json_agg(sx order by sx.score desc, sx.name)
      from (
        select s.id, s.name, s.trade,
          count(distinct i.project_id) as projects,
          count(i.id) filter (where i.status = 'delayed') as delayed_items,
          count(i.id) filter (where i.status <> 'done' and i.planned_start <= current_date
            and not exists (select 1 from reports r where r.work_item_id = i.id and r.report_date >= current_date - 2)) as idle_items,
          (select count(*) from reports r where r.subcontractor_id = s.id and r.created_at >= now() - interval '30 days') as reports_30d,
          (select count(*) from reports r where r.subcontractor_id = s.id and r.status = 'rejected' and r.created_at >= now() - interval '30 days') as rejected_30d,
          count(i.id) filter (where i.status = 'delayed') * 2
            + count(i.id) filter (where i.status <> 'done' and i.planned_start <= current_date
                and not exists (select 1 from reports r where r.work_item_id = i.id and r.report_date >= current_date - 2)) as score
        from subcontractors s
        join items i on i.subcontractor_id = s.id
        group by s.id
      ) sx
    ), '[]'::json),
    'activity', coalesce((
      select json_agg(json_build_object(
        'd', d::date,
        'submitted', (select count(*) from reports r where r.created_at::date = d::date),
        'approved', (select count(*) from reports r where r.status = 'approved' and r.approved_at::date = d::date)
      ) order by d)
      from generate_series(current_date - 13, current_date, interval '1 day') d
    ), '[]'::json)
  );
$$;

-- Khảo sát hiện trạng: chỉ nhân viên đăng nhập. Mẫu checklist ai cũng đọc,
-- chỉ quản lý thêm/sửa (không delete — tắt active). Dữ liệu theo công trình
-- dùng can_access_project().
alter table survey_checklist_items enable row level security;
alter table survey_answers enable row level security;
alter table survey_photos enable row level security;
alter table survey_files enable row level security;
revoke all on survey_checklist_items, survey_answers, survey_photos, survey_files from anon;
revoke all on survey_checklist_items, survey_answers, survey_photos, survey_files from authenticated;
grant select, insert, update on survey_checklist_items to authenticated;   -- KHÔNG delete: dùng active=false
grant select, insert, update, delete on survey_answers, survey_photos to authenticated;
grant select, insert, delete on survey_files to authenticated;             -- KHÔNG update: tải nhầm thì xoá, tải lại

drop policy if exists "survey template read" on survey_checklist_items;
drop policy if exists "survey template insert" on survey_checklist_items;
drop policy if exists "survey template update" on survey_checklist_items;
create policy "survey template read" on survey_checklist_items for select to authenticated using (true);
create policy "survey template insert" on survey_checklist_items for insert to authenticated with check (is_manager());
create policy "survey template update" on survey_checklist_items for update to authenticated
  using (is_manager()) with check (is_manager());

drop policy if exists "project scope" on survey_answers;
create policy "project scope" on survey_answers for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));
drop policy if exists "project scope" on survey_photos;
create policy "project scope" on survey_photos for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));
drop policy if exists "project scope" on survey_files;
create policy "project scope" on survey_files for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

-- Postgres tự cấp EXECUTE cho PUBLIC khi tạo hàm mới — thu hồi tường minh
-- (file migration chạy riêng, không có dòng revoke chung ở trên).
revoke execute on function survey_missing(uuid), _survey_missing_count(uuid), _on_project_phase_change(), _survey_answers_stamp() from public, anon;
grant execute on function survey_missing(uuid) to authenticated;

-- Mẫu checklist khảo sát mặc định (id cố định — chạy lại không nhân đôi,
-- không ghi đè mẫu quản lý đã sửa)
insert into survey_checklist_items (id, seq, section, label, kind, unit, required, photo_required, hint) values
  ('00000000-0000-0000-0000-000000000110', 10, 'Kết cấu', 'Chiều cao trần thô', 'number', 'mm', true, false, 'Từ sàn thô tới đáy sàn trên, đo ở 2–3 điểm, ghi số nhỏ nhất'),
  ('00000000-0000-0000-0000-000000000120', 20, 'Kết cấu', 'Cốt sàn (thô so với hoàn thiện / mốc chuẩn)', 'number', 'mm', true, false, 'Chênh cốt so với mốc ghi trên tường; ghi rõ mốc ở ghi chú ảnh'),
  ('00000000-0000-0000-0000-000000000130', 30, 'Kết cấu', 'Vị trí & kích thước dầm bê tông', 'text', null, true, true, 'Dầm nào, rộng × cao, cao độ đáy dầm so với sàn'),
  ('00000000-0000-0000-0000-000000000140', 40, 'Kết cấu', 'Độ nghiêng tường', 'number', 'mm/2m', true, false, 'Thước nhôm 2m hoặc laser — ghi bức tường nghiêng nhất'),
  ('00000000-0000-0000-0000-000000000150', 50, 'Cửa', 'Cửa thang máy (rộng × cao)', 'size', 'mm', true, true, 'Lọt lòng — quyết định kích thước tấm đá/tủ đưa lên được'),
  ('00000000-0000-0000-0000-000000000160', 60, 'Cửa', 'Cửa chính (rộng × cao)', 'size', 'mm', false, false, 'Lọt lòng'),
  ('00000000-0000-0000-0000-000000000170', 70, 'Kỹ thuật', 'Vị trí cấp / thoát nước', 'text', null, false, true, 'Chấm điểm trên ảnh, ghi cao độ'),
  ('00000000-0000-0000-0000-000000000180', 80, 'Kỹ thuật', 'Vị trí tủ điện, ổ cắm hiện có', 'text', null, false, true, 'Chấm điểm trên ảnh, ghi cao độ')
on conflict (id) do nothing;

commit;
