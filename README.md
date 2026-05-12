# shopeeAI

Local API tạo Shopee Affiliate Custom Link khi bạn không có Shopee Open API key.

Luồng này dùng profile trình duyệt riêng để đăng nhập Shopee Affiliate một lần, sau đó n8n gọi API local.

Agent hỗ trợ MCP có thể dùng `npm run mcp` sau khi API đã chạy. Xem `MCP_SERVER.md`.

Tài liệu API đầy đủ nằm ở `API_DOCS.md`. Trong extension manager cũng có menu `API docs` để xem nhanh endpoint, body mẫu, và flow khuyến nghị.

Ý tưởng mở rộng thành hệ thống analytics kiểu "Shopdora mini" được phân tích trong `SHOPEEAI_ANALYTICS_BLUEPRINT.md`.

Luồng đăng link affiliate lên Facebook và trả về Embedded Post được phân tích trong `FACEBOOK_PUBLISHER_BLUEPRINT.md`.

MVP extension Facebook Publisher nằm ở `extension/facebook-publisher`. Cài bằng Chrome `Load unpacked`, cấu hình API base/token/target URL trong popup, rồi bấm `Poll now` hoặc bật auto-run queue.

## Cài đặt

```bash
npm install
cp .env.example .env
```

Sửa `API_TOKEN` trong `.env`.

Mặc định server dùng Chrome đã cài trên máy (`SHOPEE_BROWSER_CHANNEL=chrome`), nên thường không cần tải Chromium riêng. Nếu máy bạn không có Chrome hoặc muốn dùng Chromium của Playwright thì chạy thêm:

```bash
npm run install:browsers
```

## Đăng nhập Shopee

```bash
npm run login
```

Chrome/Chromium sẽ mở `https://affiliate.shopee.vn/offer/custom_link`. Đăng nhập xong, dừng lệnh bằng `Ctrl+C`.

## Chạy API

```bash
npm start
```

Health check:

```bash
curl http://localhost:8787/health
```

Tạo link:

```bash
curl -X POST http://localhost:8787/api/shopee/affiliate-links \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "links": ["https://shopee.vn/"],
    "subIds": ["n8n", "facebook"]
  }'
```

Response:

```json
{
  "ok": true,
  "strategy": "graphql",
  "links": [
    {
      "originalLink": "https://shopee.vn/",
      "shortLink": "https://s.shopee.vn/..."
    }
  ]
}
```

## n8n

Dùng node HTTP Request:

- Method: `POST`
- URL: `http://localhost:8787/api/shopee/affiliate-links`
- Headers:
  - `content-type: application/json`
  - `authorization: Bearer <API_TOKEN trong .env>`
- Body JSON:

```json
{
  "links": ["{{$json.product_url}}"],
  "subId1": "n8n"
}
```

Shopee Custom Link chỉ nhận tối đa 5 link/lần và Sub ID chỉ gồm chữ/số, tối đa 50 ký tự.

## Lấy thông tin sản phẩm và hoa hồng

Một sản phẩm:

```bash
curl -X POST http://localhost:8787/api/shopee/product-info \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012"
  }'
```

Nhiều sản phẩm:

```bash
curl -X POST http://localhost:8787/api/shopee/product-info/batch \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "urls": [
      "https://shopee.vn/product-name-i.123456.789012"
    ]
  }'
```

Response có:

- `product`: tên, ảnh, giá hiện tại, giá trước giảm, tồn kho, lượt bán, rating.
- `affiliateOffer`: mức hoa hồng và trạng thái offer nếu Shopee Affiliate trả dữ liệu cho sản phẩm đó.

Với link rút gọn/mobile, server sẽ mở link trong browser profile để lấy URL đích rồi mới tách `shop_id` và `item_id`.

## Thu thập dữ liệu sản phẩm đầy đủ

Khuyến nghị dùng extension ở `extension/shopee-collector` để thu thập từ Chrome thật của bạn. Cách này tránh việc server tự mở profile Playwright mới và bị Shopee chặn/captcha.

### Cài extension

1. Mở `chrome://extensions`.
2. Bật Developer mode.
3. Chọn Load unpacked.
4. Chọn thư mục `extension/shopee-collector`.
5. Trong popup extension, giữ:
   - API Base: `http://127.0.0.1:8787`
   - API Token: token trong `.env`, mặc định `change-me`

Popup extension có nút `Open manager`. Trang manager cho phép cấu hình API, tạo job, chạy queue, retry/cancel/clear job, xem kết quả JSON, copy kết quả, copy link sản phẩm, copy affiliate link và tải ảnh/video. Các tab Shopee/Affiliate do job tự mở sẽ tự đóng sau khi job hoàn tất.

### Nhiều Chrome profile

Bạn có thể cài extension trên nhiều Chrome profile/tài khoản Shopee khác nhau.

Trong Manager của từng profile, đặt:

- `Profile ID`: ví dụ `profile-1`, `profile-2`, `shop-account-a`
- `Profile name`: tên dễ nhớ
- `API Base`: có thể là `http://127.0.0.1:8787` hoặc `http://<server-ip>:8787`

Khi tạo job, trường `Target profile` để trống nghĩa là profile online nào cũng có thể nhận job. Nếu nhập `profile-2`, chỉ extension trong profile đó nhận job.

Server có endpoint theo dõi profile:

```bash
curl http://localhost:8787/api/shopee/extension/profiles \
  -H 'authorization: Bearer change-me'
```

### Kết nối server ngoài local

Trong `.env`, đổi:

```text
HOST=0.0.0.0
API_TOKEN=<token-dai-va-kho-doan>
```

Sau đó trên extension Manager đặt `API Base` thành:

```text
http://<server-ip>:8787
```

Không nên public API trực tiếp ra internet nếu chưa có firewall, VPN, hoặc reverse proxy có authentication.

### Tạo job cho extension

```bash
curl -X POST http://localhost:8787/api/shopee/extension/jobs \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012"
  }'
```

Extension sẽ poll job, mở Shopee bằng trình duyệt thật đang đăng nhập, trích dữ liệu, rồi gửi kết quả về server. Xem kết quả theo job id:

```bash
curl http://localhost:8787/api/shopee/extension/jobs/1 \
  -H 'authorization: Bearer change-me'
```

Hoặc lấy sản phẩm mới nhất extension đã gửi:

```bash
curl http://localhost:8787/api/shopee/browser-product-data/latest \
  -H 'authorization: Bearer change-me'
```

Bạn cũng có thể mở sản phẩm Shopee sẵn rồi bấm `Collect current tab` trong popup extension để gửi ngay trang hiện tại vào API.

### Affiliate qua extension

Tạo custom affiliate link bằng phiên Affiliate thật trong Chrome:

```bash
curl -X POST http://localhost:8787/api/shopee/extension/affiliate-links \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "links": ["https://shopee.vn/product-name-i.123456.789012"],
    "subId1": "n8n"
  }'
```

Lấy thông tin sản phẩm + mức hoàn phí/hoa hồng nếu Affiliate trả dữ liệu + affiliate link:

```bash
curl -X POST http://localhost:8787/api/shopee/extension/product-affiliate \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012",
    "subId1": "n8n"
  }'
```

Lấy riêng thông tin sản phẩm bằng extension:

```bash
curl -X POST http://localhost:8787/api/shopee/extension/product-info \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012"
  }'
```

Lấy danh sách link sản phẩm theo từ khóa:

```bash
curl -X POST http://localhost:8787/api/shopee/extension/product-links \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "keyword": "ốp lưng iphone chống sốc",
    "limit": 20
  }'
```

Lấy danh sách link sản phẩm từ URL danh mục/search có sẵn:

```bash
curl -X POST http://localhost:8787/api/shopee/extension/product-links \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "categoryUrl": "https://shopee.vn/Mobile-Gadgets-cat.11036030",
    "limit": 20
  }'
```

Các endpoint extension trả về job. Đọc kết quả bằng:

```bash
curl http://localhost:8787/api/shopee/extension/jobs/<job_id> \
  -H 'authorization: Bearer change-me'
```

### Endpoint legacy

```bash
curl -X POST http://localhost:8787/api/shopee/product-data \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012"
  }'
```

Endpoint này để server tự mở Shopee nên có thể bị Shopee chặn nếu profile Playwright không đủ tin cậy. Response có `product`: tên, mô tả, giá, giá sale, lượt bán, doanh thu ước tính, shop, tổng đánh giá, ảnh và video nếu Shopee trả dữ liệu; và `reviews`: tổng quan, điểm trung bình theo các đánh giá lấy được, snippet bình luận, ảnh/video trong đánh giá nếu có.

## Lấy sản phẩm + affiliate link trong một lần

```bash
curl -X POST http://localhost:8787/api/shopee/product-affiliate \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer change-me' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012",
    "subId1": "n8n"
  }'
```

Response gồm `product`, `affiliateOffer`, và `affiliateLink`. Nếu sản phẩm có trong `Hoa hồng Sản phẩm`, server ưu tiên lấy link từ màn Product Offer; nếu không có offer riêng thì fallback về Custom Link.
