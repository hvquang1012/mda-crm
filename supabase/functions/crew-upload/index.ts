// ============================================================
// Edge Function: crew-upload
// Cấp signed upload URL vào bucket private "site-photos" cho thầu
// phụ/công nhân KHÔNG đăng nhập. Không thể làm việc này bằng RPC
// thuần SQL vì Postgres không gọi được Storage API — đây là lý do
// duy nhất cần Edge Function thay vì chỉ dùng security definer function.
//
// Deploy: supabase functions deploy crew-upload
// Secrets cần có sẵn (Supabase tự cấp khi deploy trong cùng project):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'site-photos';

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

  let body: { token?: string; filenames?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const { token, filenames } = body;
  if (!token || !Array.isArray(filenames) || filenames.length === 0 || filenames.length > 4) {
    return json({ error: 'invalid_request' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: link, error: linkErr } = await admin
    .from('crew_links')
    .select('id, project_id, subcontractor_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (linkErr || !link || link.revoked_at ||
      (link.expires_at && new Date(link.expires_at) < new Date())) {
    return json({ error: 'invalid_or_expired_token' }, 403);
  }

  // Cập nhật last_used_at giống các RPC crew_* trong schema.sql
  await admin.from('crew_links').update({ last_used_at: new Date().toISOString() }).eq('id', link.id);

  const datePrefix = new Date().toISOString().slice(0, 10);
  const paths: string[] = [];
  const tokens: string[] = [];

  for (const name of filenames) {
    const safe = String(name).replace(/[^a-zA-Z0-9.\-]/g, '_');
    const path = `${link.project_id}/${link.subcontractor_id}/${datePrefix}/${crypto.randomUUID()}-${safe}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return json({ error: 'storage_error', detail: error.message }, 500);
    paths.push(data.path);
    tokens.push(data.token);
  }

  return json({ paths, tokens });
});
