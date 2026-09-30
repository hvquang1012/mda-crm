-- ============================================================
-- TIMELINE CHO CHỦ NHÀ — chạy SAU 008_tro_chuyen.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
-- client_view(): ngày hạng mục thiếu thì suy từ min/max ngày đầu việc con.
-- Vẫn chỉ trả 1 công trình, không tên thầu phụ, không issues, không tin nhắn.
-- ============================================================
begin;

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
        -- Hạng mục thiếu ngày thì suy từ đầu việc con (chỉ để hiển thị, không ghi DB)
        'planned_start', coalesce(wp.planned_start, (select min(wi3.planned_start) from work_items wi3 where wi3.work_package_id = wp.id)),
        'planned_end',   coalesce(wp.planned_end,   (select max(wi3.planned_end)   from work_items wi3 where wi3.work_package_id = wp.id)),
        'status', wp.status,
        'percent', (select coalesce(round(avg(wi2.percent)), 0) from work_items wi2 where wi2.work_package_id = wp.id)
      ) order by coalesce(wp.planned_start, (select min(wi4.planned_start) from work_items wi4 where wi4.work_package_id = wp.id)) nulls last)
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

grant execute on function client_view(text) to anon, authenticated;

commit;
