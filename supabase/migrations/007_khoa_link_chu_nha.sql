-- ============================================================
-- KHOÁ LINK CHỦ NHÀ KHI ĐÓNG CÔNG TRÌNH — chạy SAU 006_khoa_link_tho.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- (Giống đoạn tương ứng trong schema.sql.)
-- ============================================================
begin;

alter table client_links add column if not exists closed_with_project boolean not null default false;  -- khoá do đóng công trình

create or replace function client_view(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_link client_links;
  v_result json;
begin
  select * into v_link from client_links where token = p_token;
  if v_link.id is null
     or (v_link.revoked_at is not null and not v_link.closed_with_project)
     or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    raise exception 'invalid_or_expired_token';
  end if;
  -- Công trình đã đóng: link chủ nhà khoá (kể cả link tạo sau khi đóng)
  if v_link.revoked_at is not null
     or not exists (select 1 from projects p where p.id = v_link.project_id and p.status = 'active') then
    raise exception 'project_closed';
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

create or replace function _on_project_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' then
    update alerts set acknowledged_at = now(), acknowledged_by = auth.uid()
    where project_id = new.id and acknowledged_at is null;
    -- Khoá link thợ + chủ nhà (revoked_at → Edge Function crew-upload/dropbox-link cũng chặn)
    update crew_links set revoked_at = now(), closed_with_project = true
    where project_id = new.id and revoked_at is null;
    update client_links set revoked_at = now(), closed_with_project = true
    where project_id = new.id and revoked_at is null;
  else
    -- Mở lại: chỉ mở khoá link bị khoá do đóng, link thu hồi tay giữ nguyên
    update crew_links set revoked_at = null, closed_with_project = false
    where project_id = new.id and closed_with_project;
    update client_links set revoked_at = null, closed_with_project = false
    where project_id = new.id and closed_with_project;
  end if;
  return null;
end;
$$;

-- Công trình đã đóng từ trước
update client_links l set revoked_at = now(), closed_with_project = true
from projects p
where p.id = l.project_id and p.status <> 'active' and l.revoked_at is null;

commit;
