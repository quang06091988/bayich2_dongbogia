# bayich2_dongbogia — Đồng bộ giá

Retail đổi giá → cập nhật một lần cho:

| Đích | Cột | Lấy từ Retail |
|---|---|---|
| Sheet **bayich2** · tab **Menu** | Giá | Giá Làm Tròn |
| Sheet **vanbaobi** · tab **SanPham** | Giá Lẻ | Giá Làm Tròn |
| | Giá Sỉ | Giá Nhập Lẻ |

Tên hàng giữa các tab không giống nhau (`Ly Trơn 360ml` ↔ `Ly 360ml`…), nên ánh xạ khai ở
**tab `DongBo` trong sheet bayich2**:

| Đích | Tên ở đích | Nguồn (Retail) |
|---|---|---|
| Menu | Ly 360ml | Ly Trơn 360ml |
| Menu | Ly Cà Phê (Nắp Thường) | Ly Trơn 360ml + Nắp Hữu Phong 95mm |
| Menu | Bị Ngang (Nửa Ký) | Bị Ngang Lớn ÷ 2 |
| SanPham | Ống Hút Trong 6mm | Ống Hút Trong 6mm, 8mm |

- Món ghép: nối nguồn bằng `+` → giá = tổng giá làm tròn các thành phần.
- Phép tính ở cuối Nguồn, áp cho cả tổng: `÷ 2`, `/ 2`, `: 2`, `× 0,5`, `x 0,5`, `* 0.5`, hoặc `½` ở đầu.
  Giá = tổng × hệ số, rồi làm tròn theo "Bước làm tròn" trong tab CauHinh (Giá Sỉ làm tròn tới đồng).
  Tên Retail luôn được khớp trước, nên tên có dấu phẩy hay chữ số không bị hiểu nhầm là phép tính.
- Bản cũ có cột **Hệ số**: chạy `caiDat` một lần để gộp vào cột Nguồn (cột Hệ số bị xoá, giá không đổi).
- Món không có trong DongBo (Gạo, Lúa - Bắp…) không bao giờ bị đụng tới.

## Cấu trúc

```
index.html        trang web (Vercel: bayich2-dongbogia.vercel.app)
.clasp.json       Script ID của backend, rootDir = appsscript
appsscript/       backend — Apps Script STANDALONE "bayich2_dongbogia" (không deploy lên Vercel)
  Code.js
  appsscript.json
```

- Script: https://script.google.com/d/1zl3YIhVri2lCW8fLtlns5h-7UtAfR8V3o0vZpmU1GH7FwkxmHGKiITNv/edit
- Deployment đang dùng (`CAUHINH.API_DONGBO`): `AKfycbz767Ti7iftH6thPYqdMfr7YqDnT4ntOwZT5vMj9Ox7T6v4FCJwrrWsx8FLtp0JQfVy`

Backend là web app quyền "Bất kỳ ai", nhưng **máy chủ tự tính giá từ Retail** — trang web chỉ gửi
"ghi những món nào" kèm giá cũ/mới đã thấy lúc xem trước. Một ô chỉ được ghi khi giá đang có và giá
tính lại đều khớp. Người lạ có link cũng không chèn được giá tuỳ ý.

## Sửa backend

Chạy ở thư mục gốc repo (nơi có `.clasp.json`):

```bash
clasp pull                  # lấy bản mới nhất nếu có sửa trên web editor
clasp push                  # đẩy code lên bản nháp
clasp deploy -i AKfycbz767Ti7iftH6thPYqdMfr7YqDnT4ntOwZT5vMj9Ox7T6v4FCJwrrWsx8FLtp0JQfVy -d "mô tả"   # giữ nguyên link /exec
```

Cài lần đầu: mở script → chọn hàm `caiDat` → Run → Cho phép (tạo tab DongBo + xin quyền 2 sheet).
