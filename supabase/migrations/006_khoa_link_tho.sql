-- ============================================================
-- KHOÁ LINK THỢ KHI ĐÓNG CÔNG TRÌNH — chạy SAU 005_dong_cong_trinh.sql.
-- Supabase > SQL Editor > New query > dán > Run. Chạy lại lần 2 vô hại.
--
-- Đóng công trình → link thợ bị khoá (thợ mở link thấy "Công trình đã bàn
-- giao xong — link này đã khoá"). Mở lại công trình → link cũ dùng lại
-- được; link giám sát đã thu hồi tay thì vẫn thu hồi. Link chủ nhà không đổi.
-- (Giống đoạn tương ứng trong schema.sql.)
-- ============================================================
begin;

alter table crew_links add column if not exists closed_with_project boolean not null default false;

create or replace function _resolve_crew_link(p_token text)
returns crew_links
language plpgsql security definer set search_path = public as $$
declare
  v_link crew_links;
begin
  select * into v_link from crew_links where token = p_token;
  if v_link.id is null
     or (v_link.revoked_at is not null and not v_link.closed_with_project)
     or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    raise exception 'invalid_or_expired_token';
  end if;
  -- Công trình đã đóng: link khoá (kể cả link tạo sau khi đóng)
  if v_link.revoked_at is not null
     or not exists (select 1 from projects p where p.id = v_link.project_id and p.status = 'active') then
    raise exception 'project_closed';
  end if;
  update crew_links set last_used_at = now() where id = v_link.id;
  return v_link;
end;
$$;

create or replace function _on_project_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' then
    update alerts set acknowledged_at = now(), acknowledged_by = auth.uid()
    where project_id = new.id and acknowledged_at is null;
    -- Khoá link thợ (revoked_at → Edge Function crew-upload/dropbox-link cũng chặn)
    update crew_links set revoked_at = now(), closed_with_project = true
    where project_id = new.id and revoked_at is null;
  else
    -- Mở lại: chỉ mở khoá link bị khoá do đóng, link thu hồi tay giữ nguyên
    update crew_links set revoked_at = null, closed_with_project = false
    where project_id = new.id and closed_with_project;
  end if;
  return null;
end;
$$;

-- Công trình đã đóng từ trước khi có khoá link
update crew_links l set revoked_at = now(), closed_with_project = true
from projects p
where p.id = l.project_id and p.status <> 'active' and l.revoked_at is null;

commit;
