// ============================================================
// Edge Function: get-photo-url
// Đổi đường dẫn Storage (private bucket "site-photos") thành signed
// URL xem được trong 1 giờ. Dùng bởi crew.html (xem lại ảnh mình đã
// gửi) và client.html (xem album ảnh đã duyệt).
//
// Kiểm tra phạm vi theo tiền tố đường dẫn (path được crew-upload đặt
// tên theo dạng `${project_id}/${subcontractor_id}/...`):
//   kind=crew   → path phải nằm trong đúng project_id + subcontractor_id của token
//   kind=client → path phải nằm trong đúng project_id của token
// Lưu ý: client.html chỉ bao giờ nhận được path từ client_view() RPC,
// vốn đã lọc sẵn ảnh đã duyệt trong đúng dự án — kiểm tra tiền tố ở
// đây là lớp phòng thủ thứ 2, không phải điểm chặn duy nhất.
//
// Deploy: supabase functions deploy get-photo-url
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'site-photos';
const EXPIRES_IN = 3600;

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

  let body: { kind?: 'crew' | 'client'; token?: string; paths?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { kind, token, paths } = body;
  if (!kind || !token || !Array.isArray(paths) || paths.length === 0 || paths.length > 60) {
    return json({ error: 'invalid_request' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let allowedPrefix: string;

  if (kind === 'crew') {
    const { data: link } = await admin
      .from('crew_links')
      .select('project_id, subcontractor_id, revoked_at, expires_at')
      .eq('token', token).maybeSingle();
    if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
      return json({ error: 'invalid_or_expired_token' }, 403);
    }
    allowedPrefix = `${link.project_id}/${link.subcontractor_id}/`;
  } else if (kind === 'client') {
    const { data: link } = await admin
      .from('client_links')
      .select('project_id, revoked_at, expires_at')
      .eq('token', token).maybeSingle();
    if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date())) {
      return json({ error: 'invalid_or_expired_token' }, 403);
    }
    allowedPrefix = `${link.project_id}/`;
  } else {
    return json({ error: 'invalid_kind' }, 400);
  }

  const urls: (string | null)[] = [];
  for (const p of paths) {
    if (!p.startsWith(allowedPrefix)) { urls.push(null); continue; }
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(p, EXPIRES_IN);
    urls.push(error ? null : data.signedUrl);
  }

  return json({ urls });
});
