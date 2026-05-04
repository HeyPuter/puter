# Running Puter — fresh-clone walkthrough

You just cloned the repo. Pick one of three modes:

| Mode                                         | What it gives you                                       | What you need                          |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| [**A. Dev**](#a-dev-mode-contributing)       | Local hacking, source-tree, debugger-friendly           | Node 24, a C toolchain                 |
| [**B. Docker (single)**](#b-docker-single-container) | One container; bring your own DB / S3 / etc.    | Docker                                 |
| [**C. All-in-one**](#c-all-in-one-self-host) | Public self-host: nginx + DB + S3 + cache, your domain  | Docker, a domain, optional TLS certs   |

Every section is a copy-paste recipe. Stop reading the moment your mode works.

---

## A. Dev mode (contributing)

You want to hack on Puter. Everything runs in-process on your machine — no databases, no Redis, no external anything.

### Requirements
- **Node 24+** (`nvm install 24` if you don't have it)
- **C toolchain** for native deps:
  - macOS: `xcode-select --install`
  - Debian/Ubuntu: `sudo apt install build-essential python3`

### Setup

```bash
cd packages/puter            # if you cloned the heyputer parent repo
                             # (skip this if you cloned puter directly)
npm install
npm run build                # one-time: compiles backend + GUI + puter.js
npm start                    # daily use: re-builds backend, then starts
```

Open **<http://puter.localhost:4100>**. Sign in as `admin` — the temp password is printed in the boot logs.

### What you get for free
- SQLite at `volatile/runtime/puter-database.sqlite` (auto-created)
- In-process S3 (`fauxqs`) with the `puter-local` bucket auto-created
- In-process DynamoDB (`dynalite`) with its KV table auto-created
- In-process Redis (`ioredis-mock`)

State lives under `./volatile/`. Delete that folder to reset.

### Configuring (optional)

Drop a `config.json` next to `package.json`. Anything you set deep-merges over `config.default.json` — only specify what you want to change:

```json
{ "port": 5101, "domain": "myhost.local" }
```

Restart with `npm start`.

### Daily workflow
- Backend changes → `npm start` re-runs the TS compile (~5–10s) and restarts.
- GUI / puter.js changes → re-run `npm run build` (slower, full webpack).
- Reset state → `rm -rf volatile/` and start over.

> ⚠️ Dev mode is **not safe to expose publicly**. Default JWT secrets are in the source tree.

---

## B. Docker (single container)

You want Puter running in Docker, but you're bringing your own database / S3 / Redis (or you just want to kick the tires with the bundled defaults).

### Requirements
- **Docker** (any version)

### Bare minimum — defaults, single command

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

Open <http://puter.localhost:4100>. With nothing in `puter/config/`, the in-process defaults kick in (same SQLite + dynalite + fauxqs + redis-mock as dev mode), state lands in `puter/data/`.

That's enough to confirm the image works. Now configure for real.

### Add a config

Create `puter/config/config.json` — only put the keys you want to override:

```json
{
    "domain": "puter.example.com",
    "protocol": "https",
    "pub_port": 443,

    "jwt_secret": "REPLACE-WITH-openssl-rand-hex-64",
    "url_signature_secret": "REPLACE-WITH-A-DIFFERENT-openssl-rand-hex-64"
}
```

> 🔒 **Always replace `jwt_secret` and `url_signature_secret`.** The defaults are baked into the public image. Generate with `openssl rand -hex 64`.

Then `docker restart puter` and watch:

```bash
docker logs -f puter
```

You're looking for `[config] override from /etc/puter/config.json` — that's the success signal.

### Wire to external services

Drop the relevant block(s) into your `config.json`. Mix and match.

**MySQL / MariaDB** — Puter applies its schema on first boot when you set `migrationPaths`:

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

**Real S3** (or any S3-compatible endpoint):

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

The bucket must exist already — Puter doesn't create it.

**Real DynamoDB** (table provisioned by you, e.g. via Terraform):

```json
{
    "dynamo": {
        "aws": { "accessKeyId": "...", "secretAccessKey": "...", "region": "us-east-1" }
    }
}
```

The KV table is named `store-kv-v1`. Schema: hash `namespace` (S), range `key` (S), LSI `lsi1-index` on `lsi1` (S), TTL on `ttl`.

**Real Redis cluster:**

```json
{ "redis": { "startupNodes": [{ "host": "redis-0", "port": 6379 }] } }
```

After any config change → `docker restart puter`.

### What persists?

Anything your config points at `/var/puter/...` lives on the host via the `puter/data` mount. If you've moved every dependency to external services (real DB, real S3, real Redis), the data volume is mostly empty and optional.

### Updating

```bash
docker pull ghcr.io/heyputer/puter:latest
docker rm -f puter
# re-run the docker run command above
```

Your `config.json` and persistent data are untouched.

---

## C. All-in-one self-host

You want a public Puter at your own domain. The bundled `docker-compose.full.yml` brings up Puter **plus everything it needs** (MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx) so you don't glue anything together.

### Requirements
- **Docker** with the `compose` plugin
- A **domain** with DNS access — you need a wildcard record (`*.your-domain.com` → server IP)
- Optional: **TLS certs** (or `certbot` to grab them — see below)

### Step 1 — Set the secrets

```bash
cp .env.example .env
```

Edit `.env`. At minimum, replace every `replace-with-...` value. Use `openssl rand -hex 32` for each:

```bash
MARIADB_ROOT_PASSWORD=<openssl rand -hex 32>
MARIADB_DATABASE=puter
MARIADB_USER=puter
MARIADB_PASSWORD=<openssl rand -hex 32>

S3_ACCESS_KEY=puter
S3_SECRET_KEY=<openssl rand -hex 32>
S3_BUCKET=puter-local

HTTP_PORT=80
# HTTPS_PORT=443     # uncomment after enabling TLS (Step 4)
```

### Step 2 — Write `puter/config/config.json`

```bash
mkdir -p puter/config puter/data puter/tls
```

Drop this into `puter/config/config.json`. Replace the `REPLACE-...` markers and make sure the password / secret strings match what you put in `.env`:

```json
{
    "domain": "puter.example.com",
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

Why these knobs:
- `migrationPaths` runs `mysql_mig_1.sql` (schema) and `mysql_mig_2.sql` (default apps: editor, viewer, pdf, camera, player, recorder, git, dev-center, puter-linux). Idempotent — safe to re-run.
- `dynamo.bootstrapTables: true` lets Puter create its KV table on boot. **Only against the local emulator** — never set this with real-AWS creds.
- `dynamo.aws` keys are dummies; DynamoDB-local doesn't validate them but the AWS SDK requires *something*.

### Step 3 — Point DNS at the server

In your DNS provider, add **two records**:

```
A      puter.example.com         → <your server's public IP>
A      *.puter.example.com       → <your server's public IP>
```

The wildcard is required — Puter routes via subdomains (`api.puter.example.com`, `site.puter.example.com`, `app.puter.example.com`).

### Step 4 — TLS (recommended for public installs)

If you skip this, Puter runs over plain HTTP on port 80. Fine for a quick demo; not fine for users typing passwords.

**Get a wildcard cert.** Easiest path with Let's Encrypt + DNS-01 (works for wildcards):

```bash
sudo certbot certonly --manual --preferred-challenges dns \
    -d puter.example.com -d "*.puter.example.com"
```

Drop the resulting `fullchain.pem` and `privkey.pem` into `./puter/tls/`.

**Wire nginx to use them:**
1. Open [nginx/nginx.conf](nginx/nginx.conf), uncomment the entire `# server { listen 443 ssl … }` block.
2. (Optional) Replace the body of the port-80 block with `return 301 https://$host$request_uri;` to force HTTPS.
3. In [docker-compose.full.yml](docker-compose.full.yml), uncomment the `443:443` port mapping under the `nginx` service.
4. In `.env`, uncomment `HTTPS_PORT=443`.
5. In `config.json`, switch:
   ```json
   { "protocol": "https", "pub_port": 443 }
   ```

### Step 5 — Bring it up

```bash
docker compose -f docker-compose.full.yml up -d
```

First boot takes ~30s while MariaDB initialises and Puter applies the schema + default apps. Watch:

```bash
docker compose -f docker-compose.full.yml logs -f puter
```

Healthy startup:
```
[config] override from /etc/puter/config.json
[mysql] running migrations from /opt/puter/src/backend/clients/database/migrations: 2 file(s)
[mysql] applied mysql_mig_1.sql (...)
[mysql] applied mysql_mig_2.sql (9 statements)
```

Then open **<https://puter.example.com>** (or `http://` if you skipped TLS). Login is `admin` — the temp password is printed once in the puter container logs on first boot.

### What's running

| Container       | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `puter-nginx`   | Reverse proxy on 80 (and 443 if TLS), forwards everything to puter      |
| `puter`         | The app                                                                 |
| `puter-mariadb` | SQL database — schema + default apps applied on first boot              |
| `puter-valkey`  | Redis cache + rate limiter                                              |
| `puter-dynamo`  | DynamoDB-local — KV table auto-created                                  |
| `puter-s3`      | RustFS object storage                                                   |
| `puter-s3-init` | One-shot bucket creator; exits 0 once `puter-local` exists              |

State lives under `./puter/data/<service>/`.

### Day 2

```bash
# update
docker compose -f docker-compose.full.yml pull
docker compose -f docker-compose.full.yml up -d

# logs
docker compose -f docker-compose.full.yml logs -f puter

# stop, keep data
docker compose -f docker-compose.full.yml down

# stop, NUKE all state (irreversible)
docker compose -f docker-compose.full.yml down
rm -rf puter/data
```

---

## When things go wrong

**`docker logs puter` shows the container restarting.**
Almost always JSON syntax in `config.json`. Validate: `jq . puter/config/config.json`.

**Site loads but I get "Bad Gateway" / nginx errors.**
The puter container failed to come up. `docker compose -f docker-compose.full.yml logs puter` will tell you which dependency rejected it (most often DB password mismatch between `.env` and `config.json`).

**Login screen says "admin password not set".**
First-boot temp password is logged once. Find it: `docker compose -f docker-compose.full.yml logs puter | grep "tmp_password"`. After login, change it in Settings.

**Healthcheck reports unhealthy but the site works.**
The healthcheck hits `puter.localhost:4100/test` from inside the container. If you changed `domain` or `port`, the check still uses defaults. The site itself is fine.

**Nothing resolves at `puter.example.com` after DNS changes.**
DNS propagates slowly. `dig puter.example.com` and `dig api.puter.example.com` should both return your server IP. If not, give it 5–60 minutes.

**`docker compose up` hangs on "waiting for service to be healthy".**
`docker compose -f docker-compose.full.yml ps` shows which container is unhealthy. MariaDB takes ~20–30s on a cold boot; everything else under 5s. If something stays unhealthy, `logs <service>` will tell you why.
