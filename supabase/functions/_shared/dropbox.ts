// ============================================================
// Gọi Dropbox API từ Edge Function — dùng chung cho dropbox-link và
// dropbox-sync. Xác thực bằng refresh token (không hết hạn) đổi lấy
// access token 4 giờ mỗi lần chạy.
//
// Secrets cần đặt (supabase secrets set ...):
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
//   DROPBOX_ROOT  (không bắt buộc, mặc định "/MDA Tiến độ")
// ============================================================

const APP_KEY = Deno.env.get('DROPBOX_APP_KEY') ?? '';
const APP_SECRET = Deno.env.get('DROPBOX_APP_SECRET') ?? '';
const REFRESH_TOKEN = Deno.env.get('DROPBOX_REFRESH_TOKEN') ?? '';
export const DROPBOX_ROOT = (Deno.env.get('DROPBOX_ROOT') ?? '/MDA Tiến độ').replace(/\/+$/, '');

export function dropboxConfigured() {
  return Boolean(APP_KEY && APP_SECRET && REFRESH_TOKEN);
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN,
      client_id: APP_KEY, client_secret: APP_SECRET
    })
  });
  if (!res.ok) throw new Error('dropbox_auth_failed: ' + (await res.text()).slice(0, 200));
  const body = await res.json();
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 14400) * 1000 };
  return cached.token;
}

export class DropboxError extends Error {
  constructor(public summary: string, public status: number) { super(summary); }
}

// Header Dropbox-API-Arg chỉ nhận ASCII — tên thư mục tiếng Việt phải
// đổi sang \uXXXX, nếu không Dropbox báo lỗi header.
function headerSafeJson(obj: unknown) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export async function rpc(endpoint: string, body: unknown) {
  const res = await fetch('https://api.dropboxapi.com/2/' + endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    let summary = text;
    try { summary = JSON.parse(text).error_summary ?? text; } catch { /* không phải JSON */ }
    throw new DropboxError(String(summary).slice(0, 300), res.status);
  }
  return text ? JSON.parse(text) : {};
}

export async function upload(path: string, bytes: Uint8Array | Blob) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + await accessToken(),
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': headerSafeJson({ path, mode: 'add', autorename: true, mute: true })
    },
    body: bytes
  });
  const text = await res.text();
  if (!res.ok) {
    let summary = text;
    try { summary = JSON.parse(text).error_summary ?? text; } catch { /* không phải JSON */ }
    throw new DropboxError(String(summary).slice(0, 300), res.status);
  }
  return JSON.parse(text);
}

// Tên thư mục / tệp an toàn cho Dropbox: bỏ ký tự cấm, dấu chấm/cách ở
// cuối, giới hạn độ dài. Giữ nguyên dấu tiếng Việt.
export function safeName(s: string | null | undefined, fallback = 'Khong-ten') {
  const cleaned = String(s ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function projectFolder(projectName: string, subName: string) {
  return `${DROPBOX_ROOT}/${safeName(projectName)}/${safeName(subName)}`;
}
export function pendingFolder(projectName: string, subName: string, reportDate: string) {
  return `${projectFolder(projectName, subName)}/_Chờ duyệt/${reportDate}`;
}
export function approvedFolder(projectName: string, subName: string, reportDate: string, itemName: string) {
  return `${projectFolder(projectName, subName)}/${reportDate} ${safeName(itemName)}`;
}
export function rejectedFolder(projectName: string, subName: string, reportDate: string) {
  return `${projectFolder(projectName, subName)}/_Bị trả lại/${reportDate}`;
}
export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
