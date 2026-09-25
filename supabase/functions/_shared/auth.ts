// Dùng chung cho các Edge Function chỉ cron (service_role) được gọi.
// Chỉ nhận lời gọi mang khoá quyền quản trị (service_role). Không so
// nguyên chuỗi với SUPABASE_SERVICE_ROLE_KEY: project dùng hệ khoá API
// mới thì biến đó KHÁC khoá "legacy service_role" mà cron gửi lên, dù cả
// hai đều hợp lệ (bản đầu so nguyên chuỗi → cron luôn nhận 403).
// Cổng Supabase đã kiểm chữ ký JWT trước khi request tới đây (verify_jwt
// mặc định bật khi deploy), nên chỉ cần đọc claim role trong JWT.
export function isServiceRole(header: string | null, serviceRoleKey: string) {
  const token = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return false;
  if (token === serviceRoleKey) return true;
  try {
    const part = token.split('.')[1];
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
