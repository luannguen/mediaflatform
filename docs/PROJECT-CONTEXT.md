# Media Platform — Ngữ cảnh để tiếp tục phát triển

**Báo cáo khảo sát lịch sử tại c13a409.** Đợt sửa 3.8.5 đã thay đổi các hành vi bên dưới. Đọc [kết quả cập nhật](PRODUCTION-UPDATE.md) và [runbook hiện hành](operations/PRODUCTION.md) trước khi tiếp tục; các mục “chưa sửa/chưa kiểm tra” trong báo cáo này chỉ phản ánh thời điểm khảo sát.

Ngày đối chiếu: **2026-09-13**. Mã nguồn được đọc tại commit **c13a40989e14b3a2ca267cee50467e6b9283e0e4** trên `main`, khớp với GitHub tại thời điểm kiểm tra. Working tree ban đầu sạch; không có PR hoặc issue đang mở theo kết quả GitHub.

Đây là bản đồ dự án dựa trên tài liệu, mã nguồn và kiểm tra offline; không phải chứng nhận hoạt động production hay một đợt kiểm toán bảo mật toàn diện. Khi cập nhật, đối chiếu lại các file nguồn được dẫn bên dưới. Không suy ra trạng thái database hoặc deployment từ việc có sẵn migration trong repo.

## 1. Mục tiêu sản phẩm và nguyên tắc nền tảng

Media Platform hướng tới một **dịch vụ quản lý tài sản số độc lập (headless DAM)** dùng chung cho CMS, thương mại điện tử, cộng đồng và các ứng dụng khác. Dịch vụ sở hữu metadata, lưu trữ, xử lý và phân phối media; dashboard phục vụ người quản trị, REST API và SDK phục vụ ứng dụng tích hợp.

Các mục tiêu được ghi trong [ADR](adr/ADR-001-to-006.md) và [hướng dẫn tích hợp](integration-guide/INTEGRATION-GUIDE.md):

- Ứng dụng ngoài lưu `asset_id` dạng `med_...`, rồi lấy URL delivery khi sử dụng. Không dùng đường dẫn bucket làm định danh nghiệp vụ.
- `Organization → Workspace` là mô hình phân vùng; workspace là ranh giới truy cập media.
- Theo dõi ứng dụng nào đang dùng asset bằng references để bảo vệ thao tác xóa vĩnh viễn.
- Xử lý media nặng bằng job/worker; giữ API, dashboard và tích hợp bên ngoài dùng chung dữ liệu.
- Có lớp trừu tượng storage để có thể bổ sung nhà cung cấp khác về sau.

Đây là các mục tiêu/contract. Những bảo đảm tuyệt đối trong tài liệu cũ không thay thế việc kiểm tra thực tế các luồng ở phần 6.

## 2. Cấu trúc và công nghệ hiện tại

Kiến trúc mã nguồn là một **Next.js modular monolith**, kèm worker Node.js chạy riêng. Chưa thấy cấu hình npm workspaces hay bộ điều phối monorepo tại root.

| Khu vực | Vai trò và điểm bắt đầu đọc |
| --- | --- |
| `src/app/(dashboard)` | Dashboard, library, folders, collections, trash, analytics, developers, docs và settings. [Layout](../src/app/(dashboard)/layout.tsx), [sidebar](../src/components/layout/AppSidebar.tsx). |
| `src/components`, `src/hooks` | Thành phần UI; hooks gọi REST API. [useAssets](../src/hooks/useAssets.ts), [useUpload](../src/hooks/useUpload.ts), [AuthContext](../src/lib/auth/AuthContext.tsx). |
| `src/app/api/v1` | 66 file route API v1; thêm một alias OpenAPI ngoài v1 thành tổng 67 file route API. Nhóm auth/workspaces, assets/uploads, delivery, jobs, developer, references, webhooks, health và usage. |
| `src/services` | 19 service nghiệp vụ: asset, upload session, workspace, invitation, folder, collection, tag, reference, purge, integrity, developer, webhook, audit, usage, analytics, job queue, video, video worker, worker fleet. |
| `src/lib/security`, `src/lib/auth` | Session, API key, RBAC/scopes, workspace resolution, resource authorization, delivery grant, CORS, upload policy; có thêm các module rate limit và idempotency. |
| `src/lib/media`, `src/lib/storage` | Sharp/FFmpeg, transform/delivery policy, worker cores, storage interface và Supabase adapter. |
| `src/types/database.ts`, `supabase`, `scripts/migrate*` | TypeScript domain types, schema nền và các migration tăng dần/RPC PostgreSQL. |
| `packages/sdk`, `src/lib/sdk` | SDK đóng gói `MediaPlatformClient`, client khác `MediaClient`, React helpers, React Native và Flutter. |
| `plugins` | Connector WordPress và upload provider Strapi. |
| `src/app/landingtest`, `landingtest`, `src/app/picker` | Demo trong Next.js, demo HTML/JS riêng và media picker nhúng. |
| `docs`, `scripts/test*` | Tài liệu kiến trúc/API/vận hành và các script kiểm tra theo phiên bản. |

Theo [package.json](../package.json), [lockfile](../package-lock.json) và [runtime version](../src/lib/platform/version.ts):

- Platform/package/SDK hiện khai báo `3.8.4`; các commit gần nhất là đợt sửa `3.8.4.1`, API vẫn `v1`.
- Phiên bản khóa trong lockfile: Next.js `15.5.25`, React `19.2.8`, Tailwind `4.3.3`, TypeScript `5.9.3`, Supabase JS `2.116.0`, Sharp `0.35.4`.
- PostgreSQL và Supabase Storage là backend triển khai trong mã nguồn; các mô tả Vercel trong docs thể hiện hướng triển khai, chưa được xác minh bằng deployment trong lần đọc này.
- Sharp được import trực tiếp nhưng chưa được khai báo dependency trực tiếp tại root. FFmpeg/FFprobe có installer packages và hỗ trợ đường dẫn binary qua biến môi trường.
- Chỉ có `SupabaseStorageProvider` được đăng ký trong [storage factory](../src/lib/storage/factory.ts). R2/S3 chưa có adapter trong repo.

## 3. Luồng nghiệp vụ chính

### Danh tính và workspace

Dashboard dùng cookie `mda_session` ký HMAC qua WebCrypto. Đăng nhập/đăng ký tích hợp Supabase Auth; quyền runtime được lấy lại từ membership bằng `user_id`, không lấy email làm căn cứ cấp quyền. Nếu có nhiều workspace mà chưa chọn rõ, resolver trả `WORKSPACE_SELECTION_REQUIRED`.

API bên ngoài dùng `X-Media-Api-Key` hoặc Bearer API key. Worker có loại principal riêng. Các role gồm owner, admin, media_manager, editor, uploader, viewer và developer; quyền UI và scope API nằm ở các bảng mapping riêng, cần đối chiếu khi sửa.

Nguồn: [session](../src/lib/auth/session.ts), [auth guard](../src/lib/security/auth-guard.ts), [workspace resolver](../src/lib/security/workspace-resolver.ts), [workspace service](../src/services/workspaceService.ts), [resource authorization](../src/lib/security/resourceAuthorization.ts).

### Upload và xử lý bất đồng bộ

Luồng đang dùng trong dashboard/picker:

1. `POST /api/v1/uploads/sessions`: kiểm tra scope, giới hạn dung lượng/quota và folder trong workspace; lưu upload session, cấp capability ký sẵn.
2. Browser gửi bytes trực tiếp vào Storage, không chuyển file lớn qua body của Next.js API.
3. `POST /api/v1/uploads/sessions/{id}/complete`: đọc metadata object và đối chiếu kích thước khai báo.
4. RPC `finalize_upload_session` khóa session bằng `FOR UPDATE`, kiểm tra trạng thái/workspace/folder/kích thước và tạo asset + job + hoàn tất session trong một giao dịch. Gọi hoàn tất lại có thể trả asset/job đã tạo.
5. Worker xử lý job, lưu các output và publish bằng RPC có kiểm tra quyền sở hữu lease/run.

Capability hiện chỉ là **signed-put**. Session sống 24 giờ; capability được yêu cầu thời hạn 1 giờ và có API refresh. TUS/resumable hiện được khai báo **false**. Checksum do client gửi và ETag provider không được coi là SHA-256 đã kiểm chứng; luồng mới có thể để `checksum = null` và `checksum_verified = false`.

Nguồn: [upload hook](../src/hooks/useUpload.ts), [upload session service](../src/services/uploadSessionService.ts), [migration finalize mới nhất](../scripts/migrate-v3-8-4-1-correctness-gate.js), [capabilities](../src/app/api/v1/capabilities/route.ts).

Hai luồng upload cũ vẫn tồn tại và có hành vi khác:

- `/uploads` và alias `/uploads/direct`: multipart tối đa 4 MiB; tính SHA-256 từ bytes, tạo asset qua `assetService`, enqueue video riêng. Compensation xóa object khi asset chưa được ghi thành công.
- `/uploads/presigned` rồi `/uploads/confirm`: tạo asset trước; bước confirm tải bytes về server để kiểm tra MIME/magic bytes, xử lý SVG và tính checksum.

Không thay một luồng bằng luồng khác mà bỏ qua validation, webhook, metadata và job semantics. Giới hạn theo loại của upload session: ảnh/other 25 MiB, video 500 MiB, PDF/audio/archive 50 MiB; xem [upload policy](../src/lib/security/uploadPolicy.ts).

### Worker và media outputs

Queue nằm trong PostgreSQL `processing_jobs`. Luồng chính dùng `claim_next_processing_job`, `renew_job_heartbeat`, `publish_transcoded_asset`/`publish_processed_asset`, `fail_processing_job`. `worker_id`, `job_run_id`, lease expiry và output version giúp ngăn worker đã mất quyền ghi đè kết quả mới.

- Video: FFmpeg/FFprobe, HLS nhiều mức chất lượng, poster và preview WebP; logic chung trong [workerCore.js](../src/lib/media/workerCore.js).
- Ảnh: Sharp, auto orientation, palette và các variant kích thước chuẩn; delivery có thêm resize/crop/focal/watermark và cache transform.
- PDF: kiểm tra header, đếm trang bằng heuristic và tạo thumbnail minh họa bằng SVG + Sharp; chưa render nội dung trang PDF.
- Archive trong finalize mới được chuyển sang `quarantined`; chưa có processor audio được quảng bá là hoạt động.

[CLI worker](../scripts/run-queue-worker.js) có `--direct`, `--http`, `--once`. Chế độ direct xử lý tại daemon; chế độ HTTP gọi `/jobs/process`, nên phần xử lý chạy trong server API. Video core được chia sẻ, còn pipeline ảnh/PDF vẫn có logic riêng ở CLI và các TypeScript worker cores.

### Delivery, references và vòng đời asset

Delivery ảnh/tài liệu qua `/delivery/{id}`; HLS và các artifact video qua `/delivery/video/{id}/...`. Với asset private/workspace, gateway kiểm tra principal hoặc delivery grant ký sẵn có workspace/asset/permission/TTL. Private response dùng cache policy `private`/`no-store`; HLS truyền grant xuống URL playlist/segment.

`asset_versions` lưu phiên bản file gốc; `asset_variants` và output version biểu diễn kết quả xử lý. Không đồng nhất hai khái niệm này khi sửa rollback hoặc cache.

References ghi ứng dụng, entity và field đang sử dụng asset. `sync_asset_references` thay tập references của entity theo giao dịch. Trash ghi thời điểm và hạn purge 30 ngày; purge kiểm tra quyền và references, có chế độ force. Trong mã delivery hiện tại, asset đã trashed bị trả 404 ngay.

Nguồn: [delivery gateway](../src/app/api/v1/delivery/[id]/route.ts), [video gateway](../src/app/api/v1/delivery/video/[id]/[...file]/route.ts), [delivery grant](../src/lib/security/delivery-grant.ts), [asset service](../src/services/assetService.ts), [reference service](../src/services/referenceService.ts), [purge service](../src/services/purgeService.ts).

## 4. Data model và vận hành

Các nhóm bảng cần nắm:

- Tenant/identity: organizations, workspaces, roles, workspace_memberships.
- Media: assets, folders, collections, collection_assets, tags, asset_tags, asset_favorites, asset_variants, asset_versions, asset_references.
- Pipeline: upload_sessions, processing_jobs, integrity_issues, worker_instances.
- Tích hợp/vận hành: applications, service_accounts, api_keys, webhook_endpoints, webhook_deliveries, audit_events, api_request_logs, usage_metrics, idempotency_records, rate_limit_buckets, operational_alerts.

Danh sách này tổng hợp [schema nền](../supabase/schema.sql), migrations và [types](../src/types/database.ts), chưa phải inventory của database đang chạy. Schema nền chưa đủ để tái tạo phiên bản hiện tại; các RPC nằm rải trong chuỗi migrations từ v2 đến v3.8.4.1. Một số script sửa định nghĩa cũ bằng thao tác chuỗi, vì vậy phải đọc từng migration và đối chiếu chữ ký RPC trước khi áp dụng.

Repo chưa có migration runner thống nhất hay ledger đã áp dụng mà lần đọc này xác minh được. Không chạy migrations/seed/integration tests vào database được cấu hình sẵn chỉ để kiểm tra onboarding.

Các biến cần tra theo tác vụ: cấu hình Supabase, bucket/provider, `API_KEY_SECRET_SALT`, `SESSION_SECRET`, delivery grant secret/keyring, `WORKER_SERVICE_TOKEN`; migration dùng `DIRECT_URL`/`DATABASE_URL`; worker có `FFMPEG_PATH`, `FFPROBE_PATH`, `WORKER_POLL_INTERVAL_MS`. [.env.example](../.env.example) chưa bao phủ đầy đủ các biến trong mã nguồn. Không đưa giá trị từ `.env.local` vào tài liệu hoặc commit.

Có live/ready/deep health endpoints và worker/queue metrics. Deep health có thao tác ghi–đọc–xóa object Storage, nên không xem đó là probe chỉ đọc. Các SLO trong docs là mục tiêu; chưa có số đo production chứng minh trong lần khảo sát này. Chưa thấy file CI workflow, Dockerfile hoặc `vercel.json` được track tại baseline.

## 5. Tích hợp và các điểm phải giữ tương thích

- Có hai bề mặt client chính: [SDK package](../packages/sdk/index.ts) và [client nội bộ](../src/lib/sdk/mediaClient.ts). `src/lib/sdk/index.ts` re-export cả SDK package và các React helpers.
- `MediaPlatformClient.assets.upload()` vẫn dùng multipart; phương thức `MediaPlatformClient.upload()` mới chọn direct session khi file >4 MiB. Không suy ra cả hai tự chuyển sang upload session.
- SDK package khai báo entrypoint `dist/*` nhưng chưa có tsconfig/build pipeline riêng tạo đủ các entrypoint đó trong repo. Chưa kiểm tra việc publish npm hoặc sử dụng từ package đã đóng gói.
- WordPress/Strapi còn gọi `/uploads/direct`; media >4 MiB sẽ vướng giới hạn multipart của route hiện tại. Chưa chạy hai CMS để xác minh tích hợp.
- Có OpenAPI trong `src/openapi/spec.ts`, mô tả API khác trong `src/lib/docs/api-spec.ts`, trang docs và các guide Markdown. Kiểm tra đồng bộ cả contract, SDK và ví dụ khi đổi API.
- Các hợp đồng cần bảo toàn: asset ID ổn định; workspace từ principal; scope/role; envelope success/error; lifecycle/processing status; upload completion có thể gọi lại; lease/run fencing; quyền delivery và cache private; references và force-purge.

## 6. Khoảng cách giữa mục tiêu, tài liệu và mã nguồn

Các ghi nhận dưới đây đến từ việc đọc source, chưa sửa trong tác vụ khảo sát này:

| Điểm cần chú ý | Bằng chứng và tác động khi update |
| --- | --- |
| Dev bypass chưa chặn production | [auth guard](../src/lib/security/auth-guard.ts) chấp nhận nhánh `X-Dev-Bypass` mà không yêu cầu môi trường non-production; principal nhận wildcard scopes và workspace từ header. Cần ưu tiên xử lý trước khi dựa vào phân quyền hiện tại. |
| Các module bảo vệ chưa được nối vào route | Tìm kiếm trong source chỉ thấy `rateLimiter` và `idempotencyService` được định nghĩa, chưa được import/call trong route/middleware. Có RPC và test cấp module không có nghĩa request thực tế đã được bảo vệ. Tính gọi lại an toàn của finalize session là cơ chế riêng. |
| Validation không đồng đều giữa các luồng upload | Magic-byte/SVG sanitization được gọi ở `/uploads/confirm`; luồng session mới không gọi chung các bước đó. Cần rà tính tương đương trước khi hợp nhất hoặc bỏ route cũ. |
| Lời mời thành viên vẫn là mock | [invitationService](../src/services/invitationService.ts) lưu invitation/membership vào `mockDb`, trong khi workspace resolver production đọc PostgreSQL. Không thể coi tính năng mời vào workspace đã có persistence hoàn chỉnh. |
| UI restore không khớp PATCH contract | [useAssets](../src/hooks/useAssets.ts) gửi `status` khi restore; [assetService.updateAsset](../src/services/assetService.ts) từ chối trường `status` với principal API. Service restore nội bộ tồn tại nhưng UI chưa dùng một endpoint tương ứng. |
| PDF capability mô tả vượt implementation | Capabilities nêu `pdf-lib` và first-page thumbnail; [documentWorkerCore](../src/lib/media/documentWorkerCore.ts) dùng heuristic + thumbnail minh họa, không import pdf-lib. |
| Trạng thái cleanup/purge cần kiểm tra kỹ | Có hàm cleanup expired session nhưng chưa thấy scheduler/caller trong source runtime. Purge liệt kê prefix với limit 100, không đệ quy vào cây HLS/output version, và chưa xử lý đầy đủ kết quả lỗi xóa. Chưa thể khẳng định không còn orphan artifacts. |
| Logging/webhook chưa là pipeline bền vững đầy đủ | Chưa thấy caller runtime của `recordApiRequestLog`; webhook dispatch gửi bất đồng bộ trong process và có replay, chưa thấy durable outbox/dispatcher retry. Không coi mọi request/event đã được ghi/gửi chắc chắn. |
| Demo chưa chứng minh cách ly khỏi workspace thật | Demo broker có role uploader cố định và TTL ngắn, nhưng chọn workspace theo id/slug default hoặc production. Cần cấu hình/kiểm tra môi trường demo riêng trước khi công khai dữ liệu thật. |
| RLS là tuyên bố chưa được kiểm chứng | Docs mô tả RLS; chưa thấy khai báo enable/policy trong schema/migrations được khảo sát. Code sử dụng service-role client nhiều nơi. Phải kiểm tra database thực và kiểm soát workspace trong API, không suy ra tenant isolation chỉ từ chữ RLS. |
| Tài liệu setup/version bị lệch | README badge `3.8.2`, changelog dừng `3.8.3`, runtime/package `3.8.4` với sửa `3.8.4.1`; README hướng dẫn `npm run worker` nhưng package.json không có script worker. R2/S3 ghi ready nhưng chưa có adapter; docs nói trash vẫn delivery được, code trả 404. |

Danh sách này dùng làm ngữ cảnh và điểm kiểm tra khi thay đổi phần liên quan, không phải yêu cầu tự động sửa toàn bộ dự án.

## 7. Kiểm tra đã thực hiện và phạm vi chưa xác minh

Ngày 2026-09-13:

- TypeScript: `node_modules/.bin/tsc.cmd --noEmit --incremental false` — **đạt**.
- `node scripts/test-v3-8-4-1-correctness-gate.js` — **12/12 đạt**. Đây là assertion trên nội dung source, không phải test hành vi HTTP/database.
- Hàm `validateOpenApi()` của `scripts/test-openapi-contract.js` — **đạt**: metadata, structural parse, 32 operation IDs duy nhất, các schema bắt buộc, 13 endpoint chính. Chạy bằng TypeScript compiler có sẵn và bộ nạp tạm trong process vì chưa có binary `tsx` local; không cài dependency. Script hiện không chứng minh API runtime tuân thủ schema hoặc mọi route đều đã có trong spec.
- Đối chiếu remote repository/branch và PR/issue bằng GitHub API; không fetch/merge/push thay đổi vào nhánh.

Chưa chạy production build, browser flow, worker thật, integration test có ghi dữ liệu, migration, hoặc truy vấn trạng thái Supabase/deployment. Không đọc giá trị secrets trong `.env.local`. Không sửa mã chức năng, dependency, cấu hình hoặc schema; tác vụ này chỉ bổ sung tài liệu này.

Repo chưa có `AGENTS.md`, Project Memory index hay các registry/bootstrap thuộc bộ skill đã đọc. Vì vậy bản này là tài liệu onboarding có nguồn tham chiếu; chưa khởi tạo hoặc xác nhận một hệ Project Memory có lint/index riêng.

## 8. Cách tiếp tục ở lần cập nhật sau

1. Đọc file này, kiểm tra `git status`, nhánh/commit và các thay đổi mới hơn baseline.
2. Xác định luồng cần thay đổi, lần theo `UI/hook → route → guard/service → Storage/RPC → worker/delivery` tương ứng.
3. Kiểm tra tác động sang các luồng upload cũ, SDK/plugin, OpenAPI, role/scope và migration. Mã nguồn hiện hành quyết định hành vi thực tế; docs cũ giúp hiểu ý định.
4. Chọn kiểm tra theo thay đổi: TypeScript/contract cho thay đổi cấu trúc; integration trên môi trường test cho DB/auth/queue; browser flow cho UI; kiểm tra artifacts thật cho media.
5. Cập nhật lại ngữ cảnh và dẫn nguồn khi trạng thái đã thay đổi. Các vấn đề ở phần 6 cần được xác minh lại trước khi kết luận còn tồn tại.
