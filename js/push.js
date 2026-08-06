// ============================================================
// Đăng ký Web Push cho nhân viên (giám sát / chỉ huy trưởng).
//
// Lưu ý iOS: chỉ nhận được push khi PWA đã "Thêm vào MH chính"
// (iOS 16.4+). Mở bằng Safari thường (chưa cài) sẽ không xin được
// quyền, hàm bên dưới tự bỏ qua trong trường hợp đó.
// ============================================================

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function setupPush(supabaseClient, staffId) {
  const cfg = window.MDA_CONFIG || {};
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!cfg.VAPID_PUBLIC_KEY) { console.warn('[push] chưa cấu hình VAPID_PUBLIC_KEY trong config.js'); return false; }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
    });
  }

  const json = sub.toJSON();
  await supabaseClient.from('push_subscriptions').upsert({
    staff_id: staffId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth
  }, { onConflict: 'endpoint' });

  return true;
}
