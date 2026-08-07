# HƯỚNG DẪN TRIỂN KHAI — MDA SITE (v2: quản lý tiến độ thầu phụ)

Bản này thay thế hoàn toàn bản v1 (task list đơn giản). Có 3 màn hình
riêng biệt:

- **index.html** — giám sát + chỉ huy trưởng/ban giám đốc, cần đăng nhập
- **crew.html** — thầu phụ/công nhân, mở bằng link Zalo, không đăng nhập
- **client.html** — chủ nhà, mở bằng link Zalo riêng từng công trình, không đăng nhập

Thời gian triển khai: ~45-60 phút cho lần đầu (nhiều bước kỹ thuật hơn
bản v1 vì có thêm ảnh + cảnh báo đẩy), sau đó chỉ cần tạo link cho từng
đội và từng khách hàng mới.

---

## BƯỚC 1 — Tạo database Supabase

1. Vào **supabase.com** → **Start your project** → đăng ký.
2. **New project** → đặt tên (VD: `mda-tiendo`) → đặt mật khẩu database → khu vực **Singapore** → **Create** (đợi ~2 phút).
3. **SQL Editor** → **New query** → mở file `supabase/schema.sql` (không phải `supabase-schema.sql` cũ), copy toàn bộ → dán → **Run**.
   - Tạo toàn bộ bảng, bảo mật (RLS), hàm xử lý, mẫu đầu việc đá/điện, và bucket ảnh `site-photos`.
   - Nếu dòng `create extension if not exists pg_cron;` báo lỗi: vào **Database → Extensions**, tìm và bật **pg_cron** thủ công, rồi chạy lại 2 dòng `select cron.schedule(...)` ngay dưới nó.
4. **Project Settings → API** → copy **Project URL** và **anon public key**.

⚠️ Nếu trước đó đã chạy `supabase-schema.sql` (bản cũ) và có thể đã gửi
link cho khách: chạy ngay `supabase/migrations/000_urgent_fix_rls.sql`
trong SQL Editor **trước khi làm gì khác** — bản cũ có lỗ hổng để lộ dữ
liệu mọi dự án.

---

## BƯỚC 2 — Điền `config.js`

Mở `config.js`, điền `SUPABASE_URL` và `SUPABASE_ANON_KEY` từ Bước 1.
Để trống `VAPID_PUBLIC_KEY` — điền ở Bước 5.

---

## BƯỚC 3 — Tạo tài khoản nhân viên

**Authentication → Users → Add user → Create new user**, nhập email +
mật khẩu cho từng giám sát/chỉ huy trưởng. Hệ thống tự tạo hồ sơ nhân
viên khi tài khoản được tạo — không cần thao tác gì thêm.

---

## BƯỚC 4 — Cài Supabase CLI (bắt buộc — để deploy Edge Functions)

Ảnh hiện trường và cảnh báo đẩy cần 3 Edge Function chạy trên server
Supabase, không chỉ SQL. Cần cài CLI một lần:

```bash
npm install -g supabase
supabase login
```

Tại thư mục `mda-crm-pwa`, liên kết với project vừa tạo (lấy `<project-ref>`
từ Project URL, dạng `https://<project-ref>.supabase.co`):

```bash
supabase link --project-ref <project-ref>
```

Deploy 3 hàm:

```bash
supabase functions deploy crew-upload
supabase functions deploy get-photo-url
supabase functions deploy send-alerts
```

---

## BƯỚC 5 — Bật cảnh báo đẩy (Web Push)

1. Tạo cặp khoá VAPID (một lần duy nhất, không đổi sau này):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Dán **Public Key** vào `config.js` → `VAPID_PUBLIC_KEY`.
3. Set secret cho Edge Function `send-alerts`:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY="<public key>"
   supabase secrets set VAPID_PRIVATE_KEY="<private key>"
   supabase secrets set VAPID_SUBJECT="mailto:ban@mdarchitects.vn"
   ```
4. Nối `pg_cron` với `send-alerts` để tự động gửi 2 lần/ngày: mở
   `supabase/schema.sql`, kéo xuống phần **"ĐẨY WEB PUSH"** ở cuối file,
   bỏ dấu `--` (uncomment) 2 khối `cron.schedule`, thay `<PROJECT_REF>`
   bằng project ref và `<SERVICE_ROLE_KEY>` bằng **service_role key**
   (Project Settings → API — khác với anon key, giữ kín, không đưa vào
   `config.js`). Chạy đoạn đó trong SQL Editor.
   - Nếu báo lỗi thiếu extension: bật **pg_net** ở Database → Extensions.

Không làm bước này thì app vẫn chạy bình thường — chỉ là nhân viên
không nhận được thông báo đẩy khi có cảnh báo, phải tự mở tab "Cảnh báo"
để xem.

---

## BƯỚC 6 — Đưa app lên mạng

**Netlify Drop (app.netlify.com/drop):** kéo thả **toàn bộ thư mục**
`mda-crm-pwa` — bao gồm `index.html`, `crew.html`, `client.html`,
`config.js`, `manifest.json`, `sw.js`, thư mục `css/`, `js/`, `vendor/`,
2 file icon. **Không cần** kéo thư mục `supabase/` (đó là phần chạy
trên server Supabase, không phải phần web tĩnh).

Netlify trả về link dạng `https://random-name-123.netlify.app` — đây
là gốc để tạo mọi link con (staff mở `/index.html`, thầu phụ mở
`/crew.html?t=...`, khách mở `/client.html?t=...`).

---

## BƯỚC 7 — Cài lên điện thoại

Giống bản v1: **iPhone** — mở bằng Safari → nút Chia sẻ → Thêm vào MH
chính. **Android** — mở bằng Chrome → banner Cài đặt, hoặc menu 3 chấm
→ Thêm vào màn hình chính.

⚠️ Cảnh báo đẩy trên iPhone **chỉ hoạt động sau khi đã "Thêm vào MH
chính"** (iOS 16.4+). Mở bằng Safari thường sẽ không xin được quyền.

---

## CÁCH SỬ DỤNG

### Giám sát / chỉ huy trưởng (index.html)
1. Đăng nhập.
2. Tab **Công việc**: tạo dự án → bấm "＋ Thêm đội" → chọn ngành (đá/điện)
   → chọn mẫu đầu việc có sẵn (tự tạo checklist chuẩn) hoặc tự nhập.
3. Bấm **"🔗 Link cho đội"** trong từng hạng mục → nhập tên người nhận
   (không bắt buộc) → **Tạo link** → **Copy link** → gửi qua Zalo cho
   đội thầu phụ/công nhân. Mỗi người nên có link riêng để biết ai báo
   cáo gì.
4. Bấm **"🔗 Khách"** ở thanh trên cùng để lấy link riêng cho chủ nhà
   của dự án đang chọn.
5. Tab **Tổng quan**: xem nhanh mọi công trình đang chạy, đội nào đang
   có cảnh báo.
6. Tab **Cảnh báo**: danh sách 5 loại cảnh báo tự động, bấm ✓ khi đã xử
   lý xong. Nút "Kiểm tra ngay" chạy lại thủ công không cần chờ lịch
   7h/15h.
7. Nếu một đội không chịu dùng app: trong từng đầu việc có nút
   **"＋ Nhập thay"** để giám sát tự nhập hộ (vẫn cần ảnh + ghi chú —
   ghi nhận thẳng vào tiến độ ngay, không còn bước duyệt riêng).

### Thầu phụ / công nhân (crew.html)
Mở link được gửi qua Zalo → chọn đầu việc đang làm → nhập khối lượng
làm thêm hôm nay, số thợ có mặt, ghi chú, chụp ảnh → Gửi. Xem lại trạng
thái ở tab "Lịch sử". Nút ⚠ góc dưới để báo vướng mắc (thiếu vật tư,
chưa được bàn giao mặt bằng...).

### Chủ nhà (client.html)
Mở link riêng → xem tiến độ theo giai đoạn + album ảnh công trình.
Không thấy tên thầu phụ, giá cả, hay vướng mắc nội bộ.

---

## GIỚI HẠN CẦN BIẾT

- **Dung lượng:** ảnh đã được nén phía điện thoại trước khi gửi
  (~150KB/ảnh) nhưng với 3-8 công trình chạy song song, gói Supabase
  free (1GB) có thể hết trong ~4 tháng. Cân nhắc nâng **Pro ($25/tháng)**
  khi cần.
- **iOS Push:** chỉ nhận được sau khi đã cài vào màn hình chính, không
  nhận được khi chỉ mở bằng Safari.
- **Không dùng Zalo ZNS:** cảnh báo chỉ qua app (trong app + push),
  không tự động nhắn Zalo. Có thể bổ sung sau nếu cần, tốn thêm chi phí
  đăng ký Zalo OA + phí mỗi tin.
- **Xuất khối lượng:** file xuất ra là `.csv` (mở trực tiếp bằng Excel,
  giữ đúng dấu tiếng Việt), không phải `.xlsx` thật — đủ dùng cho việc
  đối chiếu số liệu, chưa hỗ trợ nhiều sheet hay công thức.
- **Ảnh cũ không tự xoá:** kế hoạch dọn ảnh gốc sau 180 ngày (mục 5
  trong thiết kế) chưa được triển khai trong bản này — cần thêm 1 Edge
  Function chạy theo lịch nếu muốn tự động, hiện tại phải xoá thủ công
  trong Storage nếu gần hết dung lượng.
- **Đơn giá & biên bản nghiệm thu:** theo yêu cầu, hệ thống KHÔNG lưu
  đơn giá thầu phụ hay xuất biên bản — chỉ theo dõi khối lượng.

---

## CHI PHÍ

- Supabase free: 500MB database + 1GB storage + 50.000 request/tháng.
  Với ảnh hiện trường hàng ngày của 5-6 đội, khả năng cần nâng Pro
  ($25/tháng) trong vòng vài tháng đầu.
- Netlify hosting: miễn phí.
- Không cần chi phí App Store/Google Play vì là PWA.
