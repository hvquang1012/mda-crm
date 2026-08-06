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
| `crew_submit(token, item_id, qty, crew_size, note, photos)` | crew.html |
| `crew_my_reports(token)` | crew.html |
| `crew_raise_issue(token, ...)` | crew.html |
| `client_view(token)` | client.html |

Mỗi hàm **bắt buộc** có đủ:
- `security definer` **và** `set search_path = public` (thiếu `search_path` là lỗ hổng leo thang quyền)
- Kiểm tra `revoked_at is null and (expires_at is null or expires_at > now())`
- Cập nhật `last_used_at`

### 2.3 Kiểm tra phạm vi token

`crew_submit` và `crew_raise_issue` phải xác minh `work_item` thuộc đúng `(project_id, subcontractor_id)` của token — nếu không sẽ raise `item_not_in_scope`. Đội đá không được ghi vào đầu việc của đội điện.

`client_view(token)` chỉ trả về **đúng một** công trình, **không** trả tên thầu phụ, **không** trả `issues`.

### 2.4 Ranh giới dữ liệu khác

- Token phải là `encode(gen_random_bytes(16), 'hex')` (32 ký tự). Không dùng `md5(random())` cắt ngắn.
- `service_role` key chỉ được xuất hiện trong Edge Functions (đọc từ `Deno.env`). **Không bao giờ** trong `config.js`, `js/`, hay bất kỳ file nào gửi tới trình duyệt.
- Mọi dữ liệu người dùng nhúng vào `innerHTML` phải qua `escapeHtml()` (`js/ui.js`).

---

## 3. Bất biến về dữ liệu

**`progress_reports` là append-only.** Không `UPDATE` cột nghiệp vụ, không `DELETE`. Chỉ được đổi `status` / `approved_qty` / `approved_by` / `approved_at` / `reject_reason` qua `approve_report()` và `reject_report()`.

**`work_items.qty_done` và `percent` là cache, không phải nguồn.** Chỉ `approve_report()` được cộng vào. 🚩 Từ chối mọi code ghi thẳng `qty_done` từ client.

**Ảnh và ghi chú bắt buộc — kiểm tra ở server.** `crew_submit()` raise `note_required` / `photo_required`. Validate ở client là để UX, không phải là lớp bảo vệ. Đừng bỏ kiểm tra phía SQL.

**Nén ảnh phía client là bắt buộc.** `js/photos.js`: bản chính 1280px/q0.7 (~150KB) + thumbnail 400px/q0.6 (~30KB). Ảnh gốc điện thoại 3–5MB sẽ đốt hết 1GB gói free trong vài tuần.

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

**CSS ở `css/app.css`**, dùng design token trong `:root`. Không thêm inline style mới cho những gì token đã có. Bảng màu là bộ nhận diện thương hiệu (đồng thau/kem, Fraunces + IBM Plex) — không đổi tuỳ tiện.

**`state` object** (`js/staff/state.js`) là kênh chia sẻ duy nhất giữa các module tab, cố ý để tránh import vòng. Không import chéo giữa `dashboard.js` / `approvals.js` / `items.js` / `alerts.js`.

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

**4. Vận hành**
- [ ] `sw.js` còn network-first không?
- [ ] Có thêm dependency cần build không?
- [ ] `crew.html` có nặng thêm không?

### Đã biết — đừng báo lại

| Vấn đề | Ghi chú |
|---|---|
| `staff.role` không được RLS dùng | Mọi tài khoản đăng nhập có quyền như nhau. Có chủ ý ở giai đoạn này. |
| `pg_cron` gọi `send-alerts` còn comment trong `schema.sql` | Cần điền service_role key thủ công. Đã ghi trong README. |
| Chưa dọn ảnh gốc >180 ngày | Cần Edge Function riêng, chưa viết. |
| Không có test tự động | Chưa có hạ tầng test. |
| `config.js` chứa anon key công khai | Đúng thiết kế — anon key vốn để public, RLS chặn ở tầng DB. |

### Bug đã biết, chưa sửa

- **`js/staff/approvals.js` — `approveGroup()` / `rejectGroup()` nuốt lỗi.** Dùng `try/catch` quanh `await supabase.rpc()`, nhưng RPC không throw khi Postgres raise exception. Nếu `approve_report` báo `already_processed` hoặc `not_authenticated`, người dùng vẫn thấy toast "Đã duyệt". Thêm nữa: nhóm nhiều báo cáo được duyệt bằng nhiều lời gọi RPC tuần tự, không phải một transaction — hỏng giữa chừng để lại trạng thái nửa vời. Nên gộp thành một RPC `approve_report_group(ids[], total)` chạy trong một transaction.
- **`js/staff/export.js` — gộp dòng bằng chuỗi tên.** Key là `subcontractor.name|package.name|item.name` vì query không select `id`. Hai đầu việc trùng tên trong cùng hạng mục sẽ bị cộng gộp sai. Sửa bằng cách select thêm `work_items.id` và dùng làm key.

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

Chạy web local:

```bash
python3 -m http.server 8080
```

---

## 7. Kiểm thử thủ công

Chưa có test tự động. Thay đổi chạm vào các vùng dưới đây phải test tay:

**Bảo mật** — với anon key, `curl` thẳng REST API:

```bash
curl "https://lneaqpfiifqkpccpxgsp.supabase.co/rest/v1/projects?select=*" \
  -H "apikey: <anon_key>" -H "Authorization: Bearer <anon_key>"
```

Phải trả `42501 permission denied`. Trả về dữ liệu là lỗ hổng.

**Luồng thợ** — mở `crew.html?t=<token>` trong **Zalo in-app browser trên điện thoại thật**, không phải Chrome desktop. Gửi thiếu ảnh hoặc thiếu ghi chú phải bị chặn. Ảnh lên Storage phải ~150KB.

**Hộp duyệt** — ba người cùng đội báo cùng đầu việc trong cùng ngày phải hiện **một** thẻ gộp. Chỉnh `approved_qty` khác số đề xuất rồi duyệt → `work_items.qty_done` cộng đúng số đã chỉnh.

**Cảnh báo** — `select compute_alerts();` rồi đối chiếu bảng `alerts`.

**Deploy** — thiết bị đã cài PWA phải nhận bản mới sau khi mở lại (kiểm tra network-first thật sự hoạt động).
