# shopeeAI MCP Server

This project includes a local MCP server for agents that can use MCP tools.

## Requirements

Start the shopeeAI API first:

```bash
./start-server.sh
```

Keep the Chrome extension installed and logged in, because product collection jobs are executed by the real Chrome session.

## Start MCP

```bash
npm run mcp
```

The MCP server uses stdio and talks to:

```text
http://127.0.0.1:8787
```

It loads `API_TOKEN` from `.env`. You can override the API base with:

```bash
SHOPEEAI_API_BASE=http://127.0.0.1:8787 npm run mcp
```

## Example MCP config

Use this shape in an MCP-compatible agent/client:

```json
{
  "mcpServers": {
    "shopeeAI": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/Users/longx/Documents/Codex/2026-05-10/hi"
    }
  }
}
```

## Tools

- `shopeeai_health`
- `shopeeai_create_product_info_job`
- `shopeeai_create_product_affiliate_job`
- `shopeeai_create_product_links_job`
- `shopeeai_create_affiliate_links_job`
- `shopeeai_list_jobs`
- `shopeeai_list_profiles`
- `shopeeai_get_job`
- `shopeeai_retry_job`
- `shopeeai_cancel_job`
- `shopeeai_latest_product_data`

Typical flow:

1. Call `shopeeai_create_product_affiliate_job` with a Shopee product URL.
2. Wait for the Chrome extension to process the queue.
3. Call `shopeeai_get_job` with the returned job id.
