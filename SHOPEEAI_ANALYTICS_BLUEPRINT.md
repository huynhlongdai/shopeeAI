# shopeeAI Analytics Blueprint

Mục tiêu: phát triển `shopeeAI` từ công cụ lấy dữ liệu/affiliate link thành một hệ thống phân tích Shopee kiểu "Shopdora mini": thu thập dữ liệu bằng extension thật, lưu lịch sử, tính biến động, ước lượng sales/SKU, và cung cấp dashboard/API cho automation.

Tài liệu này là bản phân tích để triển khai sau, không phải đặc tả cuối cùng.

## 1. Tầm Nhìn Sản Phẩm

`shopeeAI` nên tách thành 4 lớp:

1. **Collector**
   - Extension chạy trong Chrome thật.
   - Nhiều profile cùng kết nối.
   - Thu sản phẩm, shop, review, search result, category.
   - Tạo affiliate link.

2. **Job Orchestrator**
   - API server tạo job, chia batch, phân phối cho profile online.
   - Theo dõi tiến trình, retry, timeout, rate-limit.
   - Có thể chạy local hoặc kết nối server online.

3. **Data Warehouse**
   - Lưu dữ liệu thô và snapshot lịch sử.
   - Tính delta theo ngày/giờ.
   - Chuẩn hóa ID, URL, shop, category, keyword.

4. **Analytics Layer**
   - Product tracking.
   - Shop tracking.
   - Keyword/category tracking.
   - Sales/revenue estimation.
   - SKU estimation từ review/variant.
   - Review summary và content intelligence.

## 2. Điều Có Thể Làm Ngay

Các phần này khả thi với code hiện tại:

- Lưu job vào database thay vì RAM.
- Lưu product snapshot mỗi lần collect.
- Lưu search/category result theo keyword/category.
- Tính biến động `sold`, `review_count`, `rating`, `price`.
- Tính doanh thu ước lượng cơ bản: `delta_sold * sale_price`.
- Lấy và lưu media: image/video URL.
- Lấy review và tóm tắt review.
- Tạo affiliate link hàng loạt, tự chia mỗi job 5 link.
- Multi-profile extension: profile online nhận job theo queue.
- Dashboard manager xem job/result.

## 3. Điều Cần Dữ Liệu Lịch Sử

Các tính năng này cần dữ liệu chạy đều 7-30 ngày:

- Sales 1 ngày, 7 ngày, 30 ngày.
- Revenue trend.
- Price history.
- Review growth.
- Ranking theo keyword/category.
- Top product movement.
- Shop growth.
- Category demand trend.
- Sản phẩm mới nổi.
- Cảnh báo đối thủ đổi giá/tăng sale.

Nếu không có lịch sử, mọi thứ chỉ là snapshot hiện tại. Muốn giống Shopdora, phần lịch sử là nền móng.

## 4. Data Model Đề Xuất

Nên bắt đầu bằng SQLite cho local, sau đó nâng lên Postgres nếu cần server online nhiều máy.

### 4.1 products

Lưu định danh sản phẩm ổn định.

```sql
products (
  id integer primary key,
  shop_id text not null,
  item_id text not null,
  product_key text not null unique,
  canonical_url text not null,
  first_seen_at text not null,
  last_seen_at text not null,
  latest_name text,
  latest_shop_name text,
  latest_category_path text,
  latest_image text
)
```

### 4.2 product_snapshots

Mỗi lần collect tạo một snapshot.

```sql
product_snapshots (
  id integer primary key,
  product_key text not null,
  captured_at text not null,
  name text,
  description text,
  sale_price integer,
  original_price integer,
  discount text,
  sold_text text,
  sold_value integer,
  rating real,
  total_ratings integer,
  shop_name text,
  shop_id text,
  stock integer,
  raw_json text
)
```

### 4.3 product_daily_metrics

Bảng tổng hợp theo ngày.

```sql
product_daily_metrics (
  id integer primary key,
  product_key text not null,
  date text not null,
  sold_start integer,
  sold_end integer,
  sold_delta integer,
  review_start integer,
  review_end integer,
  review_delta integer,
  min_price integer,
  max_price integer,
  avg_price integer,
  estimated_revenue integer,
  confidence real
)
```

### 4.4 product_media

```sql
product_media (
  id integer primary key,
  product_key text not null,
  type text not null,
  url text not null,
  first_seen_at text not null,
  unique(product_key, type, url)
)
```

### 4.5 reviews

```sql
reviews (
  id integer primary key,
  product_key text not null,
  review_id text,
  author text,
  rating integer,
  variant text,
  comment text,
  created_at text,
  images_json text,
  videos_json text,
  raw_json text,
  unique(product_key, review_id)
)
```

### 4.6 search_runs

```sql
search_runs (
  id integer primary key,
  keyword text,
  category_url text,
  source_url text,
  page_count integer,
  limit_count integer,
  captured_at text not null
)
```

### 4.7 search_results

```sql
search_results (
  id integer primary key,
  search_run_id integer not null,
  product_key text,
  position integer,
  page integer,
  name text,
  price integer,
  sold_text text,
  sold_value integer,
  rating real,
  image text,
  url text
)
```

### 4.8 affiliate_links

```sql
affiliate_links (
  id integer primary key,
  original_url text not null,
  short_link text,
  long_link text,
  sub_id1 text,
  sub_id2 text,
  sub_id3 text,
  sub_id4 text,
  sub_id5 text,
  created_at text not null,
  unique(original_url, sub_id1, sub_id2, sub_id3, sub_id4, sub_id5)
)
```

### 4.9 jobs

Persist queue thay vì in-memory.

```sql
jobs (
  id integer primary key,
  type text not null,
  status text not null,
  input_json text,
  result_json text,
  error text,
  target_profile_id text,
  worker_profile_id text,
  created_at text not null,
  updated_at text not null,
  started_at text,
  completed_at text
)
```

## 5. Thuật Toán Sales Estimation

Shopee thường hiển thị số bán dạng mơ hồ:

- `1k+`
- `2k+`
- `10k+`
- `100k+`

Vì vậy không nên coi `sold_value` là con số chính xác tuyệt đối.

### 5.1 Basic Delta

Nếu `sold_value` tăng từ 2000 lên 3000:

```text
delta_min = 1000
confidence = medium
```

Nếu giữ nguyên 2000:

```text
delta_min = 0
delta_unknown = true
confidence = low
```

Vì sản phẩm vẫn có thể bán thêm nhưng chưa vượt ngưỡng Shopee làm tròn.

### 5.2 Review Growth Proxy

Nếu review tăng:

```text
estimated_sales = review_delta / review_rate
```

`review_rate` có thể mặc định 2%-8% tùy ngành. Ban đầu dùng cấu hình:

```json
{
  "defaultReviewRate": 0.04,
  "categoryReviewRates": {
    "beauty": 0.06,
    "electronics": 0.025,
    "home": 0.035
  }
}
```

### 5.3 Hybrid Estimate

Kết hợp:

- Delta sold nếu vượt ngưỡng.
- Review growth.
- Ranking movement.
- Stock movement nếu lấy được.
- Price/promo changes.

Pseudo:

```text
if sold_delta > 0:
  estimate = sold_delta
  confidence = 0.7
else if review_delta > 0:
  estimate = review_delta / review_rate
  confidence = 0.45
else:
  estimate = 0
  confidence = 0.2
```

Sau 30 ngày có thể hiệu chỉnh theo từng category/shop.

## 6. SKU Sales Estimation

Nếu Shopee không trả SKU sales trực tiếp:

1. Lấy nhiều review nhất có thể.
2. Mỗi review thường có variant/SKU text.
3. Đếm số review theo variant.
4. Ước lượng tỷ trọng SKU:

```text
sku_share = variant_review_count / total_variant_reviews
sku_estimated_sales = estimated_product_sales * sku_share
```

Ví dụ:

```text
Product estimated 30d sales: 1000
Variant A reviews: 60
Variant B reviews: 40
SKU A estimated sales: 600
SKU B estimated sales: 400
```

Đây là proxy, không phải số thật tuyệt đối. Nhưng đủ dùng để phân tích biến thể nào bán tốt.

## 7. Keyword & Category Tracking

### 7.1 Keyword Snapshot

Job:

```json
{
  "type": "product-links",
  "keyword": "ốp lưng iphone",
  "limit": 300,
  "maxPages": 6
}
```

Lưu:

- product position
- page
- price
- sold
- rating
- image
- shop

Tính:

- sản phẩm nào lên/xuống rank
- shop nào chiếm top nhiều
- price band phổ biến
- keyword có nhiều sản phẩm mới không
- sản phẩm nào có tốc độ review/sold tăng nhanh

### 7.2 Category Snapshot

Tương tự keyword, nhưng source là category URL.

Tính:

- top products by sold
- top shops
- category revenue estimate
- median price
- product count trend
- new product ratio

## 8. Review Intelligence

Review là nguồn dữ liệu rất giàu:

- Pain points.
- Selling points.
- Use cases.
- SKU/variant demand.
- Ảnh/video thực tế.
- Từ khóa tự nhiên của khách.

Pipeline:

1. Crawl review pages.
2. Deduplicate.
3. Extract variant.
4. Classify positive/negative/neutral.
5. Extract topics:
   - chất lượng
   - giao hàng
   - đóng gói
   - đúng mô tả
   - giá
   - độ bền
6. Generate summary:
   - điểm mạnh
   - điểm yếu
   - buyer objections
   - content angle gợi ý

## 9. Multi-Profile Strategy

Mục tiêu: giảm rủi ro một tài khoản out session hoặc bị hạn chế.

Mỗi Chrome profile có:

- `profileId`
- `profileName`
- heartbeat
- currentJobId
- state
- lastSeenAt

Job có thể:

- chạy với bất kỳ profile online
- chỉ định `targetProfileId`
- retry sang profile khác nếu timeout

Chính sách đề xuất:

```text
product-info: any profile
product-links: rotate profile
affiliate-links: profile có affiliate login ổn định
product-affiliate: ưu tiên profile affiliate
```

## 10. Remote Server Pattern

Không nên expose máy local trực tiếp ra internet nếu chưa cần.

Mô hình tốt hơn:

```text
Chrome Extension Local -> Local API -> Relay Client -> VPS/API Online
```

Hoặc:

```text
Chrome Extension Local -> VPS Queue Polling
```

Trong mô hình polling:

- Server online giữ job.
- Extension local gọi outbound đến server online.
- Không cần mở port local.
- An toàn hơn với NAT, firewall, IP động.

## 11. API Mới Nên Thêm

### Tracking

```http
POST /api/tracking/products
GET /api/tracking/products
GET /api/tracking/products/:productKey
GET /api/tracking/products/:productKey/snapshots
GET /api/tracking/products/:productKey/daily
```

### Search/Category

```http
POST /api/tracking/search-runs
GET /api/tracking/search-runs
GET /api/tracking/search-runs/:id/results
```

### Analytics

```http
GET /api/analytics/products/:productKey/summary
GET /api/analytics/keywords/:keyword
GET /api/analytics/categories
GET /api/analytics/shops/:shopId
```

### Reviews

```http
POST /api/tracking/products/:productKey/reviews/collect
GET /api/tracking/products/:productKey/reviews
GET /api/analytics/products/:productKey/review-summary
```

## 12. Dashboard Đề Xuất

### Product Tracker

- Product name/shop.
- Current price.
- Sold/review/rating.
- 1d/7d/30d estimated sales.
- Revenue estimate.
- Price chart.
- Review growth chart.
- Media gallery.
- Affiliate link.

### Keyword Research

- Keyword.
- Search volume proxy.
- Top products.
- Median price.
- Top shops.
- Competition score.
- New product count.
- Products with fast growth.

### Category Research

- Category size estimate.
- Revenue trend.
- Top products.
- Top shops.
- Price distribution.
- Growth/decline.

### Review Analysis

- Positive topics.
- Negative topics.
- Common buyer wording.
- SKU demand distribution.
- Content suggestions.

## 13. Roadmap Triển Khai

### Phase 1: Persistence Foundation

- Add SQLite.
- Persist jobs.
- Persist product snapshots.
- Persist media.
- Add migration script.
- Add API docs update.

Deliverable:

- Restart server không mất job.
- Mỗi lần collect sản phẩm có snapshot.

### Phase 2: Product Tracking

- Add tracked products table.
- Add scheduled collect jobs.
- Add daily metric aggregation.
- Add product detail analytics API.

Deliverable:

- Theo dõi 1 sản phẩm trong nhiều ngày.
- Biết giá/sold/review thay đổi.

### Phase 3: Search & Category Runs

- Persist product-links result.
- Add keyword/category tracking schedule.
- Add rank history.

Deliverable:

- Theo dõi keyword/category nhiều ngày.
- Biết sản phẩm nào lên/xuống top.

### Phase 4: Review & SKU Estimation

- Crawl reviews deeper.
- Persist reviews.
- Estimate SKU share.
- Add review summary.

Deliverable:

- Có bảng SKU estimated demand.
- Có tóm tắt review tự động.

### Phase 5: Dashboard Upgrade

- Manager UI thành analytics dashboard.
- Product tracker page.
- Keyword page.
- Category page.
- Review page.

Deliverable:

- Dùng được như mini analytics app.

### Phase 6: Remote Relay

- Server online queue.
- Local extension profile polling.
- API token/profile auth.
- Multi-machine sync.

Deliverable:

- VPS tạo job, máy local nhận job và chạy Shopee bằng Chrome thật.

## 14. Rủi Ro Và Cách Giảm

### Captcha / Risk Control

Giảm bằng:

- Dùng extension trên Chrome thật.
- Giãn tốc độ job.
- Random delay.
- Multi-profile.
- Không mở quá nhiều tab song song.

### Dữ Liệu Mơ Hồ

Giảm bằng:

- Lưu raw data.
- Gắn `confidence`.
- Không hiển thị estimate như số tuyệt đối.
- Dùng nhiều proxy: sold, review, rank, stock.

### Out Session

Giảm bằng:

- Heartbeat profile.
- Detect login required.
- Retry sang profile khác.
- Dashboard báo profile cần login.

### Database Phình To

Giảm bằng:

- Snapshot hourly cho tracked product quan trọng.
- Snapshot daily cho sản phẩm thường.
- Nén raw JSON cũ.
- Retention policy.

## 15. Quy Ước Hiển Thị Estimate

Không nên ghi:

```text
Sales: 4986
```

Nên ghi:

```text
Estimated sales: ~4.8k
Confidence: 72%
Basis: sold delta + review growth
```

Với data Shopee dạng `10k+`, nên ghi:

```text
Reported sold: 10k+
Estimated 30d sales: ~850
Confidence: 45%
```

## 16. Quyết Định Kỹ Thuật Đề Xuất

- SQLite trước, Postgres sau.
- Migrations bằng file SQL đơn giản.
- Không thêm ORM nặng ở phase đầu.
- Giữ extension làm collector chính.
- Server chỉ điều phối và lưu dữ liệu.
- Dashboard manager dùng vanilla JS hiện tại cho đến khi UI quá lớn.
- Khi dashboard phình to, cân nhắc tách Vite/React.

## 17. Bước Tiếp Theo Nên Làm

Nên bắt đầu bằng Phase 1:

1. Thêm `src/db.js`.
2. Thêm `data/shopeeai.sqlite`.
3. Thêm migrations.
4. Persist jobs.
5. Persist product snapshots khi job complete.
6. Thêm endpoint:

```http
GET /api/tracking/products
GET /api/tracking/products/:productKey/snapshots
GET /api/tracking/products/:productKey/daily
```

Sau đó mới làm dashboard analytics. Nếu chưa có database lịch sử mà làm dashboard trước, giao diện sẽ đẹp nhưng insight còn mỏng.

