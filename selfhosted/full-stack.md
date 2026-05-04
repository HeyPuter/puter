# 3. Full self-hosted stack

`docker-compose.full.yml` brings up Puter **plus every external service it needs** — MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx — wired together. Closest thing to a production deployment you can self-manage on a single host.

## Requirements

- **Docker** with the `compose` plugin.
- A **domain** with DNS access — you need a wildcard record (`*.your-domain.com` → server IP). Puter routes by subdomain (`api.<domain>`, `site.<domain>`, `app.<domain>`).
- Optional: **TLS certs** (or `certbot` to grab them — see Step 4).

## What's running

| Container       | Image                          | Role                                                      |
| --------------- | ------------------------------ | --------------------------------------------------------- |
| `puter-nginx`   | `nginx:1.27-alpine`            | Reverse proxy on 80 (and 443 if TLS); forwards to Puter   |
| `puter`         | `ghcr.io/heyputer/puter`       | The app                                                   |
| `puter-mariadb` | `mariadb:11`                   | SQL database — schema applied automatically on first boot |
| `puter-valkey`  | `valkey/valkey:8-alpine`       | Redis-compatible cache + rate-limiter                     |
| `puter-dynamo`  | `amazon/dynamodb-local`        | KV store — table auto-created on first boot               |
| `puter-s3`      | `rustfs/rustfs`                | S3-compatible object storage (MinIO drop-in noted in file)|
| `puter-s3-init` | `amazon/aws-cli`               | One-shot — creates the bucket on first boot, then exits   |

State lives under `./puter/data/<service>/`.

---

## Step 1 — Set the secrets (`.env`)

```bash
cp .env.example .env
```

Edit `.env`. Replace every `replace-with-...` value (use `openssl rand -hex 32` per secret):

```bash
MARIADB_ROOT_PASSWORD=<openssl rand -hex 32>
MARIADB_DATABASE=puter
MARIADB_USER=puter
MARIADB_PASSWORD=<openssl rand -hex 32>

S3_ACCESS_KEY=puter
S3_SECRET_KEY=<openssl rand -hex 32>
S3_BUCKET=puter-local

HTTP_PORT=80
# HTTPS_PORT=443     # uncomment after enabling TLS in Step 4
```

## Step 2 — Write `puter/config/config.json`

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
        "aws": { "access_key": "fake", "secret_key": "fake", "region": "us-east-1" }
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

- `database.migrationPaths` — Puter applies the bundled MySQL schema on boot. `mysql_mig_1.sql` (tables) and `mysql_mig_2.sql` (default apps: editor, viewer, pdf, camera, player, recorder, git, dev-center, puter-linux). Idempotent — safe to re-run.
- `dynamo.bootstrapTables: true` — Puter creates its KV table on boot. **Only set against a local emulator**, never real AWS.
- `dynamo.aws` keys are dummies; DynamoDB-local doesn't validate them but the AWS SDK requires *something*. **Note:** DynamoDB uses `access_key` / `secret_key` (snake_case); S3 below uses `accessKeyId` / `secretAccessKey` (camelCase). Not interchangeable.

## Step 3 — Point DNS at the server

In your DNS provider, add **two records**:

```
A      puter.example.com         → <your server's public IP>
A      *.puter.example.com       → <your server's public IP>
```

The wildcard is required — Puter routes via subdomains.

## Step 4 — TLS (recommended for public installs)

Skip this for a quick local demo. Don't skip it for users typing passwords.

**Get a wildcard cert.** Easiest path with Let's Encrypt + DNS-01 (works for wildcards):

```bash
sudo certbot certonly --manual --preferred-challenges dns \
    -d puter.example.com -d "*.puter.example.com"
```

Drop the resulting `fullchain.pem` and `privkey.pem` into `./puter/tls/`.

**Wire nginx to use them:**

1. Open [nginx/nginx.conf](../nginx/nginx.conf), uncomment the entire `# server { listen 443 ssl … }` block.
2. (Optional) Replace the body of the port-80 block with `return 301 https://$host$request_uri;` to force HTTPS.
3. In [docker-compose.full.yml](../docker-compose.full.yml), uncomment the `443:443` port mapping under the `nginx` service.
4. In `.env`, uncomment `HTTPS_PORT=443`.
5. In `config.json`, switch:
   ```json
   { "protocol": "https", "pub_port": 443 }
   ```

## Step 5 — Bring it up

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

Then open **<https://puter.example.com>** (or `http://` if you skipped TLS). Login is `admin` — the temp password is printed once in the puter container logs on first boot:

```bash
docker compose -f docker-compose.full.yml logs puter | grep tmp_password
```

Change it in Settings after first login.

## Building from source instead of pulling

If you want to test local Dockerfile changes against the full stack, uncomment the `build:` block in [docker-compose.full.yml](../docker-compose.full.yml) under the `puter` service, change `pull_policy: always` → `pull_policy: never`, then:

```bash
docker compose -f docker-compose.full.yml up -d --build
```

## Day 2

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
