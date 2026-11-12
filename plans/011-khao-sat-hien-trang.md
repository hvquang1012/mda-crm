# 011 — Khảo sát & số hoá hiện trạng

**Trạng thái:** Sẵn sàng · **Nhánh:** 3 nhánh, xem [Thứ tự làm](#thứ-tự-làm-3-pr-merge-lần-lượt) · **Người code:** Antigravity · **Review:** Claude Code

> Đọc [AGENTS.md](../AGENTS.md) (nhất là mục 0, 2, 3, 4) trước khi code. Mọi bất biến ở đó vẫn áp dụng.

## Thứ tự làm (3 PR, merge lần lượt)

Mỗi phần một nhánh tạo từ `main` **mới nhất** (phần trước đã merge), một PR riêng. Không gộp.

| # | Nhánh | Làm mục nào | Ghi chú |
|---|---|---|---|
| 1 | `011-1-sua-loi-ngay-gio` | I | Nhỏ, không đụng SQL. Trong PR này cũng nâng `sw.js` lên `v12`. |
| 2 | `011-2-giai-doan-va-checklist` | A, D1, D2, D4, E, F, G, H | Toàn bộ SQL nằm ở đây (kể cả bảng `survey_photos` — PR 3 chỉ thêm giao diện). Nút "📷 Ảnh" ở mỗi mục checklist **chưa làm** ở PR này. `sw.js` → `v13`. |
| 3 | `011-3-ve-so-do-len-anh` | B, C, D3 + nút "📷 Ảnh" của D2 | Phải có kết quả thử tay trên điện thoại thật trong PR. `sw.js` → `v14`. |

Checklist nghiệm thu: PR nào tick phần của PR đó (SQL + giao diện checklist ở PR 2; ca "chọn ảnh giả → trình bắt điểm" và "Thử tay" ở PR 3). Tài liệu cập nhật ở PR có thay đổi tương ứng.

## Bối cảnh

Hiện app chỉ theo dõi **thi công** của thầu phụ. Trước thi công, nhân viên Minh Đức phải xuống công trình đo hiện trạng; đo thiếu (quên cửa thang máy, quên cốt sàn, quên đáy dầm) là phải cho kỹ thuật xuống **đo lần 2** — mất 1 buổi và trễ phương án.

Tính năng thêm bước **Khảo sát** trước **Lên phương án**:

1. **Bắt điểm trên ảnh** — nhân viên chụp ảnh hiện trạng bằng điện thoại, kẻ đường đo (chiều dài tường, chiều cao trần), chấm điểm (ổ cắm, công tắc, cấp/thoát nước, điện) và ghi số đo **đè thẳng lên ảnh**.
2. **Checklist chống sót** — các thông số bắt buộc (cửa thang máy, độ nghiêng tường, dầm bê tông, cốt sàn, chiều cao trần) phải điền đủ — hoặc đánh "Không áp dụng" kèm lý do — **mới được chuyển công trình sang "Lên phương án"**. Chặn ở DB, không chỉ ở giao diện.

Chỉ **nhân viên đăng nhập** (`index.html`) dùng. Thợ (`crew.html`) và chủ nhà (`client.html`) không thấy gì của khảo sát.

## Quyết định đã chốt (không được đổi)

| Chủ đề | Quyết định |
|---|---|
| Đo đạc | **Đo trên ảnh**, không AR/WebXR (iPhone Safari/Zalo không hỗ trợ AR web). Số đo nhập tay từ thước laser / app Đo của iPhone, hoặc **ước tính theo thước chuẩn** (kẻ lên vật đã biết kích thước). Không thêm thư viện. |
| Cổng chặn | **Giai đoạn công trình**: `survey` (Khảo sát) → `design` (Lên phương án) → `construction` (Thi công). Rời `survey` khi checklist chưa đủ → DB raise `survey_incomplete`. Lùi giai đoạn thì tự do. Công trình cũ mặc định `construction`. |
| Checklist | **Theo công trình** (một danh sách cho cả công trình), **mẫu dùng chung do quản lý/admin sửa**. Mỗi mục có lựa chọn "Không áp dụng" + **lý do bắt buộc**. |
| Cột giai đoạn | Cột mới `projects.phase`, **tách khỏi** `projects.status` (active/done/paused) — không chạm trigger `trg_projects_status` / khoá link. |

## Phạm vi file

**Tạo mới:** `supabase/migrations/011_khao_sat.sql`, `js/annotate.js`, `js/staff/survey.js`.

**Sửa:** `supabase/schema.sql`, `supabase/tests/rls_test.sql`, `index.html`, `js/staff/items.js`, `js/staff/wizard.js`, `js/staff/dashboard.js`, `js/staff/state.js`, `js/photos.js`, `js/ui.js`, `css/app.css`, `sw.js`, `tests/ui/mock-supabase.js`, `tests/ui/smoke.mjs`, `AGENTS.md`, `README.md`, `HUONG_DAN_TRIEN_KHAI.md`.

**Không đụng:** `crew.html`, `client.html`, `js/crew*.js`, `js/client.js`, `js/outbox.js`, Edge Functions, `config.js`, `vendor/`.

---

## Đặc tả

### A. SQL — `supabase/migrations/011_khao_sat.sql`

Bọc `begin; … commit;` như `010_sua_nhieu_dau_viec.sql`, header ghi "chạy SAU 010". **Chép y hệt** từng khối vào đúng vị trí trong `schema.sql` (bảng ở mục BẢNG DỮ LIỆU, hàm ở mục hàm, RLS/grant ở mục RLS). Chạy 2 lần phải vô hại.

**A1. Giai đoạn công trình**

```sql
alter table projects add column if not exists phase text not null default 'construction';
-- ràng buộc tạo lại an toàn (giống staff_role_check)
alter table projects drop constraint if exists projects_phase_check;
alter table projects add constraint projects_phase_check check (phase in ('survey','design','construction'));
```

**A2. Mẫu checklist (dùng chung mọi công trình)**

```sql
create table if not exists survey_checklist_items (
  id uuid primary key default gen_random_uuid(),
  seq int not null default 0,
  section text not null default 'Chung',          -- nhóm hiển thị: "Kết cấu", "Cửa", "Kỹ thuật"...
  label text not null,
  kind text not null default 'number' check (kind in ('number','size','text')),
  unit text,                                       -- 'mm', 'mm/2m', null cho text
  hint text,                                       -- cách đo, hiện dưới ô nhập
  required boolean not null default false,
  photo_required boolean not null default false,  -- bắt buộc có ≥1 ảnh gắn vào mục
  active boolean not null default true,           -- ẩn thay vì xoá, giữ câu trả lời cũ
  created_at timestamptz default now()
);
```

- `kind='number'` → 1 số; `'size'` → rộng × cao (2 số); `'text'` → mô tả chữ.
- Seed bằng id cố định `00000000-0000-0000-0000-0000000001xx` + `on conflict (id) do nothing` (giống seed `work_package_templates`):

| seq | section | label | kind | unit | required | photo_required | hint |
|---|---|---|---|---|---|---|---|
| 10 | Kết cấu | Chiều cao trần thô | number | mm | ✔ | | Từ sàn thô tới đáy sàn trên, đo ở 2–3 điểm, ghi số nhỏ nhất |
| 20 | Kết cấu | Cốt sàn (thô so với hoàn thiện / mốc chuẩn) | number | mm | ✔ | | Chênh cốt so với mốc ghi trên tường; ghi rõ mốc ở ghi chú ảnh |
| 30 | Kết cấu | Vị trí & kích thước dầm bê tông | text | | ✔ | ✔ | Dầm nào, rộng × cao, cao độ đáy dầm so với sàn |
| 40 | Kết cấu | Độ nghiêng tường | number | mm/2m | ✔ | | Thước nhôm 2m hoặc laser — ghi bức tường nghiêng nhất |
| 50 | Cửa | Cửa thang máy (rộng × cao) | size | mm | ✔ | ✔ | Lọt lòng — quyết định kích thước tấm đá/tủ đưa lên được |
| 60 | Cửa | Cửa chính (rộng × cao) | size | mm | | | Lọt lòng |
| 70 | Kỹ thuật | Vị trí cấp / thoát nước | text | | | ✔ | Chấm điểm trên ảnh, ghi cao độ |
| 80 | Kỹ thuật | Vị trí tủ điện, ổ cắm hiện có | text | | | ✔ | Chấm điểm trên ảnh, ghi cao độ |

**A3. Câu trả lời của từng công trình**

```sql
create table if not exists survey_answers (
  project_id uuid not null references projects(id) on delete cascade,
  item_id uuid not null references survey_checklist_items(id) on delete restrict,
  value jsonb,                 -- number: {"n": 2650} · size: {"w": 900, "h": 2100} · text: {"t": "..."}
  na boolean not null default false,   -- "Không áp dụng"
  na_reason text,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz default now(),
  primary key (project_id, item_id),
  constraint survey_answers_na_reason check (not na or length(trim(coalesce(na_reason,''))) > 0)
);
```

Gắn trigger `set_updated_at()` có sẵn (xem cách `work_packages` gắn). Thêm một trigger `before insert or update` đặt `new.updated_by = auth.uid()` — **bắt buộc dùng trigger**, client không gửi cột này (client không tin được).

**A4. Ảnh hiện trạng**

```sql
create table if not exists survey_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  item_id uuid references survey_checklist_items(id) on delete set null,  -- gắn vào mục checklist (tuỳ chọn)
  area text,                          -- phòng / khu vực: "Bếp", "WC tầng 2"
  path text not null,                 -- ảnh gốc đã nén (prepareImage)
  thumb_path text not null,
  annotated_path text,                -- ảnh đã vẽ đè số đo (null = chưa vẽ)
  annotated_thumb_path text,
  annotations jsonb not null default '[]'::jsonb,   -- xem mục B2, để mở ra sửa lại
  note text,
  taken_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint survey_photos_path_scope check (
    _path_project(path) = project_id and _path_project(thumb_path) = project_id
    and (annotated_path is null or _path_project(annotated_path) = project_id)
    and (annotated_thumb_path is null or _path_project(annotated_thumb_path) = project_id))
);
create index if not exists idx_survey_photos_project on survey_photos(project_id);
```

`_path_project()` phải được khai báo **trước** bảng này trong `schema.sql` (hiện đang khai báo sau mục bảng) → hoặc chuyển khối bảng `survey_photos` xuống sau phần hàm, hoặc thêm constraint bằng `alter table ... add constraint` ở sau `_path_project`. Chọn cách nào cũng được, miễn chạy lại 2 lần không lỗi.

**A5. Hàm kiểm còn thiếu gì**

```sql
-- Mục bắt buộc còn thiếu của 1 công trình → [{id, label, reason}] (reason: 'value' | 'photo')
create or replace function survey_missing(p_project_id uuid) returns json
language sql stable security invoker set search_path = public as $$ ... $$;
```

Một mục `active and required` coi là **đủ** khi có dòng `survey_answers` và:
- `na = true` (lý do đã được constraint đảm bảo), **hoặc**
- theo `kind`: number → `value->>'n'` **là số** (cho phép `0` và số âm — tường thẳng nghiêng 0, cốt sàn chênh 0 hoặc âm đều là số đo hợp lệ); size → cả `w` và `h` là số > 0; text → `trim(value->>'t') <> ''`. Kiểm "là số" bằng `jsonb_typeof(value->'n') = 'number'`, không ép kiểu chuỗi (ép kiểu lỗi sẽ làm hỏng cả hàm).

Thêm điều kiện ảnh: mục `photo_required` (và không `na`) phải có ≥1 `survey_photos` cùng `project_id` + `item_id`. Thiếu ảnh → `reason = 'photo'`. Trả `'[]'::json` khi đủ (không trả null). Sắp theo `seq`.

`security invoker` là đủ cho UI (RLS lọc). **Trigger** ở A6 phải đếm đúng bất kể RLS → trigger function là `security definer`, gọi một biến thể nội bộ `_survey_missing_count(p_project_id)` (security definer, **không grant** cho authenticated) hoặc tự viết lại câu đếm.

**A6. Cổng chặn**

```sql
create or replace function _on_project_phase_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.phase = 'survey' and new.phase <> 'survey' and _survey_missing_count(new.id) > 0 then
    raise exception 'survey_incomplete';
  end if;
  return new;
end; $$;
drop trigger if exists trg_projects_phase on projects;
create trigger trg_projects_phase before update of phase on projects
  for each row when (new.phase is distinct from old.phase)
  execute function _on_project_phase_change();
```

- Insert công trình mới với `phase = 'design'`/`'construction'` **được phép** (công trình chỉ thi công, không khảo sát). Không chặn.
- Sau khi rời `survey`, sửa/xoá câu trả lời vẫn được (sửa số sai) — không khoá.

**A7. RLS + grant** (đặt ở mục RLS của `schema.sql`; bảng mới phải nằm **sau** `revoke all on all tables in schema public from anon` hoặc tự revoke riêng)

```sql
alter table survey_checklist_items enable row level security;
alter table survey_answers enable row level security;
alter table survey_photos enable row level security;
revoke all on survey_checklist_items, survey_answers, survey_photos from anon;
grant select, insert, update on survey_checklist_items to authenticated;   -- KHÔNG delete: dùng active=false
grant select, insert, update, delete on survey_answers, survey_photos to authenticated;
```

Policy (luôn `drop policy if exists` trước):
- `survey_checklist_items`: select `to authenticated using (true)`; insert/update `to authenticated` **chỉ `is_manager()`** — KTS không được tự gỡ cờ bắt buộc để lách cổng.
- `survey_answers`, `survey_photos`: `for all to authenticated using (can_access_project(project_id)) with check (can_access_project(project_id))`.

Quyền gọi hàm — Postgres tự cấp EXECUTE cho PUBLIC khi tạo hàm mới, và file migration chạy **riêng** nên không được dựa vào dòng `revoke execute on all functions` của `schema.sql`. Ghi rõ trong **cả hai file**:

```sql
revoke execute on function survey_missing(uuid), _survey_missing_count(uuid), _on_project_phase_change() from public, anon;
grant execute on function survey_missing(uuid) to authenticated;
```

Trong `schema.sql`, đặt hai dòng này **sau** dòng `revoke execute on all functions in schema public from public`. `_survey_missing_count` / `_on_project_phase_change` không grant cho ai.

**A8. Tổng quan** — `dashboard_summary()`: thêm `p.phase` vào CTE `proj` (trong `select` + đã `group by p.id` nên được) và `'phase', pr.phase` vào `json_build_object` của công trình.

**A9. Cảnh báo bỏ qua công trình chưa thi công** — `compute_alerts()`: mọi chỗ đang `join projects pj on … and pj.status = 'active'` (6 chỗ) thêm `and pj.phase = 'construction'`. Công trình đang khảo sát / lên phương án không sinh cảnh báo "không ra quân / chậm / quá hạn" và không bị tự đổi trạng thái đầu việc, kể cả khi đã lỡ có đầu việc. Sửa luôn câu comment đầu hàm. Không đổi `crew_*` / `client_view` (vẫn lọc theo `status`).

Storage: **không cần policy mới** — ảnh khảo sát lưu `{project_id}/survey/...`, policy `staff upload/read site-photos` lọc theo thư mục đầu = `project_id` đã đúng. Edge Function `get-photo-url` với `kind=client` ký **mọi path có tiền tố `{project_id}/`** — tức chủ nhà về lý thuyết ký được ảnh khảo sát nếu biết đúng tên file. Tên file có `Date.now()` + 6 ký tự ngẫu nhiên và chủ nhà chỉ nhận path từ `client_view()` (không chứa ảnh khảo sát) nên **chấp nhận, không sửa Edge Function trong plan này**; ghi một dòng vào AGENTS.md mục "Đã biết".

### B. Trình bắt điểm — `js/annotate.js` (mới)

Module độc lập, không phụ thuộc thư viện, tự dựng DOM lần đầu gọi (giống `js/lightbox.js`). Chuỗi UI tiếng Việt.

**B1. API**

```js
// img: ImageBitmap | HTMLImageElement | HTMLCanvasElement (ảnh gốc ĐÃ NÉN 1280px)
// annotations: mảng (rỗng khi chụp mới, mảng cũ khi sửa lại)
// Trả Promise: null nếu bấm Huỷ, ngược lại { annotations, mainBlob, thumbBlob }
export async function openAnnotator(img, annotations = [], { title } = {});
// Vẽ đè, dùng cả trong openAnnotator lúc lưu (tách ra để test được)
export async function renderAnnotated(img, annotations, maxDim = 1280, quality = 0.8);
```

**B2. Dữ liệu `annotations`** — toạ độ **chuẩn hoá 0..1** theo kích thước ảnh (không phụ thuộc màn hình):

```js
{ id, type: 'line',   a: [x, y], b: [x, y], value_mm: 2450, estimated: false, label: '' }
{ id, type: 'height', a: [x, y], b: [x, y], value_mm: 2650, estimated: false }      // nhãn "H 2650"
{ id, type: 'point',  at: [x, y], kind: 'o_cam'|'cong_tac'|'cap_nuoc'|'thoat_nuoc'|'dien'|'khac', height_mm: 300, label: '' }
{ id, type: 'ref',    a: [x, y], b: [x, y], value_mm: 297 }                          // thước chuẩn
{ id, type: 'text',   at: [x, y], text: 'Tường nứt chân' }
```

**B3. Công cụ** (thanh công cụ dưới cùng, nút to ≥44px cho ngón tay):

| Nút | Cách dùng |
|---|---|
| 📏 Đoạn đo | Chạm điểm đầu, chạm điểm cuối → hộp nhập số mm. Có thước chuẩn thì điền sẵn ước tính, đánh dấu `estimated: true`; người dùng sửa số → `estimated: false`. |
| ↕ Chiều cao | Như đoạn đo, nhãn hiển thị "H". |
| 📍 Điểm | Chạm 1 lần → chọn loại (ổ cắm / công tắc / cấp nước / thoát nước / điện / khác) + cao độ từ sàn (mm, không bắt buộc). |
| 📐 Thước chuẩn | Kẻ lên vật đã biết kích thước (tờ A4 297, gạch 600, cửa…) + nhập mm. Tối đa 1 thước chuẩn/ảnh. Hiện nhắc: *"Chỉ ước tính đúng cho vật nằm cùng mặt phẳng với thước chuẩn"*. |
| ✎ Chữ | Chạm → nhập ghi chú. |
| ↶ Hoàn tác · 🗑 Xoá mục đang chọn · ✓ Lưu · ✕ Huỷ | |

**Ước tính theo thước chuẩn:** `mm_per_px = ref.value_mm / khoảng_cách_px(ref.a, ref.b)` (khoảng cách tính trên **pixel ảnh gốc**, không phải toạ độ chuẩn hoá — nhân lại với width/height). Nhãn ước tính hiển thị `≈ 2.430 mm`.

**B4. Bắt điểm chính xác**
- Dùng Pointer Events (chạm + chuột + bút), `touch-action: none` trên canvas.
- Chạm vào đầu mút có sẵn (bán kính ~24px màn hình) → kéo để chỉnh; chạm vào thân đường/nhãn → chọn mục.
- **Kính lúp** khi đang kéo/đặt điểm: vòng tròn ~110px phóng 2.5×, hiện **lệch lên trên** ngón tay (không bị ngón che), có dấu thập ở tâm.
- Hỗ trợ ảnh dọc/ngang: canvas vừa khung màn hình theo tỉ lệ ảnh; xoay máy thì vẽ lại.
- Không cần zoom/pan toàn ảnh ở bản này.

**B5. Vẽ đè lên ảnh (`renderAnnotated`)**
- Canvas bằng kích thước ảnh (tối đa 1280 cạnh dài), vẽ ảnh rồi vẽ lớp số đo. Nét/chữ **tỉ lệ theo cạnh dài ảnh** (ví dụ nét = cạnh dài/400, chữ = cạnh dài/40) để đọc được trên thumbnail.
- Đường: nét màu + viền trắng mảnh bên ngoài (nổi trên nền tối lẫn sáng), có gạch chặn 2 đầu. Nhãn: chữ trắng trên nền mực đậm bo góc, đặt ở giữa đoạn.
- Màu: lấy giá trị **hex cố định** tương ứng token thương hiệu (`--primary` cho đoạn đo, `--danger` cho điểm nước/điện…) — canvas không đọc được CSS var lúc xuất nên ghi hằng số ở đầu file kèm comment token gốc.
- Điểm: chấm tròn + chữ viết tắt (Ổ, CT, CN, TN, Đ) + cao độ nếu có ("Ổ · 300"). **Không dùng emoji trên canvas** (máy khác nhau vẽ khác/không vẽ).
- Số đo định dạng kiểu Việt: `2.450 mm` (dấu chấm hàng nghìn).
- Xuất: ảnh chính JPEG **1280px q0.8** (cao hơn q0.7 của ảnh báo cáo để chữ rõ — ghi vào AGENTS.md mục 3), thumbnail **400px q0.6**. `toBlob` trả null → ném `PhotoError` như `resizeToBlob` trong `photos.js`.

**B6. Sửa lại ảnh cũ** — tải ảnh gốc (`path`) bằng `createSignedUrl` → `fetch(url)` → `blob` → `createImageBitmap(blob)`. **Không** gán signed URL thẳng vào `<img>` rồi vẽ canvas (canvas bị "tainted", `toBlob` lỗi bảo mật).

### C. Ảnh — `js/photos.js`

- Tách phần upload trong `uploadStaffPhoto` thành helper nội bộ `putStaffBlob(supabaseClient, path, blob)` (giữ nguyên `withRetry` + thông báo lỗi quyền 403). `uploadStaffPhoto` dùng lại helper, hành vi không đổi.
- Thêm:

```js
// Tải 1 cặp ảnh (chính + thumb) của khảo sát. kind: 'orig' | 'ann'
// Trả { path, thumb_path }
export async function uploadSurveyBlobs(supabaseClient, projectId, { mainBlob, thumbBlob }, kind = 'orig');
```

  Đường dẫn: `${projectId}/survey/${ngày-địa-phương}/${kind}-${stamp}.jpg` và `…-thumb.jpg`.
- Ảnh gốc khảo sát **bắt buộc qua `prepareImage(file)`** (nhận HEIC/DNG, nén 1280/q0.7) — không upload file gốc điện thoại.
- Sửa lại số đo → upload ảnh `ann` **mới** (stamp mới) rồi update dòng `survey_photos`. File ảnh vẽ cũ để lại (staff không có quyền xoá Storage). Tương tự, "🗑 Xoá ảnh" chỉ xoá dòng `survey_photos`, file gốc + ảnh vẽ vẫn nằm trên Storage — ghi cả hai vào AGENTS.md "Đã biết".

### D. Màn hình khảo sát — `js/staff/survey.js` (mới)

Module phụ **chỉ `items.js` import** (như `wizard.js`); đọc/ghi qua `state`, không import module tab khác.

```js
export async function renderSurvey(wrap, project);   // vẽ toàn bộ view khảo sát vào wrap
export async function surveyMissing(projectId);       // gọi RPC survey_missing, trả mảng
```

**D1. Đầu trang:** thanh tiến độ "Đã đủ **6/9** mục bắt buộc" (tính từ `survey_missing` + danh sách mục), và (chỉ quản lý — `isManager()` trong `state.js`) nút "⚙ Sửa mẫu khảo sát".

**D2. Checklist** — nhóm theo `section`, sắp theo `seq`, chỉ mục `active`. Mỗi mục:
- Nhãn + dấu `*` nếu bắt buộc + `hint` nhỏ bên dưới.
- Ô nhập theo `kind`: `number` → 1 ô số + đơn vị; `size` → 2 ô "Rộng × Cao" + đơn vị; `text` → textarea 2 dòng. `inputmode="numeric"` cho số.
- Nút "Không áp dụng" (bật/tắt). Bật → ẩn ô nhập, hiện ô **lý do** (bắt buộc).
- Nút "📷 Ảnh (n)" → chụp ảnh gắn vào mục này (`item_id`), mở trình bắt điểm (mục D3).
- Trạng thái góc phải: ✓ đủ · ⚠ thiếu số · 📷 thiếu ảnh.
- **Tự lưu khi rời ô** (`change`/`blur`): `upsert` vào `survey_answers` (`onConflict: 'project_id,item_id'`) qua helper `db()` hoặc đọc `{ error }`. Lỗi → giữ nguyên số đã gõ, hiện "Chưa lưu · Thử lại" ở mục đó (nút thử lại). Lưu xong → cập nhật lại tiến độ.
- Hợp lệ phía client **khớp đúng A5**: `number` nhận mọi số kể cả `0` và âm (ô trống = chưa điền); `size` cả hai ô phải > 0; `na` mà lý do trống → không gửi, báo ngay ở ô. Ô `number` dùng `inputmode="decimal"` kèm cho gõ dấu trừ (bàn phím số iPhone không có dấu `-` → thêm nút nhỏ "±" cạnh ô).

**D3. Album hiện trạng** (dưới checklist) — nhóm theo `area`:
- Nút "＋ Chụp ảnh hiện trạng": hỏi khu vực (gợi ý các `area` đã có), `<input type="file" accept="image/*,.heic,.heif,.dng">` — **không** đặt `capture` (repo không dùng ở đâu; đặt vào là mất lựa chọn "Thư viện ảnh", trong khi nhân viên cần lấy ảnh đã chụp sẵn hoặc ảnh từ app Đo của iPhone).
- Luồng: `prepareImage(file)` → `openAnnotator(...)` → (Lưu) `uploadSurveyBlobs(..., 'orig')` + nếu có vẽ thì `uploadSurveyBlobs(annotated, 'ann')` → `insert survey_photos`. Huỷ trình bắt điểm → vẫn hỏi "Lưu ảnh không vẽ?" (ảnh hiện trạng thuần cũng có giá trị).
- Trong lúc tải: nút hiện "Đang gửi ảnh…", khoá bấm 2 lần. Lỗi → `showToast(e.message, true)` (PhotoError đã có câu dễ hiểu), giữ bản nén trong bộ nhớ để bấm "Thử lại" không phải vẽ lại.
- Lưới thumbnail (ưu tiên `annotated_thumb_path`, không có thì `thumb_path`), ký URL bằng `signStaffPhotoUrl`. Chạm → `openLightbox` (ảnh vẽ), kèm nút "✎ Sửa số đo" và "🗑 Xoá ảnh" (xoá dòng `survey_photos`, confirm trước).
- Dùng lại `galleryHtml`/`wireGalleries` (`js/gallery.js`) nếu hợp, không bắt buộc.

**D4. Sửa mẫu (quản lý)** — modal mới `#surveyTemplateModal` trong `index.html`: danh sách mục, sửa nhãn/nhóm/loại/đơn vị/gợi ý/thứ tự, bật tắt "Bắt buộc", "Bắt buộc ảnh", "Đang dùng". Thêm mục mới. **Không có nút xoá** (chỉ tắt "Đang dùng"). Ghi trực tiếp bảng `survey_checklist_items`, đọc `{ error }`.

### E. Tab Công việc — `index.html`, `js/staff/items.js`, `js/staff/state.js`

- **Thanh giai đoạn** ngay dưới `.project-bar`: 3 bước `Khảo sát → Lên phương án → Thi công`, bước hiện tại nổi bật, bước đã qua có ✓. Nút hành động theo giai đoạn:
  - `survey` → "Chuyển sang lên phương án →": gọi `surveyMissing()` trước; còn thiếu → hiện danh sách mục thiếu (và lý do số/ảnh), chuyển sang view khảo sát, cuộn tới mục thiếu đầu tiên; đủ → `confirm` → `update projects set phase='design'`. **Đọc `{ error }`**: `survey_incomplete` (người khác vừa xoá số) → `rpcErrorText` + vẽ lại.
  - `design` → "Bắt đầu thi công →" (`phase='construction'`), kèm link nhỏ "← Quay lại khảo sát".
  - `construction` → không nút tiến, link nhỏ "← Về lên phương án".
  - Sau khi đổi: cập nhật `state.projects`, vẽ lại thanh + view.
- Công trình đã đóng (`status='done'`) → thanh giai đoạn chỉ hiển thị, không nút.
- Ở `survey` / `design`, view Danh sách chưa có đội nào → thay câu trống hiện tại bằng *"Chưa vào thi công — đội và đầu việc thêm khi lên phương án xong"*. Nút "＋ Thêm đội" vẫn dùng được (chuẩn bị trước đội trong lúc lên phương án); cảnh báo đã bị A9 chặn.
- **`items-view-switch`** thêm nút thứ 3 `📐 Khảo sát` (`id="btnItemsSurveyView"`). `state.itemsView` thêm giá trị `'survey'` (cập nhật comment trong `state.js`). Khi đổi công trình: công trình ở `survey` → mặc định view khảo sát; giai đoạn khác → giữ view đang chọn trừ khi đang ở `survey` thì về `list`.
- View `survey`: ẩn `#packagesList`, nút "Chọn nhiều", "＋ Thêm đội", khối xuất CSV; hiện vùng `#surveyView` → `renderSurvey()`. Rời view thì ngược lại.
- Realtime: **không bắt buộc** subscribe bảng khảo sát ở bản này; sau mỗi lần ghi phải tự vẽ lại (AGENTS.md mục 4).

### F. Tạo công trình — `js/staff/wizard.js`

Bước 1 thêm lựa chọn 2 nút (chip): **"Bắt đầu từ khảo sát hiện trạng"** (mặc định) / **"Thi công ngay"** → `info.phase = 'survey' | 'construction'`, ghi vào insert `projects`. Hint dưới: *"Khảo sát: phải điền đủ số đo bắt buộc mới chuyển sang lên phương án được. Đội thi công thêm sau."*

**Chọn "Bắt đầu từ khảo sát" thì wizard chỉ còn bước 1.** Hiện wizard luôn tạo đội + đầu việc có lịch từ hôm nay + link thợ + link chủ nhà (`wizard.js` ~dòng 215–246) — với công trình còn đang đo thì đó là dữ liệu rác: thợ có link khi chưa có việc, chủ nhà thấy timeline giả. Vì vậy:
- Thanh bước ẩn bước 2–3, nút bước 1 đổi thành "✓ Tạo công trình".
- Chỉ `insert projects`; **không** tạo `subcontractors` / `work_packages` / `work_items` / `crew_links` / `client_links`.
- Tạo xong: đóng wizard, chọn công trình mới, mở thẳng view Khảo sát (không hiện màn "gửi link cho đội").
- "Thi công ngay": wizard 3 bước chạy **y như cũ**.
- Đội thêm sau bằng "＋ Thêm đội" có sẵn; link chủ nhà tạo bằng nút có sẵn ở `items.js` (~dòng 853).

### G. Tổng quan — `js/staff/dashboard.js`

Thẻ công trình có `phase` khác `construction` → chip nhỏ: `📐 Đang khảo sát` / `✏ Lên phương án`. Công trình ở 2 giai đoạn này — **dù có đầu việc hay chưa** — không hiển thị "0% / trễ / còn n ngày" gây hiểu nhầm (thay bằng dòng "Chưa vào thi công") và không tính vào các số tổng "chậm tiến độ" của trang. Nếu việc này cần sửa SQL trong `dashboard_summary()` thì làm ở đó (lọc theo `phase`), không lọc mò ở client. Bấm chip → `state.currentProjectId = id`, `state.itemsView = 'survey'` (nếu `survey`), `state.navigate('items')`.

### H. Linh tinh

- `js/ui.js` → `RPC_ERROR_VI`: `survey_incomplete: 'Còn thiếu số liệu khảo sát bắt buộc — điền đủ hoặc chọn "Không áp dụng" kèm lý do'`.
- `css/app.css`: style trình bắt điểm (toàn màn hình, nền tối, thanh công cụ, kính lúp), thanh giai đoạn, checklist. **Chỉ dùng token sẵn có** trong `:root`, khai báo cả khối sáng và tối nếu thêm biến. Không inline style mới.
- `sw.js`: tăng `CACHE` thêm 1 ở **mỗi PR** (v12 → v13 → v14, xem "Thứ tự làm"). Không thêm `annotate.js`/`survey.js` vào `SHELL` (runtime cache tự lo). Giữ network-first.

### I. Sửa lỗi nhỏ từ review code (PR 1 — nhánh `011-1-sua-loi-ngay-gio`)

| # | Vị trí | Lỗi | Sửa |
|---|---|---|---|
| 1 | `js/ui.js:18` `todayISO()` | Dùng `toISOString()` = giờ UTC → trước **7h sáng** giờ VN trả về **ngày hôm qua** (ngày mặc định khi tạo công trình, thêm đầu việc, ô "Từ ngày"…) | Trả ngày theo giờ máy, như `localDateISO()` ở `js/crew.js:33`. Kiểm mọi chỗ gọi `todayISO()` vẫn đúng. |
| 2 | `js/staff/items.js` `saveStaffReport()` (~dòng 722) | Không gửi `report_date` → DB lấy `current_date` theo giờ máy chủ (UTC) → nhập thay trước 7h bị ghi sang hôm qua, gộp sai nhóm ở hộp duyệt | Gửi `report_date: todayISO()` (sau khi sửa #1). |
| 3 | cùng hàm | `reporter_name: state.user.email` — hộp duyệt hiện email thay vì tên | `state.profile.full_name \|\| state.user.email` |
| 4 | cùng hàm | `catch` hiện `e.message` thô của Postgres | Lỗi Supabase → `rpcErrorText(e)`; `PhotoError` giữ `e.message` |
| 5 | `js/staff/items.js` `savePackageAsTemplate()` (~dòng 478) | Xoá mẫu để hoàn tác không đọc `{ error }` → có thể để lại mẫu rỗng mà vẫn báo "đã huỷ" | Đọc `error`; lỗi thì báo "Còn mẫu rỗng tên … — xoá tay" |
| 6 | `js/photos.js:197` | Thư mục ngày ảnh nhập thay theo UTC | Dùng ngày địa phương (helper chung với #1) |

`dashboard.js` `state_today()` đã ưu tiên `lastData.today` từ server — để nguyên.

---

## Không làm

- AR / WebXR / thư viện 3D, OCR, tự nhận diện ổ cắm bằng AI.
- Cho thợ hoặc chủ nhà xem khảo sát; sửa `client_view`, `crew_*`, Edge Functions.
- Xuất PDF/Excel biên bản khảo sát (plan sau).
- Hàng đợi offline (IndexedDB) cho khảo sát — bản này chỉ "Thử lại" trong phiên.
- Checklist theo từng phòng (đã chốt: theo công trình).
- Zoom/pan ảnh trong trình bắt điểm, nhiều thước chuẩn trên 1 ảnh.
- Đổi bảng màu, font, thêm dependency/build step.

## Checklist nghiệm thu

**SQL** — thêm vào `supabase/tests/rls_test.sql` (theo kiểu "(phải lỗi)" sẵn có), chạy `PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/run.sh`:
- [ ] Schema áp 2 lần không lỗi (run.sh đã kiểm).
- [ ] anon `select * from survey_answers` / `survey_photos` / `survey_checklist_items` (phải lỗi).
- [ ] anon gọi `survey_missing(...)` và `_survey_missing_count(...)` (phải lỗi); K1 gọi `_survey_missing_count(...)` (phải lỗi).
- [ ] K2 (không phụ trách P1) thấy 0 dòng `survey_answers` của P1; insert vào P1 (phải lỗi).
- [ ] K1 upsert câu trả lời P1 được; `na = true` không lý do (phải lỗi).
- [ ] K1 sửa `survey_checklist_items.required` (phải lỗi / 0 dòng đổi); admin sửa được.
- [ ] K1 insert `survey_photos` với `path` thuộc công trình khác (phải lỗi).
- [ ] P1 ở `survey`, còn thiếu → `update projects set phase='design'` (phải lỗi `survey_incomplete`); `survey_missing(P1)` liệt kê đúng mục + lý do `photo`.
- [ ] Điền đủ (có mục `na` + lý do, có ảnh cho mục `photo_required`) → chuyển `design` được → lùi `survey` được.
- [ ] Công trình insert thẳng `phase='construction'` được.
- [ ] Mục `number` trả lời `{"n": 0}` và `{"n": -20}` → **không** nằm trong `survey_missing`; `{"n": "abc"}` / `{}` → vẫn thiếu. Mục `size` có `w = 0` → vẫn thiếu.
- [ ] `updated_by`: K1 upsert kèm `updated_by` của người khác → dòng lưu vẫn là id của K1.
- [ ] `compute_alerts()`: công trình `phase='survey'` có đầu việc quá hạn → **không** sinh cảnh báo, trạng thái đầu việc không đổi; đổi sang `construction` rồi chạy lại → có cảnh báo.
- [ ] `dashboard_summary()` có trường `phase`.

**Giao diện** — `tests/ui/mock-supabase.js` thêm bảng `survey_checklist_items`, `survey_answers`, `survey_photos`, `projects.phase` (P1 để `survey`), RPC `survey_missing`; `tests/ui/smoke.mjs`:
- [ ] Mở tab Công việc → P1 tự vào view Khảo sát; chụp màn hình điện thoại (390px) + máy tính, sáng + tối.
- [ ] Gõ 1 số vào mục → có lời gọi upsert `survey_answers`.
- [ ] Bấm "Chuyển sang lên phương án" khi thiếu → hiện danh sách thiếu, không có lời gọi update `projects`.
- [ ] Gõ `0` vào "Độ nghiêng tường" → mục chuyển ✓ (không báo thiếu).
- [ ] Wizard chọn "Bắt đầu từ khảo sát" → chỉ có **1** lời gọi insert (`projects`, `phase='survey'`), không insert `work_packages` / `crew_links` / `client_links`; chọn "Thi công ngay" → đủ 3 bước như cũ.
- [ ] Chọn ảnh giả (`setInputFiles` với `icon-512.png`) → trình bắt điểm mở → kẻ 1 đoạn đo (2 cú chạm) → nhập số → Lưu → có upload storage + insert `survey_photos` với `annotations` dài 1.
- [ ] Không lỗi console (smoke.mjs đã gom `errors`).

**Tài liệu**
- [ ] `AGENTS.md` mục 3: bất biến khảo sát (cổng `trg_projects_phase`; mẫu chỉ quản lý sửa; ảnh khảo sát giữ gốc + ảnh vẽ 1280/q0.8 + `annotations`); cảnh báo chỉ chạy cho công trình `phase='construction'`; mục 5 "Đã biết": ảnh vẽ cũ và ảnh đã xoá không bị xoá khỏi Storage.
- [ ] `README.md`: bảng dữ liệu (+3 bảng, cột `phase`), cấu trúc file (`annotate.js`, `survey.js`), dòng tính năng.
- [ ] `HUONG_DAN_TRIEN_KHAI.md`: bước chạy `011_khao_sat.sql` (bấm từng bước trên Supabase SQL Editor, viết cho người không biết code).

**Thử tay** (ghi kết quả vào PR; người dùng làm nếu agent không có máy):
- [ ] iPhone Safari + PWA đã cài: chụp ảnh (HEIC) → vẽ → lưu → mở lại sửa được.
- [ ] Android Chrome: như trên.
- [ ] Kính lúp không bị ngón tay che; nút đủ to để bấm bằng ngón cái.

## Điểm review (Claude sẽ soi — tự kiểm trước khi mở PR)

1. **Bảo mật:** không `grant`/`policy` nào cho `anon`; mọi policy bảng khảo sát dùng `can_access_project()`; mẫu checklist chỉ `is_manager()` ghi; hàm `security definer` mới đều có `set search_path = public` và không được grant cho người gọi tuỳ ý.
2. **Định nghĩa "đủ" một chỗ:** quy tắc ở client (D2) khớp từng chữ với `survey_missing` (A5) — số `0` / âm hợp lệ.
2b. **Cổng không lách được:** chỉ chặn ở trigger DB, không chỉ ở nút. Thử `update projects set phase = 'construction'` thẳng từ `survey` khi thiếu → phải lỗi.
3. **XSS:** nhãn mục, lý do, khu vực, ghi chú, chữ trong `annotations` vào `innerHTML` đều qua `escapeHtml()`.
4. **Lỗi Supabase:** mọi `.upsert/.insert/.update/.delete/.rpc` đọc `{ error }` — không `try/catch` suông.
5. **Ảnh:** ảnh gốc qua `prepareImage`; ảnh vẽ 1280/q0.8; tải ảnh để sửa bằng `fetch → blob` (không tainted canvas); nhận được HEIC.
6. **Không phá tính năng cũ:** view Danh sách/Timeline, Chọn nhiều, wizard, hộp duyệt chạy như trước; `crew.html` không tải thêm byte nào.
7. **Sau ghi phải vẽ lại**, không trông vào realtime.

## Câu hỏi mở

_(Người code ghi vào đây khi plan không rõ — dừng chờ trả lời.)_

## Nhật ký review

_(Claude ghi kết quả từng lượt review.)_
