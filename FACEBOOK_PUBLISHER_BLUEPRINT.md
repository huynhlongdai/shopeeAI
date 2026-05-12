# Facebook Affiliate Publisher Blueprint

Mục tiêu: tách một extension riêng làm nhiệm vụ nhận Shopee affiliate link, tạo/draft bài Facebook trên profile/fanpage đã đăng nhập, sau đó trả về Facebook Embedded Post để user bấm vào bài viết và click link Shopee bên trong bài.

Ý tưởng này tốt hơn việc chỉ trả link affiliate thường vì click đi qua Facebook có thể tạo thêm ngữ cảnh social/referrer như:

```text
content_source=fb
channel_type=fb
content_type=PHOTOS
fb_content_id=...
fbclid=...
```

Các tín hiệu này xuất hiện trong link redirect `l.facebook.com/l.php?u=...` sau khi bài Facebook được đăng công khai.

## 1. Kiến Trúc Tách Extension

Giữ extension hiện tại:

```text
extension/shopee-collector
```

Nhiệm vụ:

- lấy dữ liệu sản phẩm Shopee
- lấy ảnh/video/review
- tạo Shopee affiliate short link
- tạo job/product result

Thêm extension mới:

```text
extension/facebook-publisher
```

Nhiệm vụ:

- nhận affiliate link từ server/local API
- mở Facebook profile/fanpage đã đăng nhập
- tạo draft bài viết
- gắn caption + affiliate link + media
- dừng ở bước chờ user bấm Publish hoặc yêu cầu xác nhận trước khi publish
- sau khi bài đã đăng, lấy post URL
- tạo Facebook Embedded Post URL/HTML
- trả kết quả về server

## 2. Flow Đề Xuất

```text
Product URL
  -> shopee-collector collect product data
  -> shopee-collector create affiliate short link
  -> server create facebook-publish job
  -> facebook-publisher opens target page/profile
  -> facebook-publisher creates post draft
  -> user confirms/publishes
  -> facebook-publisher captures post URL
  -> server returns embedded post
```

## 3. Vì Sao Embedded Post Hợp Lý

Nếu trả trực tiếp:

```text
https://s.shopee.vn/xxxxx
```

thì user click link affiliate thường.

Nếu trả Embedded Post:

```html
<iframe src="https://www.facebook.com/plugins/post.php?href=..."></iframe>
```

user sẽ thấy bài Facebook thật. Khi click link Shopee trong bài, Facebook thường redirect qua:

```text
https://l.facebook.com/l.php?u=https%3A%2F%2Fs.shopee.vn%2Fxxxxx%3Fcontent_source%3Dfb...
```

Điều này giữ ngữ cảnh bài viết/kênh Facebook tốt hơn.

## 4. API Nền Đã Thêm

### POST /api/social/facebook/embed

Nhận Facebook post URL, trả về embed URL và iframe HTML.

Request:

```json
{
  "postUrl": "https://www.facebook.com/page/posts/123",
  "width": 500,
  "showText": true
}
```

Response:

```json
{
  "ok": true,
  "postUrl": "https://www.facebook.com/page/posts/123",
  "embedUrl": "https://www.facebook.com/plugins/post.php?href=...",
  "embedHtml": "<iframe ...></iframe>"
}
```

### POST /api/social/facebook/extract-shopee-links

Tách link Shopee từ text/html/href Facebook. Hỗ trợ cả redirect dạng `l.facebook.com/l.php?u=...`.

Request:

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

## 5. API Nên Thêm Cho Extension Facebook

### POST /api/social/facebook/jobs

Tạo job draft/publish bài Facebook.

```json
{
  "type": "facebook-publish-post",
  "targetUrl": "https://www.facebook.com/Mienguyen.1203",
  "productKey": "252432728.7449427978",
  "affiliateLink": "https://s.shopee.vn/xxxxx",
  "caption": "Tên sản phẩm\nGiá: 599.000đ\nLink mua: https://s.shopee.vn/xxxxx",
  "media": [
    "https://down-vn.img.susercontent.com/file/..."
  ],
  "publishMode": "auto",
  "schedule": {
    "notBefore": "2026-05-12T09:00:00+07:00",
    "cooldownMinutes": 45,
    "jitterMinutes": 10
  }
}
```

`targetUrl` có thể lấy từ:

1. body job
2. setting extension
3. setting server/env

Thứ tự ưu tiên:

```text
job.targetUrl > extension.defaultTargetUrl > server.facebookDefaultTargetUrl
```

`publishMode` hỗ trợ:

- `manual`: chỉ mở Facebook và copy caption/link.
- `draft`: tạo draft, dừng trước nút đăng.
- `confirm`: extension chuẩn bị bài, hỏi xác nhận rồi mới publish.
- `auto`: tự publish nếu job hợp lệ và lịch/rate-limit cho phép.

Với `auto`, hệ thống vẫn phải log lại đầy đủ nội dung, target, thời điểm, media, và post URL sau khi đăng.

### GET /api/social/facebook/jobs/next

Extension Facebook poll job tiếp theo.

### POST /api/social/facebook/jobs/:id/ready

Extension báo đã tạo draft xong, chờ user publish.

```json
{
  "status": "ready_for_user_publish",
  "targetUrl": "https://www.facebook.com/Mienguyen.1203"
}
```

### POST /api/social/facebook/jobs/:id/complete

Extension báo bài đã đăng và trả post URL.

```json
{
  "facebookPostUrl": "https://www.facebook.com/Mienguyen.1203/posts/...",
  "embeddedPost": {
    "embedUrl": "https://www.facebook.com/plugins/post.php?href=...",
    "embedHtml": "<iframe ...></iframe>"
  }
}
```

## 6. Data Model Đề Xuất

### social_channels

```sql
social_channels (
  id integer primary key,
  platform text not null,
  channel_type text not null,
  name text,
  url text not null,
  external_id text,
  status text,
  created_at text not null,
  updated_at text not null
)
```

### social_posts

```sql
social_posts (
  id integer primary key,
  platform text not null,
  channel_id integer,
  product_key text,
  affiliate_link_id integer,
  original_product_url text,
  affiliate_short_link text,
  facebook_post_url text,
  facebook_embed_url text,
  facebook_embed_html text,
  caption text,
  media_json text,
  status text not null,
  created_at text not null,
  published_at text
)
```

Nên thêm các cột phục vụ lịch đăng:

```sql
alter table social_posts add column publish_mode text;
alter table social_posts add column scheduled_at text;
alter table social_posts add column not_before text;
alter table social_posts add column target_url text;
alter table social_posts add column cooldown_group text;
alter table social_posts add column attempt_count integer default 0;
```

### social_link_extractions

```sql
social_link_extractions (
  id integer primary key,
  social_post_id integer,
  source_href text,
  shopee_link text,
  clean_shopee_link text,
  channel_type text,
  content_source text,
  content_type text,
  facebook_content_id text,
  captured_at text not null
)
```

## 7. Extension Facebook Publisher UI

Popup/manager nên có:

- API base/token
- profile ID
- default Facebook target URL
- server-managed target URL fallback
- publish mode:
  - `draft`: tạo bài, user tự bấm đăng
  - `confirm`: hỏi user trước khi extension bấm đăng
  - `auto`: tự đăng theo lịch và giới hạn rate
  - `manual`: chỉ copy caption và mở page
- posting interval:
  - minimum cooldown minutes
  - allowed posting hours
  - max posts per day
  - jitter minutes
- job list
- last published post
- copy embed HTML
- copy embed URL

## 8. Quy Tắc An Toàn

Không nên để extension tự động bấm Publish không kiểm soát. Vì đăng bài là hành động công khai, cần thiết kế theo hướng chống spam, tuân thủ nền tảng, và giữ lịch đăng tự nhiên cho vận hành nội dung.

Mặc định:

```text
publishMode = draft
```

Extension chỉ:

1. mở composer
2. điền caption/link
3. gắn media nếu có
4. dừng lại

User tự kiểm tra và bấm Publish.

Nếu muốn auto-publish:

- phải có setting riêng
- phải có `targetUrl` rõ ràng
- phải có lịch/cooldown rõ ràng
- phải có giới hạn số bài/ngày
- phải tránh đăng trùng caption/link liên tục
- phải log lại nội dung đã đăng
- phải lưu post URL sau khi đăng
- nên có nút tạm dừng khẩn cấp

Không thiết kế hệ thống để né, vượt, hoặc đánh lừa cơ chế phát hiện tự động của Facebook. Các thao tác như refresh/scroll/delay chỉ nên dùng để:

- chờ UI ổn định
- tránh spam request
- giảm lỗi do trang chưa render xong
- tuân thủ nhịp đăng nội dung đã cấu hình

## 8.1 Posting Schedule & Rate Limit

Server/extension nên có cấu hình:

```json
{
  "facebookDefaultTargetUrl": "https://www.facebook.com/Mienguyen.1203",
  "facebookPublishMode": "auto",
  "facebookPosting": {
    "minCooldownMinutes": 45,
    "jitterMinutes": 10,
    "maxPostsPerDay": 12,
    "allowedHours": [
      { "start": "08:00", "end": "11:30" },
      { "start": "13:30", "end": "22:00" }
    ],
    "refreshBeforePost": true,
    "scrollBeforeCompose": true
  }
}
```

Luật đề xuất:

- Không đăng nếu chưa qua `minCooldownMinutes` từ bài trước cùng target.
- Cộng/trừ `jitterMinutes` để lịch không dồn cục.
- Không đăng ngoài `allowedHours`.
- Không vượt `maxPostsPerDay`.
- Nếu Facebook yêu cầu xác minh, CAPTCHA, checkpoint, hoặc login lại, job chuyển sang `blocked_requires_user`.
- Nếu nội dung/media bị lỗi upload, job chuyển sang `failed` và không retry liên tục.

Trạng thái job:

```text
queued
waiting_schedule
opening_target
composing
uploading_media
ready_for_publish
publishing
published
blocked_requires_user
failed
cancelled
```

## 8.2 Auto Publish Algorithm

Pseudo:

```text
load settings
resolve targetUrl
check channel is enabled
check current time in allowedHours
check daily post count
check last published at + cooldown + jitter
open targetUrl
refresh if configured
scroll if configured
open composer
fill caption
attach media
verify preview contains affiliate link
if publishMode == draft:
  stop at composer
if publishMode == confirm:
  wait for user approval
if publishMode == auto:
  click Publish
wait for post URL
create embed
store social_post result
```

## 8.3 Duplicate Control

Trước khi đăng:

- hash caption
- hash affiliate link
- kiểm tra sản phẩm đã đăng trong N giờ chưa
- kiểm tra cùng `targetUrl` đã đăng link đó chưa

Cấu hình:

```json
{
  "duplicateWindowHours": 48,
  "allowSameProductAfterHours": 72
}
```

Nếu trùng:

```text
status = skipped_duplicate
```

## 9. Template Caption

Nên dùng template:

```text
{name}

Giá sale: {salePrice}
Đã bán: {sold}
Đánh giá: {rating}

Link mua: {affiliateLink}
```

Biến hỗ trợ:

- `{name}`
- `{description}`
- `{salePrice}`
- `{originalPrice}`
- `{discount}`
- `{sold}`
- `{rating}`
- `{shopName}`
- `{affiliateLink}`
- `{productKey}`

## 10. Sub ID Strategy

Khi tạo affiliate link cho bài Facebook:

```text
subId1 = fb
subId2 = page/profile
subId3 = channel slug
subId4 = campaign
subId5 = productKey
```

Ví dụ:

```text
fb / fanpage / Mienguyen1203 / may-duoi-chuot / 2524327287449427978
```

## 11. Embedded Post Response Cho User

Khi user cần link/bài để chia sẻ:

```json
{
  "type": "facebook_embedded_post",
  "facebookPostUrl": "https://www.facebook.com/Mienguyen.1203/posts/...",
  "embedUrl": "https://www.facebook.com/plugins/post.php?href=...",
  "embedHtml": "<iframe ...></iframe>",
  "affiliateLink": "https://s.shopee.vn/xxxxx",
  "extractedFacebookShopeeLink": "https://s.shopee.vn/xxxxx?content_source=fb&channel_type=fb"
}
```

Frontend có thể render:

```html
<iframe src="https://www.facebook.com/plugins/post.php?href=ENCODED_POST_URL&show_text=true&width=500"></iframe>
```

## 12. Roadmap Triển Khai

### Phase 1

- Add `/api/social/facebook/embed`.
- Add `/api/social/facebook/extract-shopee-links`.
- Add docs.

### Phase 2

- Scaffold `extension/facebook-publisher`.
- Popup settings.
- Open target Facebook URL.
- Copy caption to clipboard.
- Show a Facebook overlay panel with caption/link actions.

### Phase 3

- Create draft post in composer.
- Fill caption/link.
- Optional media attach.
- Stop before publish.

### Phase 4

- Detect published post URL.
- Extract Shopee link from post DOM.
- Return embedded post.

### Phase 5

- Persist `social_posts`.
- Add dashboard in manager.
- Add analytics by social channel.
