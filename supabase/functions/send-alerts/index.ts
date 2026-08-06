// ============================================================
// Edge Function: send-alerts
// Gọi bởi pg_cron (qua pg_net, xem cuối supabase/schema.sql) 10 phút
// sau mỗi lần compute_alerts() chạy. Lấy các alert chưa notified_at,
// gửi Web Push tới TẤT CẢ nhân viên đã đăng ký (push_subscriptions).
//
// Deploy: supabase functions deploy send-alerts
// Secrets cần set thêm (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (vd: mailto:you@domain.com)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY đã có sẵn tự động)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'https://esm.sh/web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: 'vapid_not_configured' }), { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: alerts, error: alertsErr } = await admin
    .from('alerts')
    .select('id, project_id, kind, severity, message')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  if (alertsErr) return new Response(JSON.stringify({ error: alertsErr.message }), { status: 500 });
  if (!alerts || alerts.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  const projectIds = [...new Set(alerts.map(a => a.project_id))];
  const { data: projects } = await admin.from('projects').select('id, name').in('id', projectIds);
  const projectName = new Map((projects || []).map(p => [p.id, p.name]));

  let sent = 0;
  const staleEndpoints: string[] = [];

  for (const alert of alerts) {
    const title = severityEmoji(alert.severity) + ' ' + (projectName.get(alert.project_id) || 'Công trình');
    const payload = JSON.stringify({ title, body: alert.message, url: './index.html' });

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (e: any) {
        // 404/410 = subscription đã hết hạn (thiết bị gỡ app, đổi máy...) — dọn sau vòng lặp
        if (e && (e.statusCode === 404 || e.statusCode === 410)) staleEndpoints.push(sub.endpoint);
      }
    }
  }

  await admin.from('alerts').update({ notified_at: new Date().toISOString() }).in('id', alerts.map(a => a.id));
  if (staleEndpoints.length) {
    await admin.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }

  return new Response(JSON.stringify({ sent, alerts: alerts.length, cleaned: staleEndpoints.length }), { status: 200 });
});

function severityEmoji(sev: string) {
  return sev === 'critical' ? '🔴' : sev === 'warning' ? '🟡' : 'ℹ️';
}
