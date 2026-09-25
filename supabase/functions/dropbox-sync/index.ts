// ============================================================
// Edge Function: dropbox-sync — pg_cron gọi 10 phút/lần (xem schema.sql).
//   1. Ảnh gốc gửi dở quá 6 giờ → đánh dấu hỏng (để bước 3 lấp chỗ)
//   2. Báo cáo đã duyệt / trả lại → chuyển ảnh gốc từ "_Chờ duyệt"
//      sang "<ngày> <đầu việc>" hoặc "_Bị trả lại"
//   3. Báo cáo đã duyệt mà thiếu ảnh gốc (thợ mất sóng, staff nhập thay,
//      báo cáo trước khi bật Dropbox) → sao chép bản nén từ Storage
// Lỗi ghi vào photo_archive.error, thử lại tối đa 5 lần.
//
// Chỉ nhận lời gọi mang service_role key (cron) — anon key bị từ chối.
// Deploy: supabase functions deploy dropbox-sync
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  dropboxConfigured, rpc, upload, approvedFolder, rejectedFolder, basename, safeName, DropboxError
} from '../_shared/dropbox.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TIME_BUDGET_MS = 110_000;   // dừng trước giới hạn thời gian của Edge Function

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function errText(e: unknown) {
  return e instanceof DropboxError ? e.summary : String((e as Error)?.message ?? e).slice(0, 300);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) return json({ error: 'forbidden' }, 403);
  if (!dropboxConfigured()) return json({ error: 'dropbox_not_configured' }, 503);

  const started = Date.now();
  const timeLeft = () => Date.now() - started < TIME_BUDGET_MS;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = () => new Date().toISOString();
  const stats = { expired: 0, moved: 0, copied: 0, errors: 0 };

  // 1. Ảnh gốc không bao giờ tới
  const { data: expired } = await admin.rpc('dropbox_expire_uploads');
  stats.expired = expired ?? 0;

  // 2. Chuyển thư mục theo kết quả duyệt
  const { data: moves, error: movesErr } = await admin.rpc('dropbox_moves_due', { p_limit: 100 });
  if (movesErr) return json({ error: movesErr.message }, 500);
  for (const m of moves ?? []) {
    if (!timeLeft()) break;
    const folder = m.report_status === 'approved'
      ? approvedFolder(m.project_name, m.sub_name, m.report_date, m.item_name)
      : rejectedFolder(m.project_name, m.sub_name, m.report_date);
    try {
      const res = await rpc('files/move_v2', {
        from_path: m.dropbox_path, to_path: `${folder}/${basename(m.dropbox_path)}`, autorename: true
      });
      await admin.from('photo_archive').update({
        state: m.report_status === 'approved' ? 'approved' : 'rejected',
        dropbox_path: res.metadata?.path_display ?? `${folder}/${basename(m.dropbox_path)}`,
        error: null, updated_at: now()
      }).eq('id', m.archive_id);
      stats.moved++;
    } catch (e) {
      stats.errors++;
      const msg = errText(e);
      // Ảnh đã bị xoá tay khỏi "_Chờ duyệt" → coi như hỏng, bước 3 sao chép bản nén
      const notFound = /from_lookup\/not_found/.test(msg);
      const { data: cur } = await admin.from('photo_archive').select('attempts').eq('id', m.archive_id).single();
      await admin.from('photo_archive').update({
        state: notFound ? 'failed' : 'pending', attempts: (cur?.attempts ?? 0) + 1, error: msg, updated_at: now()
      }).eq('id', m.archive_id);
    }
  }

  // 3. Sao chép bản nén cho báo cáo đã duyệt còn thiếu ảnh
  const { data: missing, error: missErr } = await admin.rpc('dropbox_missing_copies', { p_limit: 30 });
  if (missErr) return json({ ...stats, error: missErr.message }, 500);
  for (const c of missing ?? []) {
    if (!timeLeft()) break;
    const folder = approvedFolder(c.project_name, c.sub_name, c.report_date, c.item_name);
    const path = `${folder}/${safeName(c.reporter_name)} ${c.photo_no} (ban nen).jpg`;
    try {
      const { data: blob, error } = await admin.storage.from('site-photos').download(c.storage_path);
      if (error || !blob) throw new Error('Không tải được ảnh từ kho: ' + (error?.message ?? 'trống'));
      const res = await upload(path, new Uint8Array(await blob.arrayBuffer()));
      await upsertCompressed(admin, c, { state: 'approved', dropbox_path: res.path_display ?? path, error: null });
      stats.copied++;
    } catch (e) {
      stats.errors++;
      await upsertCompressed(admin, c, { state: 'failed', dropbox_path: path, error: errText(e), bump: true });
    }
  }

  return json(stats);
});

// Mỗi ảnh nén chỉ có 1 dòng photo_archive (source=compressed) — lỗi thì
// tăng attempts trên dòng đó thay vì chèn thêm dòng mới mỗi lần thử.
async function upsertCompressed(admin: any, c: any, v: { state: string; dropbox_path: string; error: string | null; bump?: boolean }) {
  const { data: existing } = await admin.from('photo_archive').select('id, attempts')
    .eq('report_id', c.report_id).eq('storage_path', c.storage_path).eq('source', 'compressed').maybeSingle();
  const row = {
    state: v.state, dropbox_path: v.dropbox_path, error: v.error, updated_at: new Date().toISOString(),
    attempts: (existing?.attempts ?? 0) + (v.bump ? 1 : 0)
  };
  if (existing) await admin.from('photo_archive').update(row).eq('id', existing.id);
  else await admin.from('photo_archive').insert({
    ...row, project_id: c.project_id, report_id: c.report_id, storage_path: c.storage_path, source: 'compressed'
  });
}
