// ============================================================
// Edge Function: dropbox-link
// Cấp link tạm (4 giờ) để máy thợ gửi ẢNH GỐC thẳng lên Dropbox, không
// đi qua Supabase Storage (gói free chỉ 1GB — ảnh gốc 3–5MB/tấm).
// Ảnh vào thư mục "_Chờ duyệt"; dropbox-sync chuyển sang thư mục ngày
// sau khi giám sát duyệt.
//
//   action=request  { token, report_id, photos: [{storage_path, name, size}] }
//                   → { links: [{archive_id, url}] }
//   action=confirm  { token, archive_ids: [...] } → { confirmed }
//
// Kiểm tra giống crew-upload: token còn hạn, báo cáo phải thuộc đúng
// (project_id, subcontractor_id) của token.
// Deploy: supabase functions deploy dropbox-link
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { dropboxConfigured, rpc, pendingFolder, safeName, DropboxError } from '../_shared/dropbox.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_BYTES = 150 * 1024 * 1024;   // giới hạn của link tạm Dropbox

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!dropboxConfigured()) return json({ error: 'dropbox_not_configured' }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const { action, token } = body ?? {};
  if (!token || (action !== 'request' && action !== 'confirm')) return json({ error: 'invalid_request' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: link } = await admin.from('crew_links')
    .select('id, project_id, subcontractor_id, revoked_at, expires_at')
    .eq('token', token).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
    return json({ error: 'invalid_or_expired_token' }, 403);
  }

  if (action === 'confirm') {
    const ids: string[] = Array.isArray(body.archive_ids) ? body.archive_ids.slice(0, 10) : [];
    if (!ids.length) return json({ confirmed: 0 });
    const { data: rows } = await admin.from('photo_archive')
      .select('id, dropbox_path, project_id, state').in('id', ids);
    let confirmed = 0;
    for (const r of rows ?? []) {
      if (r.project_id !== link.project_id || r.state !== 'uploading') continue;
      // Kiểm tra tệp thật sự đã nằm trên Dropbox — máy báo xong chưa chắc đã xong
      try {
        await rpc('files/get_metadata', { path: r.dropbox_path });
        await admin.from('photo_archive').update({ state: 'pending', updated_at: new Date().toISOString() }).eq('id', r.id);
        confirmed++;
      } catch (e) {
        await admin.from('photo_archive').update({
          state: 'failed', error: 'Không thấy ảnh gốc trên Dropbox sau khi máy báo đã gửi', updated_at: new Date().toISOString()
        }).eq('id', r.id);
      }
    }
    return json({ confirmed });
  }

  // action = request
  const photos: any[] = Array.isArray(body.photos) ? body.photos : [];
  if (!body.report_id || !photos.length || photos.length > 4) return json({ error: 'invalid_request' }, 400);

  const { data: report } = await admin.from('progress_reports')
    .select('id, report_date, reporter_name, created_at, photos, work_items!inner(name, work_packages!inner(project_id, subcontractor_id, projects(name), subcontractors(name)))')
    .eq('id', body.report_id).maybeSingle();
  const wp = (report as any)?.work_items?.work_packages;
  if (!report || wp?.project_id !== link.project_id || wp?.subcontractor_id !== link.subcontractor_id) {
    return json({ error: 'report_not_in_scope' }, 403);
  }
  const knownPaths = new Set(((report as any).photos ?? []).map((p: any) => p?.path));

  const folder = pendingFolder(wp.projects?.name, wp.subcontractors?.name, report.report_date);
  const time = new Date(report.created_at).toISOString().slice(11, 16).replace(':', 'h');
  const links: { archive_id: string; url: string }[] = [];

  for (const [i, p] of photos.entries()) {
    if (!p || typeof p.size !== 'number' || p.size <= 0 || p.size > MAX_BYTES) { links.push(null as any); continue; }
    const storagePath = knownPaths.has(p.storage_path) ? p.storage_path : null;
    const ext = (String(p.name ?? '').match(/\.(jpe?g|png|heic|heif|dng|tiff?|webp)$/i)?.[0] ?? '.jpg').toLowerCase();
    const id = crypto.randomUUID();
    // Tên tệp duy nhất (kèm mã ngắn) → không cần autorename, dropbox_path lưu đúng chỗ thật
    const path = `${folder}/${time} ${safeName(report.reporter_name)} ${i + 1}-${id.slice(0, 6)}${ext}`;
    try {
      const res = await rpc('files/get_temporary_upload_link', {
        commit_info: { path, mode: 'add', autorename: false, mute: true },
        duration: 14400
      });
      const { error } = await admin.from('photo_archive').insert({
        id, project_id: link.project_id, report_id: report.id, storage_path: storagePath,
        dropbox_path: path, source: 'original', state: 'uploading'
      });
      if (error) throw new Error(error.message);
      links.push({ archive_id: id, url: res.link });
    } catch (e) {
      const msg = e instanceof DropboxError ? e.summary : String((e as Error)?.message ?? e);
      return json({ error: 'dropbox_error', detail: msg }, 502);
    }
  }
  return json({ links });
});
