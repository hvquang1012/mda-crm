-- ============================================================
-- ⚠ ĐÃ NGỪNG SỬ DỤNG — file này chỉ giữ lại để tham khảo lịch sử.
-- File này chứa lỗ hổng bảo mật (policy "public read" dùng using(true)
-- cho phép đọc toàn bộ dữ liệu mọi dự án qua anon key). KHÔNG chạy
-- file này. Dùng supabase/schema.sql thay thế.
-- Nếu đã lỡ chạy file này trước đó, chạy ngay
-- supabase/migrations/000_urgent_fix_rls.sql để vá.
-- ============================================================
--
-- MD ARCHITECTS — CRM BÁO CÁO TIẾN ĐỘ (bản cũ — v1)
-- ============================================================

create extension if not exists pgcrypto;

-- Bảng dự án
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  start_date date not null default current_date,
  end_date date not null default (current_date + interval '30 days'),
  share_token text unique not null default substr(md5(random()::text), 1, 10),
  created_at timestamptz default now()
);

-- Bảng công việc (hỗ trợ việc con qua parent_id)
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references tasks(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  percent int not null default 0 check (percent between 0 and 100),
  status text not null default 'notStarted' check (status in ('onTrack','delayed','ahead','notStarted','done')),
  note text,
  assignee text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Hồ sơ nhân viên (gắn với tài khoản đăng nhập Supabase Auth)
create table if not exists staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text default 'staff',
  created_at timestamptz default now()
);

-- Tự động cập nhật updated_at
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_updated on tasks;
create trigger trg_tasks_updated before update on tasks
  for each row execute function set_updated_at();

-- ============================================================
-- BẬT REALTIME (để nhân viên thấy cập nhật tức thời)
-- ============================================================
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table projects;

-- ============================================================
-- BẢO MẬT (Row Level Security)
-- - Nhân viên đã đăng nhập: xem + sửa toàn bộ
-- - Khách (không đăng nhập, dùng link share): chỉ xem
-- ============================================================
alter table projects enable row level security;
alter table tasks enable row level security;
alter table staff_profiles enable row level security;

-- Ai cũng xem được (khách xem qua link, nhân viên xem trong app)
create policy "public read projects" on projects for select using (true);
create policy "public read tasks" on tasks for select using (true);

-- Chỉ nhân viên đã đăng nhập mới được thêm/sửa/xoá
create policy "staff write projects" on projects for insert with check (auth.role() = 'authenticated');
create policy "staff update projects" on projects for update using (auth.role() = 'authenticated');
create policy "staff delete projects" on projects for delete using (auth.role() = 'authenticated');

create policy "staff write tasks" on tasks for insert with check (auth.role() = 'authenticated');
create policy "staff update tasks" on tasks for update using (auth.role() = 'authenticated');
create policy "staff delete tasks" on tasks for delete using (auth.role() = 'authenticated');

create policy "staff read own profile" on staff_profiles for select using (auth.uid() = id);
create policy "staff update own profile" on staff_profiles for update using (auth.uid() = id);

-- ============================================================
-- DỮ LIỆU MẪU (xoá đoạn này nếu không cần)
-- ============================================================
insert into projects (name, client_name, start_date, end_date)
values ('Nhà anh Minh — Vinhomes Ocean Park', 'Anh Minh', current_date - 5, current_date + 25)
returning id;
-- Sau khi chạy, copy id dự án vừa tạo và dùng để insert tasks mẫu nếu muốn.
