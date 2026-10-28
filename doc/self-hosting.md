# Self-Hosting Puter

`docker-compose.yml` brings up Puter **plus every external service it needs** — MariaDB, Valkey, DynamoDB-local, RustFS S3, Caddy — wired together. Closest thing to a production deployment you can self-manage on a single host.

## One-line installer (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/install.sh | sh
```

Generates secrets, writes `.env` + `puter/config/config.json`, downloads `docker-compose.yml` + `caddy/Caddyfile` from the OSS repo, and runs `docker compose up -d`. Re-running is safe — it won't overwrite existing config (set `PUTER_FORCE=1` to rotate). Use the manual steps below if you want to inspect or tweak each step yourself.

## Requirements

- **Docker** with the `compose` plugin.
- A **domain** with DNS access — you need a wildcard record (`*.your-domain.com` → server IP). Puter routes by subdomain (`api.<domain>`, `site.<domain>`, `app.<domain>`).
- Optional: **TLS certs** (or `certbot` to grab them — see Step 3).

### Installing Docker on macOS (Apple Silicon / Intel)

The one-line installer requires **Docker Desktop** or **Docker Engine** with the Compose plugin.

#### Option 1: Docker Desktop (recommended for most users)

1. Download Docker Desktop for Mac from [docker.com](https://www.docker.com/products/docker-desktop/)
   - **Apple Silicon (M1/M2/M3/M4)**: Choose "Mac with Apple silicon" (.dmg)
   - **Intel Macs**: Choose "Mac with Intel chip" (.dmg)
2. Open the downloaded `.dmg` and drag Docker.app to Applications
3. Launch Docker Desktop from Applications
4. Complete the initial setup (you may need to grant privileged access)
5. Verify installation:
   ```bash
   docker version
   docker compose version
   ```

#### Option 2: Docker Engine via Homebrew (advanced users)

```bash
# Install Docker Engine + Compose plugin
brew install docker docker-compose

# Start Docker daemon (requires sudo)
sudo /usr/local/bin/docker-machine start  # if using docker-machine
# Or use Colima (lightweight VM for Docker on macOS):
brew install colima
colima start --arch aarch64  # for Apple Silicon
colima start                  # for Intel

# Verify
docker version
docker compose version
```

> **Note for Apple Silicon users**: Docker Desktop runs natively on Apple Silicon (no Rosetta required). The `ghcr.io/heyputer/puter` image is multi-arch (`linux/amd64`, `linux/arm64`), so it will automatically pull the correct variant for your architecture.

> **Tip**: If you encounter "docker compose plugin not found" errors, ensure Docker Desktop is running and the Compose plugin is enabled in Settings → General → "Use Docker Compose V2".

---

## What's running

| Container       | Image                    | Role                                                       |
| --------------- | ------------------------ | ---------------------------------------------------------- |
| `puter-caddy`   | `caddy:2.11-alpine`      | Reverse proxy on 80 (and 443 if TLS); forwards to Puter    |
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

Optional services (compose profile `smtp`, opt-in):

| Container    | Image                    | Role                                                     |
| ------------ | ------------------------ | -------------------------------------------------------- |
| `puter-smtp` | `ghcr.io/heyputer/puter` | Receives mail over SMTP and files it into user mailboxes |

State lives under `./puter/data/<service>/`.

---

## Step 1 — Create `.env` and `puter/config/config.json`

> ⚠️ **Run this whole block in one shell session.** It generates secrets once and writes them into both `.env` (read by docker compose) and `config.json` (read by Puter). The two files **must** agree on the MariaDB password and the S3 secret — if they drift, MariaDB initialises with one password and Puter tries to log in with another, and you get `ER_ACCESS_DENIED_ERROR`.

```bash
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 32)
MARIADB_PASSWORD=$(openssl rand -hex 32)
S3_SECRET_KEY=$(openssl rand -hex 32)
JWT_SECRET_V2=$(openssl rand -hex 64)
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

mkdir -p puter/config puter/data puter/data/caddy puter/tls
cat > puter/config/config.json <<EOF
{
    "domain": "puter.localhost",
    "protocol": "http",
    "pub_port": 80,
    "env": "prod",

    "static_hosting_domain": "site.puter.localhost",
    "static_hosting_domain_alt": "host.puter.localhost",
    "private_app_hosting_domain": "app.puter.localhost",
    "private_app_hosting_domain_alt": "dev.puter.localhost",

    "jwt_secret": "$JWT_SECRET",
    "jwt_secret_v2": "$JWT_SECRET_V2",
    "allow_v1_tokens": true,
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
            "publicEndpoint": "$PUTER_PROTOCOL://s3.$PUTER_DOMAIN",
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
    },

    "meteringEnforcement": {
        "subscriptions": false
    },

    "trust_proxy": $PUTER_TRUST_PROXY
}
EOF

---

## Step 2 — Download `docker-compose.yml` and `caddy/Caddyfile`

```bash
curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/docker-compose.yml -o docker-compose.yml
mkdir -p caddy
curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/caddy/Caddyfile -o caddy/Caddyfile
```

---

## Step 3 — TLS (optional but recommended)

If you have a wildcard TLS cert (`*.your-domain.com`), drop the files into `./puter/tls/`:

```bash
mkdir -p puter/tls
cp /path/to/fullchain.pem puter/tls/
cp /path/to/privkey.pem puter/tls/
```

Then uncomment the HTTPS block in `caddy/Caddyfile` (remove the `#` from the `:443` server block) and uncomment `HTTPS_PORT=443` in `.env`.

If you don't have certs, you can use `certbot`:

```bash
sudo certbot certonly --standalone -d '*.your-domain.com' -d 'your-domain.com'
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem puter/tls/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem puter/tls/
```

Then uncomment the HTTPS block in Caddyfile and `HTTPS_PORT=443` in `.env`.

Restart Caddy to pick up the new config:

```bash
docker compose restart caddy
```

---

## Step 4 — Bring up the stack

```bash
docker compose up -d
```

First boot takes ~30 seconds while MariaDB initialises. Follow logs:

```bash
docker compose logs -f puter
```

Open `http://puter.localhost` (or your domain) once the `puter` container is healthy.

First-boot admin password:

```bash
docker compose logs puter | grep "password for admin"
```

---

## Optional: AI profile (Ollama)

To run a local LLM via Ollama:

```bash
docker compose --profile ai up -d
```

This starts `puter-ollama` and pulls `tinyllama` on first boot. Enable in `puter/config/config.json`:

```json
"providers": { "ollama": { "enabled": true } }
```

---

## Optional: SMTP profile (receive email)

Puter can receive email for user mailboxes. Requires port 25 inbound.

```bash
docker compose --profile smtp up -d
```

Configure DNS:

- `mx.example.com` A record → server IP
- `example.com` MX record → `mx.example.com`
- PTR record for reverse DNS (many providers require this)

Port 25 is often blocked by cloud providers and ISPs. The container binds 2525 internally and compose publishes `${SMTP_PORT:-25}`.

Mail stored as `message/rfc822` objects under `~/.mail/objects/<date>/`.

No STARTTLS, no per-sender rate limiting — put a filtering relay in front if needed.

This is a *receiving* server only; outbound mail uses the separate `email` config block.

Every setting is documented in [config.template.jsonc](../config.template.jsonc).

---

## Building from source instead of pulling

To run a local build against the full stack, use a source checkout and complete
the configuration steps above. Create `docker-compose.override.yml` in the
repository root, next to [docker-compose.yml](../docker-compose.yml):

```yaml
services:
  puter:
    pull_policy: never
    build:
      context: .
```

If that file already exists, merge these settings into its `puter` service.
Compose merges the override automatically: `build.context: .` builds this
checkout, and `pull_policy: never` stops it pulling the published image. Git
ignores the override, so local build settings stay out of pull requests and
don't conflict with `docker-compose.yml` when you pull updates.

From the repository root, build and start the stack:

```bash
docker compose up -d --build
```

Run the same command after changing or pulling source code to rebuild the image.
To return to the published image, remove the local build settings (or the override
file if those are its only settings), then run `docker compose up -d`.

---

## Managing running backend

```bash
# update
docker compose pull
docker compose up -d

# logs
docker compose logs -f puter

# stop, keep data
docker compose down

# stop, NUKE all state (irreversible)
docker compose down
rm -rf puter/data
```

Migrations re-apply idempotently across pulls. Volumes are preserved.

---

## Troubleshooting

**Site loads but I get a 502 / "Bad Gateway" from Caddy.**
The puter container failed to come up. `docker compose logs puter` will tell you which dependency rejected it (most often DB password mismatch between `.env` and `config.json`).

**Can't find the admin password.**
It's logged on every boot until you change it: `docker compose logs puter | grep "password for admin"`. After login, change it in Settings.

**Healthcheck reports unhealthy but the site works.**
The compose healthcheck requests `http://localhost:4100/` from inside the container. If you changed `port` or set `allow_all_host_values: false`, the check fails while the site itself is fine.

**Nothing resolves at `puter.example.com` after DNS changes.**
DNS propagates slowly. `dig puter.example.com` and `dig api.puter.example.com` should both return your server IP. If not, give it 5–60 minutes.

**`docker compose up` hangs at "waiting for service to be healthy".**
`docker compose ps` shows which container is unhealthy. MariaDB takes ~20–30s on a cold boot; everything else under 5s. If something stays unhealthy, `logs <service>` will tell you why.

**`Error: DynamoDB aws config requires both access_key and secret_key`.**
You wrote `accessKeyId` / `secretAccessKey` under `dynamo.aws`. That config block uses snake_case (`access_key` / `secret_key`). Only the `s3.s3Config` block uses camelCase.