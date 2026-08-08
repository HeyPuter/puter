# OnlyOffice bridge

Lets Puter open, edit, and save Word/Excel/PowerPoint-style documents using
a self-hosted [OnlyOffice Document Server](https://github.com/ONLYOFFICE/DocumentServer).

## Why this exists

OnlyOffice's Document Server does the actual document rendering/editing,
but it needs to reach Puter over HTTP to (a) download the file being opened
and (b) upload the edited file back on save — and those two calls are made
*by the Document Server container itself*, not by the user's browser. This
bridge is the small piece in between: it proxies the download, and on save
either overwrites the existing Puter file (via its signed `write_url`) or
creates a new one (via `/batch`, for documents created from a blank
template rather than an existing file).

```
Browser (user)                OnlyOffice Document Server         Puter backend
     |  loads editor.html            |                                |
     |------------------------------>|                                |
     |  (page also loads OnlyOffice's api.js directly from docserver) |
     |                                |--- GET document.url --------->|  (via this bridge's /download)
     |                                |<-- file bytes -----------------|
     |  ... user edits ...            |                                |
     |                                |--- POST callbackUrl --------->|  (this bridge)
     |                                |     (edited file ready)       |
     |                                |                          bridge downloads the
     |                                |                          edited copy from the
     |                                |                          docserver's own cache,
     |                                |                          then writes it into
     |                                |                          Puter (write_url or /batch)
```

Registered in Puter as three apps — `word-processor`, `spreadsheet`,
`presentation` — each pointing at this bridge's `editor.html`, associated
with the relevant file extensions (see the DB migration in
`src/backend/clients/database/migrations/*/*_onlyoffice-apps.*`).

## Running it

```bash
cd integrations/onlyoffice-bridge
npm install   # no real dependencies today, but keeps this future-proof
node server.js
```

Configuration is via environment variables (see `.env.example`) — there's
no bundled `.env` loader, so set these however your process manager does
(systemd `Environment=`, `docker run -e`, a `docker-compose.yml`
`environment:` block, etc.):

| Variable | Meaning |
|---|---|
| `PORT` | Port this bridge listens on. Default `8083`. |
| `DOCSERVER_BROWSER_ORIGIN` | OnlyOffice origin as reached **by the browser** (loads `api.js`, renders the editor). |
| `BRIDGE_CONTAINER_ORIGIN` | This bridge's own origin as reached **by the OnlyOffice container** (for downloads/callbacks). |
| `PUTER_API_ORIGIN` | Puter's API origin as reached **by this bridge process**. |

## Local development (what these values are today)

- OnlyOffice Document Server running via Docker Desktop, JWT disabled, with
  `ALLOW_PRIVATE_IP_ADDRESS=true` (needed so it can reach `host.docker.internal`,
  a private-range address, without tripping its SSRF guard):

  ```bash
  docker run -i -t -d -p 8082:80 --restart=always --name onlyoffice-documentserver \
    --add-host=host.docker.internal:host-gateway \
    -e JWT_ENABLED=false \
    -e ALLOW_PRIVATE_IP_ADDRESS=true \
    -e ALLOW_META_IP_ADDRESS=true \
    onlyoffice/documentserver
  ```
- `DOCSERVER_BROWSER_ORIGIN=http://localhost:8082`
- `BRIDGE_CONTAINER_ORIGIN=http://host.docker.internal:8083`
- `PUTER_API_ORIGIN=http://api.puter.localhost:4100`

## Deploying to the VPS — what changes

1. **Run the Document Server container on the VPS** (same `docker run` as
   above works), but:
   - **Enable JWT** (drop `JWT_ENABLED=false`) and set a real secret via
     `-e JWT_SECRET=<random-string>`. Local testing ran with JWT off for
     simplicity; a public instance must not.
   - Put a real domain in front of it (e.g. `office.yourdomain.com`) via
     your reverse proxy, with HTTPS.
2. **Run this bridge as its own long-lived process** (systemd unit, or a
   small Docker container built from this directory — either works, there's
   no framework lock-in). Point its three env vars at real addresses:
   - `DOCSERVER_BROWSER_ORIGIN=https://office.yourdomain.com`
   - `BRIDGE_CONTAINER_ORIGIN=http://<bridge-container-name-or-internal-ip>:8083`
     (if the bridge and Document Server share a Docker network, use the
     bridge's service/container name — no `host.docker.internal` needed
     outside a Mac/Docker-Desktop dev setup)
   - `PUTER_API_ORIGIN=https://api.yourdomain.com`
3. **Update the three apps' `index_url`** in the `apps` table from
   `http://localhost:8083/editor.html` to wherever this bridge is publicly
   reachable, e.g. `https://docs-bridge.yourdomain.com/editor.html`.
4. **`ALLOW_PRIVATE_IP_ADDRESS`**: only needed if the bridge is reachable
   solely via a private/internal address from the Document Server's
   perspective. If it's reachable via a normal public domain, you can (and
   should) turn this back off.

### Known gap: the `/callback` endpoint doesn't verify JWT yet

With JWT enabled on the Document Server, it signs the save callback it
POSTs to this bridge — but `server.js` doesn't currently check that
signature. In production, anyone who can reach this bridge's `/callback`
endpoint could POST a forged save event. Before exposing this publicly,
add JWT verification (HS256, shared secret) on the incoming callback
request before trusting its body — this is a real gap, not a
nice-to-have.
