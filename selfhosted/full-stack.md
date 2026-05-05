# 3. Full self-hosted stack

`docker-compose.full.yml` brings up Puter **plus every external service it needs** — MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx — wired together. Closest thing to a production deployment you can self-manage on a single host.

## Requirements

- **Docker** with the `compose` plugin.
- A **domain** with DNS access — you need a wildcard record (`*.your-domain.com` → server IP). Puter routes by subdomain (`api.<domain>`, `site.<domain>`, `app.<domain>`).
- Optional: **TLS certs** (or `certbot` to grab them — see Step 4).

## What's running

| Container       | Image                    | Role                                                       |
| --------------- | ------------------------ | ---------------------------------------------------------- |
| `puter-nginx`   | `nginx:1.27-alpine`      | Reverse proxy on 80 (and 443 if TLS); forwards to Puter    |
| `puter`         | `ghcr.io/heyputer/puter` | The app                                                    |
| `puter-mariadb` | `mariadb:11`             | SQL database — schema applied automatically on first boot  |
| `puter-valkey`  | `valkey/valkey:8-alpine` | Redis-compatible cache + rate-limiter                      |
| `puter-dynamo`  | `amazon/dynamodb-local`  | KV store — table auto-created on first boot                |
| `puter-s3`      | `rustfs/rustfs`          | S3-compatible object storage (MinIO drop-in noted in file) |
| `puter-s3-init` | `amazon/aws-cli`         | One-shot — creates the bucket on first boot, then exits    |

Optional services (compose profile `ai`, opt-in):

| Container           | Image           | Role                                                           |
| ------------------- | --------------- | -------------------------------------------------------------- |
| `puter-ollama`      | `ollama/ollama` | Local LLM provider (CPU; GPU passthrough opt-in)               |
| `puter-ollama-init` | `ollama/ollama` | One-shot — pulls the default model (`tinyllama`) on first boot |

State lives under `./puter/data/<service>/`.

---

## Step 1 — Create `.env` and `puter/config/config.json`

> ⚠️ **Run this whole block in one shell session.** It generates secrets once and writes them into both `.env` (read by docker compose) and `config.json` (read by Puter). The two files **must** agree on the MariaDB password and the S3 secret — if they drift, MariaDB initialises with one password and Puter tries to log in with another, and you get `ER_ACCESS_DENIED_ERROR`.

```bash
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 32)
MARIADB_PASSWORD=$(openssl rand -hex 32)
S3_SECRET_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 64)
URL_SIGNATURE_SECRET=$(openssl rand -hex 64)

cat > .env <<EOF
HTTP_PORT=80
# HTTPS_PORT=443     # uncomment after enabling TLS in Step 3

MARIADB_ROOT_PASSWORD=$MARIADB_ROOT_PASSWORD
MARIADB_DATABASE=puter
MARIADB_USER=puter
MARIADB_PASSWORD=$MARIADB_PASSWORD

S3_ACCESS_KEY=puter
S3_SECRET_KEY=$S3_SECRET_KEY
S3_BUCKET=puter-local
EOF

mkdir -p puter/config puter/data puter/tls
cat > puter/config/config.json <<EOF
{
    "domain": "puter.local",
    "protocol": "http",
    "pub_port": 80,
    "env": "prod",

    "static_hosting_domain": "puter.sitelocal",
    "static_hosting_domain_alt": "puter.hostlocal",
    "private_app_hosting_domain": "puter.applocal",
    "private_app_hosting_domain_alt": "puter.devlocal",

    "jwt_secret": "$JWT_SECRET",
    "url_signature_secret": "$URL_SIGNATURE_SECRET",

    "database": {
        "engine": "mysql",
        "host": "mariadb",
        "port": 3306,
        "user": "puter",
        "password": "$MARIADB_PASSWORD",
        "database": "puter",
        "migrationPaths": ["/opt/puter/dist/src/backend/clients/database/migrations/mysql"]
    },

    "redis": {
        "startupNodes": [{ "host": "valkey", "port": 6379 }],
        "tls": false
    },

    "dynamo": {
        "endpoint": "http://dynamo:8000",
        "bootstrapTables": true,
        "aws": {
            "access_key": "fake",
            "secret_key": "fake",
            "region": "us-east-1"
        }
    },

    "s3": {
        "s3Config": {
            "endpoint": "http://s3:9000",
            "publicEndpoint": "http://s3.puter.local",
            "accessKeyId": "puter",
            "secretAccessKey": "$S3_SECRET_KEY",
            "region": "us-east-1",
            "forcePathStyle": true
        }
    },
    "s3_bucket": "puter-local",
    "s3_region": "us-east-1",

    "providers": {
        "ollama": { "enabled": false }
    }
}
EOF
```

Replace `puter.local`, `puter.sitelocal`, `puter.hostlocal`, `puter.applocal` and `puter.devlocal` with your actual domain (or leave it for a localhost-only trial).

Why these knobs:

- `env: "prod"` — the bundled `config.default.json` ships with `env: "dev"` (matches the source-tree `npm run start=gui` workflow, which expects webpack-dev-server emitting a CSS manifest). Self-host runs against pre-built static bundles, so `env: "prod"` makes the homepage emit the `/dist/bundle.min.css` `<link>` tag instead of waiting on a manifest that doesn't exist.
- `database.migrationPaths` — Puter applies the bundled MySQL schema on boot. `mysql_mig_1.sql` (tables) and `mysql_mig_2.sql` (default apps: editor, viewer, pdf, camera, player, recorder, git, dev-center, puter-linux). Idempotent — safe to re-run.
- `dynamo.bootstrapTables: true` — Puter creates its KV table on boot. **Only set against a local emulator**, never real AWS.
- `dynamo.aws` keys are dummies; DynamoDB-local doesn't validate them but the AWS SDK requires _something_. **Note:** DynamoDB uses `access_key` / `secret_key` (snake_case); S3 below uses `accessKeyId` / `secretAccessKey` (camelCase). Not interchangeable.
- `providers.ollama.enabled: false` — Puter auto-probes a local Ollama at `127.0.0.1:11434` by default; without one running you'd see `ECONNREFUSED` on every boot. To run a bundled Ollama, see [Optional: local LLM (Ollama)](#optional-local-llm-ollama) below.
- `s3.s3Config.forcePathStyle: true` — RustFS / MinIO / fauxqs need path-style URLs (`<endpoint>/<bucket>`). Real AWS S3 wants virtual-hosted (`<bucket>.<endpoint>`) — drop this flag (or set `false`) when you swap to real S3.
- `s3.s3Config.publicEndpoint` — `endpoint` (`http://s3:9000`) only resolves inside the docker network; presigned upload/download URLs handed to the browser need a host-reachable URL. nginx routes the `s3.<domain>` subdomain to RustFS internally and preserves the Host header end-to-end (required for S3 signature validation), so the browser hits the same port/protocol as the rest of the app — no separate published port, no mixed-content surprises when you turn on TLS. Switch to `https://s3.<your-domain>` once you enable TLS in Step 3. Real AWS S3 doesn't need this — its endpoint is already public; drop the field entirely.

> If you ever change `MARIADB_PASSWORD` after first boot, `.env` alone won't update MariaDB — its credentials are baked into `./puter/data/mariadb/` on first init. Either rotate the password inside MariaDB by hand or `docker compose down && rm -rf ./puter/data/mariadb` to start fresh.

## Step 2 — Point DNS at the server \[Optional\]

In your DNS provider, add records for the main domain plus the subdomains Puter and nginx route on (`api.*`, `site.*`, `app.*`, `s3.*`):

```
A      puter.local         → <your server's public IP>
A      *.puter.local       → <your server's public IP>
A      puter.sitelocal     → <your server's public IP>
A      *.puter.sitelocal   → <your server's public IP>
A      puter.hostlocal     → <your server's public IP>
A      *.puter.hostlocal   → <your server's public IP>
A      puter.applocal      → <your server's public IP>
A      *.puter.applocal    → <your server's public IP>
A      puter.devlocal      → <your server's public IP>
A      *.puter.devlocal    → <your server's public IP>
```

The wildcards are required — Puter routes via subdomains (`api.*`, `app.*`, etc.) and nginx routes browser S3 traffic via `s3.*` to RustFS.

For local-only testing, add this, and any specific subdomains, your hosts file (`/etc/hosts` on macOS/Linux, `C:\Windows\System32\drivers\etc\hosts` on Windows):

```
127.0.0.1 puter.local s3.puter.local api.puter.local
```

## Step 3 — TLS (recommended for public installs) \[Optional\]

Skip this for a quick local demo. Don't skip it for users typing passwords.

**Get a wildcard cert.** Easiest path with Let's Encrypt + DNS-01 (works for wildcards):

```bash
sudo certbot certonly --manual --preferred-challenges dns \
    -d puter.local -d "*.puter.local" \
    -d puter.sitelocal -d "*.puter.sitelocal" \
    -d puter.hostlocal -d "*.puter.hostlocal" \
    -d puter.applocal -d "*.puter.applocal" \
    -d puter.devlocal -d "*.puter.devlocal"
```

The cert needs to cover `*.puter.local` so that `s3.puter.local` (browser S3 endpoint), plus Puter's own `api.*` / `app.*` subdomains, all validate.

Drop the resulting `fullchain.pem` and `privkey.pem` into `./puter/tls/`.

**Wire nginx to use them:**

1. Open [nginx/nginx.conf](../nginx/nginx.conf), uncomment **both** `# server { listen 443 ssl … }` blocks (one for `s3.*`, one for the catch-all).
2. (Optional) Replace the body of the port-80 blocks with `return 301 https://$host$request_uri;` to force HTTPS everywhere.
3. In [docker-compose.full.yml](../docker-compose.full.yml), uncomment the `443:443` port mapping under the `nginx` service.
4. In `.env`, uncomment `HTTPS_PORT=443`.
5. In `config.json`, switch:
    ```json
    { "protocol": "https", "pub_port": 443 }
    ```
    …and update the S3 public endpoint:
    ```json
    "s3": { "s3Config": { "publicEndpoint": "https://s3.puter.local", ... } }
    ```

## Step 4 — Bring it up

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
[mysql] running migrations from /opt/puter/dist/src/backend/clients/database/migrations/mysql: 2 file(s)
[mysql] applied mysql_mig_1.sql (...)
[mysql] applied mysql_mig_2.sql (9 statements)
```

Then open **<https://puter.local>** (or `http://` if you skipped TLS). Login is `admin` — the temp password is printed once in the puter container logs on first boot:

```bash
docker compose -f docker-compose.full.yml logs puter | grep tmp_password
```

Change it in Settings after first login.

## Optional: local LLM (Ollama)

The `ollama` and `ollama-init` services live behind a compose profile so they don't run unless you ask for them. By default, `puter/config/config.json` has `"ollama": { "enabled": false }` — Puter skips the auto-probe entirely. To run a local model:

1. Flip the config:
    ```json
    "providers": {
        "ollama": { "apiBaseUrl": "http://ollama:11434" }
    }
    ```
2. (Optional) Pick a model in `.env`:
    ```bash
    OLLAMA_DEFAULT_MODEL=tinyllama   # default — 1.1B, ~640 MB on disk, ~700 MB RAM
    # Other tiny picks: qwen2.5:0.5b, llama3.2:1b
    # Larger / better: phi3.5, llama3.2, mistral
    ```
3. Bring up with the `ai` profile:
    ```bash
    docker compose -f docker-compose.full.yml --profile ai up -d
    docker compose -f docker-compose.full.yml logs -f ollama-init
    ```
    `ollama-init` exits 0 once the model is pulled. Subsequent boots find the model already on disk and the pull is a fast no-op.

Without `--profile ai`, the `ollama` containers stay down and Puter (with `enabled: false`) doesn't try to reach them — the rest of the stack runs identically.

For GPU acceleration (NVIDIA), uncomment the `deploy:` block under the `ollama` service in [docker-compose.full.yml](../docker-compose.full.yml). Requires `nvidia-container-toolkit` on the host.

## Building from source instead of pulling

If you want to test local Dockerfile changes against the full stack, uncomment the `build:` block in [docker-compose.full.yml](../docker-compose.full.yml) under the `puter` service, change `pull_policy: always` → `pull_policy: never`, then:

```bash
docker compose -f docker-compose.full.yml up -d --build
```

---

## Re-starting backend

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

Migrations re-apply idempotently across pulls. Volumes are preserved.

## Troubleshooting

**Site loads but I get "Bad Gateway" / nginx errors.**
The puter container failed to come up. `docker compose -f docker-compose.full.yml logs puter` will tell you which dependency rejected it (most often DB password mismatch between `.env` and `config.json`).

**Login screen says "admin password not set".**
First-boot temp password is logged once. Find it: `docker compose -f docker-compose.full.yml logs puter | grep "tmp_password"`. After login, change it in Settings.

**Healthcheck reports unhealthy but the site works.**
The healthcheck hits `puter.localhost:4100/test` from inside the container. If you changed `domain` or `port`, the check still uses defaults. The site itself is fine.

**Nothing resolves at `puter.example.com` after DNS changes.**
DNS propagates slowly. `dig puter.example.com` and `dig api.puter.example.com` should both return your server IP. If not, give it 5–60 minutes.

**`docker compose up` hangs at "waiting for service to be healthy".**
`docker compose -f docker-compose.full.yml ps` shows which container is unhealthy. MariaDB takes ~20–30s on a cold boot; everything else under 5s. If something stays unhealthy, `logs <service>` will tell you why.

**`Error: DynamoDB aws config requires both access_key and secret_key`.**
You wrote `accessKeyId` / `secretAccessKey` under `dynamo.aws`. That config block uses snake_case (`access_key` / `secret_key`). Only the `s3.s3Config` block uses camelCase.
