# shopeeAI API Docs

Base URL mặc định:

```text
http://127.0.0.1:8787
```

Trừ `/health`, tất cả API cần header:

```http
Authorization: Bearer change-me
Content-Type: application/json
```

Nên dùng nhóm `/api/shopee/extension/*` cho Shopee vì job chạy trong Chrome thật, dùng cookie/session/extension hiện có.

## Health

### GET /health

Kiểm tra server đang chạy.

```bash
curl http://127.0.0.1:8787/health
```

Response:

```json
{ "ok": true }
```

## Product ID

### GET /api/shopee/product-id?url=<product_url>

Tách `shopId`, `itemId`, `productKey`, và canonical URL từ link sản phẩm Shopee.

```bash
curl "http://127.0.0.1:8787/api/shopee/product-id?url=https%3A%2F%2Fshopee.vn%2Fabc-i.233958535.7167929427" \
  -H "authorization: Bearer change-me"
```

Response:

```json
{
  "ok": true,
  "shopId": "233958535",
  "itemId": "7167929427",
  "productKey": "233958535.7167929427",
  "canonicalUrl": "https://shopee.vn/product/233958535/7167929427",
  "resolved": false
}
```

Thêm `resolve=1` nếu link là link rút gọn hoặc redirect.

### POST /api/shopee/product-id

```json
{
  "url": "https://shopee.vn/abc-i.233958535.7167929427",
  "resolve": false
}
```

### POST /api/shopee/product-ids

Parse nhiều link.

```json
{
  "links": [
    "https://shopee.vn/abc-i.233958535.7167929427",
    "https://shopee.vn/product/30674096/25400104317"
  ],
  "resolve": false
}
```

## Extension Jobs

### POST /api/shopee/extension/jobs

Tạo job chạy bằng extension trong Chrome thật.

Body theo loại job:

```json
{
  "type": "product-affiliate",
  "url": "https://shopee.vn/abc-i.233958535.7167929427",
  "subId1": "n8n",
  "subId2": "",
  "targetProfileId": "profile-1"
}
```

Các `type` hỗ trợ:

- `product-info`: lấy thông tin sản phẩm.
- `product-affiliate`: lấy thông tin sản phẩm, hoàn phí/commission, affiliate link.
- `product-links`: lấy link sản phẩm từ keyword, search URL, hoặc category URL.
- `affiliate-links`: chuyển link thường sang affiliate link.

Response:

```json
{
  "ok": true,
  "job": {
    "id": "1",
    "type": "product-affiliate",
    "status": "queued"
  }
}
```

### GET /api/shopee/extension/jobs/created

Xem danh sách job đã tạo.

Query:

- `limit`: mặc định 100, tối đa 500.
- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`.

```bash
curl "http://127.0.0.1:8787/api/shopee/extension/jobs/created?limit=100&status=completed" \
  -H "authorization: Bearer change-me"
```

### GET /api/shopee/extension/jobs/<id>

Xem chi tiết một job và result.

```bash
curl http://127.0.0.1:8787/api/shopee/extension/jobs/1 \
  -H "authorization: Bearer change-me"
```

### POST /api/shopee/extension/jobs/<id>/retry

Chạy lại job.

### POST /api/shopee/extension/jobs/<id>/cancel

Hủy job đang queued/running.

### POST /api/shopee/extension/jobs/clear

Xóa job theo trạng thái.

```json
{ "status": "completed" }
```

## Product Info

### POST /api/shopee/extension/product-info

Shortcut tạo job `product-info`.

```json
{
  "url": "https://shopee.vn/abc-i.233958535.7167929427",
  "targetProfileId": "profile-1"
}
```

Result thường gồm:

- `name`
- `description`
- `salePrice`
- `originalPrice`
- `discount`
- `sold`
- `shop`
- `rating`
- `totalRatings`
- `reviews`
- `images`
- `videos`
- `shopId`
- `itemId`

### POST /api/shopee/extension/product-links

Lấy danh sách link sản phẩm từ keyword, search URL, hoặc category URL.

Theo keyword:

```json
{
  "keyword": "ốp lưng iphone",
  "limit": 100,
  "maxPages": 5
}
```

Theo URL:

```json
{
  "url": "https://shopee.vn/search?keyword=ốp%20lưng%20iphone",
  "limit": 100,
  "maxPages": 5
}
```

## Affiliate

### POST /api/shopee/extension/affiliate-links

Chuyển tối đa 5 link thường sang affiliate link.

```json
{
  "links": [
    "https://shopee.vn/product/233958535/7167929427"
  ],
  "subId1": "n8n",
  "subId2": "",
  "subId3": "",
  "subId4": "",
  "subId5": ""
}
```

### POST /api/shopee/extension/affiliate-links/batch

Chuyển nhiều hơn 5 link. Server tự chia thành nhiều job, mỗi job tối đa 5 link.

```json
{
  "links": [
    "https://shopee.vn/product/233958535/7167929427",
    "https://shopee.vn/product/30674096/25400104317"
  ],
  "subId1": "n8n"
}
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "jobs": [
    { "id": "7", "type": "affiliate-links", "status": "queued" }
  ]
}
```

### POST /api/shopee/extension/product-affiliate

Lấy thông tin sản phẩm, mức hoàn phí/commission, và affiliate link.

```json
{
  "url": "https://shopee.vn/abc-i.233958535.7167929427",
  "subId1": "n8n"
}
```

## Browser Product Data

### POST /api/shopee/browser-product-data

Endpoint để extension gửi dữ liệu sản phẩm hiện tại về server.

### GET /api/shopee/browser-product-data/latest

Lấy dữ liệu sản phẩm mới nhất extension đã gửi.

## Profiles

### GET /api/shopee/extension/profiles

Xem các Chrome profile/extension đang online.

### POST /api/shopee/extension/profiles/heartbeat

Heartbeat của extension. Thường không cần gọi thủ công.

## Legacy Playwright Endpoints

Các endpoint này dùng browser Playwright local, có thể bị Shopee chặn/captcha hơn extension.

### POST /api/shopee/affiliate-links

Chuyển tối đa 5 link thường sang affiliate link.

### POST /api/shopee/product-info

Lấy thông tin sản phẩm trực tiếp.

### POST /api/shopee/product-info/batch

Lấy thông tin nhiều sản phẩm trực tiếp.

### POST /api/shopee/product-data

Lấy thông tin sản phẩm và review.

### POST /api/shopee/product-affiliate

Lấy thông tin sản phẩm và affiliate link qua Playwright.

## Flow Khuyến Nghị

1. Parse ID nhanh bằng `/api/shopee/product-id`.
2. Tạo job bằng `/api/shopee/extension/product-affiliate`.
3. Poll job bằng `/api/shopee/extension/jobs/<id>`.
4. Lấy `result.productData`, `result.affiliateOffer`, `result.affiliateLink`.
5. Với nhiều sản phẩm, dùng `/api/shopee/extension/product-links`, sau đó đưa link qua `/api/shopee/extension/affiliate-links/batch`.

