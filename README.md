# MDA Site — Quản lý tiến độ thầu phụ

PWA cho **MD Architects** (thầu chính) theo dõi tiến độ các đội thầu phụ — trước mắt là thi công **đá** và **điện** — trên nhiều công trình chạy song song.

| | |
|---|---|
| **Web** | https://zippy-douhua-7a4098.netlify.app |
| **Repo** | `git@github.com:hvquang1012/mda-crm.git` |
| **Supabase** | project `mda-crm` (`lneaqpfiifqkpccpxgsp`, Singapore) |
| **Deploy** | Netlify, tự động khi push lên `main` |

---

## Bài toán

Quản lý thầu phụ khác quản lý task nội bộ ở ba điểm, và hệ thống được thiết kế quanh đúng ba điểm đó:

1. **Thứ gây trễ là bàn giao mặt bằng, không phải % công việc.** Đá bếp không đo được cho tới khi tủ bếp lắp xong; điện âm tường phải nghiệm thu trước khi trát. Câu hỏi thật của thầu chính là *"tôi có đang chặn ai, và ai đang chặn tôi"* → bảng `dependencies`.
2. **Số liệu thầu phụ báo lên luôn cao hơn thực tế.** Nên mọi báo cáo đều kèm ảnh bắt buộc và phải qua giám sát duyệt mới được tính.
3. **Đơn vị đo mỗi ngành mỗi khác.** Đá tính m² theo cấu kiện và có công đoạn gia công tại xưởng (ngoài tầm mắt giám sát); điện tính theo điểm/mét dây và chia hai giai đoạn thô–hoàn thiện cách nhau hàng tuần.

## Nguyên tắc thiết kế cốt lõi

> **`progress_reports` là nguồn sự thật. `%` chỉ là số tính ra.**

Bảng `progress_reports` chỉ ghi thêm, không sửa, không xoá. Mỗi bản ghi là một lần báo: khối lượng làm thêm, số thợ có mặt, ảnh, ai báo, lúc nào, ai duyệt. `work_items.qty_done` và `percent` chỉ là **cache** được cộng dồn bởi `approve_report()`.

Cả bốn mục tiêu của hệ thống đều rơi ra từ đúng một bảng này:

| Mục tiêu | Suy ra từ |
|---|---|
| Biết sớm ai sắp trễ | Tốc độ 7 ngày qua từ `qty_delta` → dự báo ngày về đích |
| Nghiệm thu khối lượng | `SUM(approved_qty)` các bản ghi đã duyệt trong kỳ |
| Bằng chứng tranh chấp | Ảnh gắn cứng vào bản ghi, có `taken_at` (EXIF) và `created_at` |
| Báo cáo chủ nhà | Lọc bản ghi đã duyệt, ẩn tên thầu phụ và vướng mắc nội bộ |

---

## Bốn kiểu người dùng

| Ai | Vào bằng | Màn hình |
|---|---|---|
| **Công nhân / đội trưởng thầu phụ** | Link Zalo, **không đăng nhập** (`crew.html?t=<token>`) | Chọn đầu việc → nhập khối lượng + số thợ + ghi chú + ảnh → gửi. Nút "Báo vướng". |
| **Giám sát** | Email + mật khẩu | Hộp duyệt (màn hình chính), nhập thay đội không dùng app |
| **Chỉ huy trưởng / ban giám đốc** | Email + mật khẩu | Dashboard đa công trình, cảnh báo, xuất CSV nghiệm thu |
| **Chủ nhà** | Link riêng, không đăng nhập (`client.html?t=<token>`) | Tiến độ theo giai đoạn + album ảnh đã duyệt |

Thiết kế cố ý cho phép **cả ba vai nội bộ đều nhập được** — hệ thống không chết khi một đội từ chối dùng app.

---

## Kiến trúc

Static PWA + Supabase. **Không build step, không npm, không bundler** — sửa file là chạy.

```
Trình duyệt                          Supabase
──────────                          ────────
index.html   ─ đăng nhập ─────────→  Auth + RLS (authenticated: full access)
crew.html    ─ ?t=token ──────────→  RPC crew_*()      security definer
client.html  ─ ?t=token ──────────→  RPC client_view() security definer
                                     ↓
ảnh ─ nén client-side ─────────────→ Edge Function crew-upload → Storage (private)
                                     ↓
                                     pg_cron 7h & 15h → compute_alerts()
                                     → Edge Function send-alerts → Web Push
```

**Bảo mật:** role `anon` **không có quyền gì** trên mọi bảng (`revoke all ... from anon`). Mọi thao tác không đăng nhập bắt buộc đi qua hàm `security definer` tự kiểm tra token bên trong. Đây là khác biệt cốt lõi so với bản v1 từng dùng `using (true)` khiến ai cũng đọc được dữ liệu mọi công trình.

### Bảng dữ liệu (14 bảng)

```
subcontractors    Đội thầu phụ (trade: da | dien | khac)
projects          Công trình
work_packages     Hạng mục = 1 đội × 1 công trình
work_items        Đầu việc trong hạng mục
dependencies      A xong mới tới B  ← nguồn gây trễ thật sự
progress_reports  NHẬT KÝ (append-only) — nguồn sự thật
issues            Vướng mắc, có cờ is_blocking
alerts            Cảnh báo sinh bởi compute_alerts()
crew_links        Token link Zalo cho từng người
client_links      Token link chủ nhà
staff             Hồ sơ nhân viên (auto-tạo bằng trigger từ auth.users)
push_subscriptions
work_package_templates + work_package_template_items
```

### Năm cảnh báo tự động

| Loại | Điều kiện |
|---|---|
| `no_crew` | Không có báo cáo nào 2 ngày liên tiếp trong khung thi công |
| `forecast_delay` | Khối lượng còn lại ÷ tốc độ TB 7 ngày → dự báo trễ *trước khi* trễ |
| `chain_block` | Đầu việc sắp tới hạn nhưng predecessor chưa xong |
| `issue_pending` | Vướng mắc `is_blocking` treo quá 24h |
| `plan_deviation` | Thực tế thấp hơn kế hoạch >10% (vàng) / >20% (đỏ) |

---

## Cấu trúc file

```
index.html          Staff app (giám sát + chỉ huy trưởng)
crew.html           Thợ / thầu phụ — entry riêng, nhẹ (chạy trong Zalo browser)
client.html         Chủ nhà
css/app.css         Design tokens + toàn bộ component
sw.js               Service worker: network-first + Web Push
config.js           SUPABASE_URL / ANON_KEY / VAPID_PUBLIC_KEY
manifest.json       PWA manifest
vendor/             supabase-js pin cứng 2.45.4 (không CDN)

js/
  supabase.js       Khởi tạo client dùng chung
  ui.js             escapeHtml, displayDate, daysUntil, showToast, db()
  photos.js         Nén ảnh + đọc EXIF + upload
  push.js           Đăng ký Web Push
  crew.js           Logic crew.html
  client.js         Logic client.html
  staff/
    state.js        State dùng chung giữa các tab
    main.js         Bootstrap: đăng nhập, tab, realtime
    dashboard.js    Tab Tổng quan
    approvals.js    Tab Duyệt — gộp theo (đầu việc × ngày)
    items.js        Tab Công việc — CRUD dự án/hạng mục/đầu việc/link
    alerts.js       Tab Cảnh báo
    export.js       Xuất CSV nghiệm thu theo kỳ

supabase/
  schema.sql              Toàn bộ schema + RLS + RPC + cảnh báo (~870 dòng)
  migrations/000_*.sql    Vá khẩn cấp lỗ hổng RLS của bản v1
  functions/
    crew-upload/          Cấp signed upload URL cho người không đăng nhập
    get-photo-url/        Cấp signed download URL cho chủ nhà
    send-alerts/          Đẩy Web Push
```

---

## Chạy local

Không có build step, nhưng **không mở bằng `file://`** — ES modules cần HTTP.

```bash
python3 -m http.server 8080
```

Rồi mở `http://localhost:8080`. `config.js` đã trỏ sẵn vào Supabase thật, nên local dùng chung dữ liệu với production — cẩn thận khi thử thao tác ghi.

## Deploy

**Web:** push lên `main`, Netlify tự deploy. Không cần build command, publish directory để trống.

**Schema / Edge Functions:** xem [AGENTS.md](AGENTS.md) mục "Lệnh vận hành".

---

## Trạng thái hiện tại

**Đã chạy thật:** schema đầy đủ 14 bảng, 3 Edge Functions, RLS đã kiểm chứng (anon bị chặn đọc trực tiếp), dữ liệu demo 1 công trình + 2 đội, đã test end-to-end trên production (đăng nhập → dashboard → duyệt → cảnh báo).

**Chưa làm:**

- `pg_cron` gọi `send-alerts` còn **comment trong `schema.sql`** — cần điền service_role key rồi chạy tay để bật Web Push tự động. `compute_alerts()` thì đã lên lịch chạy 7h/15h.
- Dọn ảnh gốc >180 ngày (giữ thumbnail) — cần Edge Function riêng, chưa viết.
- Không có test tự động nào.
- `staff.role` (`staff`/`manager`/`admin`) mới chỉ là nhãn — RLS đang cấp quyền như nhau cho mọi tài khoản đăng nhập.

**Chi phí:** Supabase free 1GB storage. Ước tính 5 công trình × 5 đội × ~2 báo cáo/ngày × 3 ảnh × 150KB × 90 ngày ≈ 1GB — sát trần, nên tính tới gói Pro $25/tháng trong năm đầu.

---

## Tài liệu khác

- [HUONG_DAN_TRIEN_KHAI.md](HUONG_DAN_TRIEN_KHAI.md) — hướng dẫn triển khai cho người không biết code
- [huong-dan-domain.html](huong-dan-domain.html) — gắn tên miền riêng
- [AGENTS.md](AGENTS.md) — quy ước kỹ thuật + checklist review
- [CLAUDE.md](CLAUDE.md) — hướng dẫn cho Claude Code
