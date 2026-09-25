-- Kiểm thử phân quyền theo công trình + duyệt nhóm. Chạy qua run.sh.
\set ON_ERROR_STOP 0
-- Dữ liệu: admin A, KTS K1 (phụ trách P1), KTS K2 (không phụ trách gì)
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','admin@x'),
 ('aaaaaaaa-0000-0000-0000-000000000002','k1@x'),
 ('aaaaaaaa-0000-0000-0000-000000000003','k2@x');
update staff set role='admin' where id='aaaaaaaa-0000-0000-0000-000000000001';
select id, role from staff order by id;
insert into subcontractors(id,name,trade) values ('22222222-2222-2222-2222-222222222222','Đội A','da');
insert into projects(id,name,end_date) values ('33333333-3333-3333-3333-333333333333','P1', current_date+10);
insert into project_members values ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000002');
insert into work_packages(id,project_id,subcontractor_id,trade,name) values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','da','Đá');
insert into work_items(id,work_package_id,name,qty_plan,planned_start,planned_end) values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','Lắp',10,current_date-10,current_date);
insert into crew_links(id,token,project_id,subcontractor_id) values ('77777777-7777-7777-7777-777777777777','tok','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');

-- thợ gửi 3 báo cáo qua RPC (anon)
set role anon; set request.jwt.claim.role='anon'; reset request.jwt.claim.sub;
select 'anon đọc projects (phải lỗi)' t; select * from projects;
select crew_submit('tok','55555555-5555-5555-5555-555555555555',2,3,'n1','[{"path":"33333333-3333-3333-3333-333333333333/x/a.jpg"}]') is not null as submitted;
select crew_submit('tok','55555555-5555-5555-5555-555555555555',2,3,'n2','[{"path":"33333333-3333-3333-3333-333333333333/x/b.jpg"}]') is not null as submitted;
select crew_submit('tok','55555555-5555-5555-5555-555555555555',1,3,'n3','[{"path":"33333333-3333-3333-3333-333333333333/x/c.jpg"}]') is not null as submitted;
select 'anon gọi approve_report_group (phải lỗi)' t; select approve_report_group(array[]::uuid[], 1);
select 'anon gọi dashboard (phải lỗi)' t; select dashboard_summary();
reset role;

-- K2 không thấy gì, không duyệt được
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000003';
select 'K2 số công trình thấy được' t, count(*) from projects;
select 'K2 số báo cáo thấy được' t, count(*) from progress_reports;
select 'K2 duyệt (phải lỗi report_not_found/forbidden)' t;
reset role; create temp table ids as select array_agg(id order by created_at) a from progress_reports; grant select on ids to authenticated;
set role authenticated;
select approve_report_group((select a from ids), 5);
select 'K2 tự nâng admin (phải lỗi)' t; update staff set role='admin' where id=auth.uid();
select set_staff_role(auth.uid(),'admin');
select 'K2 thấy ảnh storage P1' t, count(*) from storage.objects;

-- K1
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
select 'K1 thấy' t, count(*) from projects;
select 'K1 duyệt nhóm 3 báo cáo, tổng 7' t, approve_report_group((select a from ids), 7);
select 'duyệt lại (phải lỗi already_processed)' t; select approve_report_group((select a from ids), 7);
select status, approved_qty from progress_reports order by created_at;
select qty_done, percent, status from work_items;
select 'K1 chèn báo cáo status approved (phải lỗi RLS)' t;
insert into progress_reports(work_item_id,reporter_kind,staff_id,reporter_name,qty_delta,note,status) values ('55555555-5555-5555-5555-555555555555','staff',auth.uid(),'k1',5,'x','approved');
select 'K1 chèn báo cáo pending (ok)' t;
insert into progress_reports(work_item_id,reporter_kind,staff_id,reporter_name,qty_delta,note) values ('55555555-5555-5555-5555-555555555555','staff',auth.uid(),'k1',1,'x') returning status;
select 'K1 trả lại' t, reject_report_group(array(select id from progress_reports where status='pending'), 'Ảnh mờ');
select status, reject_reason from progress_reports where status='rejected';
select 'K1 tạo công trình mới + returning' t;
insert into projects(name) values ('P mới của K1') returning name, created_by is not null as has_creator;
select 'K1 giờ thấy' t, count(*) from projects;
select 'K1 dashboard' t, json_array_length(dashboard_summary()->'projects') n, dashboard_summary()->'projects'->0->>'actual_pct' actual, dashboard_summary()->'projects'->0->>'planned_pct' planned;
select 'K1 gán thành viên (phải lỗi)' t; insert into project_members values ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000003');
select 'K1 gọi dropbox_missing_copies (phải lỗi)' t; select * from dropbox_missing_copies(5);
select 'compute_alerts' t, compute_alerts();
select name, status from work_items;
reset role;
select 'service: missing copies' t, count(*) from dropbox_missing_copies(10);
-- admin
set role authenticated; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000001';
select 'admin thấy' t, count(*) from projects;
select 'admin đổi K2 thành manager' t, set_staff_role('aaaaaaaa-0000-0000-0000-000000000003','manager');
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000003';
select 'K2 (manager) thấy' t, count(*) from projects;
