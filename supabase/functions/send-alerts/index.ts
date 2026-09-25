// ============================================================
// Edge Function: send-alerts
// Gọi bởi pg_cron (job mda-notify, xem cuối supabase/schema.sql) mỗi
// phút khi notify_due() = true. Gửi Web Push tới nhân viên đã đăng ký
// (push_subscriptions) CÓ QUYỀN trên công trình đó: quản lý/quản trị
// nhận tất cả, KTS chỉ nhận công trình mình phụ trách (project_members
// hoặc người tạo). Hai loại thông báo:
//   1. Cảnh báo trễ hạn (alerts chưa notified_at) — sinh bởi compute_alerts()
//   2. Báo cáo mới chờ duyệt — gom theo (công trình, người gửi), xem
//      reports_to_notify(). Người tự nhập báo cáo không nhận thông báo
//      về báo cáo của chính mình.
//
// Chỉ nhận lời gọi mang khoá service_role (cron) — anon key bị từ chối.
// Deploy: supabase functions deploy send-alerts
// Secrets cần set thêm (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (vd: mailto:you@domain.com)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY đã có sẵn tự động)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { isServiceRole } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
// Cảnh báo tồn quá lâu (cron gửi từng tắt) thì chỉ đánh dấu, không dội thông báo cũ
const ALERT_MAX_AGE_MS = 24 * 3600 * 1000;

type Sub = { id: string; staff_id: string; endpoint: string; p256dh: string; auth: string };
type Note = { projectId: string; title: string; body: string; url: string; tag: string; severity?: string; exclude?: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isServiceRole(req.headers.get('Authorization'), SERVICE_ROLE_KEY)) return json({ error: 'forbidden' }, 403);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'vapid_not_configured' }, 500);
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: alerts, error: alertsErr } = await admin
    .from('alerts')
    .select('id, project_id, severity, message, created_at')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (alertsErr) return json({ error: alertsErr.message }, 500);

  const { data: reports, error: reportsErr } = await admin.rpc('reports_to_notify');
  if (reportsErr) return json({ error: reportsErr.message }, 500);

  if (!alerts?.length && !reports?.length) return json({ sent: 0 });

  const notes: Note[] = [];

  const freshAlerts = (alerts || []).filter(a => Date.now() - new Date(a.created_at).getTime() < ALERT_MAX_AGE_MS);
  for (const a of freshAlerts) {
    notes.push({ projectId: a.project_id, title: '', body: a.message, url: './index.html#alerts', tag: 'alert-' + a.id, severity: a.severity });
  }

  // Gom báo cáo theo (công trình, người gửi)
  const groups = new Map<string, any[]>();
  for (const r of reports || []) {
    const key = r.project_id + '|' + r.reporter_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const items = [...new Set(list.map(r => r.item_name))];
    const shown = items.slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3}` : '');
    const who = first.staff_id ? first.reporter_name : `${first.reporter_name} (${first.sub_name})`;
    notes.push({
      projectId: first.project_id,
      title: '📋 ' + first.project_name,
      body: `${who} gửi ${list.length} báo cáo chờ duyệt: ${shown}`,
      url: './index.html#approvals',
      tag: 'reports-' + first.project_id,
      exclude: first.staff_id
    });
  }

  const projectIds = [...new Set(notes.map(n => n.projectId))];
  const [{ data: subs }, { data: projects }, { data: staff }, { data: members }] = await Promise.all([
    admin.from('push_subscriptions').select('id, staff_id, endpoint, p256dh, auth'),
    admin.from('projects').select('id, name, created_by').in('id', projectIds),
    admin.from('staff').select('id, role'),
    admin.from('project_members').select('project_id, staff_id').in('project_id', projectIds)
  ]);
  const projectName = new Map((projects || []).map(p => [p.id, p.name]));
  const managers = new Set((staff || []).filter(s => s.role === 'manager' || s.role === 'admin').map(s => s.id));
  const canSee = (staffId: string, projectId: string) =>
    managers.has(staffId)
    || (members || []).some(m => m.project_id === projectId && m.staff_id === staffId)
    || (projects || []).some(p => p.id === projectId && p.created_by === staffId);

  let sent = 0;
  const staleEndpoints = new Set<string>();

  for (const n of notes) {
    const title = n.title || (severityEmoji(n.severity ?? '') + ' ' + (projectName.get(n.projectId) || 'Công trình'));
    const payload = JSON.stringify({ title, body: n.body, url: n.url, tag: n.tag });
    const targets = ((subs || []) as Sub[]).filter(s =>
      s.staff_id !== n.exclude && canSee(s.staff_id, n.projectId) && !staleEndpoints.has(s.endpoint));

    for (const sub of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (e: any) {
        // 404/410 = subscription đã hết hạn (thiết bị gỡ app, đổi máy...) — dọn sau vòng lặp
        if (e && (e.statusCode === 404 || e.statusCode === 410)) staleEndpoints.add(sub.endpoint);
      }
    }
  }

  if (alerts?.length) {
    await admin.from('alerts').update({ notified_at: new Date().toISOString() }).in('id', alerts.map(a => a.id));
  }
  if (reports?.length) {
    await admin.rpc('mark_reports_notified', { p_ids: reports.map((r: any) => r.report_id) });
  }
  if (staleEndpoints.size) {
    await admin.from('push_subscriptions').delete().in('endpoint', [...staleEndpoints]);
  }

  return json({ sent, alerts: alerts?.length || 0, reports: reports?.length || 0, cleaned: staleEndpoints.size });
});

function severityEmoji(sev: string) {
  return sev === 'critical' ? '🔴' : sev === 'warning' ? '🟡' : 'ℹ️';
}
