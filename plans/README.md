# Bản giao việc (plans)

Claude Code viết bản giao việc ở đây; Antigravity code theo đúng bản đó. Quy trình đầy đủ: [AGENTS.md mục 0](../AGENTS.md#0-phân-vai-giữa-các-agent).

## Danh sách

| Số | Tính năng | Trạng thái | Nhánh |
|---|---|---|---|
| 011 | [Khảo sát & số hoá hiện trạng](011-khao-sat-hien-trang.md) | Sẵn sàng | `011-1-sua-loi-ngay-gio` → `011-2-giai-doan-va-checklist` → `011-3-ve-so-do-len-anh` |

Trạng thái: `Sẵn sàng` → `Đang làm` → `Chờ review` → `Cần sửa` ↔ `Chờ review` → `Xong`. Người đổi trạng thái ghi lại ở đầu file plan.

Tên nhánh: `NNN-viec-lam-bang-tieng-viet-khong-dau` — đọc tên là biết nhánh làm gì (không dùng tiền tố `feat/`, `fix/`). Plan chia nhiều PR thì thêm số thứ tự: `NNN-1-…`, `NNN-2-…`, merge lần lượt.

Số plan đi theo số migration nếu có đổi SQL (plan 011 ↔ `supabase/migrations/011_*.sql`) để dễ dò. Plan không đụng SQL thì lấy số kế tiếp.

## Mẫu một bản giao việc

```markdown
# NNN — Tên tính năng

**Trạng thái:** Sẵn sàng · **Nhánh:** NNN-viec-lam · **Người code:** Antigravity · **Review:** Claude Code

## Bối cảnh
Vấn đề nghiệp vụ, vì sao làm, kết quả mong muốn (viết bằng ngôn ngữ công trình).

## Quyết định đã chốt
Những gì người dùng đã quyết — KHÔNG được đổi khi code.

## Phạm vi file
File tạo mới / file sửa. Ngoài danh sách này thì hỏi trước.

## Đặc tả
Từng phần (SQL, front-end, test), đủ chi tiết để code mà không phải đoán.
Ghi rõ hàm/tiện ích có sẵn phải dùng lại.

## Không làm
Những thứ dễ bị làm lố.

## Checklist nghiệm thu
- [ ] ... (người code tick khi xong, kèm lệnh test đã chạy)

## Điểm review
Những chỗ reviewer sẽ soi kỹ — người code tự kiểm trước khi mở PR.

## Câu hỏi mở
Người code ghi câu hỏi ở đây khi plan không rõ — dừng chờ trả lời.

## Nhật ký review
- YYYY-MM-DD · Claude · Đạt / Cần sửa: ...
```
