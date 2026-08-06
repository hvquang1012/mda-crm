# CLAUDE.md

Hướng dẫn cho Claude Code khi làm việc trên repo này.

**Đọc [AGENTS.md](AGENTS.md) trước khi sửa code** — chứa toàn bộ ràng buộc kiến trúc, bất biến bảo mật và quy ước. File này chỉ bổ sung phần vận hành đặc thù môi trường.

---

## Tóm tắt 30 giây

PWA tĩnh + Supabase, không build step. Thầu chính (MD Architects) theo dõi tiến độ thầu phụ đá/điện. Ba HTML entry: `index.html` (staff, đăng nhập), `crew.html` (thợ, token trong URL), `client.html` (chủ nhà, token trong URL).

**Ba điều dễ làm sai nhất:**

1. `supabase.rpc()` **không throw** — phải đọc `{ error }`, `try/catch` là vô dụng.
2. `anon` không có quyền trên bảng nào. Mọi truy cập không đăng nhập đi qua RPC `security definer`.
3. `progress_reports` append-only; `qty_done`/`percent` là cache, chỉ `approve_report()` được cộng.

---

## Cạm bẫy môi trường

### Đường dẫn có dấu tiếng Việt làm hỏng Supabase CLI

Thư mục dự án nằm ở `C:\Users\hvqua\OneDrive\Máy tính\mda-crm-pwa`. Chữ "Máy tính" khiến `supabase link` thất bại:

```
PlatformError: AlreadyExists: FileSystem.makeDirectory (...\supabase\.temp)
```

**Cách xử lý:** copy riêng thư mục `supabase/` sang đường dẫn ASCII (scratchpad) rồi chạy CLI ở đó. Không cần copy cả repo.

```bash
cp -r "C:/Users/hvqua/OneDrive/Máy tính/mda-crm-pwa/supabase" "$SCRATCH/mda-deploy/"
cd "$SCRATCH/mda-deploy" && npx --yes supabase link --project-ref lneaqpfiifqkpccpxgsp
```

### Node/npx có thể không tồn tại

Máy này **không cài Node global**. Có phiên `npx` chạy được, có phiên báo `command not found`. Kiểm tra trước khi lên kế hoạch dùng CLI.

**Phương án dự phòng khi không có npx** — gọi thẳng Management API bằng `curl`:

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/lneaqpfiifqkpccpxgsp/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @payload.json
```

`payload.json` dạng `{"query": "<SQL>"}`. Dựng file này bằng `python3` (có sẵn) để escape JSON đúng — đừng nội suy SQL tiếng Việt thẳng vào chuỗi shell.

Tương tự, tạo tài khoản nhân viên qua Auth Admin API bằng `curl` với `service_role` key thay vì CLI.

### Shell

Git Bash là chính, PowerShell cũng có. `curl`, `python3`, `openssl`, `git` đều sẵn. `node`, `npm` thì không chắc.

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
- Đổi front-end → commit + push, Netlify tự deploy.
- Đổi thứ chạm vào bảo mật → chạy lại kiểm tra anon bằng `curl` (xem AGENTS.md mục 7).

**Kiểm chứng bằng dữ liệu thật, không phải bằng suy luận.** Có project Supabase thật và site Netlify thật đang chạy — sau khi đổi logic tính toán, query DB đối chiếu thay vì tin là đúng.

**Không tự ý:** đổi bảng màu / typography, thêm dependency, đổi mô hình quyền, chạy migration phá dữ liệu. Hỏi trước.

---

## Toạ độ hạ tầng

| | |
|---|---|
| Supabase project ref | `lneaqpfiifqkpccpxgsp` (`mda-crm`, ap-southeast-1) |
| Supabase URL | `https://lneaqpfiifqkpccpxgsp.supabase.co` |
| Netlify | `zippy-douhua-7a4098.netlify.app` (auto-deploy từ `main`) |
| GitHub | `git@github.com:hvquang1012/mda-crm.git` |
| Storage bucket | `site-photos` (private) |
| Edge Functions | `crew-upload`, `get-photo-url`, `send-alerts` |
| Cron | `compute_alerts()` chạy 7h & 15h hằng ngày |

Domain riêng dự kiến: `tiendo.noithatminhduc.com` (CNAME → Netlify, Cloudflare DNS, **DNS only** không bật proxy). Xem [huong-dan-domain.html](huong-dan-domain.html).

---

## Người dùng

Người vận hành hệ thống **không phải lập trình viên**. Giải thích bằng ngôn ngữ nghiệp vụ (công trình, hạng mục, nghiệm thu), không phải thuật ngữ kỹ thuật (RLS policy, RPC, bucket). Khi có việc phải tự làm trên dashboard bên thứ ba, đưa từng bước bấm cụ thể.

Trả lời bằng **tiếng Việt**.
