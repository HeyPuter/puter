# Puter MCP Connector (Cloudflare Workers)

An [MCP](https://modelcontextprotocol.io) server that runs on Cloudflare Workers
and lets **anyone use their own Puter auth token** to drive their Puter account's
filesystem and subdomains from an MCP client (Claude, Cursor, etc.).

The Worker stores **no credentials of its own**. Every request runs as the
caller, authenticated either by a `Authorization: Bearer <token>` header or by an
OAuth "Sign in with Puter" flow the Worker hosts itself (see
[Authentication](#authentication)).

## Tools

### Filesystem
| Tool | Description |
| --- | --- |
| `fs_read_file` | Read a file (UTF-8 or base64; optional offset/length). |
| `fs_stat` | Stat a file or directory (size, type, timestamps, uid). |
| `fs_write_file` | Create/overwrite a file (UTF-8 or base64 content). |
| `fs_mkdir` | Create a directory (optionally creating missing parents). |
| `fs_delete` | Delete a file or directory (recursive by default). |
| `fs_readdir` | List the entries of a directory. |

### Subdomains
| Tool | Description |
| --- | --- |
| `subdomains_list` | List the caller's subdomains. |
| `subdomains_get` | Get a subdomain by name. |
| `subdomains_create` | Create a subdomain (optionally pointing at a `root_dir`). |
| `subdomains_update` | Update a subdomain's `root_dir`. |
| `subdomains_delete` | Delete a subdomain. |

### Paths
Tools pass paths straight to puter.js, so the usual conventions apply: absolute
(`/your-username/Desktop/file.txt`), home-relative (`~/Desktop/file.txt`), or
relative (`Desktop/file.txt`, resolved against your home directory).

## How it works

This is a **fork of [`src/worker`](../worker)** — Puter's port of puter.js to a
Cloudflare Worker runtime — with two changes:

1. **No `me.puter`.** The original worker creates a worker-owned puter instance
   from `globalThis.puter_auth`. That's removed: this connector holds no
   credentials of its own.
2. **`user.puter` from the `Authorization` header.** The per-request puter
   instance is built from `Authorization: Bearer <token>` instead of the
   original `puter-auth` header.

Because it's the real port, the tools call genuine `puter.fs.*` and
`puter.hosting.*` methods on a real puter.js instance (created via
`init_puter_portable(token, origin, 'userPuter')`, which runs puter.js inside an
isolated `with` context so concurrent requests don't share auth/cache state).

The MCP transport is **Streamable HTTP**: a single endpoint accepting JSON-RPC
2.0 over `POST` (single message or batch array). The server is stateless. The
MCP layer ([`src/mcp.js`](src/mcp.js)) is a small hand-rolled JSON-RPC dispatcher
registered onto the forked router as routes.

### Build pipeline (same as `src/worker`)

`npm run build` does two steps:

1. **webpack** bundles [`src/index.js`](src/index.js) (the router +
   [`src/mcp.js`](src/mcp.js) + [`src/tools.js`](src/tools.js)) into
   `dist/webpackPreamplePart.js`.
2. **`scripts/buildPreamble.mjs`** inlines `#include`s in
   [`template/puter-portable.template`](template/puter-portable.template) —
   pulling in `../puter-js/dist/puter.js` and the webpack bundle — to produce
   `dist/workerPreamble.js`, the deployable **service-worker-format** script.

> Requires `src/puter-js/dist/puter.js` to exist. Build puter.js first if needed
> (`cd ../puter-js && npm run build`).

## Files

| Path | Role |
| --- | --- |
| [`src/s2w-router.js`](src/s2w-router.js) | Forked router: builds `event.user.puter` from the bearer token (no `me.puter`). |
| [`src/index.js`](src/index.js) | Entry: `initS2w()` + registers MCP and OAuth routes. |
| [`src/mcp.js`](src/mcp.js) | MCP JSON-RPC dispatch; 401 + `WWW-Authenticate` when unauthenticated. |
| [`src/oauth.js`](src/oauth.js) | OAuth bridge: discovery, `/register`, `/authorize`→authme, `/oauth/callback`, `/token`. |
| [`src/tools.js`](src/tools.js) | The 12 tools, calling real `puter.fs.*` / `puter.hosting.*`. |
| [`template/puter-portable.template`](template/puter-portable.template) | Preamble template (defines `init_puter_portable`, inlines puter.js). |

## Running locally

```bash
cd src/mcp-connector
npm install
npm run dev        # builds, then wrangler dev — serves on http://localhost:8787
```

## Deploying

```bash
npm run deploy     # builds, then wrangler deploy
```

To target a self-hosted Puter instance, set `puter_endpoint` / `puter_gui_origin`
(uncomment the `[vars]` block in `wrangler.toml`). They default to
`https://api.puter.com` and `https://puter.com`.

If you use the OAuth flow (below), also set the sealing secret in production:

```bash
wrangler secret put OAUTH_SECRET
```

## Authentication

Two ways, both running as the caller — the Worker holds no credentials of its own:

1. **OAuth "Sign in with Puter"** (no token to copy). For clients that support
   OAuth over HTTP (e.g. Claude Code), the Worker *is* the authorization server:
   on first use the client opens a browser, you sign into Puter and approve, and
   the Worker hands the client your Puter token. See
   [`src/oauth.js`](src/oauth.js). Under the hood it redirects to Puter's
   `?action=authme` page and catches the returned token on its `/oauth/callback`;
   the short-lived flow/code blobs are AES-GCM sealed with `OAUTH_SECRET`, so the
   Worker stays stateless.
2. **Bearer token** (copy/paste). Get it from a logged-in Puter browser tab's
   devtools console: `puter.authToken`. Treat it like a password. Pass it as an
   `Authorization: Bearer <token>` header (or the `.mcpb` token field).

## Connecting a client

### Option A — Claude Code (OAuth, no token)

```bash
claude mcp add --transport http puter https://puter-mcp.<your-subdomain>.workers.dev/
```

On first use Claude Code opens a browser to sign in with Puter; approve, and it's
connected. (If you'd rather skip OAuth, add `-H "Authorization: Bearer YOUR_PUTER_TOKEN"`.)

### Option B — one-click `.mcpb` bundle (Claude Desktop etc.)

[`puter-mcp-connector.mcpb`](puter-mcp-connector.mcpb) is a prebuilt [MCP
Bundle](https://github.com/anthropics/mcpb). Import it into a host that supports
MCPB (e.g. Claude Desktop: Settings → Extensions → install from file), then fill
in the two config fields it prompts for:

- **Server URL** — your deployed Worker, e.g. `https://puter-mcp.<your-subdomain>.workers.dev/`
  (or `http://127.0.0.1:8799/` for local `wrangler dev`).
- **Puter Auth Token** — your personal token (stored as a secret).

Because the connector is a *remote* HTTP Worker but MCPB extensions run a *local*
process, the bundle ships a tiny zero-dependency Node stdio↔HTTP proxy
([`mcpb/server/index.cjs`](mcpb/server/index.cjs)) that forwards JSON-RPC to your
Worker with the token attached as `Authorization: Bearer`.

Rebuild the bundle after changing the proxy or manifest:

```bash
npm run pack:mcpb     # -> puter-mcp-connector.mcpb
```

The `.mcpb` is unsigned; hosts may warn it's from an unknown developer. To
self-sign: `npx @anthropic-ai/mcpb sign --self-signed puter-mcp-connector.mcpb`.

### Option C — direct HTTP

Point any MCP client that supports HTTP transport at the Worker URL and add your
token as a bearer header. Example (`mcp.json`-style):

```json
{
  "mcpServers": {
    "puter": {
      "url": "https://puter-mcp.<your-subdomain>.workers.dev/",
      "headers": { "Authorization": "Bearer YOUR_PUTER_TOKEN" }
    }
  }
}
```

## Quick smoke test with curl

```bash
URL=http://localhost:8787
TOKEN=your_puter_token

# initialize
curl -s $URL -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}
}'

# list tools
curl -s $URL -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# stat your home directory
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"fs_stat","arguments":{"path":"~"}}
}'

# write then read a file
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":4,"method":"tools/call",
  "params":{"name":"fs_write_file","arguments":{"path":"~/Desktop/hello.txt","content":"hi from MCP"}}
}'

# list subdomains
curl -s $URL -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"subdomains_list","arguments":{}}}'
```
