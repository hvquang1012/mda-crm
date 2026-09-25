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
  work_item_id uuid not null references work_items(id) on delete restrict,
  report_date date not null default current_date,
  reporter_kind text not null check (reporter_kind in ('crew','staff')),
  crew_link_id uuid references crew_links(id),
  staff_id uuid references auth.users(id),
  reporter_name text not null,
  qty_delta numeric not null default 0 check (qty_delta >= 0),
  crew_size int check (crew_size is null or crew_size >= 0), -- số thợ có mặt — chỉ báo trễ sớm nhất
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

-- Migrate ràng buộc cho DB đã chạy schema.sql từ trước — "create table if
-- not exists" ở trên không áp lại các cột/ràng buộc mới cho bảng đã tồn tại.
alter table progress_reports drop constraint if exists progress_reports_work_item_id_fkey;
alter table progress_reports add constraint progress_reports_work_item_id_fkey
  foreign key (work_item_id) references work_items(id) on delete restrict;

-- Mã do máy thợ tự sinh cho mỗi báo cáo trong hàng đợi offline: mạng rớt
-- đúng lúc máy chủ đã lưu nhưng chưa kịp trả lời thì lần gửi lại không
-- tạo báo cáo trùng (crew_submit trả về báo cáo cũ).
alter table progress_reports add column if not exists client_ref uuid;
create unique index if not exists uq_reports_client_ref on progress_reports(client_ref) where client_ref is not null;

do $$ begin
  alter table progress_reports add constraint progress_reports_qty_delta_nonneg check (qty_delta >= 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table progress_reports add constraint progress_reports_crew_size_nonneg check (crew_size is null or crew_size >= 0);
exception when duplicate_object then null;
end $$;

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
-- Ghi chú cách xử lý — giám sát ghi khi bấm "Đã xử lý", đội xem lại được.
alter table issues add column if not exists resolution_note text;

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
  role text not null default 'kts' check (role in ('staff','kts','manager','admin')),
  created_at timestamptz default now()
);
-- Vai trò: kts (và 'staff' cũ, coi như kts) chỉ thấy công trình được
-- giao qua project_members; manager/admin thấy tất cả. Chỉ admin đổi
-- được vai trò (hàm set_staff_role).
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check check (role in ('staff','kts','manager','admin'));
alter table staff alter column role set default 'kts';
-- Số điện thoại (0xxxxxxxxx) — hộp "Cài đặt tài khoản", nút Zalo ở danh sách nhân viên.
alter table staff add column if not exists phone text;
alter table staff drop constraint if exists staff_phone_check;
alter table staff add constraint staff_phone_check check (phone is null or phone ~ '^0[0-9]{9}$');

-- Người tạo công trình — KTS tạo xong phải thấy ngay công trình của mình.
alter table projects add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

-- KTS / giám sát phụ trách công trình
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (project_id, staff_id)
);
create index if not exists idx_project_members_staff on project_members(staff_id);

-- Lưu trữ ảnh sang Dropbox (xem Edge Function dropbox-link / dropbox-sync).
-- Không phải progress_reports nên được phép cập nhật trạng thái.
--   uploading: đã cấp link, máy thợ đang gửi ảnh gốc
--   pending:   ảnh gốc đã nằm trong thư mục "_Chờ duyệt"
--   approved / rejected: đã chuyển sang thư mục tương ứng
--   failed:    hỏng quá 5 lần hoặc ảnh gốc không bao giờ tới
create table if not exists photo_archive (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  report_id uuid not null references progress_reports(id) on delete cascade,
  storage_path text,                       -- bản nén trong Storage (khớp photos[].path)
  dropbox_path text not null,
  source text not null default 'original' check (source in ('original','compressed')),
  state text not null default 'uploading' check (state in ('uploading','pending','approved','rejected','failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_photo_archive_report on photo_archive(report_id);
create index if not exists idx_photo_archive_state on photo_archive(state);
create index if not exists idx_photo_archive_storage on photo_archive(storage_path);

-- Báo cáo mới đã đẩy thông báo cho quản lý chưa (Edge Function send-alerts
-- ghi). Bảng riêng vì progress_reports append-only — không thêm cột trạng
-- thái vào đó.
do $$
begin
  if to_regclass('public.report_notifications') is null then
    create table report_notifications (
      report_id uuid primary key references progress_reports(id) on delete cascade,
      notified_at timestamptz not null default now()
    );
    -- Lần đầu tạo: coi mọi báo cáo cũ là đã báo, tránh dội thông báo cũ
    insert into report_notifications(report_id) select id from progress_reports;
  end if;
end $$;

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

-- Tài khoản tạo trước khi có trigger vẫn phải có hồ sơ staff.
insert into staff(id, full_name) select id, email from auth.users on conflict (id) do nothing;

-- Chuyển sang phân quyền theo công trình: trước đây mọi tài khoản thấy
-- toàn bộ. Lần đầu chạy (chưa có quản lý nào) nâng mọi tài khoản cũ lên
-- admin để không ai bị mất quyền đột ngột — sau đó admin tự hạ ai là KTS.
update staff set role = 'admin'
  where role = 'staff'
    and not exists (select 1 from staff where role in ('manager','admin'));

-- ============================================================
-- PHÂN QUYỀN THEO CÔNG TRÌNH — dùng trong mọi policy bên dưới
-- security definer để đọc được staff / project_members mà không vướng
-- RLS của chính các bảng đó (tránh đệ quy policy).
-- ============================================================

create or replace function is_manager()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('manager','admin'));
$$;

create or replace function can_access_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    is_manager()
    or exists (select 1 from project_members m where m.project_id = p_project_id and m.staff_id = auth.uid())
    or exists (select 1 from projects p where p.id = p_project_id and p.created_by = auth.uid())
  );
$$;

create or replace function _package_project(p_package_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from work_packages where id = p_package_id;
$$;

create or replace function _item_project(p_item_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select wp.project_id from work_items wi join work_packages wp on wp.id = wi.work_package_id where wi.id = p_item_id;
$$;

-- Thư mục đầu của đường dẫn ảnh là project_id; path lạ (không phải
-- uuid) trả null thay vì làm hỏng cả câu truy vấn Storage.
create or replace function _path_project(p_path text)
returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- Tự thêm người tạo vào thành viên công trình
create or replace function handle_new_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into project_members(project_id, staff_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projects_add_creator on projects;
create trigger trg_projects_add_creator after insert on projects
  for each row execute function handle_new_project();

-- Chỉ admin đổi vai trò (bảng staff không cho tự sửa cột role)
create or replace function set_staff_role(p_staff_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from staff where id = auth.uid() and role = 'admin') then
    raise exception 'admin_only';
  end if;
  if p_role not in ('kts','manager','admin') then
    raise exception 'invalid_role';
  end if;
  if p_staff_id = auth.uid() and p_role <> 'admin' then
    raise exception 'cannot_demote_self';
  end if;
  update staff set role = p_role where id = p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;
end;
$$;

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

-- Bản trước không có p_client_ref — xoá chữ ký cũ, nếu không PostgREST
-- gặp 2 hàm trùng tên và báo lỗi "could not choose the best candidate".
drop function if exists crew_submit(text, uuid, numeric, int, text, jsonb, text, date);
create or replace function crew_submit(
  p_token text,
  p_item_id uuid,
  p_qty_delta numeric,
  p_crew_size int,
  p_note text,
  p_photos jsonb,
  p_reporter_name text default null,
  p_report_date date default current_date,
  p_client_ref uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_owns boolean;
  v_id uuid;
begin
  v_link := _resolve_crew_link(p_token);

  -- Gửi lại từ hàng đợi offline: báo cáo này đã lưu rồi thì trả id cũ
  if p_client_ref is not null then
    select id into v_id from progress_reports where client_ref = p_client_ref and crew_link_id = v_link.id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Báo cáo nằm trong hàng đợi vài ngày vẫn giữ đúng ngày làm, nhưng
  -- không cho lùi quá 7 ngày hay ghi trước ngày tương lai (+1 cho lệch múi giờ).
  if p_report_date is not null and (p_report_date < current_date - 7 or p_report_date > current_date + 1) then
    raise exception 'invalid_report_date';
  end if;

  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'note_required';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) = 0
     or exists (
       select 1 from jsonb_array_elements(p_photos) as el
       where coalesce(trim(el->>'path'), '') = ''
     )
  then
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
    qty_delta, crew_size, note, photos, client_ref
  ) values (
    p_item_id, coalesce(p_report_date, current_date), 'crew', v_link.id,
    coalesce(nullif(trim(p_reporter_name), ''), v_link.person_name, 'Đội thi công'),
    coalesce(p_qty_delta, 0), p_crew_size, p_note, p_photos, p_client_ref
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
    'id', id, 'work_item_id', work_item_id, 'work_item_name', work_item_name, 'report_date', report_date,
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
--
-- security definer: progress_reports KHÔNG có policy update (append-only),
-- nên hàm chạy bằng quyền invoker sẽ không đổi được status — bản trước
-- dùng security invoker và mọi lần duyệt đều thất bại ngầm. Thay vào
-- đó hàm tự kiểm tra: đã đăng nhập + có quyền trên công trình.
--
-- Duyệt theo NHÓM trong 1 transaction: hộp duyệt gộp nhiều báo cáo
-- cùng (đầu việc, ngày) thành 1 thẻ. Hỏng giữa chừng thì rollback cả
-- nhóm, không để lại trạng thái nửa vời.
-- ============================================================

-- work_packages.status là cache tổng hợp từ work_items — client_view()
-- đọc cột này để hiện tiến độ cho chủ nhà.
create or replace function _refresh_package_status(p_package_id uuid)
returns void
language sql security definer set search_path = public as $$
  update work_packages set
    status = coalesce((
      select case
        when count(*) = 0 then 'notStarted'
        when count(*) filter (where wi.status <> 'done') = 0 then 'done'
        when bool_or(wi.status = 'delayed') then 'delayed'
        when bool_or(wi.status in ('onTrack', 'ahead', 'done')) then 'onTrack'
        else 'notStarted'
      end
      from work_items wi where wi.work_package_id = p_package_id
    ), 'notStarted'),
    updated_at = now()
  where id = p_package_id;
$$;

create or replace function approve_report_group(p_report_ids uuid[], p_total numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_found int;
  v_pending int;
  v_item_count int;
  v_item_id uuid;
  v_first uuid;
  v_total numeric;
  v_package_id uuid;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_ids := array(select distinct unnest(p_report_ids));
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'empty_group';
  end if;
  if p_total is not null and p_total < 0 then
    raise exception 'negative_qty';
  end if;

  -- Khoá theo thứ tự id — hai giám sát duyệt cùng lúc thì người thứ hai
  -- đợi người thứ nhất commit rồi mới thấy status đã đổi (không cộng 2 lần).
  perform 1 from progress_reports where id = any(v_ids) order by id for update;

  select count(*), count(*) filter (where status = 'pending'), count(distinct work_item_id), min(work_item_id::text)::uuid
    into v_found, v_pending, v_item_count, v_item_id
    from progress_reports where id = any(v_ids);
  if v_found <> cardinality(v_ids) then raise exception 'report_not_found'; end if;
  if v_pending <> v_found then raise exception 'already_processed'; end if;
  if v_item_count <> 1 then raise exception 'mixed_items'; end if;
  if not can_access_project(_item_project(v_item_id)) then raise exception 'forbidden'; end if;

  select coalesce(p_total, sum(qty_delta)) into v_total from progress_reports where id = any(v_ids);
  select id into v_first from progress_reports where id = any(v_ids) order by created_at, id limit 1;

  -- Báo cáo đầu nhận tổng khối lượng đã chỉnh, các báo cáo còn lại 0 —
  -- tổng approved_qty của nhóm luôn bằng đúng số giám sát chốt.
  update progress_reports set
    status = 'approved',
    approved_qty = case when id = v_first then v_total else 0 end,
    approved_by = auth.uid(),
    approved_at = now()
  where id = any(v_ids) and status = 'pending';

  update work_items set
    qty_done = qty_done + v_total,
    percent = case when qty_plan is not null and qty_plan > 0
                   then least(100, round((qty_done + v_total) / qty_plan * 100))
                   else percent end,
    status = case
                when qty_plan is not null and qty_plan > 0 and (qty_done + v_total) >= qty_plan then 'done'
                when status = 'notStarted' then 'onTrack'
                else status
              end
    where id = v_item_id
    returning work_package_id into v_package_id;

  perform _refresh_package_status(v_package_id);
  return v_total;
end;
$$;

-- Giữ tương thích: duyệt 1 báo cáo = nhóm 1 phần tử
create or replace function approve_report(p_report_id uuid, p_approved_qty numeric default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform approve_report_group(array[p_report_id], p_approved_qty);
end;
$$;

create or replace function reject_report_group(p_report_ids uuid[], p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_found int;
  v_pending int;
  v_bad int;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_ids := array(select distinct unnest(p_report_ids));
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'empty_group';
  end if;

  perform 1 from progress_reports where id = any(v_ids) order by id for update;

  select count(*), count(*) filter (where status = 'pending'),
         count(*) filter (where not can_access_project(_item_project(work_item_id)))
    into v_found, v_pending, v_bad
    from progress_reports where id = any(v_ids);
  if v_found <> cardinality(v_ids) then raise exception 'report_not_found'; end if;
  if v_bad > 0 then raise exception 'forbidden'; end if;
  if v_pending <> v_found then raise exception 'already_processed'; end if;

  update progress_reports set
    status = 'rejected',
    reject_reason = coalesce(nullif(trim(p_reason), ''), 'Không đạt yêu cầu'),
    approved_by = auth.uid(),
    approved_at = now()
  where id = any(v_ids) and status = 'pending';
end;
$$;

create or replace function reject_report(p_report_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform reject_report_group(array[p_report_id], p_reason);
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
    where wi.status <> 'done'
  )
  update work_items wi set status = c.new_status
  from calc c
  where wi.id = c.id and wi.status is distinct from c.new_status;

  perform _refresh_package_status(wp.id) from work_packages wp;

  return v_count;
end;
$$;

-- Lên lịch chạy 7h và 15h mỗi ngày. Nếu lệnh dưới báo lỗi "permission
-- denied" hoặc "extension pg_cron does not exist", vào Dashboard >
-- Database > Extensions > bật "pg_cron" trước, rồi chạy lại 2 dòng này.
create extension if not exists pg_cron;
-- pg_cron chạy theo giờ UTC: 0h UTC = 7h, 8h UTC = 15h giờ Việt Nam
select cron.schedule('mda-compute-alerts-morning', '0 0 * * *', $$select compute_alerts();$$);
select cron.schedule('mda-compute-alerts-afternoon', '0 8 * * *', $$select compute_alerts();$$);

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
-- ĐỒNG BỘ ẢNH DROPBOX — mỗi 10 phút gọi Edge Function dropbox-sync
-- (chuyển ảnh gốc từ "_Chờ duyệt" sang thư mục ngày sau khi duyệt, sao
-- chép bản nén cho báo cáo thiếu ảnh gốc). Cũng cần điền 2 giá trị thật
-- như trên và đã đặt secrets DROPBOX_* (xem HUONG_DAN_TRIEN_KHAI.md).
-- ============================================================
-- select cron.schedule('mda-dropbox-sync', '*/10 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/dropbox-sync',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 120000
--   );
-- $$);

-- ============================================================
-- THÔNG BÁO NGAY KHI CÓ BÁO CÁO MỚI — mỗi phút kiểm tra notify_due(),
-- có việc mới gọi send-alerts (gửi luôn cả cảnh báo trễ hạn nên không
-- cần 2 job mda-send-alerts-* ở trên nữa). Đoạn dưới lấy lại URL + key
-- từ job mda-dropbox-sync đã tạo — không phải dán key lần nữa.
-- ============================================================
-- do $do$
-- declare v_cmd text; v_url text; v_key text;
-- begin
--   select command into v_cmd from cron.job where command like '%dropbox-sync%' limit 1;
--   v_url := substring(v_cmd from '(https://[a-z0-9]+\.supabase\.co)');
--   v_key := substring(v_cmd from 'Bearer ([^'']+)');
--   if v_url is null or v_key is null then raise exception 'Chưa có job dropbox-sync để lấy URL/key'; end if;
--   perform cron.schedule('mda-notify', '* * * * *', format(
--     $f$select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb) where notify_due()$f$,
--     v_url || '/functions/v1/send-alerts', 'Bearer ' || v_key));
-- end $do$;

-- ============================================================
-- DỜI LỊCH CẢ HẠNG MỤC — thầu phụ vào trễ / sớm N ngày thì dời toàn bộ
-- đầu việc cùng lúc, thay vì sửa tay từng ngày. security invoker: RLS
-- quyết định ai được dời (KTS chỉ dời được công trình mình phụ trách).
-- ============================================================
create or replace function shift_package_schedule(p_package_id uuid, p_days int)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_days is null or p_days = 0 then return; end if;
  if abs(p_days) > 365 then raise exception 'invalid_shift'; end if;
  update work_packages set planned_start = planned_start + p_days, planned_end = planned_end + p_days
    where id = p_package_id;
  if not found then raise exception 'forbidden'; end if;
  update work_items set planned_start = planned_start + p_days, planned_end = planned_end + p_days
    where work_package_id = p_package_id;
end;
$$;

-- ============================================================
-- DASHBOARD QUẢN LÝ — một lần gọi trả đủ số liệu cho tab Tổng quan.
-- security invoker: chạy bằng quyền người gọi nên RLS tự lọc — KTS chỉ
-- thấy số liệu công trình mình phụ trách, quản lý thấy tất cả.
--
-- % thực tế / % kế hoạch có TRỌNG SỐ theo thời lượng đầu việc (đầu
-- việc 10 ngày nặng gấp 10 lần đầu việc 1 ngày) — trung bình cộng
-- thường làm "Nghiệm thu 1 ngày xong" kéo % cả hạng mục lên ảo.
-- % kế hoạch dùng cùng công thức với compute_alerts() mục 5.
-- ============================================================
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
    where p.status = 'active'
  ),
  reports as (
    select pr.id, pr.status, pr.report_date, pr.created_at, pr.approved_at, wp.project_id, wp.subcontractor_id, pr.work_item_id
    from progress_reports pr
    join work_items wi on wi.id = pr.work_item_id
    join work_packages wp on wp.id = wi.work_package_id
  ),
  proj as (
    select p.id, p.name, p.client_name, p.start_date, p.end_date,
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
        'id', pr.id, 'name', pr.name, 'client_name', pr.client_name,
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

-- ============================================================
-- DROPBOX — hàng đợi cho Edge Function dropbox-sync (chỉ service_role gọi)
-- ============================================================

-- Ảnh gốc cấp link quá 6 giờ mà máy thợ chưa báo gửi xong → coi như
-- hỏng, để bước sao chép bản nén (dropbox_missing_copies) lấp chỗ trống.
create or replace function dropbox_expire_uploads()
returns int
language sql security definer set search_path = public as $$
  with x as (
    update photo_archive set state = 'failed', error = 'Không nhận được ảnh gốc từ máy thợ', updated_at = now()
    where state = 'uploading' and created_at < now() - interval '6 hours'
    returning 1
  ) select count(*)::int from x;
$$;

-- Ảnh đang nằm "_Chờ duyệt" mà báo cáo đã được duyệt / trả lại → cần chuyển thư mục
create or replace function dropbox_moves_due(p_limit int default 100)
returns table (
  archive_id uuid, dropbox_path text, report_status text, report_date date,
  project_name text, sub_name text, item_name text
)
language sql stable security definer set search_path = public as $$
  select pa.id, pa.dropbox_path, pr.status, pr.report_date, p.name, s.name, wi.name
  from photo_archive pa
  join progress_reports pr on pr.id = pa.report_id
  join work_items wi on wi.id = pr.work_item_id
  join work_packages wp on wp.id = wi.work_package_id
  join projects p on p.id = wp.project_id
  join subcontractors s on s.id = wp.subcontractor_id
  where pa.state = 'pending' and pr.status in ('approved', 'rejected') and pa.attempts < 5
  order by pa.created_at
  limit p_limit;
$$;

-- Ảnh của báo cáo ĐÃ DUYỆT chưa có bản nào trên Dropbox (thợ mất sóng
-- không gửi được ảnh gốc, hoặc staff nhập thay) → sao chép bản nén.
create or replace function dropbox_missing_copies(p_limit int default 30)
returns table (
  report_id uuid, project_id uuid, storage_path text, photo_no int, report_date date,
  project_name text, sub_name text, item_name text, reporter_name text, prior_attempts int
)
language sql stable security definer set search_path = public as $$
  select pr.id, wp.project_id, ph.value->>'path', ph.ord::int, pr.report_date,
    p.name, s.name, wi.name, pr.reporter_name,
    coalesce((select max(pa.attempts) from photo_archive pa
      where pa.report_id = pr.id and pa.storage_path = ph.value->>'path' and pa.source = 'compressed'), 0)
  from progress_reports pr
  join work_items wi on wi.id = pr.work_item_id
  join work_packages wp on wp.id = wi.work_package_id
  join projects p on p.id = wp.project_id
  join subcontractors s on s.id = wp.subcontractor_id
  cross join lateral jsonb_array_elements(pr.photos) with ordinality as ph(value, ord)
  where pr.status = 'approved'
    and coalesce(ph.value->>'path', '') <> ''
    and not exists (
      select 1 from photo_archive pa
      where pa.report_id = pr.id and pa.storage_path = ph.value->>'path'
        and (pa.state <> 'failed' or (pa.source = 'compressed' and pa.attempts >= 5))
    )
  order by pr.approved_at
  limit p_limit;
$$;

-- ============================================================
-- THÔNG BÁO BÁO CÁO MỚI — hàng đợi cho Edge Function send-alerts.
-- Gom theo (công trình, người gửi): thợ gửi liền 3 đầu việc thì quản lý
-- nhận 1 thông báo, không phải 3. Nhóm còn báo cáo gửi trong p_quiet
-- gần đây thì chờ lượt sau — thợ có thể đang gửi tiếp.
-- ============================================================
create or replace function reports_to_notify(p_quiet interval default interval '90 seconds')
returns table (
  report_id uuid, project_id uuid, project_name text, reporter_key text,
  reporter_name text, staff_id uuid, sub_name text, item_name text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with q as (
    select pr.id, wp.project_id, p.name as project_name,
      coalesce(pr.crew_link_id::text, pr.staff_id::text) as reporter_key,
      pr.reporter_name, pr.staff_id, s.name as sub_name, wi.name as item_name, pr.created_at
    from progress_reports pr
    join work_items wi on wi.id = pr.work_item_id
    join work_packages wp on wp.id = wi.work_package_id
    join projects p on p.id = wp.project_id
    join subcontractors s on s.id = wp.subcontractor_id
    where pr.status = 'pending'
      and pr.created_at > now() - interval '3 days'
      and not exists (select 1 from report_notifications rn where rn.report_id = pr.id)
  )
  select * from q
  where not exists (
    select 1 from q y
    where y.project_id = q.project_id and y.reporter_key = q.reporter_key
      and y.created_at > now() - p_quiet
  )
  order by q.created_at;
$$;

create or replace function mark_reports_notified(p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  insert into report_notifications(report_id)
  select unnest(p_ids) on conflict (report_id) do nothing;
$$;

-- Cron mỗi phút chỉ gọi Edge Function khi có việc — tránh tốn lượt gọi
create or replace function notify_due()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from progress_reports pr
    where pr.status = 'pending' and pr.created_at > now() - interval '3 days'
      and not exists (select 1 from report_notifications rn where rn.report_id = pr.id)
  ) or exists (select 1 from alerts where notified_at is null);
$$;

-- ============================================================
-- REALTIME (bọc exception để chạy lại file này nhiều lần không lỗi)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['work_items', 'progress_reports', 'issues', 'alerts'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

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
alter table project_members enable row level security;
alter table photo_archive enable row level security;
alter table report_notifications enable row level security;  -- không cấp quyền cho ai, chỉ hàm security definer ghi

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Postgres tự cấp EXECUTE cho PUBLIC (nên anon cũng có) khi tạo hàm mới.
-- Thu hồi hết rồi cấp lại đúng từng hàm ở dưới — nếu không, các hàm
-- security definer không cố ý cho anon gọi (approve_report, reject_report,
-- compute_alerts) vẫn bị gọi được vì không có dòng revoke nào chặn PUBLIC.
revoke execute on all functions in schema public from public;

grant select, insert, update, delete on
  subcontractors, projects, work_packages, work_items, dependencies,
  progress_reports, issues, crew_links, client_links, alerts,
  push_subscriptions, work_package_templates, work_package_template_items,
  project_members
to authenticated;
grant select on photo_archive to authenticated;  -- chỉ Edge Function (service_role) được ghi

-- staff: ai cũng đọc được danh sách, chỉ tự sửa được TÊN + SỐ ĐIỆN THOẠI
-- của mình. Cột role chỉ đổi qua set_staff_role() — nếu cho update cả
-- dòng, KTS tự nâng mình thành admin là thấy hết mọi công trình.
revoke all on staff from authenticated;
grant select on staff to authenticated;
grant update (full_name, phone) on staff to authenticated;

-- Xoá policy cũ trước khi tạo lại — "create policy" không idempotent.
drop policy if exists "staff full access" on subcontractors;
drop policy if exists "staff full access" on projects;
drop policy if exists "staff full access" on work_packages;
drop policy if exists "staff full access" on work_items;
drop policy if exists "staff full access" on dependencies;
drop policy if exists "staff full access" on issues;
drop policy if exists "staff full access" on crew_links;
drop policy if exists "staff full access" on client_links;
drop policy if exists "staff full access" on alerts;
drop policy if exists "staff full access" on work_package_templates;
drop policy if exists "staff full access" on work_package_template_items;

-- Danh mục dùng chung mọi công trình: đội thầu phụ, mẫu đầu việc
create policy "staff full access" on subcontractors for all to authenticated using (true) with check (true);
create policy "staff full access" on work_package_templates for all to authenticated using (true) with check (true);
create policy "staff full access" on work_package_template_items for all to authenticated using (true) with check (true);

-- Dữ liệu theo công trình: KTS chỉ chạm được công trình mình phụ trách
drop policy if exists "project read" on projects;
drop policy if exists "project create" on projects;
drop policy if exists "project update" on projects;
drop policy if exists "project delete" on projects;
create policy "project read" on projects for select to authenticated
  using (created_by = auth.uid() or can_access_project(id));
create policy "project create" on projects for insert to authenticated
  with check (created_by = auth.uid() or is_manager());
create policy "project update" on projects for update to authenticated
  using (can_access_project(id)) with check (can_access_project(id));
create policy "project delete" on projects for delete to authenticated
  using (is_manager());

drop policy if exists "project scope" on work_packages;
create policy "project scope" on work_packages for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

drop policy if exists "project scope" on work_items;
create policy "project scope" on work_items for all to authenticated
  using (can_access_project(_package_project(work_package_id)))
  with check (can_access_project(_package_project(work_package_id)));

drop policy if exists "project scope" on dependencies;
create policy "project scope" on dependencies for all to authenticated
  using (can_access_project(_item_project(predecessor_item_id)))
  with check (can_access_project(_item_project(predecessor_item_id))
          and can_access_project(_item_project(successor_item_id)));

drop policy if exists "project scope" on issues;
create policy "project scope" on issues for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

drop policy if exists "project scope" on crew_links;
create policy "project scope" on crew_links for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

drop policy if exists "project scope" on client_links;
create policy "project scope" on client_links for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

drop policy if exists "project scope" on alerts;
create policy "project scope" on alerts for all to authenticated
  using (can_access_project(project_id)) with check (can_access_project(project_id));

drop policy if exists "project scope read" on photo_archive;
create policy "project scope read" on photo_archive for select to authenticated
  using (can_access_project(project_id));

-- Thành viên công trình: ai cũng xem được mình phụ trách gì, chỉ quản lý gán/bỏ.
drop policy if exists "members read" on project_members;
drop policy if exists "members manage" on project_members;
drop policy if exists "members remove" on project_members;
create policy "members read" on project_members for select to authenticated
  using (staff_id = auth.uid() or is_manager() or can_access_project(project_id));
create policy "members manage" on project_members for insert to authenticated
  with check (is_manager());
create policy "members remove" on project_members for delete to authenticated
  using (is_manager());

-- progress_reports: staff xem và có thể nhập thay đội không dùng app.
-- KHÔNG có policy insert cho anon — thầu phụ chỉ ghi được qua
-- crew_submit() (security definer, bỏ qua RLS).
-- KHÔNG có policy update trực tiếp — progress_reports là append-only,
-- chỉ approve_report_group()/reject_report_group() (security definer +
-- kiểm tra quyền công trình) được đổi status/approved_qty/reject_reason.
-- Insert của staff bị ép status='pending' — không tự tạo báo cáo "đã
-- duyệt" để lách bước duyệt.
drop policy if exists "staff update reports" on progress_reports;
drop policy if exists "staff read reports" on progress_reports;
drop policy if exists "staff insert reports" on progress_reports;
create policy "staff read reports" on progress_reports for select to authenticated
  using (can_access_project(_item_project(work_item_id)));
create policy "staff insert reports" on progress_reports for insert to authenticated
  with check (
    can_access_project(_item_project(work_item_id))
    and reporter_kind = 'staff' and staff_id = auth.uid()
    and status = 'pending' and approved_qty is null and approved_by is null and approved_at is null
  );

drop policy if exists "staff manage own push" on push_subscriptions;
create policy "staff manage own push" on push_subscriptions for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid());

drop policy if exists "staff read all profiles" on staff;
drop policy if exists "staff update own profile" on staff;
create policy "staff read all profiles" on staff for select to authenticated using (true);
create policy "staff update own profile" on staff for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

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
-- Dùng bên trong policy — người gọi (authenticated) phải được thực thi
grant execute on function is_manager() to authenticated;
grant execute on function can_access_project(uuid) to authenticated;
grant execute on function _package_project(uuid) to authenticated;
grant execute on function _item_project(uuid) to authenticated;
grant execute on function _path_project(text) to authenticated;
-- Hàng đợi Dropbox: chỉ Edge Function dropbox-sync (service_role)
grant execute on function dropbox_expire_uploads() to service_role;
grant execute on function dropbox_moves_due(int) to service_role;
grant execute on function dropbox_missing_copies(int) to service_role;
-- Thông báo báo cáo mới: Edge Function send-alerts + cron mda-notify
grant execute on function reports_to_notify(interval) to service_role;
grant execute on function mark_reports_notified(uuid[]) to service_role;
grant execute on function notify_due() to service_role;

-- ============================================================
-- STORAGE: bucket private cho ảnh hiện trường
--
-- Thầu phụ/công nhân (anon, không đăng nhập) upload qua Edge Function
-- crew-upload — hàm đó dùng service_role nên KHÔNG cần policy insert
-- cho anon ở đây (RLS dưới đây chỉ áp cho request từ browser/app trực
-- tiếp bằng anon/authenticated key).
--
-- Staff (đăng nhập) upload trực tiếp khi nhập thay đội không dùng app,
-- và cần đọc (createSignedUrl) để xem lại ảnh trong hộp duyệt. Đường
-- dẫn ảnh bắt đầu bằng project_id/ nên lọc được theo quyền công trình.
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('site-photos', 'site-photos', false)
  on conflict (id) do nothing;

drop policy if exists "staff read site-photos" on storage.objects;
drop policy if exists "staff upload site-photos" on storage.objects;
create policy "staff read site-photos" on storage.objects for select to authenticated
  using (bucket_id = 'site-photos' and can_access_project(_path_project(name)));
create policy "staff upload site-photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-photos' and can_access_project(_path_project(name)));

-- ============================================================
-- DỮ LIỆU MẪU: template đầu việc cho đá và điện
-- ============================================================

insert into work_package_templates (id, trade, name) values
  ('00000000-0000-0000-0000-000000000001', 'da', 'Thi công đá — mẫu chuẩn'),
  ('00000000-0000-0000-0000-000000000002', 'dien', 'Thi công điện — mẫu chuẩn')
on conflict (id) do nothing;

-- Bảng này không có khoá duy nhất nên "on conflict do nothing" không
-- chặn được trùng — chỉ seed khi mẫu chưa có đầu việc nào.
insert into work_package_template_items (template_id, name, seq, unit, default_duration_days)
select v.template_id::uuid, v.name, v.seq, v.unit, v.days from (values
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
) as v(template_id, name, seq, unit, days)
where not exists (select 1 from work_package_template_items t where t.template_id = v.template_id::uuid);

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
