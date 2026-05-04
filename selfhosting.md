# Self-hosting Puter

There are three supported ways to run Puter, in increasing order of effort and capability:

| Mode                                         | Best for                                    | External services                                                |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| [**1. Dev (npm)**](#1-dev-mode-npm-start)    | Trying it out on your laptop / LAN          | None — everything runs in-process                                |
| [**2. Standalone Docker**](#2-standalone-docker)  | Production single-host, BYO database / S3  | None bundled — point at whatever you already run                 |
| [**3. Full self-hosted stack**](#3-full-self-hosted-stack-docker-compose) | Production with a self-managed stack | Bundled: MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx       |

Pick one, follow that section, ignore the rest. There's also a [troubleshooting](#troubleshooting) section at the bottom.

---

## 1. Dev mode (npm start)

For trying Puter on your laptop or sharing it on your local network. **Not safe to expose to the internet** — uses dev secrets and an in-process key store.

**Requirements:** Node.js 24+, a C toolchain (Xcode CLT on macOS, `build-essential` + `python3` on Debian/Ubuntu) for native deps.

```bash
# from packages/puter/
npm install
npm run build        # one-time — compiles backend, GUI, and puter.js
npm start            # daily use — re-builds backend only, then starts
```

Open <http://puter.localhost:4100> in your browser.

That's it. With no `config.json` present, defaults give you:

- SQLite at `volatile/runtime/puter-database.sqlite` (auto-created)
- In-process S3 (`fauxqs`) with the `puter-local` bucket auto-created
- In-process DynamoDB (`dynalite`) with its table auto-created
- In-process Redis (`ioredis-mock`)

All state goes into `./volatile/`. Delete it to reset.

To override anything (port, domain, etc.), drop a `config.json` next to `package.json`:

```json
{ "port": 5101, "domain": "myhost.local" }
```

It deep-merges over `config.default.json`. Restart with `npm start`.

---

## 2. Standalone Docker

Single Puter container; you bring your own database, S3, etc. (or run with the in-process defaults for a quick spin).

**Requirements:** Docker.

The image is multi-arch (`linux/amd64`, `linux/arm64`).

### Quick start

```bash
mkdir -p puter/config puter/data

docker run -d \
  --name puter \
  --restart unless-stopped \
  -p 4100:4100 \
  -v $(pwd)/puter/config:/etc/puter \
  -v $(pwd)/puter/data:/var/puter \
  ghcr.io/heyputer/puter:latest
```

Open <http://puter.localhost:4100>. With no config mounted, the in-process defaults kick in (same as dev mode), and state lands in `puter/data/`.

### Adding a config

The container reads **`/etc/puter/config.json`** and deep-merges it on top of the bundled defaults. You only put the keys you want to change.

1. Create the file:
   ```bash
   touch ./puter/config/config.json
   ```
2. Add overrides:
   ```json
   {
       "domain": "puter.example.com",
       "protocol": "https",
       "pub_port": 443,
       "jwt_secret": "REPLACE-WITH-openssl-rand-hex-64",
       "url_signature_secret": "REPLACE-WITH-A-DIFFERENT-openssl-rand-hex-64"
   }
   ```
3. Restart: `docker restart puter`.

Confirm it took effect — logs should show:
```
[config] override from /etc/puter/config.json
```

### Wiring to external services

Same `config.json`, just add the relevant blocks. Mix and match.

**MySQL / MariaDB** (with idempotent schema bootstrap):
```json
{
    "database": {
        "engine": "mysql",
        "host": "db.internal", "port": 3306,
        "user": "puter", "password": "...", "database": "puter",
        "migrationPaths": ["/opt/puter/src/backend/clients/database/migrations"]
    }
}
```

**Real S3 / S3-compatible:**
```json
{
    "s3": {
        "s3Config": {
            "endpoint": "https://s3.example.com",
            "accessKeyId": "...", "secretAccessKey": "...",
            "region": "us-east-1"
        }
    },
    "s3_bucket": "my-puter-bucket",
    "s3_region": "us-east-1"
}
```

**Real DynamoDB** (existing tables; provision externally):
```json
{
    "dynamo": {
        "aws": { "accessKeyId": "...", "secretAccessKey": "...", "region": "us-east-1" }
    }
}
```

**Real Redis cluster:**
```json
{ "redis": { "startupNodes": [{ "host": "redis-0", "port": 6379 }] } }
```

**Always replace secrets.** The two below are baked into the public image and known to anyone — change them for any non-toy install:
```json
{ "jwt_secret": "...", "url_signature_secret": "..." }
```
Generate with `openssl rand -hex 64`.

### Persistent data

Anything you point at `/var/puter/...` in your config (e.g. SQLite path, fauxqs data dirs) lives on the host via the `./puter/data` mount. If you're using external services for everything, the data volume is optional.

### Updating

```bash
docker pull ghcr.io/heyputer/puter:latest
docker rm -f puter && <re-run the docker run command above>
```

Your `config.json` and persistent data are untouched.

### Building the image yourself

```bash
docker build -t puter .

# Multi-arch (requires buildx, on by default in modern Docker):
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t your-registry/puter:latest \
    --push .
```

---

## 3. Full self-hosted stack (docker compose)

Brings up Puter **plus every external service it needs**, configured to talk to each other out of the box. Closest thing to a production deployment you can self-manage.

**Requirements:** Docker with the compose plugin.

| Service       | Image                          | Role                                                      |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| `nginx`       | `nginx:1.27-alpine`            | Reverse proxy (mirrors prod ALB; TLS termination point)   |
| `puter`       | `ghcr.io/heyputer/puter`       | The app                                                   |
| `mariadb`     | `mariadb:11`                   | SQL database — schema applied automatically on first boot |
| `valkey`      | `valkey/valkey:8-alpine`       | Redis-compatible cache + rate-limiter                     |
| `dynamo`      | `amazon/dynamodb-local`        | KV store — table auto-created on first boot               |
| `s3`          | `rustfs/rustfs`                | S3-compatible object storage (MinIO drop-in noted in file)|
| `s3-init`     | `amazon/aws-cli`               | One-shot — creates the bucket on first boot, then exits   |

State lives under `./puter/data/<service>/`.

### Setup

1. **Create your `.env`** (secrets for the bundled services):
   ```bash
   cp .env.example .env
   ```
   Open `.env` and replace every `replace-with-...` value. Use `openssl rand -hex 32` for each.

2. **Create your `config.json`** at `./puter/config/config.json` — this wires Puter to the bundled services. Copy this verbatim, then replace the `REPLACE-...` markers (and make sure the password / secret values match your `.env`):

   ```json
   {
       "domain": "puter.localhost",
       "protocol": "http",
       "pub_port": 80,

       "jwt_secret": "REPLACE-WITH-openssl-rand-hex-64",
       "url_signature_secret": "REPLACE-WITH-A-DIFFERENT-openssl-rand-hex-64",

       "database": {
           "engine": "mysql",
           "host": "mariadb", "port": 3306,
           "user": "puter",
           "password": "MUST-MATCH-MARIADB_PASSWORD-IN-DOTENV",
           "database": "puter",
           "migrationPaths": ["/opt/puter/src/backend/clients/database/migrations"]
       },

       "redis": { "startupNodes": [{ "host": "valkey", "port": 6379 }] },

       "dynamo": {
           "endpoint": "http://dynamo:8000",
           "bootstrapTables": true,
           "aws": { "accessKeyId": "fake", "secretAccessKey": "fake", "region": "us-east-1" }
       },

       "s3": {
           "s3Config": {
               "endpoint": "http://s3:9000",
               "accessKeyId": "puter",
               "secretAccessKey": "MUST-MATCH-S3_SECRET_KEY-IN-DOTENV",
               "region": "us-east-1"
           }
       },
       "s3_bucket": "puter-local",
       "s3_region": "us-east-1"
   }
   ```

   Why these matter:
   - `database.migrationPaths` — Puter applies the bundled MySQL schema (idempotent) on boot. Two files run in order: `mysql_mig_1.sql` (tables) and `mysql_mig_2.sql` (default apps — editor, viewer, pdf, camera, player, recorder, git, dev-center, puter-linux). Same defaults as the SQLite path.
   - `dynamo.bootstrapTables: true` — Puter creates its KV table on boot. **Only set against a local emulator**, never real AWS.
   - The `dynamo.aws` keys are dummies; DynamoDB-local doesn't validate them but the AWS SDK requires *something*.

3. **Start it:**
   ```bash
   docker compose -f docker-compose.full.yml up -d
   ```

   First boot takes ~30s while MariaDB initialises and migrations apply. Tail logs:
   ```bash
   docker compose -f docker-compose.full.yml logs -f puter
   ```
   Healthy startup logs:
   ```
   [config] override from /etc/puter/config.json
   [mysql] running migrations from /opt/puter/src/backend/clients/database/migrations: 1 file(s)
   [mysql] applied mysql_mig_1.sql (...)
   ```

4. **Open** <http://puter.localhost> (port 80, behind nginx).

### TLS

The default nginx config listens on port 80. To enable HTTPS:

1. Drop `fullchain.pem` and `privkey.pem` into `./puter/tls/` (use `certbot --standalone` against your domain or copy from a wildcard cert).
2. In [nginx/nginx.conf](nginx/nginx.conf), uncomment the 443 server block. Optionally replace the body of the port-80 server with `return 301 https://$host$request_uri;`.
3. In [docker-compose.full.yml](docker-compose.full.yml), uncomment the `443:443` port mapping under `nginx`.
4. In `config.json`, set:
   ```json
   { "protocol": "https", "pub_port": 443 }
   ```
5. Restart:
   ```bash
   docker compose -f docker-compose.full.yml restart nginx puter
   ```

For wildcard subdomain support (Puter uses `api.<domain>`, `site.<domain>`, `app.<domain>`), make sure your DNS and cert cover `*.<your-domain>`. nginx's `server_name _` already accepts every Host header.

### Updating

```bash
docker compose -f docker-compose.full.yml pull
docker compose -f docker-compose.full.yml up -d
```

Migrations re-apply idempotently. Volumes are preserved.

### Tearing down

```bash
docker compose -f docker-compose.full.yml down       # stop containers, keep data
rm -rf ./puter/data                                  # nuke ALL state (irreversible!)
```

---

## Troubleshooting

**`docker logs puter` shows the container restarting.**
Most often a syntax error in `config.json` or a port already in use. Validate the JSON: `jq . ./puter/config/config.json`.

**The config file isn't picked up.**
Check the path resolves to `/etc/puter/config.json` *inside* the container:
```bash
docker exec puter cat /etc/puter/config.json
```
If that prints nothing, the volume mount is wrong.

**Healthcheck failing but the site loads.**
The healthcheck hits `http://puter.localhost:4100/test` from inside the container. If you changed `domain` or `port` in your config, the healthcheck still uses the defaults and may report unhealthy — the site itself is fine.

**Architecture mismatch on Apple Silicon / ARM hosts.**
Use the published `:latest` tag — it's already multi-arch. If you built locally with `docker build` on an Intel Mac, the resulting image will be `linux/amd64` only.

**`npm start` says missing `dist/`.**
You skipped `npm run build`. The `prestart` hook only rebuilds the backend; the GUI + `puter.js` bundles need the full build once.

**`docker compose -f docker-compose.full.yml up` hangs at "waiting for healthy".**
Check which dependency is unhealthy: `docker compose -f docker-compose.full.yml ps`. MariaDB takes ~20–30s on first boot to initialise; everything else should be ready in under 5s. If something stays unhealthy, `logs <service>` will tell you.
