# shopeeAI AI Agent Runbook

Use this runbook when another AI agent needs to operate shopeeAI without reading the whole codebase.

## Server

Local default:

```text
http://127.0.0.1:8787
```

Current VPS:

```text
http://143.198.205.143:8787
```

Auth for every endpoint except `/health`:

```http
authorization: Bearer <API_TOKEN>
content-type: application/json
```

## Discover The API

Start with the machine-readable manifest:

```bash
curl -s http://143.198.205.143:8787/api/agent/manifest \
  -H 'authorization: Bearer <API_TOKEN>'
```

The manifest returns base URL, auth contract, worker model, recommended flows, endpoint groups, and terminal statuses.

## Worker Model

- Server owns queue, cache, result storage, Admin UI, and API endpoints.
- Chrome extension workers execute jobs in real logged-in browser profiles.
- A product/Facebook job needs at least one online extension profile.

Check workers:

```bash
curl -s http://143.198.205.143:8787/api/shopee/extension/profiles \
  -H 'authorization: Bearer <API_TOKEN>'
```

If no profile is online, ask the user to configure the extension:

```text
API Base: http://143.198.205.143:8787
API Token: <API_TOKEN>
Profile ID: profile-1
Auto-run queue: enabled
```

## Product + Affiliate

Create job:

```bash
curl -s -X POST http://143.198.205.143:8787/api/shopee/extension/product-affiliate \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <API_TOKEN>' \
  -d '{
    "url": "https://shopee.vn/product-name-i.123456.789012",
    "subId1": "agent"
  }'
```

Poll:

```bash
curl -s http://143.198.205.143:8787/api/shopee/extension/jobs/<JOB_ID> \
  -H 'authorization: Bearer <API_TOKEN>'
```

Read:

- `result.productData`
- `result.affiliateOffer`
- `result.affiliateLink`

Terminal statuses:

```text
completed, failed, cancelled
```

## Batch Products

```bash
curl -s -X POST http://143.198.205.143:8787/api/shopee/extension/product-affiliate-batch \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <API_TOKEN>' \
  -d '{
    "links": [
      "https://shopee.vn/product-name-i.123456.789012",
      "https://shopee.vn/product-name-i.123456.789013"
    ],
    "subId1": "agent",
    "mode": "fast",
    "priority": 100
  }'
```

## Search Links

```bash
curl -s -X POST http://143.198.205.143:8787/api/shopee/extension/product-links \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <API_TOKEN>' \
  -d '{
    "keyword": "ốp lưng iphone",
    "limit": 100,
    "maxPages": 5
  }'
```

## Facebook Wrap

Create a Shopee affiliate link first. Then create a Facebook wrap job:

```bash
curl -s -X POST http://143.198.205.143:8787/api/social/facebook/jobs \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <API_TOKEN>' \
  -d '{
    "type": "facebook-publish-post",
    "targetUrl": "https://www.facebook.com/<page-or-profile>",
    "affiliateLink": "https://s.shopee.vn/<id>",
    "caption": "Link mua: https://s.shopee.vn/<id>",
    "publishMode": "auto",
    "wrapMode": true
  }'
```

Poll:

```bash
curl -s http://143.198.205.143:8787/api/social/facebook/jobs/<JOB_ID> \
  -H 'authorization: Bearer <API_TOKEN>'
```

Return link priority:

1. `result.outputLink`
2. `result.primaryLink`
3. `result.facebookWrappedShopeeLink`
4. `result.facebookTrackedShopeeLink`
5. `result.facebookPostUrl` only as debug/fallback

Use `publishMode: "test"` to verify Facebook composer fill without posting.

## Admin UI

Open:

```text
http://143.198.205.143:8787/admin/
```

Use `Agent Ops` to copy:

- agent handoff prompt
- curl pack
- endpoint checklist
- manifest JSON

## Safety

Never create `publishMode: "auto"` Facebook jobs unless the user explicitly authorizes the Facebook target URL and caption.
