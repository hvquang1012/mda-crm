# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trên repo này.

**Đọc [AGENTS.md](AGENTS.md) trước khi sửa code** — chứa toàn bộ ràng buộc kiến trúc, bất biến bảo mật và quy ước. File này chỉ bổ sung phần vận hành đặc thù môi trường.

---

## Tóm tắt 30 giây

PWA tĩnh + Supabase, không build step. Thầu chính (MD Architects) theo dõi tiến độ thầu phụ đá/điện. Ba HTML entry: `index.html` (staff, đăng nhập), `crew.html` (thợ, token trong URL), `client.html` (chủ nhà, token trong URL).

**Ba điều dễ làm sai nhất:**

1. `supabase.rpc()` **không throw** — phải đọc `{ error }`, `try/catch` là vô dụng.
2. `anon` không có quyền trên bảng nào. Mọi truy cập không đăng nhập đi qua RPC `security definer`.
3. `progress_reports` append-only; `qty_done`/`percent` là cache, chỉ `approve_report_group()` được cộng. KTS chỉ thấy công trình được giao — mọi policy dùng `can_access_project()`.

---

## Môi trường vận hành

**Máy:** Mac Mini M4 (Apple Silicon, arm64), macOS 27. Dự án chạy và test trên máy này. Cài công cụ bằng Homebrew, dùng bản arm64 native (không cần Rosetta).

**Shell:** zsh (mặc định macOS). `curl`, `git`, `python3` có sẵn (đi kèm Xcode Command Line Tools — thiếu thì `xcode-select --install`). `openssl` trên macOS là LibreSSL; `openssl rand -hex 16` vẫn chạy được.

Chưa chắc máy đã cài gì → **kiểm tra trước, cài nếu thiếu**, đừng giả định.

### Node/npx

Kiểm tra: `node -v`. Thiếu thì `brew install node`. Supabase CLI chạy qua `npx --yes supabase ...` (không cài global, xem AGENTS.md mục 6).

**Phương án dự phòng khi không có npx** — gọi thẳng Management API bằng `curl`:

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/lneaqpfiifqkpccpxgsp/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json
```

`payload.json` dạng `{"query": "<SQL>"}`. Dựng file này bằng `python3` để escape JSON đúng — đừng nội suy SQL tiếng Việt thẳng vào chuỗi shell.

Tương tự, tạo tài khoản nhân viên qua Auth Admin API bằng `curl` với `service_role` key thay vì CLI.

### Đường dẫn có dấu làm hỏng Supabase CLI

Trên máy Windows cũ, thư mục có chữ "Máy tính" khiến `supabase link` thất bại:

```
PlatformError: AlreadyExists: FileSystem.makeDirectory (...\supabase\.temp)
```

Trên Mac chạy CLI ngay trong repo. Nếu vẫn gặp lỗi này (đường dẫn repo có dấu), copy riêng thư mục `supabase/` sang đường dẫn ASCII rồi chạy CLI ở đó — không cần copy cả repo:

```bash
mkdir -p "$SCRATCH/mda-deploy" && cp -r supabase "$SCRATCH/mda-deploy/"
cd "$SCRATCH/mda-deploy" && npx --yes supabase link --project-ref lneaqpfiifqkpccpxgsp
```

### Chạy & test trên máy này

| Việc | Lệnh |
|---|---|
| Chạy web local | `python3 -m http.server 8080` |
| Test SQL (Postgres cục bộ, không đụng project thật) | Cài: `brew install postgresql@16 && brew services start postgresql@16`. Chạy: `PGHOST=/tmp PGPORT=5433 PGUSER=postgres bash supabase/tests/run.sh` (đổi host/port theo cách Postgres đang chạy) |
| Test khói giao diện (backend giả lập) | `python3 -m http.server 8765 & node tests/ui/smoke.mjs` — cần Playwright, lần đầu `npx playwright install chromium` |

Zalo in-app browser và PWA đã cài vẫn phải test tay trên **điện thoại thật** (AGENTS.md mục 7). Trên Mac chỉ dùng Safari/Chrome để xem giao diện.

---

## Xử lý thông tin nhạy cảm

- **Personal Access Token (`sbp_...`)** có quyền trên toàn bộ tài khoản Supabase. Đặt qua biến môi trường `SUPABASE_ACCESS_TOKEN`, không dán vào dòng lệnh (lưu lại trong shell history). Nhắc người dùng thu hồi sau khi xong việc.
- **`service_role` key** chỉ dùng trong lệnh vận hành và Edge Function secrets. Không bao giờ commit, không bao giờ đưa vào file client.
- **Mật khẩu sinh ra** (DB password, mật khẩu tài khoản nhân viên): hiện cho người dùng **một lần** rồi xoá file tạm ngay trong cùng lượt.
- **`anon` key trong `config.js` là công khai có chủ ý** — đúng thiết kế, RLS chặn ở tầng DB. Không cần giấu.
- Trước khi `git add -A`, kiểm tra `git status` xem có file lạ không.

---

## Quy trình làm việc

**Trước khi sửa:** đọc file liên quan. Codebase nhỏ (~3.300 dòng), đọc thẳng nhanh hơn là suy đoán.

**Sau khi sửa:**

- Đổi SQL → chạy lại `schema.sql` (idempotent: `create table if not exists`, `create or replace function`). Nhưng `create policy` **không** idempotent — thêm `drop policy if exists` trước.
- Đổi Edge Function → deploy lại function đó.
- Đổi front-end → commit + push, Cloudflare Pages tự deploy từ `main`.
- Đổi thứ chạm vào bảo mật → chạy lại kiểm tra anon bằng `curl` (xem AGENTS.md mục 7).

**Kiểm chứng bằng dữ liệu thật, không phải bằng suy luận.** Có project Supabase thật và site thật đang chạy (Cloudflare Pages) — sau khi đổi logic tính toán, query DB đối chiếu thay vì tin là đúng.

**Không tự ý:** đổi bảng màu / typography, thêm dependency, đổi mô hình quyền, chạy migration phá dữ liệu. Hỏi trước.

---

## Toạ độ hạ tầng

| | |
|---|---|
| Supabase project ref | `lneaqpfiifqkpccpxgsp` (`mda-crm`, ap-southeast-1) |
| Supabase URL | `https://lneaqpfiifqkpccpxgsp.supabase.co` |
| Hosting | Cloudflare Pages, project `mda-crm` (auto-deploy từ `main`, không build step, output `/`) |
| GitHub | `git@github.com:hvquang1012/mda-crm.git` |
| Storage bucket | `site-photos` (private) |
| Edge Functions | `crew-upload`, `get-photo-url`, `send-alerts` |
| Cron | `compute_alerts()` 7h & 15h giờ VN (lịch ghi theo UTC: `0 0`, `0 8`); `mda-notify` mỗi phút; `mda-dropbox-sync` 10 phút |

Domain: `tiendo.noithatminhduc.com` → Custom domain của Cloudflare Pages (bản ghi DNS do Pages tự tạo). Xem [huong-dan-domain.html](huong-dan-domain.html).

---

## Người dùng

Người vận hành hệ thống **không phải lập trình viên**. Giải thích bằng ngôn ngữ nghiệp vụ (công trình, hạng mục, nghiệm thu), không phải thuật ngữ kỹ thuật (RLS policy, RPC, bucket). Khi có việc phải tự làm trên dashboard bên thứ ba, đưa từng bước bấm cụ thể.

Trả lời bằng **tiếng Việt**.
