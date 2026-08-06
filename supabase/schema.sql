-- ============================================================
-- MD ARCHITECTS — QUẢN LÝ TIẾN ĐỘ THẦU PHỤ (v2)
-- Chạy toàn bộ file này trong Supabase > SQL Editor > New query > Run
-- (Thay thế hoàn toàn supabase-schema.sql cũ. Nếu đã chạy bản cũ,
--  xem thêm supabase/migrations/000_urgent_fix_rls.sql trước.)
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- BẢNG DỮ LIỆU
-- ============================================================

-- Đội thầu phụ (đá, điện, ...)
create table if not exists subcontractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text not null check (trade in ('da','dien','khac')),
  contact_person text,
  phone text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Công trình
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  address text,
  start_date date not null default current_date,
  end_date date not null default (current_date + interval '30 days'),
  status text not null default 'active' check (status in ('active','done','paused')),
  created_at timestamptz default now()
);

-- Hạng mục = 1 đội thầu phụ × 1 công trình
create table if not exists work_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete restrict,
  trade text not null check (trade in ('da','dien','khac')),
  name text not null,
  contract_qty numeric,
  unit text not null default 'm2' check (unit in ('m2','diem','md','tron_goi')),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  status text not null default 'notStarted' check (status in ('notStarted','onTrack','delayed','ahead','done')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_work_packages_project on work_packages(project_id);

-- Đầu việc trong một hạng mục
create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  work_package_id uuid not null references work_packages(id) on delete cascade,
  name text not null,
  seq int not null default 0,
  unit text not null default 'm2' check (unit in ('m2','diem','md','tron_goi')),
  planned_start date,
  planned_end date,
  qty_plan numeric,
  qty_done numeric not null default 0,           -- cache, cộng dồn từ progress_reports đã duyệt
  percent int not null default 0 check (percent between 0 and 100),
  status text not null default 'notStarted' check (status in ('notStarted','onTrack','delayed','ahead','done')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_work_items_package on work_items(work_package_id);

-- Phụ thuộc giữa các đầu việc: predecessor phải xong trước successor mới bắt đầu
-- (VD: "Nghiệm thu điện âm" phải xong trước "Trát tường". Xem README mục
--  4 bảng phụ thuộc mẫu — tạo thủ công trong app khi lập kế hoạch từng công trình,
--  vì cặp phụ thuộc phụ thuộc vào đầu việc cụ thể của từng dự án.)
create table if not exists dependencies (
  id uuid primary key default gen_random_uuid(),
  predecessor_item_id uuid not null references work_items(id) on delete cascade,
  successor_item_id uuid not null references work_items(id) on delete cascade,
  lag_days int not null default 0,
  created_at timestamptz default now(),
  check (predecessor_item_id <> successor_item_id),
  unique (predecessor_item_id, successor_item_id)
);

-- Link Zalo cấp cho từng đội / công nhân — không cần đăng nhập
create table if not exists crew_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  project_id uuid not null references projects(id) on delete cascade,
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  person_name text,
  role text not null default 'crew' check (role in ('crew','manager')),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_crew_links_token on crew_links(token);

-- Link riêng cho chủ nhà — chỉ xem đúng 1 công trình
create table if not exists client_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  project_id uuid not null references projects(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_client_links_token on client_links(token);

-- NHẬT KÝ TIẾN ĐỘ — chỉ ghi thêm, không sửa/xoá. Đây là nguồn sự thật;
-- % và trạng thái của work_items chỉ là số tính ra từ bảng này.
create table if not exists progress_reports (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete cascade,
  report_date date not null default current_date,
  reporter_kind text not null check (reporter_kind in ('crew','staff')),
  crew_link_id uuid references crew_links(id),
  staff_id uuid references auth.users(id),
  reporter_name text not null,
  qty_delta numeric not null default 0,
  crew_size int,                                  -- số thợ có mặt — chỉ báo trễ sớm nhất
  note text not null,
  photos jsonb not null default '[]'::jsonb,       -- [{path, thumb_path, taken_at}]
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_qty numeric,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  check (
    (reporter_kind = 'crew' and crew_link_id is not null) or
    (reporter_kind = 'staff' and staff_id is not null)
  )
);
create index if not exists idx_reports_item on progress_reports(work_item_id);
create index if not exists idx_reports_status on progress_reports(status);
create index if not exists idx_reports_date on progress_reports(report_date);

-- Vướng mắc / báo chặn
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  work_item_id uuid references work_items(id) on delete set null,
  raised_by_kind text not null check (raised_by_kind in ('crew','staff')),
  raised_by_crew_link_id uuid references crew_links(id),
  raised_by_staff_id uuid references auth.users(id),
  raised_by_name text not null,
  kind text not null default 'other' check (kind in ('blocked_handover','material','access','safety','other')),
  description text not null,
  photos jsonb not null default '[]'::jsonb,
  is_blocking boolean not null default false,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_issues_project on issues(project_id);

-- Cảnh báo tự động (sinh bởi compute_alerts(), xem phần dưới)
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  work_item_id uuid references work_items(id) on delete cascade,
  kind text not null check (kind in ('no_crew','forecast_delay','chain_block','issue_pending','plan_deviation')),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  message text not null,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  notified_at timestamptz                          -- đã gửi Web Push hay chưa (xem Edge Function send-alerts)
);
create index if not exists idx_alerts_project on alerts(project_id);
create index if not exists idx_alerts_created on alerts(created_at);
create index if not exists idx_alerts_unnotified on alerts(notified_at) where notified_at is null;

-- Đăng ký Web Push của từng nhân viên
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- Hồ sơ nhân viên (thay staff_profiles cũ — bảng cũ không có trigger tạo
-- và không có policy insert nên chưa từng hoạt động)
create table if not exists staff (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('staff','manager','admin')),
  created_at timestamptz default now()
);

-- Mẫu hạng mục cho đá / điện — front-end đọc bảng này để dựng UI chọn
-- template, tự tạo work_items theo mẫu thay vì gõ lại từng đầu việc.
create table if not exists work_package_templates (
  id uuid primary key default gen_random_uuid(),
  trade text not null check (trade in ('da','dien','khac')),
  name text not null
);
create table if not exists work_package_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references work_package_templates(id) on delete cascade,
  name text not null,
  seq int not null,
  unit text not null check (unit in ('m2','diem','md','tron_goi')),
  default_duration_days int not null default 3
);

-- ============================================================
-- TRIGGERS
-- ============================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_work_packages_updated on work_packages;
create trigger trg_work_packages_updated before update on work_packages
  for each row execute function set_updated_at();

drop trigger if exists trg_work_items_updated on work_items;
create trigger trg_work_items_updated before update on work_items
  for each row execute function set_updated_at();

-- Tự tạo hồ sơ staff khi có tài khoản đăng nhập mới (Authentication > Users > Add user)
create or replace function handle_new_staff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into staff(id, full_name) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_staff();

-- ============================================================
-- HÀM RPC CHO THẦU PHỤ / CÔNG NHÂN (không đăng nhập, chỉ có token)
--
-- Mỗi hàm tự tra crew_links theo token, kiểm tra còn hạn/chưa bị thu
-- hồi, và chỉ cho thao tác trong đúng phạm vi (project_id,
-- subcontractor_id) của token đó. security definer nghĩa là hàm chạy
-- với quyền người tạo (postgres, có BYPASSRLS trên Supabase) nên vượt
-- qua được RLS đang chặn anon ở tầng bảng — đây là cổng duy nhất anon
-- được phép ghi dữ liệu.
-- ============================================================

create or replace function _resolve_crew_link(p_token text)
returns crew_links
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
begin
  select * into v_link from crew_links
    where token = p_token
      and revoked_at is null
      and (expires_at is null or expires_at > now());
  if v_link.id is null then
    raise exception 'invalid_or_expired_token';
  end if;
  update crew_links set last_used_at = now() where id = v_link.id;
  return v_link;
end;
$$;

create or replace function crew_bootstrap(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_result json;
begin
  v_link := _resolve_crew_link(p_token);

  select json_build_object(
    'crew_link_id', v_link.id,
    'project', json_build_object('id', p.id, 'name', p.name),
    'subcontractor', json_build_object('id', s.id, 'name', s.name, 'trade', s.trade),
    'person_name', v_link.person_name,
    'role', v_link.role,
    'work_items', coalesce((
      select json_agg(json_build_object(
        'id', wi.id, 'name', wi.name, 'unit', wi.unit,
        'qty_plan', wi.qty_plan, 'qty_done', wi.qty_done,
        'percent', wi.percent, 'status', wi.status,
        'planned_start', wi.planned_start, 'planned_end', wi.planned_end
      ) order by wi.seq)
      from work_items wi
      join work_packages wp on wp.id = wi.work_package_id
      where wp.project_id = v_link.project_id
        and wp.subcontractor_id = v_link.subcontractor_id
    ), '[]'::json)
  ) into v_result
  from projects p, subcontractors s
  where p.id = v_link.project_id and s.id = v_link.subcontractor_id;

  return v_result;
end;
$$;

create or replace function crew_submit(
  p_token text,
  p_item_id uuid,
  p_qty_delta numeric,
  p_crew_size int,
  p_note text,
  p_photos jsonb,
  p_reporter_name text default null,
  p_report_date date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_owns boolean;
  v_id uuid;
begin
  v_link := _resolve_crew_link(p_token);

  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'note_required';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) = 0 then
    raise exception 'photo_required';
  end if;

  select exists(
    select 1 from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    where wi.id = p_item_id
      and wp.project_id = v_link.project_id
      and wp.subcontractor_id = v_link.subcontractor_id
  ) into v_owns;
  if not v_owns then
    raise exception 'item_not_in_scope';
  end if;

  insert into progress_reports(
    work_item_id, report_date, reporter_kind, crew_link_id, reporter_name,
    qty_delta, crew_size, note, photos
  ) values (
    p_item_id, coalesce(p_report_date, current_date), 'crew', v_link.id,
    coalesce(nullif(trim(p_reporter_name), ''), v_link.person_name, 'Đội thi công'),
    coalesce(p_qty_delta, 0), p_crew_size, p_note, p_photos
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function crew_my_reports(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_result json;
begin
  v_link := _resolve_crew_link(p_token);

  with recent as (
    select pr.*, wi.name as work_item_name
    from progress_reports pr
    join work_items wi on wi.id = pr.work_item_id
    join work_packages wp on wp.id = wi.work_package_id
    where wp.project_id = v_link.project_id
      and wp.subcontractor_id = v_link.subcontractor_id
    order by pr.created_at desc
    limit 200
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'work_item_name', work_item_name, 'report_date', report_date,
    'qty_delta', qty_delta, 'crew_size', crew_size, 'note', note, 'photos', photos,
    'status', status, 'reject_reason', reject_reason, 'created_at', created_at
  ) order by created_at desc), '[]'::json)
  into v_result
  from recent;

  return v_result;
end;
$$;

create or replace function crew_raise_issue(
  p_token text,
  p_item_id uuid,
  p_kind text,
  p_description text,
  p_photos jsonb default '[]'::jsonb,
  p_is_blocking boolean default false,
  p_reporter_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_id uuid;
begin
  v_link := _resolve_crew_link(p_token);

  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description_required';
  end if;

  if p_item_id is not null then
    perform 1 from work_items wi join work_packages wp on wp.id = wi.work_package_id
      where wi.id = p_item_id
        and wp.project_id = v_link.project_id
        and wp.subcontractor_id = v_link.subcontractor_id;
    if not found then
      raise exception 'item_not_in_scope';
    end if;
  end if;

  insert into issues(
    project_id, work_item_id, raised_by_kind, raised_by_crew_link_id, raised_by_name,
    kind, description, photos, is_blocking
  ) values (
    v_link.project_id, p_item_id, 'crew', v_link.id,
    coalesce(nullif(trim(p_reporter_name), ''), v_link.person_name, 'Đội thi công'),
    coalesce(p_kind, 'other'), p_description, coalesce(p_photos, '[]'::jsonb), coalesce(p_is_blocking, false)
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================
-- HÀM RPC CHO CHỦ NHÀ (không đăng nhập, chỉ có token)
-- Chỉ trả về ĐÚNG 1 công trình gắn với token, ảnh đã duyệt, và
-- KHÔNG bao giờ trả tên thầu phụ hay vướng mắc nội bộ.
-- ============================================================

create or replace function client_view(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_link client_links;
  v_result json;
begin
  select * into v_link from client_links
    where token = p_token
      and revoked_at is null
      and (expires_at is null or expires_at > now());
  if v_link.id is null then
    raise exception 'invalid_or_expired_token';
  end if;
  update client_links set last_used_at = now() where id = v_link.id;

  select json_build_object(
    'project', json_build_object(
      'id', p.id, 'name', p.name, 'address', p.address,
      'start_date', p.start_date, 'end_date', p.end_date, 'status', p.status
    ),
    'stages', coalesce((
      select json_agg(json_build_object(
        'name', wp.name,
        'planned_start', wp.planned_start, 'planned_end', wp.planned_end,
        'status', wp.status,
        'percent', (select coalesce(round(avg(wi2.percent)), 0) from work_items wi2 where wi2.work_package_id = wp.id)
      ) order by wp.planned_start nulls last)
      from work_packages wp where wp.project_id = p.id
    ), '[]'::json),
    'photos', coalesce((
      select json_agg(json_build_object('path', ph.value->>'path', 'taken_at', ph.value->>'taken_at')
        order by pr.approved_at desc)
      from progress_reports pr
      join work_items wi on wi.id = pr.work_item_id
      join work_packages wp on wp.id = wi.work_package_id
      cross join lateral jsonb_array_elements(pr.photos) as ph(value)
      where wp.project_id = p.id and pr.status = 'approved'
      limit 60
    ), '[]'::json)
  ) into v_result
  from projects p where p.id = v_link.project_id;

  return v_result;
end;
$$;
-- Lưu ý: 'photos'.path là đường dẫn trong Storage private bucket, không
-- phải URL xem trực tiếp được. client.html gọi Edge Function
-- get-photo-url(token, path) để đổi thành signed URL có hạn 1 giờ.

-- ============================================================
-- HÀM RPC CHO STAFF (đăng nhập) — duyệt / trả lại báo cáo
-- security invoker: chạy bằng quyền người gọi, RLS phía dưới quyết định.
-- ============================================================

create or replace function approve_report(p_report_id uuid, p_approved_qty numeric default null)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_report progress_reports;
  v_qty numeric;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not_authenticated';
  end if;

  select * into v_report from progress_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'report_not_found';
  end if;
  if v_report.status <> 'pending' then
    raise exception 'already_processed';
  end if;

  v_qty := coalesce(p_approved_qty, v_report.qty_delta);

  update progress_reports
    set status = 'approved', approved_qty = v_qty, approved_by = auth.uid(), approved_at = now()
    where id = p_report_id;

  update work_items set
    qty_done = qty_done + v_qty,
    percent = case when qty_plan is not null and qty_plan > 0
                   then least(100, round((qty_done + v_qty) / qty_plan * 100))
                   else percent end,
    status = case
                when qty_plan is not null and qty_plan > 0 and (qty_done + v_qty) >= qty_plan then 'done'
                when status = 'notStarted' then 'onTrack'
                else status
              end
    where id = v_report.work_item_id;
end;
$$;

create or replace function reject_report(p_report_id uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not_authenticated';
  end if;
  update progress_reports
    set status = 'rejected', reject_reason = p_reason, approved_by = auth.uid(), approved_at = now()
    where id = p_report_id and status = 'pending';
  if not found then
    raise exception 'report_not_found_or_processed';
  end if;
end;
$$;

-- ============================================================
-- CẢNH BÁO TỰ ĐỘNG — chạy 2 lần/ngày qua pg_cron
-- 1. Không ra quân · 2. Dự báo về đích trễ · 3. Chặn dây chuyền
-- 4. Vướng mắc treo >24h · 5. Lệch kế hoạch >10%/>20%
-- ============================================================

create or replace function compute_alerts()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r record;
begin
  -- 1. Không ra quân
  for r in
    select wi.id as item_id, wp.project_id, wi.name
    from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    where wi.status in ('onTrack','delayed','notStarted')
      and wi.planned_start is not null and wi.planned_start <= current_date
      and (wi.planned_end is null or wi.planned_end >= current_date - 2)
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
    end if;
  end loop;

  -- 3. Chặn dây chuyền
  for r in
    select wi_p.name as pred_name, wi_s.name as succ_name, wp_s.project_id, wi_s.id as succ_item_id
    from dependencies d
    join work_items wi_p on wi_p.id = d.predecessor_item_id
    join work_items wi_s on wi_s.id = d.successor_item_id
    join work_packages wp_s on wp_s.id = wi_s.work_package_id
    where wi_p.status <> 'done'
      and wi_s.planned_start is not null
      and wi_s.planned_start <= current_date + 3
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
    where wi.qty_plan is not null and wi.qty_plan > 0
      and wi.planned_start is not null and wi.planned_end is not null
      and wi.status <> 'done'
      and current_date between wi.planned_start and wi.planned_end
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

  return v_count;
end;
$$;

-- Lên lịch chạy 7h và 15h mỗi ngày. Nếu lệnh dưới báo lỗi "permission
-- denied" hoặc "extension pg_cron does not exist", vào Dashboard >
-- Database > Extensions > bật "pg_cron" trước, rồi chạy lại 2 dòng này.
create extension if not exists pg_cron;
select cron.schedule('mda-compute-alerts-morning', '0 7 * * *', $$select compute_alerts();$$);
select cron.schedule('mda-compute-alerts-afternoon', '0 15 * * *', $$select compute_alerts();$$);

-- ============================================================
-- ĐẨY WEB PUSH — chạy sau compute_alerts() 10 phút, gọi Edge Function
-- send-alerts để gửi thông báo cho các alert chưa notified_at.
--
-- KHÔNG chạy đoạn dưới tự động — cần điền 2 giá trị thật của dự án
-- trước: <PROJECT_REF> (trong Project URL) và <SERVICE_ROLE_KEY>
-- (Project Settings > API > service_role — KHÔNG phải anon key).
-- Sau khi deploy Edge Function send-alerts (supabase functions deploy
-- send-alerts), sửa 2 chỗ <...> bên dưới rồi chạy trong SQL Editor.
-- Cần bật extension "pg_net" (Dashboard > Database > Extensions).
-- ============================================================
-- create extension if not exists pg_net;
-- select cron.schedule('mda-send-alerts-morning', '10 7 * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-alerts',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
-- select cron.schedule('mda-send-alerts-afternoon', '10 15 * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-alerts',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table work_items;
alter publication supabase_realtime add table progress_reports;
alter publication supabase_realtime add table issues;
alter publication supabase_realtime add table alerts;

-- ============================================================
-- BẢO MẬT (Row Level Security)
--
-- Nguyên tắc: anon KHÔNG có quyền trực tiếp trên bất kỳ bảng nào.
-- Mọi thao tác không đăng nhập (thầu phụ, chủ nhà) đi qua các hàm
-- security definer ở trên — hàm tự kiểm tra token bên trong. Đây là
-- điểm khác biệt cốt lõi so với bản cũ (supabase-schema.sql) từng
-- dùng `using (true)` cho phép đọc toàn bộ dữ liệu mọi dự án.
-- ============================================================

alter table subcontractors enable row level security;
alter table projects enable row level security;
alter table work_packages enable row level security;
alter table work_items enable row level security;
alter table dependencies enable row level security;
alter table progress_reports enable row level security;
alter table issues enable row level security;
alter table crew_links enable row level security;
alter table client_links enable row level security;
alter table alerts enable row level security;
alter table push_subscriptions enable row level security;
alter table staff enable row level security;
alter table work_package_templates enable row level security;
alter table work_package_template_items enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on
  subcontractors, projects, work_packages, work_items, dependencies,
  progress_reports, issues, crew_links, client_links, alerts,
  push_subscriptions, staff, work_package_templates, work_package_template_items
to authenticated;

create policy "staff full access" on subcontractors for all to authenticated using (true) with check (true);
create policy "staff full access" on projects for all to authenticated using (true) with check (true);
create policy "staff full access" on work_packages for all to authenticated using (true) with check (true);
create policy "staff full access" on work_items for all to authenticated using (true) with check (true);
create policy "staff full access" on dependencies for all to authenticated using (true) with check (true);
create policy "staff full access" on issues for all to authenticated using (true) with check (true);
create policy "staff full access" on crew_links for all to authenticated using (true) with check (true);
create policy "staff full access" on client_links for all to authenticated using (true) with check (true);
create policy "staff full access" on alerts for all to authenticated using (true) with check (true);
create policy "staff full access" on work_package_templates for all to authenticated using (true) with check (true);
create policy "staff full access" on work_package_template_items for all to authenticated using (true) with check (true);

-- progress_reports: staff xem/duyệt/trả lại và có thể nhập thay đội
-- không dùng app. KHÔNG có policy insert cho anon — thầu phụ chỉ ghi
-- được qua crew_submit() (security definer, bỏ qua RLS).
create policy "staff read reports" on progress_reports for select to authenticated using (true);
create policy "staff insert reports" on progress_reports for insert to authenticated with check (true);
create policy "staff update reports" on progress_reports for update to authenticated using (true) with check (true);

create policy "staff manage own push" on push_subscriptions for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());

create policy "staff read all profiles" on staff for select to authenticated using (true);
create policy "staff update own profile" on staff for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant execute on function crew_bootstrap(text) to anon, authenticated;
grant execute on function crew_submit(text, uuid, numeric, int, text, jsonb, text, date) to anon, authenticated;
grant execute on function crew_my_reports(text) to anon, authenticated;
grant execute on function crew_raise_issue(text, uuid, text, text, jsonb, boolean, text) to anon, authenticated;
grant execute on function client_view(text) to anon, authenticated;
grant execute on function approve_report(uuid, numeric) to authenticated;
grant execute on function reject_report(uuid, text) to authenticated;
grant execute on function compute_alerts() to authenticated; -- nút "Kiểm tra ngay" thủ công

-- ============================================================
-- STORAGE: bucket private cho ảnh hiện trường
--
-- Thầu phụ/công nhân (anon, không đăng nhập) upload qua Edge Function
-- crew-upload — hàm đó dùng service_role nên KHÔNG cần policy insert
-- cho anon ở đây (RLS dưới đây chỉ áp cho request từ browser/app trực
-- tiếp bằng anon/authenticated key).
--
-- Staff (đăng nhập) upload trực tiếp khi nhập thay đội không dùng app,
-- và cần đọc (createSignedUrl) để xem lại ảnh trong hộp duyệt.
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('site-photos', 'site-photos', false)
  on conflict (id) do nothing;

create policy "staff read site-photos" on storage.objects for select to authenticated
  using (bucket_id = 'site-photos');
create policy "staff upload site-photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-photos');

-- ============================================================
-- DỮ LIỆU MẪU: template đầu việc cho đá và điện
-- ============================================================

insert into work_package_templates (id, trade, name) values
  ('00000000-0000-0000-0000-000000000001', 'da', 'Thi công đá — mẫu chuẩn'),
  ('00000000-0000-0000-0000-000000000002', 'dien', 'Thi công điện — mẫu chuẩn')
on conflict (id) do nothing;

insert into work_package_template_items (template_id, name, seq, unit, default_duration_days) values
  ('00000000-0000-0000-0000-000000000001', 'Khảo sát đo thực tế', 1, 'm2', 1),
  ('00000000-0000-0000-0000-000000000001', 'Chốt mẫu & duyệt vân đá', 2, 'tron_goi', 2),
  ('00000000-0000-0000-0000-000000000001', 'Gia công tại xưởng', 3, 'm2', 5),
  ('00000000-0000-0000-0000-000000000001', 'Vận chuyển tới công trình', 4, 'tron_goi', 1),
  ('00000000-0000-0000-0000-000000000001', 'Lắp đặt', 5, 'm2', 3),
  ('00000000-0000-0000-0000-000000000001', 'Bơm keo, mài, đánh bóng', 6, 'm2', 2),
  ('00000000-0000-0000-0000-000000000001', 'Nghiệm thu', 7, 'tron_goi', 1),

  ('00000000-0000-0000-0000-000000000002', 'Định vị, cắt tường, đi ống âm', 1, 'md', 3),
  ('00000000-0000-0000-0000-000000000002', 'Kéo dây, đấu hộp', 2, 'diem', 3),
  ('00000000-0000-0000-0000-000000000002', 'Nghiệm thu điện âm + đo cách điện', 3, 'tron_goi', 1),
  ('00000000-0000-0000-0000-000000000002', 'Lắp đèn, thiết bị', 4, 'diem', 2),
  ('00000000-0000-0000-0000-000000000002', 'Ổ cắm, công tắc, mặt nạ', 5, 'diem', 2),
  ('00000000-0000-0000-0000-000000000002', 'Tủ điện, aptomat', 6, 'tron_goi', 1),
  ('00000000-0000-0000-0000-000000000002', 'Test toàn hệ, bàn giao', 7, 'tron_goi', 1)
on conflict do nothing;

-- ============================================================
-- GHI CHÚ: 4 cặp phụ thuộc nên tạo thủ công trong app cho mỗi công
-- trình cụ thể (bảng `dependencies` tham chiếu work_items đã tồn tại,
-- không seed sẵn được vì phụ thuộc vào từng dự án):
--   Nghiệm thu điện âm      → Trát / ốp tường
--   Lắp xong tủ bếp         → Đo đá mặt bếp
--   Lắp xong đá mặt bếp     → Lắp chậu, bếp từ
--   Xong trần thạch cao     → Lắp đèn âm trần
--
-- GHI CHÚ: dọn ảnh gốc >180 ngày (giữ thumbnail vĩnh viễn) cần một
-- Edge Function chạy theo lịch riêng vì SQL không gọi được Storage
-- API trực tiếp — chưa triển khai trong bản này, xem HUONG_DAN_TRIEN_KHAI.md.
-- ============================================================
