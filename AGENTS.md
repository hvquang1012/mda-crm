# AGENTS.md

Quy ước kỹ thuật và checklist review cho dự án **MDA Site**. Đọc [README.md](README.md) trước để nắm bối cảnh nghiệp vụ.

Áp dụng cho mọi agent làm việc trên repo này (Claude Code, Codex, ...). Claude Code đọc thêm [CLAUDE.md](CLAUDE.md) cho phần vận hành.

---

## 1. Ràng buộc nền tảng — không được phá

Đây là các quyết định kiến trúc có lý do cụ thể. Muốn đổi thì phải nêu lý do rõ ràng, không đổi ngầm.

**Không build step.** Không thêm npm, bundler, TypeScript compiler, framework, hay bất kỳ thứ gì cần `npm install` để chạy được web. Sửa file là chạy. Lý do: `crew.html` phải mở được trong Zalo in-app browser trên máy thợ đời cũ, và người vận hành hệ thống không phải lập trình viên.

**Không CDN runtime.** `supabase-js` được pin cứng ở `vendor/supabase-js@2.45.4.min.js`. Không thay bằng `unpkg`/`esm.sh` trong code chạy ở trình duyệt — bản v1 từng dùng `unpkg@2` không pin version, một bản release lỗi bên upstream là app chết. (Edge Functions chạy trên Deno thì dùng `esm.sh` là bình thường.)

**ES modules cho app code, classic script cho vendor.** Thứ tự load bắt buộc trong mọi HTML entry:

```html
<script src="vendor/supabase-js@2.45.4.min.js"></script>  <!-- đặt window.supabase -->
<script src="config.js"></script>                          <!-- đặt window.MDA_CONFIG -->
...
<script type="module" src="js/..."></script>
```

**Ba HTML entry tách biệt.** `index.html` (staff) / `crew.html` (thợ) / `client.html` (chủ nhà). Không gộp — `crew.html` phải nhẹ, không kéo theo code staff.

---

## 2. Bất biến về bảo mật — mức nghiêm trọng cao nhất

Bản v1 của dự án này có lỗ hổng cho phép **bất kỳ ai có link share đọc được toàn bộ dữ liệu mọi công trình**, kể cả token của khách hàng khác. Toàn bộ thiết kế hiện tại xoay quanh việc không tái diễn.

### 2.1 `anon` không có quyền gì trên mọi bảng

`schema.sql` có `revoke all on all tables in schema public from anon`. **Đây là bất biến số một.**

🚩 **Từ chối ngay** mọi thay đổi có:
- `grant ... to anon` trên bảng bất kỳ
- `create policy ... to anon`
- `create policy ... using (true)` mà không giới hạn `to authenticated`
- Client không đăng nhập gọi `.from('bảng').select()` thay vì `.rpc()`

### 2.2 Mọi thao tác không đăng nhập đi qua `security definer` RPC

| Hàm | Dùng bởi |
|---|---|
| `crew_bootstrap(token)` | crew.html |
| `crew_submit(token, item_id, qty, crew_size, note, photos, reporter_name, report_date, client_ref)` | crew.html (qua hàng đợi `js/outbox.js`) |
| `crew_my_reports(token)` | crew.html |
| `crew_raise_issue(token, ...)` | crew.html |
| `client_view(token)` | client.html |

Mỗi hàm **bắt buộc** có đủ:
- `security definer` **và** `set search_path = public` (thiếu `search_path` là lỗ hổng leo thang quyền)
- Kiểm tra `revoked_at is null and (expires_at is null or expires_at > now())`
- Cập nhật `last_used_at`

### 2.2b Phân quyền nhân viên theo công trình

`staff.role`: `kts` (và `staff` cũ, coi như kts) chỉ thấy công trình trong `project_members` hoặc do mình tạo (`projects.created_by`); `manager`/`admin` thấy tất cả. Mọi policy bảng theo công trình dùng `can_access_project(project_id)` (security definer, đọc `staff`/`project_members` không vướng RLS). Storage lọc theo thư mục đầu của path = `project_id`.

- Chỉ `set_staff_role()` (admin) đổi được `role` — `authenticated` chỉ có quyền `update(full_name, phone)` trên `staff`. 🚩 Từ chối mọi `grant update on staff`.
- Hàm thao tác dữ liệu nhiều công trình từ phía staff phải là `security invoker` (RLS tự lọc) **hoặc** `security definer` có gọi `can_access_project()` tường minh.
- Edge Function dùng service_role phải tự kiểm tra phạm vi (xem `send-alerts` lọc người nhận).

### 2.3 Kiểm tra phạm vi token

`crew_submit` và `crew_raise_issue` phải xác minh `work_item` thuộc đúng `(project_id, subcontractor_id)` của token — nếu không sẽ raise `item_not_in_scope`. Đội đá không được ghi vào đầu việc của đội điện.

`client_view(token)` chỉ trả về **đúng một** công trình, **không** trả tên thầu phụ, **không** trả `issues`.

### 2.4 Ranh giới dữ liệu khác

- Token phải là `encode(gen_random_bytes(16), 'hex')` (32 ký tự). Không dùng `md5(random())` cắt ngắn.
- `service_role` key chỉ được xuất hiện trong Edge Functions (đọc từ `Deno.env`). **Không bao giờ** trong `config.js`, `js/`, hay bất kỳ file nào gửi tới trình duyệt.
- Mọi dữ liệu người dùng nhúng vào `innerHTML` phải qua `escapeHtml()` (`js/ui.js`).

---

## 3. Bất biến về dữ liệu

**`progress_reports` là append-only.** Không `UPDATE` cột nghiệp vụ, không `DELETE`. Chỉ được đổi `status` / `approved_qty` / `approved_by` / `approved_at` / `reject_reason` qua `approve_report_group()` / `reject_report_group()` (hàm 1 báo cáo `approve_report`/`reject_report` gọi lại hàm nhóm). Bảng **không có policy update** — nên hai hàm này phải là `security definer` + kiểm tra `can_access_project()`. (Bản trước để `security invoker` → RLS chặn, mọi lần duyệt thất bại ngầm.) Staff chỉ `insert` được báo cáo `status='pending'`.

**`work_items.qty_done` và `percent` là cache, không phải nguồn.** Chỉ `approve_report_group()` được cộng vào. 🚩 Từ chối mọi code ghi thẳng `qty_done` từ client. `work_items.status` thì `compute_alerts()` tự cập nhật theo lịch (quá hạn → `delayed`, lệch >10% → `delayed`/`ahead`) — trừ đầu việc đã `done`. Giám sát chốt `done` bằng tay (menu ⋯ đầu việc / "Xong cả hạng mục") chỉ đổi `status`, không đụng khối lượng; trigger `trg_work_items_status` cập nhật ngay `work_packages.status` và đóng (`acknowledged_at`) cảnh báo cũ của đầu việc vừa xong. Tổng quan coi công trình xong hết đầu việc là "Đã xong", kể cả khi quá ngày bàn giao. **Đóng công trình** = `projects.status = 'done'` (nút 🏁 ở tab Công việc / thẻ "Đã xong" ở Tổng quan, qua `js/staff/project-status.js`): ẩn khỏi Tổng quan, `compute_alerts()` bỏ qua mọi công trình không `active`, trigger `trg_projects_status` đóng cảnh báo đang mở. Link thợ / chủ nhà vẫn chạy.

**Hàng đợi offline của thợ (`js/outbox.js`).** Mỗi báo cáo mang `client_ref` (uuid sinh ở máy); `crew_submit` gặp lại `client_ref` cũ thì trả id cũ — gửi lại sau khi rớt mạng không tạo bản trùng. `report_date` do máy gửi, server chỉ nhận trong khoảng [hôm nay − 7, hôm nay + 1].

**Dropbox là bản lưu trữ, không phải nguồn.** `photo_archive` ghi trạng thái từng ảnh (`uploading → pending → approved/rejected`, hoặc `failed`). App không bao giờ đọc ảnh từ Dropbox.

**Thông báo báo cáo mới** ghi vào bảng riêng `report_notifications` (không thêm cột vào `progress_reports`). Cron `mda-notify` chạy mỗi phút, chỉ gọi `send-alerts` khi `notify_due()`; hàng đợi `reports_to_notify()` gom theo (công trình, người gửi) và chờ 90 giây yên lặng.

**Ảnh và ghi chú bắt buộc — kiểm tra ở server.** `crew_submit()` raise `note_required` / `photo_required`. Validate ở client là để UX, không phải là lớp bảo vệ. Đừng bỏ kiểm tra phía SQL.

**Nén ảnh phía client là bắt buộc.** `js/photos.js`: bản chính 1280px/q0.7 (~150KB) + thumbnail 400px/q0.6 (~30KB). Ảnh gốc điện thoại 3–5MB sẽ đốt hết 1GB gói free trong vài tuần.

**Ảnh vào có thể không phải JPEG.** iPhone mặc định chụp **HEIC**, chế độ ProRAW cho **DNG** — Chrome/Edge trên máy tính không mở được cả hai, `<img>` và `createImageBitmap` đều thất bại. `js/convert.js` xử lý: nhận dạng bằng byte đầu file (không tin `file.type`, Windows để trống), HEIC giải mã bằng `vendor/libheif@1.18.2.js` (WebAssembly, tải lười — chỉ khi trình duyệt không tự mở được), DNG thì bóc ảnh JPEG xem trước nhúng sẵn bên trong thay vì giải mã raw. Đầu ra luôn là JPEG nên tầng duyệt và tầng chủ nhà không cần biết. 🚩 Đừng chuyển `libheif` sang precache trong `sw.js` — 960KB đó chỉ một số máy cần.

**`daysUntil()` không được kẹp về 0.** Số âm nghĩa là đã trễ và phải hiển thị được ("trễ 6 ngày"). Bản v1 dùng `Math.max(0, ...)` che mất thông tin quan trọng nhất.

---

## 4. Quy ước code

**Mọi mutation Supabase phải kiểm tra `error`.**

⚠️ **Cạm bẫy quan trọng nhất của repo này:** `supabase.rpc()` và `.from().insert()` **không throw** khi Postgres báo lỗi — chúng resolve thành `{ data, error }`. Bọc trong `try/catch` là vô dụng.

```js
// ❌ SAI — catch không bao giờ chạy, lỗi bị nuốt, người dùng thấy "thành công"
try { await supabase.rpc('approve_report', {...}); showToast('Đã duyệt'); }
catch (e) { showToast('Thất bại'); }

// ✅ ĐÚNG
const { error } = await supabase.rpc('approve_report', {...});
if (error) { showToast('Thất bại', true); return; }

// ✅ ĐÚNG — hoặc dùng helper có sẵn
await db(supabase.from('work_items').insert(row), { successMsg: 'Đã lưu' });
```

**Sau khi ghi phải render lại**, không phụ thuộc riêng realtime. Bản v1 dựa hoàn toàn vào realtime nên khi publication chưa bật thì UI đứng im dù DB đã đổi.

**Tiếng Việt.** Comment, tên biến nghiệp vụ, và toàn bộ chuỗi hiển thị. Chuỗi UI viết từ phía người dùng: "Đã gửi — chờ giám sát duyệt", không phải "submit thành công".

**CSS ở `css/app.css`**, dùng design token trong `:root`. Không thêm inline style mới cho những gì token đã có. Bảng màu là bộ nhận diện thương hiệu (xanh tím `#5B4CF0→#4338CA` dạng gradient cho nút/header; nền slate có lưới chấm kỹ thuật `--pattern`, thẻ viền mực 2px + bóng cứng `--shadow-hard` đồng bộ icon Filled Outline ở `assets/icons/`; font Plus Jakarta Sans đóng gói offline ở `vendor/fonts/`; Sáng/Tối theo máy hoặc ép bằng `<html data-theme>` — mọi biến tối phải khai báo ở cả hai khối) — không đổi tuỳ tiện. Icon app vẽ từ `assets/app-icon.svg` (logo vector: `assets/logo-mark.svg`); sửa SVG thì render lại `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`.

**`state` object** (`js/staff/state.js`) là kênh chia sẻ duy nhất giữa các module tab, cố ý để tránh import vòng. Không import chéo giữa `dashboard.js` / `approvals.js` / `items.js` / `alerts.js`. Chuyển tab từ module khác: `state.navigate('items')` (main.js gán). `wizard.js` là module phụ chỉ `items.js` import.

**Thông báo lỗi RPC:** dùng `rpcErrorText(error)` (`js/ui.js`) để đổi mã lỗi SQL (`already_processed`, `forbidden`...) ra câu tiếng Việt. Thêm mã lỗi mới trong SQL thì thêm vào bảng `RPC_ERROR_VI`.

**`sw.js` phải giữ network-first.** Bản v1 dùng cache-first khiến máy đã cài PWA kẹt ở bản cũ vĩnh viễn sau mỗi lần deploy. 🚩 Từ chối mọi thay đổi đưa `caches.match()` lên trước `fetch()`.

---

## 5. Checklist review

Ưu tiên theo thứ tự — mục 1 là lý do dự án được viết lại.

**1. Bảo mật (chặn merge nếu vi phạm)**
- [ ] Có `grant`/`policy` nào mở cho `anon` không?
- [ ] RPC mới có đủ `security definer` + `set search_path = public` + kiểm tra hạn/thu hồi token?
- [ ] Có kiểm tra phạm vi token (`item_not_in_scope`) trên mọi hàm nhận `p_item_id`?
- [ ] `client_view` có rò tên thầu phụ / `issues` / công trình khác không?
- [ ] `service_role` key có lọt vào file client không?
- [ ] Dữ liệu người dùng vào `innerHTML` có qua `escapeHtml()` không?

**2. Đúng đắn**
- [ ] Mọi `.rpc()` / `.insert()` / `.update()` / `.delete()` có kiểm tra `error` **bằng cách đọc `{ error }`**, không phải `try/catch`?
- [ ] Có ghi thẳng vào `qty_done` / `percent` thay vì qua `approve_report()` không?
- [ ] Có sửa/xoá `progress_reports` không?
- [ ] Sau mutation có render lại không?
- [ ] Chuỗi nhiều lời gọi RPC liên tiếp — hỏng giữa chừng thì trạng thái ra sao?

**3. Nghiệp vụ**
- [ ] Ảnh + ghi chú còn bắt buộc ở tầng SQL không?
- [ ] Nén ảnh còn nguyên không?
- [ ] Ngày trễ còn hiển thị số âm được không?
- [ ] Hộp duyệt còn gộp theo `(work_item_id, report_date)` không? Bỏ gộp thì giám sát ngập sau 2 tuần dùng thật.
- [ ] Policy mới có dùng `can_access_project()` không? `using (true)` cho bảng theo công trình là lộ dữ liệu KTS khác.

**4. Vận hành**
- [ ] `sw.js` còn network-first không?
- [ ] Có thêm dependency cần build không?
- [ ] `crew.html` có nặng thêm không?

### Đã biết — đừng báo lại

| Vấn đề | Ghi chú |
|---|---|
| `pg_cron` gọi `send-alerts` (job `mda-notify`) còn comment trong `schema.sql` | Chạy tay 1 lần; khối mẫu mượn key từ job dropbox-sync. |
| Chưa dọn ảnh gốc >180 ngày | Cần Edge Function riêng, chưa viết. |
| Test tự động còn mỏng | `supabase/tests/run.sh` (SQL trên Postgres cục bộ) + `tests/ui/smoke.mjs` (giao diện với backend giả lập). Chưa có test cho Edge Functions. |
| `dropbox-link` chỉ nhận token thợ | Ảnh staff nhập thay không có bản gốc — `dropbox-sync` chép bản nén. |
| `config.js` chứa anon key công khai | Đúng thiết kế — anon key vốn để public, RLS chặn ở tầng DB. |

### Bug đã biết, chưa sửa

(Không còn — hai bug duyệt nhóm nuốt lỗi và xuất CSV gộp theo tên đã sửa: `approve_report_group` chạy 1 transaction, `export.js` gộp theo `work_items.id`.)

---

## 6. Lệnh vận hành

Supabase CLI qua `npx` (không cài global):

```bash
npx --yes supabase link --project-ref lneaqpfiifqkpccpxgsp
```

Áp dụng schema:

```bash
npx --yes supabase db query --linked --file supabase/schema.sql
```

Deploy một Edge Function:

```bash
npx --yes supabase functions deploy crew-upload --project-ref lneaqpfiifqkpccpxgsp
```

Đặt secret cho Edge Function:

```bash
npx --yes supabase secrets set VAPID_SUBJECT="mailto:..." --project-ref lneaqpfiifqkpccpxgsp
```

Cần `SUPABASE_ACCESS_TOKEN` (Personal Access Token) trong biến môi trường. Token này có quyền trên **toàn bộ tài khoản** Supabase, không giới hạn một project — chỉ dùng khi cần, thu hồi sau tại `supabase.com/dashboard/account/tokens`.

Kiểm thử SQL trên Postgres cục bộ (không đụng project thật):

```bash
PGHOST=/tmp PGPORT=5433 PGUSER=postgres bash supabase/tests/run.sh
```

Kiểm thử khói giao diện (backend giả lập, cần Playwright):

```bash
python3 -m http.server 8765 & node tests/ui/smoke.mjs
```

Chạy web local:

```bash
python3 -m http.server 8080
```

---

## 7. Kiểm thử thủ công

Test tự động (mục 6) chỉ phủ SQL cục bộ và giao diện giả lập. Thay đổi chạm vào các vùng dưới đây vẫn phải test tay trên project thật:

**Bảo mật** — với anon key, `curl` thẳng REST API:

```bash
curl "https://lneaqpfiifqkpccpxgsp.supabase.co/rest/v1/projects?select=*" \
  -H "apikey: <anon_key>" -H "Authorization: Bearer <anon_key>"
```

Phải trả `42501 permission denied`. Trả về dữ liệu là lỗ hổng.

**Luồng thợ** — mở `crew.html?t=<token>` trong **Zalo in-app browser trên điện thoại thật**, không phải Chrome desktop. Gửi thiếu ảnh hoặc thiếu ghi chú phải bị chặn. Ảnh lên Storage phải ~150KB.

**Hộp duyệt** — ba người cùng đội báo cùng đầu việc trong cùng ngày phải hiện **một** thẻ gộp. Chỉnh `approved_qty` khác số đề xuất rồi duyệt → `work_items.qty_done` cộng đúng số đã chỉnh.

**Cảnh báo** — `select compute_alerts();` rồi đối chiếu bảng `alerts`.

**Phân quyền KTS** — đăng nhập tài khoản `kts` chưa được giao công trình → không thấy công trình, báo cáo, ảnh nào; giao 1 công trình → chỉ thấy đúng công trình đó.

**Hàng đợi offline** — bật chế độ máy bay trên điện thoại thật, gửi báo cáo → thanh cam "đang chờ gửi" → tắt chế độ máy bay → tự gửi, hộp duyệt chỉ có 1 bản.

**Dropbox** — xem HUONG_DAN_TRIEN_KHAI.md bước 9.6.

**Deploy** — thiết bị đã cài PWA phải nhận bản mới sau khi mở lại (kiểm tra network-first thật sự hoạt động).
