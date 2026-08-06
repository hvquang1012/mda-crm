// ============================================================
// Khởi tạo Supabase client dùng chung cho index.html / crew.html / client.html
// Yêu cầu đã load (theo thứ tự, dạng <script> thường, KHÔNG phải module):
//   1. vendor/supabase-js@2.45.4.min.js  (đặt window.supabase = UMD lib)
//   2. config.js                          (đặt window.MDA_CONFIG)
// ============================================================

let _client = null;
let _ready = false;

export function initSupabase() {
  if (_client) return { client: _client, ready: _ready };
  const cfg = window.MDA_CONFIG || {};
  try {
    if (cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('xxxxx') === -1 && window.supabase) {
      _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      _ready = true;
    }
  } catch (e) {
    console.error('[supabase] init failed', e);
  }
  return { client: _client, ready: _ready };
}

export function getSupabase() {
  return _client;
}

export function isSupabaseReady() {
  return _ready;
}
