# Việc cần làm — bàn giao sang phiên mới

> Cập nhật 30/09/2026. Máy vận hành: **Mac Mini M4** (không còn là Windows — bỏ qua mục "đường dẫn có dấu" và Git Bash trong CLAUDE.md).

## Giai đoạn 1 — Quản lý nhân viên (PR #30, nhánh `claude/amazing-babbage-704y9j`)

- [x] Code + test xong (commit `ff8f626`)
- [x] Chạy migration `supabase/migrations/009_quan_ly_nhan_vien.sql` trên Supabase thật
- [ ] Deploy Edge Function `admin-users` và `send-alerts`
- [ ] Merge PR #30 vào `main` (Cloudflare Pages tự cập nhật web)
- [ ] Thử thật: tạo 1 KTS thử → đăng nhập được → bấm Khoá → đăng nhập bị từ chối
- [ ] Kiểm tra bảo mật: gọi `audit_log` bằng anon key phải bị chặn (lỗi 42501)
- [ ] Nếu đã tạo token Supabase (`sbp_...`) để deploy → thu hồi tại supabase.com/dashboard/account/tokens

### Cách deploy trên Mac (Terminal)

```bash
brew install supabase/tap/supabase        # lần đầu; hoặc dùng: npx --yes supabase
cd ~/<thư-mục-repo>/mda-crm               # thư mục chứa folder supabase/
git fetch origin && git checkout claude/amazing-babbage-704y9j && git pull
supabase login                            # mở trình duyệt, bấm đồng ý
supabase functions deploy admin-users send-alerts --project-ref lneaqpfiifqkpccpxgsp
```

Chạy ở **thư mục gốc repo** (nơi có folder `supabase/`), không vào trong `supabase/`.

## Giai đoạn 2 — Cải thiện quy trình (chưa làm)

Chi tiết ở [ke-hoach-nang-cap.md](ke-hoach-nang-cap.md). Thứ tự đề xuất:
1. Cảnh báo báo cáo chờ duyệt quá 24h
2. Màn quản lý đội thầu phụ
3. Chốt kỳ nghiệm thu + xuất khối lượng
4. Bật thông báo đẩy `mda-notify` + dọn ảnh gốc >180 ngày
5. GitHub Actions chạy test mỗi PR

## Giai đoạn 3 — Trợ lý giám đốc

Bản tin sáng + hỏi đáp. **Chưa duyệt chi phí AI** — chỉ làm khi người vận hành đồng ý.

## Gợi ý mở phiên mới

> "Đọc VIEC-CAN-LAM.md và CLAUDE.md, tiếp tục việc chưa xong. Tôi dùng Mac Mini M4."
