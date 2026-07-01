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

## Facebook Social Publisher

### POST /api/social/facebook/embed

Tạo Facebook Embedded Post URL/HTML từ một Facebook post URL công khai.

```json
{
  "postUrl": "https://www.facebook.com/Mienguyen.1203/posts/...",
  "width": 500,
  "showText": true
}
```

Response:

```json
{
  "ok": true,
  "postUrl": "https://www.facebook.com/Mienguyen.1203/posts/...",
  "embedUrl": "https://www.facebook.com/plugins/post.php?href=...",
  "embedHtml": "<iframe ...></iframe>"
}
```

### POST /api/social/facebook/extract-shopee-links

Tách link Shopee từ nội dung hoặc `href` trong bài Facebook. Endpoint này xử lý được cả redirect dạng `l.facebook.com/l.php?u=...`.

```json
{
  "hrefs": [
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fs.shopee.vn%2Fabc%3Fcontent_source%3Dfb%26channel_type%3Dfb"
  ]
}
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "links": [
    {
      "source": "facebook_redirect",
      "shopeeLink": "https://s.shopee.vn/abc?content_source=fb&channel_type=fb",
      "cleanShopeeLink": "https://s.shopee.vn/abc",
      "channelType": "fb",
      "contentSource": "fb"
    }
  ]
}
```

### POST /api/social/facebook/jobs

Tạo job đăng/draft bài Facebook từ Shopee affiliate link cho extension `facebook-publisher`.

```json
{
  "type": "facebook-publish-post",
  "targetUrl": "https://www.facebook.com/Mienguyen.1203",
  "affiliateLink": "https://s.shopee.vn/xxxxx",
  "caption": "Tên sản phẩm\n\nLink mua: https://s.shopee.vn/xxxxx",
  "media": ["https://down-vn.img.susercontent.com/file/..."],
  "publishMode": "auto",
  "schedule": {
    "notBefore": "2026-05-12T09:00:00+07:00",
    "cooldownMinutes": 45,
    "jitterMinutes": 10
  }
}
```

`targetUrl` có thể lấy từ job, setting extension, hoặc setting server. `publishMode` gồm `manual`, `draft`, `confirm`, `auto`.

Khi `publishMode = auto`, extension Facebook Publisher sẽ mở target Facebook, tìm composer, điền caption/link, bấm Post, rồi cố gắng phát hiện URL bài vừa đăng. Nếu phát hiện được `facebookPostUrl`, job được chuyển sang `published` và server trả `result.embeddedPost`. Nếu Facebook đã nhận click đăng nhưng chưa expose URL bài viết, job chuyển sang `published_pending_url` để tránh trả nhầm embedded của bài cũ.

Facebook-wrap affiliate flow:

```json
{
  "type": "facebook-publish-post",
  "targetUrl": "https://www.facebook.com/Mienguyen.1203",
  "affiliateLink": "https://s.shopee.vn/xxxxx",
  "caption": "Tên sản phẩm\nLink mua: https://s.shopee.vn/xxxxx",
  "publishMode": "auto",
  "wrapMode": true
}
```

Sau khi publish, extension cố lấy các link Shopee xuất hiện trong bài Facebook. Kết quả nằm ở:

- `result.facebookPostUrl`
- `result.facebookWrappedShopeeLink`
- `result.facebookShopeeLinks[]`

Tạo comment job trên danh sách bài viết chỉ định:

```json
{
  "type": "facebook-comment",
  "targetPostUrls": [
    "https://www.facebook.com/Mienguyen.1203/posts/pfbid...",
    "https://www.facebook.com/Mienguyen.1203/posts/pfbid..."
  ],
  "commentMode": "random",
  "commentText": "Link mua: https://s.shopee.vn/xxxxx",
  "publishMode": "auto",
  "schedule": {
    "cooldownMinutes": 45,
    "jitterMinutes": 10
  }
}
```

`facebook-comment` chỉ chọn từ `targetPostUrls` đã cấu hình hoặc `targetPostUrl` cụ thể. Không có crawler tự bình luận vào bài ngoài allowlist.

Auto publish phải đi kèm rate limit:

- cooldown giữa các bài
- khung giờ được phép đăng
- giới hạn số bài/ngày
- kiểm tra trùng affiliate link/caption
- chuyển job sang `blocked_requires_user` nếu Facebook yêu cầu xác minh, CAPTCHA, checkpoint, hoặc login lại

### GET /api/social/facebook/jobs

Liệt kê Facebook publisher jobs.

Query:

- `limit`: mặc định 50, tối đa 200.
- `status`: lọc trạng thái nếu cần.

### GET /api/social/facebook/jobs/next

Endpoint cho extension poll job tiếp theo. Query hỗ trợ `profileId`, `profileName`, và `extensionVersion`.

### GET /api/social/facebook/profiles

Liệt kê các Facebook Publisher profile đã poll server gần nhất, gồm trạng thái và `extensionVersion`.

### POST /api/social/facebook/jobs/:id/ready

Extension báo bài đã được chuẩn bị trên Facebook và sẵn sàng để user publish. Body có thể dùng `status = ready_for_publish` hoặc `published_pending_url`.

### POST /api/social/facebook/jobs/:id/complete

Extension báo bài đã publish và gửi `facebookPostUrl`. Server tự tạo `embeddedPost`.

### POST /api/social/facebook/jobs/:id/fail

Extension báo lỗi hoặc trạng thái cần user xử lý.

### POST /api/social/facebook/jobs/:id/retry

Đưa Facebook job về lại `queued` để retry sau khi reload extension hoặc đổi cấu hình.

## AI Diagnostics / Auto Fix

Module này hỗ trợ extension tự chẩn đoán lỗi thường gặp: server không kết nối, tab Shopee chưa inject content script, panel không hiện, button sản phẩm bị mất, hoặc extension đang chạy version cũ.

### POST /api/ai/diagnostics/report

Extension gửi report diagnostic và nhận lại phân tích `issues/actions`.

Ví dụ:

```bash
curl -X POST http://127.0.0.1:8787/api/ai/diagnostics/report \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "shopeeAI-extension",
    "profileId": "profile-1",
    "extensionVersion": "0.4.0",
    "symptoms": ["buttons_not_visible"],
    "checks": {
      "serverOk": true,
      "shopeeTabs": [
        {
          "ok": true,
          "isProductPage": true,
          "panelExists": false,
          "detailToolButtons": 0,
          "cardToolbars": 0
        }
      ]
    },
    "fixes": []
  }'
```

Response gồm:

- `report.analysis.status`
- `report.analysis.issues`
- `report.analysis.actions`

### GET /api/ai/diagnostics/latest

Lấy report diagnostic mới nhất.

Query:

- `limit`: mặc định 10, tối đa 100.

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

> Từ bản `shopeeAI 0.5.0`, Shopee Collector và Facebook Publisher đã gộp vào một extension duy nhất tại `extension/shopee-collector`. Không cần dùng extension `extension/facebook-publisher` riêng nữa.

1. Parse ID nhanh bằng `/api/shopee/product-id`.
2. Tạo job bằng `/api/shopee/extension/product-affiliate`.
3. Poll job bằng `/api/shopee/extension/jobs/<id>`.
4. Lấy `result.productData`, `result.affiliateOffer`, `result.affiliateLink`.
5. Với nhiều sản phẩm, dùng `/api/shopee/extension/product-links`, sau đó đưa link qua `/api/shopee/extension/affiliate-links/batch`.
