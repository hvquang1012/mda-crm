// ============================================================
// ĐIỀN THÔNG TIN SUPABASE CỦA CHỊ VÀO ĐÂY
// Lấy tại: Supabase Dashboard > Project Settings > API
// ============================================================
window.MDA_CONFIG = {
  SUPABASE_URL: "https://lneaqpfiifqkpccpxgsp.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuZWFxcGZpaWZxa3BjY3B4Z3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NzkzMDksImV4cCI6MjEwMTU1NTMwOX0.WyEgyAc-_Jf1K04EEXRnqceIdZdHqlc3IeB2cTR1hAQ",

  // Bật cảnh báo đẩy (Web Push) cho nhân viên. Tạo cặp khoá VAPID bằng
  // lệnh: npx web-push generate-vapid-keys — dán PUBLIC KEY vào đây,
  // PRIVATE KEY dán vào Supabase Edge Function secret (xem HUONG_DAN_TRIEN_KHAI.md).
  VAPID_PUBLIC_KEY: "BHH2ZZQK43H2MLWT1oI-x2LPH6GSpDhgswy882ew2mKERf20PSQPAqR-FDk8mbGD64bq0H_JQge668Br6TmOYOE"
};
