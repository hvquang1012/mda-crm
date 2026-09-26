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

-- Hàng đợi offline: gửi lại cùng client_ref không tạo báo cáo trùng
reset role;
set role anon; set request.jwt.claim.role='anon'; reset request.jwt.claim.sub;
select 'gửi lần 1/2 cùng client_ref → cùng id' t,
  crew_submit('tok','55555555-5555-5555-5555-555555555555',1,2,'offline','[{"path":"33333333-3333-3333-3333-333333333333/x/d.jpg"}]',null,current_date,'99999999-9999-9999-9999-999999999999')
  = crew_submit('tok','55555555-5555-5555-5555-555555555555',1,2,'offline','[{"path":"33333333-3333-3333-3333-333333333333/x/d.jpg"}]',null,current_date,'99999999-9999-9999-9999-999999999999') as same_id;
select 'ngày báo cáo quá cũ (phải lỗi invalid_report_date)' t;
select crew_submit('tok','55555555-5555-5555-5555-555555555555',1,2,'x','[{"path":"a"}]',null,current_date-30);
select 'lịch sử có work_item_id' t, (crew_my_reports('tok')->0->>'work_item_id') is not null as ok;
reset role;
select 'số báo cáo client_ref' t, count(*) from progress_reports where client_ref is not null;

-- Dời lịch hạng mục
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
select 'K1 dời lịch +3 ngày' t, shift_package_schedule('44444444-4444-4444-4444-444444444444', 3);
select 'ngày kết thúc mới = hôm nay + 3' t, planned_end = current_date + 3 as ok from work_items;
reset role; insert into auth.users(id,email) values ('aaaaaaaa-0000-0000-0000-000000000004','k3@x');
set role authenticated; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
select 'K3 (không phụ trách) dời lịch (phải lỗi forbidden)' t; select shift_package_schedule('44444444-4444-4444-4444-444444444444', 3);
reset role;

-- Thông báo báo cáo mới: gom theo người gửi, chờ yên 90 giây, đánh dấu xong thì hết
reset role;
select 'hàng đợi thông báo: vừa gửi → chờ (0 dòng)' t, count(*) from reports_to_notify();
select 'bỏ chờ → có báo cáo pending chưa báo' t, count(*) > 0 as ok from reports_to_notify(interval '0');
select 'notify_due' t, notify_due();
select mark_reports_notified(array(select report_id from reports_to_notify(interval '0')));
select 'đánh dấu xong → hàng đợi rỗng' t, count(*) from reports_to_notify(interval '0');
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
select 'nhân viên gọi reports_to_notify (phải lỗi permission)' t; select * from reports_to_notify();
select 'nhân viên đọc report_notifications (phải lỗi permission)' t; select count(*) from report_notifications;
reset role;

-- Chốt "Xong" bằng tay → đóng cảnh báo cũ của đầu việc + hạng mục thành done ngay
insert into alerts(project_id, work_item_id, kind, severity, message) values
 ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','forecast_delay','critical','test');
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
select 'K3 (không phụ trách) chốt xong đầu việc P1 (0 dòng)' t; update work_items set status='done' where id='55555555-5555-5555-5555-555555555555' returning id;
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
update work_items set status='done' where id='55555555-5555-5555-5555-555555555555';
select 'chốt xong → cảnh báo mở = 0' t, count(*) from alerts where work_item_id='55555555-5555-5555-5555-555555555555' and acknowledged_at is null;
select 'chốt xong → người đóng là K1' t, bool_and(acknowledged_by = auth.uid()) ok from alerts where work_item_id='55555555-5555-5555-5555-555555555555';
select 'hạng mục = done' t, status from work_packages where id='44444444-4444-4444-4444-444444444444';
select 'qty_done giữ nguyên' t, qty_done, percent from work_items where id='55555555-5555-5555-5555-555555555555';
select 'dashboard: xong hết' t, (dashboard_summary()->'projects'->0->>'done_items') = (dashboard_summary()->'projects'->0->>'item_count') ok, dashboard_summary()->'projects'->0->>'critical_alerts' critical;
update work_items set status='onTrack' where id='55555555-5555-5555-5555-555555555555';
select 'mở lại → hạng mục hết done' t, status from work_packages where id='44444444-4444-4444-4444-444444444444';
reset role;

-- Đóng công trình → đóng cảnh báo đang mở, compute_alerts bỏ qua, ẩn khỏi dashboard
insert into alerts(project_id, work_item_id, kind, severity, message) values
 ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','no_crew','warning','test đóng');
insert into client_links(token,project_id) values ('ctok','33333333-3333-3333-3333-333333333333');
insert into crew_links(token,project_id,subcontractor_id,revoked_at) values ('tok_rv','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', now());
set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
select 'K3 (không phụ trách) đóng P1 (0 dòng)' t; update projects set status='done' where id='33333333-3333-3333-3333-333333333333' returning id;
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
update projects set status='done' where id='33333333-3333-3333-3333-333333333333';
select 'đóng → cảnh báo mở của P1 = 0' t, count(*) from alerts where project_id='33333333-3333-3333-3333-333333333333' and acknowledged_at is null;
reset role;
select 'đóng → link thợ bị khoá' t, count(*) filter (where revoked_at is not null and closed_with_project) locked, count(*) filter (where revoked_at is null) open from crew_links where project_id='33333333-3333-3333-3333-333333333333';
set role anon; set request.jwt.claim.role='anon'; reset request.jwt.claim.sub;
select 'thợ mở link P1 đã đóng (phải lỗi project_closed)' t; select crew_bootstrap('tok');
select 'thợ gửi báo cáo P1 đã đóng (phải lỗi project_closed)' t; select crew_submit('tok','55555555-5555-5555-5555-555555555555',1,1,'x','[{"path":"33333333-3333-3333-3333-333333333333/x/z.jpg"}]');
select 'link thu hồi tay (phải lỗi invalid_or_expired_token)' t; select crew_bootstrap('tok_rv');
select 'chủ nhà mở link P1 đã đóng (phải lỗi project_closed)' t; select client_view('ctok');
reset role;
insert into crew_links(token,project_id,subcontractor_id) values ('tok_new','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
set role anon; set request.jwt.claim.role='anon';
select 'link tạo sau khi đóng (phải lỗi project_closed)' t; select crew_bootstrap('tok_new');
reset role;
delete from crew_links where token='tok_new';
update work_items set planned_end = current_date - 5, status = 'onTrack' where id='55555555-5555-5555-5555-555555555555';
select 'compute_alerts trên P1 đã đóng' t, compute_alerts();
select 'P1 đã đóng: không sinh cảnh báo mới' t, count(*) from alerts where project_id='33333333-3333-3333-3333-333333333333' and acknowledged_at is null;
select 'P1 đã đóng: status đầu việc giữ nguyên' t, status from work_items where id='55555555-5555-5555-5555-555555555555';
set role authenticated; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
select 'dashboard không còn P1' t, not exists (select 1 from json_array_elements(dashboard_summary()->'projects') x where x->>'id' = '33333333-3333-3333-3333-333333333333') ok;
update projects set status='active' where id='33333333-3333-3333-3333-333333333333';
reset role;
select 'mở lại → compute_alerts' t, compute_alerts();
select 'mở lại → đầu việc quá hạn thành delayed' t, status from work_items where id='55555555-5555-5555-5555-555555555555';
select 'mở lại → link khoá được mở, link thu hồi tay giữ nguyên' t, token, revoked_at is null as open, closed_with_project from crew_links where project_id='33333333-3333-3333-3333-333333333333' order by token;
set role anon; set request.jwt.claim.role='anon'; reset request.jwt.claim.sub;
select 'mở lại → thợ mở link được' t, crew_bootstrap('tok') is not null ok;
select 'mở lại → chủ nhà mở link được' t, client_view('ctok') is not null ok;
reset role;
