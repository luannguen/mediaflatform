# Thư Mục Demo Tích Hợp: `landingtest/`

Thư mục này chứa bản demo hoàn chỉnh minh họa cách một ứng dụng ngoại vi (Website, App di động, E-commerce backend, CMS) tích hợp và khai thác **Media Platform** làm hạ tầng lưu trữ và phân phối media tập trung.

---

## 1. Các Cách Trải Nghiệm Demo

### Cách 1: Trải Nghiệm Qua Giao Diện Next.js 15 (Khuyên dùng)
Khi server dự án đang chạy (`npm run dev`), truy cập trực tiếp bằng trình duyệt:
👉 **`http://localhost:3000/landingtest`**

- **Không cần đăng nhập** (đã được cấu hình Public Route trong `src/middleware.ts`).
- Tích hợp sẵn 5 khu vực tương tác:
  1. **Live Gallery**: Nạp danh mục ảnh/video/tài liệu thật từ REST API v1.
  2. **CDN Sharp Lab**: Kéo thanh trượt thay đổi kích thước ảnh (150px - 1200px), chuyển đổi định dạng WebP/AVIF và xem phần trăm dung lượng tiết kiệm theo thời gian thực.
  3. **Embeddable Picker Demo**: Nút bấm mở popup `/picker?api_key=...`, chọn ảnh và nhận kết quả qua `window.postMessage`.
  4. **API Console**: Thử nghiệm gửi các request REST API thực tế (Sparse Fieldsets, Batch API, Cursor Pagination) và xem độ trễ ms cùng JSON response.
  5. **Tính Năng Cốt Lõi**: Giới thiệu kiến trúc Multi-Tenant, Safe Delete Guard và Zero-Trust RBAC.

---

### Cách 2: Trải Nghiệm Qua Trang Độc Lập `landingtest/index.html`
- File `landingtest/index.html` được thiết kế như một **website độc lập hoàn toàn** (sử dụng Tailwind CSS CDN và Lucide Icons).
- Bạn có thể nhấp đúp mở trực tiếp file `index.html` trên trình duyệt hoặc serve bằng bất kỳ static server nào (ví dụ: `npx serve landingtest`).
- File này kết nối trực tiếp đến backend `http://localhost:3000/api/v1/...` thông qua Demo API Key.

---

### Cách 3: Chạy Client Script Node.js (`landingtest/demo-client.js`)
Mô phỏng một ứng dụng backend bên thứ 3 gọi API của Media Platform qua dòng lệnh:
```bash
node landingtest/demo-client.js
```

Kết quả thực thi tự động:
1. Gọi `GET /api/v1/assets` lấy danh sách media kèm Sparse Fieldsets.
2. Gọi `POST /api/v1/assets/batch` phân giải hàng loạt ảnh kèm `delivery_url` trong 1 request duy nhất (chống N+1 query).
3. Gọi `GET /api/v1/delivery/:id` kiểm tra tốc độ nén WebP của Sharp CDN và header ETag caching.

---

## 2. Thông Tin Cấu Hình Sandbox Sẵn Có (Pre-configured Credentials)

Hệ thống đã được nạp sẵn dữ liệu và API Key hoạt động ngay lập tức:

| Thông Số | Giá Trị Cấu Hình |
| :--- | :--- |
| **Workspace ID** | `ws_default` |
| **Workspace Name** | `Production Media` |
| **Demo Raw API Key** | `mda_live_demo2026_antigravity_platform_super_secret_key_v1` |
| **API Key Prefix** | `mda_live_demo2026` |
| **Quyền Hạn (Scopes)** | `['*']` (Toàn quyền đọc, ghi, upload, batch resolve) |
| **Dữ Liệu Mẫu Đã Seed** | 10 assets phong phú: Giày Nike Air Jordan, Smartwatch, Biệt thự Nordic, Đêm Tokyo, Bàn làm việc Developer, Abstract AI 3D, Ống kính Cinema, Vector SVG Brand, PDF Whitepaper, Video 4K Reel. |

---

## 3. Các Endpoint API Chính Được Sử Dụng

### 1. Lấy danh sách media (Có phân trang & Sparse Fieldsets)
```http
GET /api/v1/assets?limit=10&fields=id,display_name,storage_url
X-Media-Api-Key: mda_live_demo2026_antigravity_platform_super_secret_key_v1
```

### 2. Phân giải hàng loạt ảnh chống N+1 (Batch Resolving)
```http
POST /api/v1/assets/batch
X-Media-Api-Key: mda_live_demo2026_antigravity_platform_super_secret_key_v1
Content-Type: application/json

{
  "ids": ["med_demo_nike_sneaker", "med_demo_smartwatch"],
  "transform": { "width": 600, "format": "webp", "quality": 80 }
}
```

### 3. Tải ảnh biến thể tự động qua Sharp CDN
```http
GET /api/v1/delivery/med_demo_nike_sneaker?w=500&format=webp&q=80
```
- Phản hồi: `image/webp` nhị phân nén siêu nhỏ kèm header `ETag` và `Cache-Control: immutable`.
- Khi client gửi lại kèm `If-None-Match: <etag>`, server phản hồi `304 Not Modified` 0-byte.

### 4. Mở hộp thoại chọn media (Embeddable Picker)
```
http://localhost:3000/picker?api_key=mda_live_demo2026_antigravity_platform_super_secret_key_v1&mode=single
```
- Mở trong popup hoặc iframe.
- Giao tiếp kết quả chọn media qua:
```javascript
window.addEventListener('message', (event) => {
  if (event.data?.type === 'MEDIA_ASSET_SELECTED') {
    console.log('Asset được chọn:', event.data.asset);
  }
});
```
