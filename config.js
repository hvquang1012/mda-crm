// ============================================================
// ĐIỀN THÔNG TIN SUPABASE CỦA CHỊ VÀO ĐÂY
// Lấy tại: Supabase Dashboard > Project Settings > API
// ============================================================
window.MDA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",   // <-- thay bằng Project URL
  SUPABASE_ANON_KEY: "eyJhbGciOiJI...",                 // <-- thay bằng anon public key

  // Bật cảnh báo đẩy (Web Push) cho nhân viên. Tạo cặp khoá VAPID bằng
  // lệnh: npx web-push generate-vapid-keys — dán PUBLIC KEY vào đây,
  // PRIVATE KEY dán vào Supabase Edge Function secret (xem HUONG_DAN_TRIEN_KHAI.md).
  VAPID_PUBLIC_KEY: ""
};
