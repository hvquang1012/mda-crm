-- ============================================================
-- TRÒ CHUYỆN THEO ĐẦU VIỆC — chạy SAU 007_khoa_link_chu_nha.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống đoạn tương ứng trong schema.sql.)
--
-- Mỗi đầu việc có 1 luồng trò chuyện giữa nhân viên (đăng nhập) và thợ
-- (link crew.html?t=...). Chủ nhà KHÔNG thấy gì — client_view() không
-- đọc bảng này.
-- ============================================================
begin;

-- Tin nhắn — CHỈ GHI THÊM: không có quyền / policy update, delete.
create table if not exists item_messages (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,  -- để lọc quyền theo công trình
  author_kind text not null check (author_kind in ('staff','crew')),
  staff_id uuid references auth.users(id),
  crew_link_id uuid references crew_links(id),
  author_name text not null,
  body text not null default '' check (length(body) <= 2000),
  photos jsonb not null default '[]'::jsonb,        -- [{path, thumb_path, taken_at}]
  client_ref uuid unique,                           -- mã do máy gửi tự sinh — gửi lại không tạo bản trùng
  created_at timestamptz not null default now(),
  check (
    (author_kind = 'crew' and crew_link_id is not null and staff_id is null) or
    (author_kind = 'staff' and staff_id is not null and crew_link_id is null)
  ),
  check (length(trim(body)) > 0 or (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0))
);
create index if not exists idx_item_messages_item on item_messages(work_item_id, created_at);
create index if not exists idx_item_messages_project on item_messages(project_id, created_at);

-- Nhân viên đã đọc luồng tới lúc nào — để đếm tin chưa đọc
create table if not exists item_message_reads (
  staff_id uuid not null references auth.users(id) on delete cascade,
  work_item_id uuid not null references work_items(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (staff_id, work_item_id)
);

-- Tin của thợ đã đẩy thông báo chưa (Edge Function send-alerts ghi).
-- Bảng riêng vì item_messages chỉ ghi thêm.
create table if not exists item_message_notifications (
  message_id uuid primary key references item_messages(id) on delete cascade,
  notified_at timestamptz not null default now()
);

-- ---------- RPC cho thợ (không đăng nhập, chỉ có token) ----------

-- Đầu việc có thuộc đúng (công trình, đội) của link không
create or replace function _crew_owns_item(v_link crew_links, p_item_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from work_items wi
    join work_packages wp on wp.id = wi.work_package_id
    where wi.id = p_item_id
      and wp.project_id = v_link.project_id
      and wp.subcontractor_id = v_link.subcontractor_id
  );
$$;

create or replace function crew_messages(p_token text, p_item_id uuid, p_since timestamptz default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_result json;
begin
  v_link := _resolve_crew_link(p_token);
  if not _crew_owns_item(v_link, p_item_id) then
    raise exception 'item_not_in_scope';
  end if;

  with recent as (
    select m.* from item_messages m
    where m.work_item_id = p_item_id
      and (p_since is null or m.created_at > p_since)
    order by m.created_at desc
    limit 200
  )
  select coalesce(json_agg(json_build_object(
    'id', id, 'author_kind', author_kind, 'author_name', author_name,
    'body', body, 'photos', photos, 'created_at', created_at,
    'client_ref', client_ref, 'mine', crew_link_id is not distinct from v_link.id
  ) order by created_at), '[]'::json)
  into v_result from recent;

  return v_result;
end;
$$;

create or replace function crew_send_message(
  p_token text,
  p_item_id uuid,
  p_body text,
  p_photos jsonb default '[]'::jsonb,
  p_author_name text default null,
  p_client_ref uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
  v_id uuid;
  v_body text := coalesce(trim(p_body), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
begin
  v_link := _resolve_crew_link(p_token);

  -- Gửi lại từ hàng đợi offline: tin này đã lưu rồi thì trả id cũ
  if p_client_ref is not null then
    select id into v_id from item_messages where client_ref = p_client_ref and crew_link_id = v_link.id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if not _crew_owns_item(v_link, p_item_id) then
    raise exception 'item_not_in_scope';
  end if;
  if jsonb_typeof(v_photos) <> 'array' then
    raise exception 'photo_not_in_scope';
  end if;
  if length(v_body) = 0 and jsonb_array_length(v_photos) = 0 then
    raise exception 'message_empty';
  end if;
  if length(v_body) > 2000 then
    raise exception 'message_too_long';
  end if;
  -- Ảnh phải nằm trong thư mục của đúng (công trình, đội) — do crew-upload cấp
  if exists (
    select 1 from jsonb_array_elements(v_photos) el
    where coalesce(el->>'path', '') not like v_link.project_id::text || '/' || v_link.subcontractor_id::text || '/%'
       or (el->>'thumb_path' is not null
           and el->>'thumb_path' not like v_link.project_id::text || '/' || v_link.subcontractor_id::text || '/%')
  ) then
    raise exception 'photo_not_in_scope';
  end if;

  insert into item_messages(work_item_id, project_id, author_kind, crew_link_id, author_name, body, photos, client_ref)
  values (
    p_item_id, v_link.project_id, 'crew', v_link.id,
    coalesce(nullif(trim(p_author_name), ''), v_link.person_name, 'Đội thi công'),
    v_body, v_photos, p_client_ref
  ) returning id into v_id;

  return v_id;
end;
$$;

-- crew_bootstrap: thêm last_message_at cho mỗi đầu việc (chấm "có tin mới" ở crew.html)
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
        'planned_start', wi.planned_start, 'planned_end', wi.planned_end,
        'last_message_at', (select max(m.created_at) from item_messages m where m.work_item_id = wi.id)
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

-- ---------- RPC cho nhân viên (security invoker — RLS tự lọc công trình) ----------

-- Hộp trò chuyện: mọi đầu việc có tin, đầu việc có tin chưa đọc lên trước
create or replace function chat_inbox()
returns table (
  work_item_id uuid, item_name text, project_id uuid, project_name text,
  subcontractor_id uuid, sub_name text, last_body text, last_author text,
  last_author_kind text, last_has_photos boolean, last_at timestamptz,
  unread int, total int
)
language sql stable security invoker set search_path = public as $$
  with last as (
    select distinct on (m.work_item_id) m.*
    from item_messages m
    order by m.work_item_id, m.created_at desc
  ), cnt as (
    select m.work_item_id,
      count(*)::int as total,
      (count(*) filter (
        where m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
          and m.staff_id is distinct from auth.uid()
      ))::int as unread
    from item_messages m
    left join item_message_reads r on r.work_item_id = m.work_item_id and r.staff_id = auth.uid()
    group by m.work_item_id
  )
  select l.work_item_id, wi.name, wp.project_id, p.name, wp.subcontractor_id, s.name,
    l.body, l.author_name, l.author_kind, jsonb_array_length(l.photos) > 0, l.created_at,
    c.unread, c.total
  from last l
  join cnt c on c.work_item_id = l.work_item_id
  join work_items wi on wi.id = l.work_item_id
  join work_packages wp on wp.id = wi.work_package_id
  join projects p on p.id = wp.project_id
  join subcontractors s on s.id = wp.subcontractor_id
  order by (c.unread > 0) desc, l.created_at desc;
$$;

-- Đánh dấu đã đọc — giờ máy chủ, không tin đồng hồ điện thoại
create or replace function chat_mark_read(p_item_id uuid)
returns void
language sql security invoker set search_path = public as $$
  insert into item_message_reads(staff_id, work_item_id, last_read_at)
  values (auth.uid(), p_item_id, now())
  on conflict (staff_id, work_item_id) do update set last_read_at = excluded.last_read_at;
$$;

-- ---------- Thông báo đẩy khi thợ nhắn (Edge Function send-alerts) ----------
-- Gom theo (công trình, đầu việc); nhóm còn tin mới trong p_quiet thì chờ
-- lượt sau — thợ thường nhắn liền mấy tin.
create or replace function messages_to_notify(p_quiet interval default interval '60 seconds')
returns table (
  message_id uuid, project_id uuid, project_name text, work_item_id uuid, item_name text,
  sub_name text, author_name text, body text, has_photos boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with q as (
    select m.id, m.project_id, p.name as project_name, m.work_item_id, wi.name as item_name,
      s.name as sub_name, m.author_name, m.body, jsonb_array_length(m.photos) > 0 as has_photos, m.created_at
    from item_messages m
    join work_items wi on wi.id = m.work_item_id
    join work_packages wp on wp.id = wi.work_package_id
    join projects p on p.id = m.project_id
    join subcontractors s on s.id = wp.subcontractor_id
    where m.author_kind = 'crew'
      and m.created_at > now() - interval '3 days'
      and not exists (select 1 from item_message_notifications n where n.message_id = m.id)
  )
  select * from q
  where not exists (
    select 1 from q y
    where y.work_item_id = q.work_item_id and y.created_at > now() - p_quiet
  )
  order by q.created_at;
$$;

create or replace function mark_messages_notified(p_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  insert into item_message_notifications(message_id)
  select unnest(p_ids) on conflict (message_id) do nothing;
$$;

-- Cron mda-notify: có tin thợ chưa báo thì cũng gọi send-alerts
create or replace function notify_due()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from progress_reports pr
    where pr.status = 'pending' and pr.created_at > now() - interval '3 days'
      and not exists (select 1 from report_notifications rn where rn.report_id = pr.id)
  ) or exists (select 1 from alerts where notified_at is null)
  or exists (
    select 1 from item_messages m
    where m.author_kind = 'crew' and m.created_at > now() - interval '3 days'
      and not exists (select 1 from item_message_notifications n where n.message_id = m.id)
  );
$$;

-- ---------- Realtime ----------
do $$ begin
  alter publication supabase_realtime add table item_messages;
exception when duplicate_object then null;
end $$;

-- ---------- Bảo mật ----------
alter table item_messages enable row level security;
alter table item_message_reads enable row level security;
alter table item_message_notifications enable row level security;  -- không cấp cho ai, chỉ hàm security definer ghi

revoke all on item_messages, item_message_reads, item_message_notifications from anon;
revoke all on item_messages, item_message_reads, item_message_notifications from authenticated;
grant select, insert on item_messages to authenticated;           -- KHÔNG update/delete: chỉ ghi thêm
grant select, insert, update on item_message_reads to authenticated;

drop policy if exists "project scope read" on item_messages;
drop policy if exists "staff send" on item_messages;
create policy "project scope read" on item_messages for select to authenticated
  using (can_access_project(project_id));
create policy "staff send" on item_messages for insert to authenticated
  with check (
    can_access_project(project_id)
    and project_id = _item_project(work_item_id)
    and author_kind = 'staff' and staff_id = auth.uid() and crew_link_id is null
    and jsonb_typeof(photos) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(photos) el
      where _path_project(el->>'path') is distinct from project_id
    )
  );

drop policy if exists "own reads" on item_message_reads;
create policy "own reads" on item_message_reads for all to authenticated
  using (staff_id = auth.uid())
  with check (staff_id = auth.uid() and can_access_project(_item_project(work_item_id)));

revoke execute on function _crew_owns_item(crew_links, uuid) from public;
revoke execute on function crew_messages(text, uuid, timestamptz) from public;
revoke execute on function crew_send_message(text, uuid, text, jsonb, text, uuid) from public;
revoke execute on function chat_inbox() from public;
revoke execute on function chat_mark_read(uuid) from public;
revoke execute on function messages_to_notify(interval) from public;
revoke execute on function mark_messages_notified(uuid[]) from public;
grant execute on function crew_messages(text, uuid, timestamptz) to anon, authenticated;
grant execute on function crew_send_message(text, uuid, text, jsonb, text, uuid) to anon, authenticated;
grant execute on function chat_inbox() to authenticated;
grant execute on function chat_mark_read(uuid) to authenticated;
grant execute on function messages_to_notify(interval) to service_role;
grant execute on function mark_messages_notified(uuid[]) to service_role;

commit;
