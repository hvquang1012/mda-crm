-- ============================================================
-- QUẢN LÝ NHÂN VIÊN + NHẬT KÝ THAO TÁC — chạy SAU 008_tro_chuyen.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống đoạn tương ứng trong schema.sql.)
--
-- Sau khi chạy: deploy Edge Function admin-users để tạo tài khoản /
-- khoá đăng nhập / cấp lại mật khẩu ngay trong app (màn "Nhân viên").
-- ============================================================
begin;

-- Nhân viên nghỉ việc: KHOÁ (active = false), không xoá — auth.users còn
-- bị progress_reports.staff_id / approved_by tham chiếu (lịch sử duyệt).
-- Khoá là mất quyền ngay ở tầng DB (is_manager / can_access_project đọc
-- cột này), kể cả khi phiên đăng nhập cũ chưa hết hạn.
alter table staff add column if not exists email text;
alter table staff add column if not exists active boolean not null default true;
alter table staff add column if not exists deactivated_at timestamptz;

-- NHẬT KÝ THAO TÁC — CHỈ GHI THÊM (không policy update/delete). Ghi bằng
-- trigger security definer (_audit_*): đổi vai trò / khoá nhân viên, giao
-- / gỡ KTS, tạo / đóng / mở lại / xoá công trình, cấp / thu hồi link.
-- Edge Function admin-users ghi thêm 'staff_created' / 'password_reset'.
-- project_id KHÔNG khoá ngoại: xoá công trình vẫn giữ nhật ký của nó.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,                 -- null = hệ thống (cron, service_role)
  action text not null,
  project_id uuid,
  target_id uuid,                -- nhân viên / link bị tác động
  detail jsonb not null default '{}'::jsonb,   -- tên công trình, tên người... tại thời điểm ghi
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_log_created on audit_log(created_at desc);
create index if not exists idx_audit_log_project on audit_log(project_id, created_at desc);

create or replace function handle_new_staff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into staff(id, full_name, email) values (new.id, new.email, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;


update staff s set email = u.email from auth.users u where u.id = s.id and s.email is distinct from u.email;

create or replace function _staff_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;


create or replace function is_manager()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and role in ('manager','admin') and active);
$$;


create or replace function can_access_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and _staff_active() and (
    is_manager()
    or exists (select 1 from project_members m where m.project_id = p_project_id and m.staff_id = auth.uid())
    or exists (select 1 from projects p where p.id = p_project_id and p.created_by = auth.uid())
  );
$$;


create or replace function set_staff_role(p_staff_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from staff where id = auth.uid() and role = 'admin' and active) then
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
-- QUẢN LÝ NHÂN VIÊN + NHẬT KÝ THAO TÁC
-- Màn "Nhân viên" (js/staff/team.js). Tạo tài khoản / khoá đăng nhập /
-- cấp lại mật khẩu cần Auth Admin API nên đi qua Edge Function
-- admin-users; phần quyền trong DB nằm ở đây.
-- ============================================================

-- Khoá / mở khoá nhân viên (chỉ admin). Khoá = mất quyền ngay ở DB và
-- không nhận thông báo đẩy nữa; Edge Function admin-users chặn luôn đăng
-- nhập (ban) theo đúng cột active này.
create or replace function set_staff_active(p_staff_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from staff where id = auth.uid() and role = 'admin' and active) then
    raise exception 'admin_only';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'cannot_deactivate_self';
  end if;
  update staff set active = p_active, deactivated_at = case when p_active then null else now() end
  where id = p_staff_id and active is distinct from p_active;
  if not found and not exists (select 1 from staff where id = p_staff_id) then
    raise exception 'staff_not_found';
  end if;
  if not p_active then
    delete from push_subscriptions where staff_id = p_staff_id;
  end if;
end;
$$;

-- Danh sách nhân viên kèm khối việc — chỉ quản lý / quản trị.
-- security definer vì cần đọc auth.users.last_sign_in_at; tự kiểm quyền.
--   projects         công trình đang chạy người đó phụ trách (hoặc tự tạo)
--   pending_reports  báo cáo đang chờ duyệt ở các công trình đó
--   reviewed_30d     số báo cáo đã duyệt / trả lại trong 30 ngày
create or replace function staff_overview()
returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager() then
    raise exception 'manager_only';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', x.id, 'full_name', x.full_name, 'email', x.email, 'phone', x.phone,
      'role', x.role, 'active', x.active, 'deactivated_at', x.deactivated_at,
      'created_at', x.created_at, 'last_sign_in_at', x.last_sign_in_at,
      'projects', x.projects, 'pending_reports', x.pending_reports,
      'oldest_pending_at', x.oldest_pending_at,
      'reviewed_30d', x.reviewed_30d, 'last_reviewed_at', x.last_reviewed_at
    ) order by x.active desc, x.role_rank, lower(coalesce(x.full_name, x.email, '')))
    from (
      select s.id, s.full_name, s.email, s.phone,
        case when s.role = 'staff' then 'kts' else s.role end as role,
        case s.role when 'admin' then 0 when 'manager' then 1 else 2 end as role_rank,
        s.active, s.deactivated_at, s.created_at, u.last_sign_in_at,
        (select count(*) from projects p where p.status = 'active' and (p.created_by = s.id
          or exists (select 1 from project_members m where m.project_id = p.id and m.staff_id = s.id))) as projects,
        pend.n as pending_reports, pend.oldest as oldest_pending_at,
        (select count(*) from progress_reports r where r.approved_by = s.id and r.approved_at >= now() - interval '30 days') as reviewed_30d,
        (select max(r.approved_at) from progress_reports r where r.approved_by = s.id) as last_reviewed_at
      from staff s
      left join auth.users u on u.id = s.id
      left join lateral (
        select count(*) as n, min(r.created_at) as oldest
        from progress_reports r
        join work_items wi on wi.id = r.work_item_id
        join work_packages wp on wp.id = wi.work_package_id
        join projects p on p.id = wp.project_id
        where r.status = 'pending' and p.status = 'active' and (p.created_by = s.id
          or exists (select 1 from project_members m where m.project_id = p.id and m.staff_id = s.id))
      ) pend on true
    ) x
  ), '[]'::json);
end;
$$;

-- Ghi 1 dòng nhật ký. Chỉ trigger (security definer) gọi — không cấp cho ai.
create or replace function _audit(p_action text, p_project_id uuid, p_target_id uuid, p_detail jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into audit_log(actor_id, action, project_id, target_id, detail)
  values (auth.uid(), p_action, p_project_id, p_target_id, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function _audit_staff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    perform _audit('staff_role', null, new.id,
      jsonb_build_object('name', coalesce(new.full_name, new.email), 'from', old.role, 'to', new.role));
  end if;
  if new.active is distinct from old.active then
    perform _audit(case when new.active then 'staff_activated' else 'staff_deactivated' end, null, new.id,
      jsonb_build_object('name', coalesce(new.full_name, new.email)));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_staff_audit on staff;
create trigger trg_staff_audit after update of role, active on staff
  for each row execute function _audit_staff();

create or replace function _audit_project_members() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row project_members;
  v_project projects;
begin
  if tg_op = 'INSERT' then v_row := new; else v_row := old; end if;
  select * into v_project from projects where id = v_row.project_id;
  -- Công trình vừa bị xoá (xoá dây chuyền) — đã có dòng project_deleted
  if v_project.id is null then return null; end if;
  -- Người tạo tự được thêm vào lúc tạo công trình — đã có dòng project_created
  if tg_op = 'INSERT' and v_row.staff_id = v_project.created_by and v_row.staff_id = auth.uid() then return null; end if;
  perform _audit(case when tg_op = 'INSERT' then 'member_added' else 'member_removed' end,
    v_row.project_id, v_row.staff_id,
    jsonb_build_object('project', v_project.name,
      'name', (select coalesce(full_name, email) from staff where id = v_row.staff_id)));
  return null;
end;
$$;
drop trigger if exists trg_project_members_audit on project_members;
create trigger trg_project_members_audit after insert or delete on project_members
  for each row execute function _audit_project_members();

create or replace function _audit_projects() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _audit('project_created', new.id, null, jsonb_build_object('project', new.name));
  elsif tg_op = 'DELETE' then
    perform _audit('project_deleted', old.id, null, jsonb_build_object('project', old.name));
  elsif new.status is distinct from old.status then
    perform _audit(case when new.status = 'active' then 'project_reopened' else 'project_closed' end,
      new.id, null, jsonb_build_object('project', new.name, 'status', new.status));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_projects_audit on projects;
create trigger trg_projects_audit after insert or delete or update of status on projects
  for each row execute function _audit_projects();

-- Cấp link / thu hồi tay link thợ + chủ nhà. Khoá do đóng công trình
-- (closed_with_project) không ghi riêng — đã có dòng project_closed.
create or replace function _audit_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := to_jsonb(new);
  v_kind text := case when tg_table_name = 'crew_links' then 'crew_link' else 'client_link' end;
  v_detail jsonb;
begin
  if tg_op = 'UPDATE' and not (old.revoked_at is null and new.revoked_at is not null and not new.closed_with_project) then
    return null;
  end if;
  v_detail := jsonb_build_object('project', (select name from projects where id = new.project_id));
  if v_kind = 'crew_link' then
    v_detail := v_detail || jsonb_build_object('name', v->>'person_name',
      'team', (select name from subcontractors where id = (v->>'subcontractor_id')::uuid));
  end if;
  perform _audit(v_kind || case when tg_op = 'INSERT' then '_created' else '_revoked' end, new.project_id, new.id, v_detail);
  return null;
end;
$$;
drop trigger if exists trg_crew_links_audit on crew_links;
create trigger trg_crew_links_audit after insert or update of revoked_at on crew_links
  for each row execute function _audit_links();
drop trigger if exists trg_client_links_audit on client_links;
create trigger trg_client_links_audit after insert or update of revoked_at on client_links
  for each row execute function _audit_links();


-- Chính sách truy cập: nhân viên đã khoá mất quyền cả ở các bảng dùng chung
drop policy if exists "staff full access" on subcontractors;
drop policy if exists "staff full access" on work_package_templates;
drop policy if exists "staff full access" on work_package_template_items;
create policy "staff full access" on subcontractors for all to authenticated using (_staff_active()) with check (_staff_active());
create policy "staff full access" on work_package_templates for all to authenticated using (_staff_active()) with check (_staff_active());
create policy "staff full access" on work_package_template_items for all to authenticated using (_staff_active()) with check (_staff_active());

drop policy if exists "project read" on projects;
drop policy if exists "project create" on projects;
create policy "project read" on projects for select to authenticated
  using ((created_by = auth.uid() and _staff_active()) or can_access_project(id));
create policy "project create" on projects for insert to authenticated
  with check (_staff_active() and (created_by = auth.uid() or is_manager()));

drop policy if exists "staff manage own push" on push_subscriptions;
create policy "staff manage own push" on push_subscriptions for all to authenticated
  using (staff_id = auth.uid()) with check (staff_id = auth.uid() and _staff_active());

drop policy if exists "staff read all profiles" on staff;
create policy "staff read all profiles" on staff for select to authenticated using (id = auth.uid() or _staff_active());

-- Nhật ký thao tác: chỉ quản lý / quản trị đọc; KHÔNG ai ghi trực tiếp
-- (trigger security definer + Edge Function service_role ghi).
alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;
grant select on audit_log to authenticated;
drop policy if exists "managers read" on audit_log;
create policy "managers read" on audit_log for select to authenticated using (is_manager());

revoke execute on function set_staff_active(uuid, boolean) from public;
revoke execute on function staff_overview() from public;
revoke execute on function _staff_active() from public;
revoke execute on function _audit(text, uuid, uuid, jsonb) from public;
grant execute on function set_staff_active(uuid, boolean) to authenticated;
grant execute on function staff_overview() to authenticated;
grant execute on function _staff_active() to authenticated;

commit;
