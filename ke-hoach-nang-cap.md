# Kế hoạch nâng cấp — quản lý nhân viên, quy trình, trợ lý giám đốc

> Rà toàn bộ repo tháng 9/2026. Lõi báo cáo → duyệt → cảnh báo → tổng quan đã chắc và an toàn; chỗ yếu nằm ở **vận hành con người**. Giai đoạn 1 đã làm; giai đoạn 2–3 chờ duyệt.

## Giai đoạn 1 — Quản lý nhân viên ✅ (đã làm)

| Vấn đề trước đây | Đã xử lý |
|---|---|
| Thêm nhân viên phải vào dashboard Supabase | Màn **Nhân viên** (bấm tên đầu trang → Quản lý nhân viên): ＋ Nhân viên, mật khẩu tạm hiện 1 lần, gửi Zalo |
| Nhân viên nghỉ không cho nghỉ được: xoá trong Supabase báo lỗi (còn lịch sử báo cáo), không xoá thì vẫn đăng nhập | Nút **Khoá**: mất quyền ngay ở DB + chặn đăng nhập + ngừng thông báo đẩy; lịch sử giữ nguyên, mở khoá lại được |
| Đổi vai trò lẫn trong hộp "KTS phụ trách" | Gom về màn Nhân viên |
| Không biết KTS nào đang dồn báo cáo chưa duyệt, ai lâu không vào app | Mỗi người: số công trình, báo cáo chờ (tô cam nếu chờ >24h), đã duyệt 30 ngày, lần vào app gần nhất |
| Không có nhật ký thao tác | Tab **Nhật ký thao tác**: đổi vai trò, khoá, giao/gỡ KTS, tạo/đóng/xoá công trình, cấp/thu hồi link |
| Không tự đổi mật khẩu được | Ô đổi mật khẩu trong Cài đặt tài khoản |

Triển khai: chạy `supabase/migrations/009_quan_ly_nhan_vien.sql`, deploy `admin-users` và `send-alerts`.

## Giai đoạn 2 — Cải thiện quy trình (mỗi mục một PR nhỏ)

1. **Cảnh báo "báo cáo chờ duyệt quá 24h"** — loại cảnh báo mới `approval_overdue` trong `compute_alerts()`, đẩy thông báo cho KTS phụ trách. Thợ gửi mà không ai duyệt là lý do số 1 khiến thợ bỏ app.
2. **Quản lý đội thầu phụ** — sửa tên, SĐT/Zalo đội trưởng, ẩn đội không còn hợp tác (`subcontractors.active` đã có, chưa có màn). Hiện đội chỉ tạo được lúc thêm hạng mục, gõ sai tên là tạo đội trùng.
3. **Chốt kỳ nghiệm thu** — bảng `acceptance_periods` (công trình × đội × kỳ); chốt xong thì khoá, xuất bảng khối lượng để thanh toán thầu phụ (mở rộng `js/staff/export.js`).
4. **Bật hẳn thông báo đẩy** (job `mda-notify` đang comment trong `schema.sql`) và **dọn ảnh gốc >180 ngày** — hai việc tồn đọng trong README.
5. **Tự động chạy kiểm thử mỗi PR** (GitHub Actions chạy `supabase/tests/run.sh` + `tests/ui/smoke.mjs`) — không đụng web, không cần build.

## Giai đoạn 3 — Trợ lý giám đốc (chờ duyệt chi phí AI)

- **Bản tin sáng 6h45**: pg_cron → Edge Function `ceo-brief` đọc `dashboard_summary()` + `staff_overview()` + vướng mắc đang chặn → AI viết 5–7 dòng tiếng Việt (công trình nguy nhất, đội chậm, KTS dồn duyệt, việc cần giám đốc quyết) → lưu bảng `ai_briefs`, đẩy thông báo cho quản lý. Thẻ "Bản tin hôm nay" đầu tab Tổng quan.
- **Hỏi trợ lý** ở tab Tổng quan ("Tuần này đội đá Sơn chậm ở đâu?"): Edge Function `ceo-assistant` chạy bằng **phiên đăng nhập của người hỏi** (không dùng service_role) nên KTS chỉ hỏi được công trình mình phụ trách. AI chỉ có công cụ **đọc** (`dashboard_summary`, `staff_overview`, thêm `ai_project_detail`, `ai_recent_reports`) — không duyệt, không sửa gì.
- Giới hạn số lượt/ngày (bảng `ai_usage`), khoá API để trong secrets của Edge Function, không gửi SĐT khách sang AI.
- Chi phí ước tính 5–15 USD/tháng. Cần người vận hành đồng ý trước khi làm.
