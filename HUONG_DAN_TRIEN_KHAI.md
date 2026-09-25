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
4. Nối `pg_cron` với `send-alerts`: mở `supabase/schema.sql`, kéo xuống
   phần **"THÔNG BÁO NGAY KHI CÓ BÁO CÁO MỚI"**, bỏ dấu `--` ở khối
   `do $do$ ... end $do$;` rồi chạy trong SQL Editor. Khối này mượn URL
   + khoá của job Dropbox (bước 9.4) nên phải làm bước 9.4 trước. Chưa
   dùng Dropbox thì dùng 2 khối **"ĐẨY WEB PUSH"** phía trên (điền tay
   `<PROJECT_REF>` và **service_role key** — giữ kín, không đưa vào
   `config.js`), đổi lịch `'10 7 * * *'` thành `'* * * * *'`.
   - Nếu báo lỗi thiếu extension: bật **pg_net** ở Database → Extensions.
5. Mỗi người muốn nhận thông báo: mở app → bấm biểu tượng **🔔** góc
   trên → Cho phép. iPhone phải "Thêm vào MH chính" và mở từ đó trước.

Nhận được gì: **📋 báo cáo mới chờ duyệt** (trong ~2 phút sau khi thợ
gửi, gom các đầu việc gửi liền nhau thành 1 thông báo) và cảnh báo trễ
hạn. Quản lý nhận mọi công trình, KTS chỉ công trình mình phụ trách.
Bấm vào thông báo mở thẳng tab Duyệt.

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

## BƯỚC 8 — Cập nhật lên bản mới (phân quyền KTS, duyệt nhóm, Dropbox)

Làm **một lần** sau khi lấy bản code mới:

1. Supabase → **SQL Editor** → New query → dán toàn bộ `supabase/schema.sql`
   → **Run**. File chạy lại nhiều lần được, không mất dữ liệu.
   - Lần đầu chạy, **mọi tài khoản cũ được nâng thành Quản trị** để không
     ai bị mất quyền. Sau đó vào tab Công việc → nút 👥 để hạ ai là KTS.
2. Deploy lại các Edge Function đã đổi và 2 function mới:
   ```bash
   npx --yes supabase functions deploy send-alerts dropbox-link dropbox-sync --project-ref lneaqpfiifqkpccpxgsp
   ```
3. Kiểm tra: đăng nhập bằng một tài khoản KTS chưa được giao công trình
   nào → tab Tổng quan phải báo "Bạn chưa được giao công trình nào".

> **Lỗi đã sửa trong bản này:** trước đây bấm **Duyệt** luôn hiện "Đã duyệt"
> nhưng thực ra máy chủ từ chối (khối lượng không được cộng). Sau khi chạy
> bước 1, hãy mở tab Duyệt — các báo cáo "đã duyệt" trước đây vẫn còn nằm
> chờ, duyệt lại một lần.

---

## BƯỚC 9 — Đồng bộ ảnh sang Dropbox (không bắt buộc)

Kết quả: mỗi ảnh thợ chụp được lưu **bản gốc, nét nhất** vào Dropbox,
tự xếp thư mục:

```
MDA Tiến độ/
  Nhà anh Minh — Ocean Park/
    Đội đá Sơn/
      _Chờ duyệt/2026-09-25/        ← ảnh vừa gửi, chưa duyệt
      2026-09-25 Lắp đá mặt bếp/    ← tự chuyển vào sau khi bấm Duyệt
      _Bị trả lại/2026-09-24/       ← báo cáo bị trả lại
```

Ảnh gốc đi **thẳng từ điện thoại lên Dropbox**, không tốn dung lượng
Supabase. Báo cáo nào thiếu ảnh gốc (thợ mất sóng, giám sát nhập thay,
báo cáo cũ từ trước khi bật) thì hệ thống tự chép **bản nén** sang, tên
tệp có chữ "(ban nen)".

### 9.1 Tạo "app" Dropbox (5 phút, làm trên máy tính)

1. Đăng nhập Dropbox bằng tài khoản công ty → mở
   **dropbox.com/developers/apps** → **Create app**.
2. Chọn **Scoped access** → **Full Dropbox** (hoặc *App folder* nếu chỉ
   muốn app đụng vào một thư mục riêng) → đặt tên, VD `MDA Tien do` →
   **Create app**.
3. Tab **Permissions**: tick `files.metadata.read`, `files.content.write`,
   `files.content.read` → bấm **Submit** ở cuối trang.
4. Tab **Settings**: chép **App key** và **App secret**.

### 9.2 Lấy "refresh token" (mã dùng lâu dài)

1. Mở trình duyệt, dán địa chỉ sau (thay `APP_KEY`):
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   ```
2. Bấm **Allow** → Dropbox hiện một mã (access code), chép lại.
3. Trên máy tính, mở Git Bash chạy (thay 3 giá trị):
   ```bash
   curl https://api.dropbox.com/oauth2/token \
     -d code=MA_VUA_CHEP -d grant_type=authorization_code \
     -u APP_KEY:APP_SECRET
   ```
   Kết quả có dòng `"refresh_token": "..."` — chép giá trị đó.
   Mã chỉ dùng được một lần; lỗi thì làm lại từ bước 1.

### 9.3 Đặt bí mật cho Edge Function

```bash
npx --yes supabase secrets set DROPBOX_APP_KEY=... DROPBOX_APP_SECRET=... DROPBOX_REFRESH_TOKEN=... --project-ref lneaqpfiifqkpccpxgsp
```

(Không bắt buộc: `DROPBOX_ROOT="/Ten thu muc khac"` nếu không muốn dùng
thư mục mặc định `/MDA Tiến độ`.)

### 9.4 Bật lịch đồng bộ 10 phút/lần

Mở cuối `supabase/schema.sql`, tìm khối **"ĐỒNG BỘ ẢNH DROPBOX"**, bỏ dấu
`--` đầu dòng, thay `<PROJECT_REF>` = `lneaqpfiifqkpccpxgsp` và
`<SERVICE_ROLE_KEY>` (Project Settings → API → service_role), dán vào
SQL Editor → Run. (Cần bật extension **pg_net** như bước Web Push.)

### 9.5 Bật gửi ảnh gốc từ máy thợ

Sửa `config.js`: đổi `DROPBOX_ORIGINALS: false` thành `true` → commit,
push. Từ lúc này mỗi báo cáo mới sẽ gửi thêm ảnh gốc lên Dropbox (chạy
nền sau khi báo cáo đã lưu, mạng yếu thì để dành gửi sau).

### 9.6 Kiểm tra

1. Thợ gửi 1 báo cáo có ảnh → trong ~1 phút, ảnh xuất hiện ở
   `_Chờ duyệt/<ngày>`.
2. Giám sát bấm Duyệt → trong ≤ 10 phút ảnh chuyển sang
   `<ngày> <tên đầu việc>`.
3. Cài **Dropbox desktop** ở máy văn phòng để thư mục tự về máy.

Nếu có ảnh không sao lưu được sau 5 lần thử, tab **Cần xử lý** hiện dòng
cảnh báo màu cam.

---

## CÁCH SỬ DỤNG

### Quản lý / KTS (index.html)

**Phân quyền:** mỗi tài khoản là **KTS** (chỉ thấy công trình được giao
hoặc tự tạo), **Quản lý** (thấy tất cả) hoặc **Quản trị** (thấy tất cả +
đổi vai trò). Giao công trình: tab Công việc → chọn công trình → nút 👥.

1. **Tạo công trình:** tab Công việc → **＋ Dự án** → 3 bước: thông tin
   → thêm các đội (đá/điện/khác) + chọn mẫu đầu việc → xem trước lịch tự
   dàn → **Tạo**. Hệ thống tạo luôn link cho từng đội + link chủ nhà, bấm
   **📤 Gửi** là mở Zalo.
2. **Thêm đầu việc nhanh:** trong hạng mục bấm **📋 Dán từ Excel** — bôi
   đen các cột Tên · Đơn vị · Khối lượng · Bắt đầu · Kết thúc trong
   Excel, copy, dán. Dòng lỗi tô đỏ, không bị thêm.
3. **Sửa nhanh:** bấm vào tên đầu việc để sửa khối lượng / ngày ngay tại
   chỗ. Đội vào trễ cả tuần → **⇆ Dời lịch** dời toàn bộ hạng mục.
4. **💾 Lưu làm mẫu:** hạng mục đã chuẩn thì lưu lại, lần sau chọn mẫu.
5. **🔗 Link cho đội:** xem ai đang giữ link, lần mở gần nhất, **Thu hồi**
   link của người đã nghỉ, cấp link mới.
6. **Tab Duyệt:** mỗi thẻ gộp các báo cáo cùng đầu việc trong ngày. Bấm
   ảnh để xem to (vuốt qua lại). Sửa số khối lượng nếu cần → **Duyệt**.
   Nhiều thẻ đã xem kỹ: tick ô vuông → **Duyệt N thẻ đã chọn**. **Trả
   lại** chọn nhanh lý do — đội thấy lý do và bấm "Sửa & gửi lại".
7. **Tab Tổng quan:** 4 con số (đang chạy · cần xử lý · chờ duyệt ·
   vướng mắc), công trình **rủi ro cao lên trước**; thanh xám = kế hoạch
   đáng đạt hôm nay, thanh màu = thực tế đã nghiệm thu. Bấm vào công
   trình để mở Timeline.
8. **Tab Cần xử lý:** vướng mắc đội báo (thiếu vật tư, chưa bàn giao mặt
   bằng...) kèm ảnh — xử lý xong ghi cách xử lý rồi bấm **Đã xử lý**. Bên
   dưới là cảnh báo tự động.
9. Đội không dùng app: nút **＋ Nhập thay** trong từng đầu việc.

### Thầu phụ / công nhân (crew.html)
Mở link Zalo → đầu việc **quá hạn** và **trong lịch hôm nay** nằm trên
cùng → chọn → bấm nhanh số lượng (+1, +5, "Xong phần còn lại"), chọn ghi
chú mẫu, chụp ảnh → **Gửi**. **Mất sóng vẫn gửi được**: báo cáo nằm trong
máy, có mạng tự gửi (thanh màu cam báo số báo cáo đang chờ). Gõ dở
chuyển đầu việc khác không mất. Báo cáo bị trả lại → tab Lịch sử →
**Sửa & gửi lại**. Nút ⚠ để báo vướng mắc, chụp kèm ảnh được.

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
  trong Storage nếu gần hết dung lượng. Khi đã bật Dropbox (bước 9),
  ảnh đã nằm an toàn trên Dropbox nên xoá ảnh cũ trong Supabase không mất gì.
- **Đơn giá & biên bản nghiệm thu:** theo yêu cầu, hệ thống KHÔNG lưu
  đơn giá thầu phụ hay xuất biên bản — chỉ theo dõi khối lượng.

---

## CHI PHÍ

- Supabase free: 500MB database + 1GB storage + 50.000 request/tháng.
  Với ảnh hiện trường hàng ngày của 5-6 đội, khả năng cần nâng Pro
  ($25/tháng) trong vòng vài tháng đầu.
- Netlify hosting: miễn phí.
- Không cần chi phí App Store/Google Play vì là PWA.
