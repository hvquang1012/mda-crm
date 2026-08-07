# Kế hoạch tính năng timeline cho từng dự án

> Đề xuất sau khi rà `README.md`, `supabase/schema.sql`, màn hình staff, crew, client và service worker.

## Chốt nhanh

Nên làm một chế độ **Timeline** ngay trong tab **Công việc** của staff, cạnh chế độ danh sách hiện tại. Timeline là Gantt rút gọn: mỗi đầu việc có khoảng kế hoạch, phần trăm đã duyệt, mốc đáng lẽ phải đạt và vạch hôm nay.

Đi cùng tính năng này là một visual refresh có chủ đích: **toàn bộ app chuyển sang sans-serif và Royal Blue**. Đây là yêu cầu mới của chủ dự án, thay thế quyết định nhận diện đồng thau/kem + Fraunces hiện ghi trong `AGENTS.md`; phải đổi tập trung qua design token, không hard-code rải rác.

MVP không cần bảng mới, RPC mới hay thư viện ngoài. Dữ liệu đã có trong query `work_packages(..., work_items(*))` của `js/staff/items.js`.

Phía chủ nhà làm ở phase 2. Không đưa timeline đầy đủ vào `crew.html`: màn hình thợ cần nhẹ và ưu tiên “hôm nay làm gì” hơn là xem cả dự án.

## Những gì code hiện tại cho thấy

| Hiện trạng | Bằng chứng | Tác động tới timeline |
|---|---|---|
| Dự án luôn có ngày đầu/cuối | `projects.start_date`, `projects.end_date` trong `supabase/schema.sql` | Có sẵn khung trục thời gian |
| Đầu việc có ngày kế hoạch và tiến độ | `work_items.planned_start`, `planned_end`, `percent`, `status` | Đủ dựng MVP mà không query thêm |
| `%` chỉ là cache sau duyệt | `approve_report()` cập nhật `qty_done` và `percent` | Timeline chỉ hiển thị, tuyệt đối không tự ghi `%` |
| Ngày làm thật có thể suy ra | `progress_reports.report_date`, đã có index | Có thể thêm “dấu chân thực tế” ở phase sau |
| Phụ thuộc đã có dữ liệu | `dependencies` có predecessor, successor, `lag_days` | Có thể hiện chip bị chặn; chưa nên vẽ mũi tên trên mobile |
| `work_packages.planned_end` chưa được form ghi | `savePackage()` hiện chỉ insert `planned_start` | Timeline cấp hạng mục/client sẽ thiếu điểm cuối nếu không vá |
| `actual_start`/`actual_end` của hạng mục chưa được cập nhật ở đâu | Chỉ thấy khai báo trong schema | Không dùng hai cột này làm nguồn thật |
| `status` không tự chuyển sang trễ/vượt theo lịch | `compute_alerts()` sinh alert nhưng không update `work_items.status` | Màu timeline phải suy từ độ lệch kế hoạch, không tin hoàn toàn vào `status` |
| `client_view()` chỉ trả hạng mục, không trả đầu việc | `stages` trong RPC | Client timeline chỉ nên ở cấp giai đoạn/hạng mục |
| Dashboard chưa có hành động mở dự án | Card chỉ render HTML | MVP vào timeline qua tab Công việc + project selector |
| `sw.js` là network-first và cache runtime | Mọi GET nội bộ được cache sau khi fetch | Không cần thêm từng file JS mới vào mảng `SHELL` |
| UI đang trộn Fraunces, IBM Plex Sans và IBM Plex Mono | `css/app.css` import cả ba font | Cần gom về một sans-serif stack trên cả ba entry |
| Nhận diện cũ nằm ở token và cả giá trị literal | `--brass`, `--brass-deep`, meta theme-color và `manifest.json` | Đổi palette phải bao phủ CSS, HTML và PWA metadata |

Hai điểm cần nhớ khi triển khai:

1. `compute_alerts()` tính lệch kế hoạch từ `qty_done / qty_plan`; đầu việc không có `qty_plan` không được gắn chip “chậm X%”.
2. `dependencies.lag_days` đang chưa được dùng trong nhánh `chain_block` của `compute_alerts()`. Không nên quảng bá timeline là đã phản ánh lag cho tới khi logic này được thống nhất.

## Phạm vi MVP — timeline cho staff

Trong tab **Công việc**, thêm segmented control:

```text
[ Danh sách ] [ Timeline ]
```

- **Danh sách:** giữ nguyên CRUD, nhập thay, tạo link đội và xuất CSV.
- **Timeline:** đọc cùng `currentPackages`, nhóm đầu việc theo hạng mục/đội.
- Đổi dự án ở `projectSelect` thì timeline render lại ngay.
- Chạm một dòng timeline sẽ mở đúng modal sửa đầu việc hiện có.
- Đầu việc thiếu hoặc sai ngày nằm trong nhóm **Chưa lên lịch**, không bị vẽ giả ở ngày đầu dự án.

Không làm trong MVP:

- kéo-thả để đổi ngày;
- zoom/scroll theo từng ngày;
- mũi tên dependency kiểu desktop Gantt;
- nhật ký báo cáo/ảnh/cảnh báo;
- timeline toàn dự án trong `crew.html`;
- thêm bảng hoặc ghi dữ liệu tiến độ mới.

## Hình dung giao diện

```text
TIMELINE                         07/08/2026
         Th7             Th8             Th9
                          │ Hôm nay

⚡ Đội điện — Điện âm
  Đi dây tầng 1                              62%
  ───────────────[██████████│░░░░░]────────────
  01/08 → 18/08 · 62/100 điểm · chậm 8%

🪨 Đội đá — Đá bếp
  Gia công tại xưởng                         100%
  ─────────────────[████████████]───────────────
  25/07 → 05/08 · Hoàn thành

Chưa lên lịch (2)
  Đá lavabo tầng 2                       [Đặt ngày]
```

Trên mobile, tên nằm trên thanh để trục thời gian dùng trọn chiều ngang. Toàn bộ dự án được nén vừa màn hình; việc một ngày được ép bề rộng hiển thị tối thiểu nhưng vị trí vẫn đúng.

Không dùng màu làm tín hiệu duy nhất: luôn có chữ `chậm`, `vượt`, `hoàn thành` hoặc `chưa lên lịch`.

## Visual direction — Sans-serif + Royal Blue

### Font

Dùng một system sans-serif stack cho toàn app:

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
```

- `body`, heading, modal title, logo chữ, input và button đều dùng `--font-sans`.
- Bỏ Fraunces và IBM Plex Mono khỏi `css/app.css`.
- Số liệu/ngày tháng dùng `font-variant-numeric: tabular-nums` thay cho font mono.
- Bỏ luôn Google Fonts `@import`: tải nhanh hơn, không phụ thuộc CDN font và nhẹ hơn cho `crew.html` trong Zalo browser.
- Tạo phân cấp bằng `font-weight`, size và spacing; không cần serif để tạo cảm giác tiêu đề.

### Palette

Đổi token theo vai trò thay vì tên màu cũ:

```css
:root {
  --bg: #F4F7FC;
  --paper: #FFFFFF;
  --ink: #16213A;
  --ink-soft: #5F6B7A;
  --ink-faint: #98A2B3;
  --line: #DCE4F0;

  --primary: #4169E1;        /* Royal Blue */
  --primary-strong: #2948B8; /* nút/chữ cần tương phản cao */
  --primary-soft: #EDF2FF;

  --success: #2E7D5B;
  --success-soft: #E8F5EE;
  --warning: #A56612;
  --warning-soft: #FFF4D9;
  --danger: #B93845;
  --danger-soft: #FCEAEC;
  --track: #E8EDF5;
}
```

Quy ước dùng màu:

- Royal Blue: brand, focus, selected, CTA, tiến độ đúng kế hoạch và thanh timeline chính.
- Xanh lá: hoàn thành/vượt kế hoạch.
- Đỏ: trễ, lỗi, cảnh báo nghiêm trọng.
- Amber: cảnh báo nhẹ; không dùng Royal Blue để giả làm cảnh báo.
- `--primary-strong` dùng cho chữ/nút nền để đảm bảo contrast; `#4169E1` ưu tiên cho fill, border và điểm nhấn.

Đổi tên token trong code thay vì giữ alias `--brass` lâu dài. Có thể alias tạm trong lúc migrate, nhưng bản hoàn tất không còn `--brass`, `--brass-deep`, Fraunces hay IBM Plex Mono trong ba app entry.

### Phạm vi visual refresh

- Áp dụng đồng bộ cho `index.html`, `crew.html`, `client.html` vì cả ba dùng `css/app.css`.
- Đổi `<meta name="theme-color">` của cả ba entry sang `#4169E1`.
- Đổi `manifest.json`: `theme_color: #4169E1`, `background_color: #F4F7FC`.
- `huong-dan-domain.html` là tài liệu standalone có CSS riêng; cập nhật cùng palette/font trong một commit riêng hoặc cùng đợt nếu muốn nhận diện tuyệt đối đồng nhất.
- Icon PWA hiện là file raster; chưa recolor tự động trong task timeline. Nếu icon đang mang màu đồng thau, cần asset Royal Blue được duyệt rồi mới thay `icon-192.png` và `icon-512.png`.

## Quy tắc tính toán

### 1. Khung thời gian

- `from = min(project.start_date, các planned_start hợp lệ)`.
- `to = max(project.end_date, các planned_end hợp lệ)`.
- Nới hai đầu 3 ngày để thanh không dính mép.
- Tối thiểu 14 ngày.
- Nếu `from >= to`, báo dữ liệu ngày không hợp lệ thay vì chia cho 0.

Ngày phải được parse theo lịch, không parse mơ hồ bằng `new Date('YYYY-MM-DD')`. Helper nên đổi chuỗi thành day index qua `Date.UTC(year, month - 1, day)` để tránh lệch timezone/DST.

### 2. Hình học thanh

```text
left  = (planned_start - window.from) / window.days * 100
width = (planned_end - planned_start + 1) / window.days * 100
```

- Kẹp `left` và mép phải vào `0..100`.
- Bề rộng hiển thị tối thiểu khoảng `1.5%`.
- Dynamic geometry có thể gán qua CSS custom properties `--tl-left`, `--tl-width`; mọi chuỗi tên/ghi chú vẫn phải qua `escapeHtml()`.

### 3. Mốc “đáng lẽ” và độ lệch

Phải khớp công thức trong `compute_alerts()`:

```text
totalDays   = max(planned_end - planned_start, 1)
elapsedDays = max(today - planned_start, 0)
expectedPct = min(100, 100 * elapsedDays / totalDays)
actualPct   = 100 * qty_done / qty_plan
gap         = expectedPct - actualPct
```

Chỉ tính khi:

- có `qty_plan > 0`;
- có đủ hai ngày kế hoạch;
- đầu việc chưa `done`;
- hôm nay không trước ngày bắt đầu.

Phân loại hiển thị:

- `gap > 20`: nghiêm trọng, dùng `--danger`;
- `gap > 10`: cần chú ý, dùng `--warning` + chip chữ;
- `actualPct > expectedPct + 10`: vượt kế hoạch, dùng `--success`;
- `done` hoặc `percent >= 100`: hoàn thành;
- còn lại: đúng tiến độ dùng `--primary`, chưa bắt đầu dùng `--track`.

`percent` dùng để vẽ phần fill trong thanh kế hoạch. `actualPct` chỉ dùng đối chiếu với alert vì đó là công thức server hiện tại.

### 4. Mốc trục

- Khung dưới 45 ngày: tick theo tuần, ghi ngày/tháng.
- Từ 45 ngày trở lên: tick đầu tháng, ghi `Th8`, `Th9`…
- Vạch hôm nay chỉ hiện nếu nằm trong khung.
- Có `aria-label` đầy đủ cho mỗi dòng để dùng được với screen reader.

## Kiến trúc đề xuất

### `js/timeline.js` — module dùng chung, không đụng Supabase

Module chỉ nhận dữ liệu chuẩn hóa và trả HTML/hình học:

```js
export function parseDay(value) {}
export function makeWindow(project, rows) {}
export function barGeometry(start, end, window) {}
export function expectedProgress(row, today) {}
export function makeTicks(window) {}
export function renderTimeline(groups, options) {}
```

Dữ liệu trung lập:

```js
const row = {
  id, name, start, end,
  qtyPlan, qtyDone, percent, status,
  meta
};

const group = {
  id, title, subtitle, rows
};
```

`js/staff/items.js` chịu trách nhiệm map `work_packages/work_items` sang shape trên và wire click. `timeline.js` không import `state.js`, không biết modal và không gọi API.

### State

Thêm vào `js/staff/state.js`:

```js
itemsView: 'list'
```

Không thêm import chéo giữa `dashboard.js`, `approvals.js`, `items.js`, `alerts.js`.

### CSS

Thêm nhóm class `.timeline-*` ở `css/app.css`, dùng bộ token Royal mới:

- `--track`: nền trục;
- `--primary`: đúng tiến độ;
- `--warning`: cần chú ý;
- `--danger`: trễ;
- `--success`: hoàn thành/vượt;
- `--ink-faint`, `--line`: tick và chữ phụ.

Không thêm thư viện, SVG engine, canvas hay inline màu mới. Visual refresh phải đổi token dùng chung trước, sau đó timeline chỉ tiêu thụ token.

## Kế hoạch triển khai

### Bước 1 — Đổi nền visual dùng chung

- Đổi typography và design token trong `css/app.css`.
- Thay toàn bộ reference `--brass*`, `--sage*`, `--brick*`, `--sand*` bằng token semantic mới.
- Đổi theme metadata trong ba HTML entry và `manifest.json`.
- Kiểm tra focus, selected, disabled, success, warning, danger ở cả staff/crew/client.
- Đây là thay đổi thuần giao diện; không trộn với logic Supabase.

### Bước 2 — Chặn dữ liệu ngày lỗi

- Thêm ô `Dự kiến xong` vào `packageModal` và ghi `planned_end` trong `savePackage()`.
- Validate `planned_end >= planned_start` cho dự án, hạng mục và đầu việc ở UI.
- Hạng mục cũ thiếu ngày: chỉ suy để hiển thị từ `min/max` ngày của đầu việc con, không tự ghi đè DB.
- Khi chạm `savePackage()`, sửa luôn lệnh insert các item template đang bỏ qua `{ error }`; nếu insert lỗi phải báo thất bại, không toast thành công.

Chưa thêm constraint SQL trong MVP để tránh schema hiện tại fail vì dữ liệu cũ. Sau khi audit dữ liệu có thể thêm `CHECK (planned_end is null or planned_start is null or planned_end >= planned_start)` bằng migration riêng.

### Bước 3 — Dựng timeline thuần UI

- Tạo `js/timeline.js`.
- Thêm CSS responsive.
- Thêm control `Danh sách / Timeline` vào `index.html`.
- `renderPackages()` vẫn query đúng một lần như hiện tại, sau đó rẽ nhánh render theo `state.itemsView`.
- Sau mọi mutation hiện có, `renderPackages()` tiếp tục được gọi nên timeline tự cập nhật, không phụ thuộc riêng realtime.

### Bước 4 — Hoàn thiện UX staff

- Click/tap dòng mở `openItemModal(null, itemId)`.
- Hiện nhóm `Chưa lên lịch` và nút đặt ngày.
- Preserve chế độ xem khi realtime re-render hoặc đổi dự án.
- Empty/loading/error state riêng cho timeline.
- Test ở 375px, không có cuộn ngang.

### Bước 5 — Phase 2: timeline cho chủ nhà

Mở rộng dữ liệu `stages` trong `client_view()` nhưng vẫn chỉ trả cấp hạng mục:

```text
planned_start = coalesce(work_packages.planned_start, min(work_items.planned_start))
planned_end   = coalesce(work_packages.planned_end,   max(work_items.planned_end))
```

Sau đó `js/client.js` có thể dùng cùng `js/timeline.js` để vẽ thanh giai đoạn.

Khi sửa RPC bắt buộc giữ:

- `security definer` + `set search_path = public`;
- kiểm tra `revoked_at`, `expires_at` và cập nhật `last_used_at`;
- chỉ đúng project của token;
- không tên thầu phụ, không `issues`, không ghi chú nội bộ;
- không grant bảng/policy cho `anon`.

Phase này không cần trả `progress_reports` hay ảnh mới; album ảnh hiện tại giữ nguyên.

### Bước 6 — Phase 3: dependency và dấu chân thực tế

- Hiện chip `Bị chặn bởi: ...` khi predecessor chưa xong.
- Thống nhất cách dùng `lag_days` giữa timeline và `compute_alerts()` trước khi hiển thị ngày chờ.
- Nếu cần `actualStart/actualEnd`, tạo query/RPC aggregate `min/max(report_date)` chỉ trên báo cáo `approved`; không tải toàn bộ lịch sử báo cáo về browser.
- RPC aggregate cho staff nên là `security invoker`, chỉ grant execute cho `authenticated`.

## File dự kiến thay đổi

### MVP

| File | Thay đổi |
|---|---|
| `js/timeline.js` | File mới: date math, geometry, ticks, render |
| `css/app.css` | Sans-serif, Royal tokens và component timeline responsive |
| `index.html` | Nút đổi view, ô kết thúc hạng mục và Royal theme-color |
| `crew.html` | Royal theme-color; nhận font/màu mới từ CSS chung |
| `client.html` | Royal theme-color; nhận font/màu mới từ CSS chung |
| `manifest.json` | Royal theme/background cho PWA |
| `js/staff/state.js` | `itemsView` |
| `js/staff/items.js` | Map dữ liệu, render timeline, validate ngày, ghi `planned_end` |

`sw.js` không cần đổi: network-first hiện tại đã cache module sau lần fetch thành công.

### Phase 2

| File | Thay đổi |
|---|---|
| `supabase/schema.sql` | Suy ngày stage trong `client_view()` |
| `js/client.js` | Render timeline cấp giai đoạn |
| `client.html` | Điều chỉnh container/nhãn nếu cần |

Không sửa file `supabase-schema.sql` cũ; nguồn schema hiện hành là `supabase/schema.sql`.

## Checklist nghiệm thu

### Đúng đắn

1. Dự án 30, 90 và 365 ngày đều render không vỡ.
2. Việc 1 ngày vẫn nhìn/chạm được; vị trí không sai.
3. Việc thiếu ngày hoặc end trước start vào nhóm lỗi/chưa lên lịch.
4. Hôm nay trước, trong và sau khung dự án đều xử lý đúng.
5. Một đầu việc có `qty_plan > 0`: chip lệch phải khớp `compute_alerts()` sau khi làm tròn.
6. Đầu việc trọn gói/không có `qty_plan` không bị gắn chip chậm sai.
7. Sửa ngày rồi lưu: timeline render lại ngay cả khi realtime chưa bật.

### Mobile và accessibility

8. Viewport 375px không cuộn ngang, chữ không đè thanh.
9. Tap target tối thiểu 44px; dùng được bằng bàn phím.
10. Trạng thái vẫn hiểu được khi bỏ màu/ở chế độ tương phản thấp.
11. Staff, crew và client đều chỉ dùng sans-serif; số liệu vẫn thẳng cột nhờ `tabular-nums`.
12. Focus ring và CTA Royal Blue đủ tương phản; warning/success/danger không bị đồng màu với brand.
13. Meta theme-color và PWA manifest đều là Royal Blue, không còn flash màu đồng thau khi mở app.

### Bảo mật và vận hành

14. MVP không thay schema/RLS và anon vẫn không select trực tiếp bảng nào.
15. Sau phase client, chạy lại curl anon: REST bảng phải trả `42501 permission denied`.
16. Hai token client của hai dự án chỉ thấy timeline dự án tương ứng.
17. Client timeline không lộ tên đội, issues hoặc note.
18. `crew.html` không tải thêm module timeline trong MVP.
19. `sw.js` vẫn network-first; thiết bị PWA nhận bản mới sau khi mở lại.

## Tiêu chí “done” cho MVP

MVP được xem là xong khi staff chọn một dự án, chuyển sang Timeline và trong một màn hình nhìn được:

- việc nào diễn ra lúc nào;
- hôm nay đang ở đâu;
- việc nào đang chậm/vượt so với kế hoạch;
- việc nào chưa có lịch;
- chạm vào việc để sửa và thấy timeline cập nhật ngay.

Đây là lát cắt đem lại giá trị cao nhất với rủi ro thấp nhất: giao diện mới sans-serif + Royal Blue, không build step, không dependency runtime, không mở thêm bề mặt anon và không chạm nguồn sự thật `progress_reports`.
