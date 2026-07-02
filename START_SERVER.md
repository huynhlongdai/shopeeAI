# Start shopeeAI API

## Quick start

From this folder:

```bash
./start-server.sh
```

The script will:

- load `.env`
- install dependencies if `node_modules` is missing
- check whether `PORT` is already in use
- ask before stopping the old process
- start the API with `npm start`

Default URL:

```text
http://127.0.0.1:8787
```

Admin UI:

```text
http://127.0.0.1:8787/admin/
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Manual commands

Start server:

```bash
npm start
```

Find process using port 8787:

```bash
lsof -ti tcp:8787
```

Stop process using port 8787:

```bash
lsof -ti tcp:8787 | xargs kill
```

After server restarts, open the server Admin UI and keep the extension configured with:

```text
API Base: http://127.0.0.1:8787
API Token: change-me
```

## MCP server for agents

After the API is running, start the MCP server with:

```bash
npm run mcp
```

See `MCP_SERVER.md` for tool names and client config.

## External server access

To allow another machine to call this API, update `.env`:

```text
HOST=0.0.0.0
API_TOKEN=<use-a-long-random-token>
```

Then start the server and connect with:

```text
http://<server-ip>:8787
```

In every Chrome profile extension popup/options, set:

```text
API Base: http://<server-ip>:8787
API Token: <same token from .env>
Profile ID: profile-1, profile-2, ...
```

Keep the token private. Do not expose this API directly to the public internet without a firewall, VPN, or reverse proxy authentication.
