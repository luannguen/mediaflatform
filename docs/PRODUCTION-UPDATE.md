# Kết quả cập nhật Media Platform 3.8.5

Đợt sửa dựa trên commit c13a409, theo báo cáo khảo sát trong PROJECT-CONTEXT.md. Ngày kiểm thử: 14–15/09/2026. Đây là bằng chứng cho các luồng đã kiểm tra, không phải chứng nhận tải lớn hay toàn bộ môi trường triển khai.

## Những thay đổi chính

| Nhóm vấn đề | Thay đổi đã thực hiện |
| --- | --- |
| Danh tính và phân quyền | Chỉ nhận tài khoản Supabase được xác minh và membership đang hoạt động; chặn dev bypass trong production, bỏ đăng nhập bằng biến admin/role giả lập; kiểm tra scope, tenant và quyền worker tại API. |
| Database và Storage | Bật RLS và thu hồi quyền truy cập trực tiếp của anon/authenticated cho các bảng ứng dụng; bucket media-assets đã chuyển private. API service-role vẫn chịu trách nhiệm kiểm tra tenant. |
| Lời mời thành viên | Lưu PostgreSQL; chấp nhận lời mời theo email hiện tại đã xác minh, dùng transaction; danh sách thành viên lấy tên/email từ Auth. |
| Bảo vệ request | Bọc toàn bộ API bằng request ID, kiểm tra origin/body, rate limit, logging và idempotency có khóa thực thi. Không lưu credential vào response replay. |
| Upload và xử lý | Hợp nhất upload session cho SDK, dashboard và route tương thích; kiểm tra quota/ownership/size; worker xác minh magic bytes, SVG và SHA-256 trước publish. |
| Ảnh/PDF/video | PDF render trang đầu thật bằng PDF.js; pipeline worker dùng chung; ảnh có giới hạn pixel; FFmpeg lỗi không còn trả poster giả. |
| Delivery | Gateway bảo vệ file riêng tư; chưa xử lý xong trả 425; cache public phải revalidate; không tải tùy ý từ storage_url bên ngoài. |
| Trash/restore/purge | Endpoint restore riêng; purge khóa trạng thái, kiểm tra references, phân trang và duyệt Storage đệ quy; lỗi xóa giữ trạng thái để retry. Cleanup session hết hạn có lịch chạy và thời gian chờ capability hết hiệu lực. |
| Webhook | Outbox ghi cùng transaction với asset, dispatcher có lease/retry, danh sách phân vùng workspace, giữ event ID khi replay, kiểm tra HTTPS/DNS trước khi gửi. |
| Analytics/SDK/UI | Tổng analytics tính đủ cửa sổ dữ liệu trong DB; SDK giữ pagination và không retry mutation không an toàn; sidebar mobile thu gọn, restore UI đã chạy thật. |
| Phát hành | Bản 3.8.5, Node 22.13+, explicit media dependencies, SDK CJS/ESM/types, CI và runbook; migration SQL giữ LF để checksum nhất quán Windows/Linux. |

## Thay đổi đã áp dụng trên Supabase

Tám migration trong supabase/migrations đã áp dụng với ledger checksum: API-only access, invitations, idempotency, upload verification, lifecycle, webhook outbox, verified publication/member directory, analytics aggregation. Bucket đã private. Không chạy daemon để tiêu thụ queue của dữ liệu có sẵn; chỉ claim job thuộc workspace test.

Các fixture HTTP tạo tài khoản, workspace và media riêng, tự dọn sau khi kết thúc. Fixture browser còn lại sau lần rate limit đã được dọn ngày 15/09, gồm transform cache và trạng thái đăng nhập cục bộ. Không xóa tài sản hay thành viên có sẵn của dự án. Đối chiếu cuối: **152 asset**, **0 workspace test**, **8 migration** có checksum khớp, bucket private.

## Bằng chứng kiểm thử

- Regression tests: **12/12** (quyền delete/purge, tenant/worker, redirect, SVG, MIME/size, session, cache, SDK upload/retry/pagination).
- PostgreSQL: **20 kiểm tra**, rollback toàn bộ fixture; gồm invitation, quota, owner, duplicate finalize, lease, publish, restore/purge/reference, quyền anon và analytics **2.005 sự kiện**.
- HTTP và media trên bản Next.js production với Supabase thật: **49 kiểm tra**. Upload/render ảnh và PDF, FFmpeg tạo HLS thật, chặn MIME giả, chặn file chưa ready, chặn public bucket access, idempotency/CSRF/tenant, restore, webhook outbox, request logs. Purge kiểm tra **105 object lồng thư mục**, giả lập lỗi Storage delete rồi retry thành công.
- Browser: đăng nhập mobile, dashboard với dữ liệu test thật, ảnh qua gateway, menu mobile, đưa vào trash và restore thành công. Ảnh chụp được lưu cục bộ trong output/playwright, không commit.
- OpenAPI: structural parse và **33 operation IDs** duy nhất. Đây chưa phải kiểm thử response-schema đầy đủ cho mọi route.
- Cài sạch npm ci, lint, TypeScript, SDK build (CJS/ESM import smoke check) và Next.js production build: **đạt** trên Windows/Node 24.11 sau khi sửa lockfile. Dependency audit không có vulnerability được báo tại thời điểm kiểm tra.
- Quét nội dung 293 file thuộc repo không còn giá trị secret hiện tại (bao gồm password tách từ chuỗi kết nối). Lịch sử Git vẫn cần xử lý bằng xoay credential.
- Strapi JavaScript kiểm tra cú pháp; WordPress PHP được đưa vào CI lint. Chưa chạy hai CMS thật.

## Điểm triển khai cần chú ý

Đọc [runbook production](operations/PRODUCTION.md) trước khi triển khai: worker phải chạy riêng và cùng phiên bản; public bucket URLs cũ phải chuyển sang gateway; upload cũ chưa có session phải bắt đầu lại; credential endpoints không nhận Idempotency-Key; worker cũ không tương thích yêu cầu checksum/run mới.

**Cần xoay mật khẩu database:** một script migration cũ chứa chuỗi kết nối khớp cấu hình hiện tại. Đã gỡ khỏi mã nguồn và chuyển sang biến môi trường. Giá trị cũ vẫn nằm trong lịch sử Git; cần đổi mật khẩu trên Supabase và cập nhật mọi môi trường sử dụng nó. Không tự đổi khi chưa xác định đủ các deployment đang dùng chung để tránh cắt kết nối dịch vụ. Không lưu giá trị đó trong báo cáo hay log mới.

Chưa xác minh: worker production chạy liên tục trên host đích, SMTP/email, webhook receiver ngoài hệ thống, cài đặt WordPress/Strapi, kiểm thử tải/SLO, kiểm thử accessibility tự động toàn bộ UI và phục hồi backup. SDK đã có bản build cục bộ, chưa publish npm. Schema lịch sử chưa có installer hoàn chỉnh cho một Supabase project trống. Các giới hạn này được ghi rõ để không đồng nhất “build qua” với “toàn bộ production đã được chứng nhận”.
