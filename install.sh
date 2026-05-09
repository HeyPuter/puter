#!/usr/bin/env sh
# Self-hosted Puter — one-shot installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/install.sh | sh
#
# What this does, in order:
#   1. Checks that docker (with the compose plugin), curl, and openssl exist.
#   2. Creates ./puter-selfhosted/ (override with PUTER_DIR=...).
#   3. Downloads docker-compose.yml from the OSS repo (raw.githubusercontent.com).
#   4. Generates fresh secrets and writes .env + puter/config/config.json.
#   5. Runs `docker compose up -d` and prints the first-boot admin password.
#
# Re-running the script in an already-initialised directory is a no-op for
# config (it won't clobber existing .env / config.json) and just refreshes
# the compose file + brings the stack up. Set PUTER_FORCE=1 to overwrite.
#
# Tunable env vars:
#   PUTER_DIR     install directory                       (default: ./puter-selfhosted)
#   PUTER_URL     base URL to fetch docker-compose.yml    (default: GitHub raw, main branch)
#   PUTER_DOMAIN  domain Puter will serve on              (default: puter.localhost)
#   PUTER_PORT    HTTP port for nginx                     (default: 80)
#   PUTER_FORCE   set to 1 to overwrite existing .env / config.json

set -eu

PUTER_DIR="${PUTER_DIR:-puter-selfhosted}"
PUTER_URL="${PUTER_URL:-https://raw.githubusercontent.com/HeyPuter/puter/main}"
PUTER_DOMAIN="${PUTER_DOMAIN:-puter.localhost}"
PUTER_PORT="${PUTER_PORT:-80}"
PUTER_FORCE="${PUTER_FORCE:-0}"

log()  { printf '\033[1;36m[puter-install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[puter-install]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[puter-install]\033[0m %s\n' "$*" >&2; exit 1; }

need() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

# ── Step 1: dependency check ────────────────────────────────────────
log "checking dependencies"
need docker
need curl
need openssl
docker compose version >/dev/null 2>&1 \
    || die "docker compose plugin not found — install docker desktop or 'docker-compose-plugin'"

# ── Step 2: install dir ─────────────────────────────────────────────
mkdir -p "$PUTER_DIR"
cd "$PUTER_DIR"
mkdir -p puter/config puter/data puter/tls
log "install dir: $(pwd)"

# ── Step 3: docker-compose.yml + nginx config ──────────────────────
log "downloading docker-compose.yml from $PUTER_URL"
curl -fsSL "$PUTER_URL/docker-compose.yml" -o docker-compose.yml \
    || die "could not fetch $PUTER_URL/docker-compose.yml"

# nginx is mounted as `./nginx/nginx.conf:/etc/nginx/nginx.conf:ro` — if
# the host file is missing, docker silently creates a directory at that
# path and the mount fails with "not a directory" at container start.
log "downloading nginx/nginx.conf from $PUTER_URL"
mkdir -p nginx
# If the path was previously auto-created as a dir by a failed `compose up`,
# remove it so curl can write the file.
[ -d nginx/nginx.conf ] && rmdir nginx/nginx.conf 2>/dev/null || true
curl -fsSL "$PUTER_URL/nginx/nginx.conf" -o nginx/nginx.conf \
    || die "could not fetch $PUTER_URL/nginx/nginx.conf"

# ── Step 4: secrets, .env, config.json ──────────────────────────────
write_config=1
if [ -f .env ] && [ -f puter/config/config.json ] && [ "$PUTER_FORCE" != "1" ]; then
    log ".env + config.json already present — keeping existing secrets (PUTER_FORCE=1 to overwrite)"
    write_config=0
fi

if [ "$write_config" = "1" ]; then
    log "generating secrets"
    MARIADB_ROOT_PASSWORD=$(openssl rand -hex 32)
    MARIADB_PASSWORD=$(openssl rand -hex 32)
    S3_SECRET_KEY=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 64)
    URL_SIGNATURE_SECRET=$(openssl rand -hex 64)

    cat > .env <<EOF
HTTP_PORT=$PUTER_PORT
# HTTPS_PORT=443     # uncomment after enabling TLS (see doc/selfhosting/full-stack.md)

MARIADB_ROOT_PASSWORD=$MARIADB_ROOT_PASSWORD
MARIADB_DATABASE=puter
MARIADB_USER=puter
MARIADB_PASSWORD=$MARIADB_PASSWORD

S3_ACCESS_KEY=puter
S3_SECRET_KEY=$S3_SECRET_KEY
S3_BUCKET=puter-local
EOF

    log "writing puter/config/config.json"
    cat > puter/config/config.json <<EOF
{
    "domain": "$PUTER_DOMAIN",
    "protocol": "http",
    "pub_port": $PUTER_PORT,
    "env": "prod",

    "static_hosting_domain": "site.$PUTER_DOMAIN",
    "static_hosting_domain_alt": "host.$PUTER_DOMAIN",
    "private_app_hosting_domain": "app.$PUTER_DOMAIN",
    "private_app_hosting_domain_alt": "dev.$PUTER_DOMAIN",

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
            "publicEndpoint": "http://s3.$PUTER_DOMAIN",
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

    "trust_proxy": 1
}
EOF
fi

# ── Step 5: bring it up ─────────────────────────────────────────────
log "docker compose up -d"
docker compose up -d

log ""
log "stack starting. first boot takes ~30s while MariaDB initialises."
log "follow puter logs:"
log "    cd $PUTER_DIR && docker compose logs -f puter"
log ""
log "open http://$PUTER_DOMAIN:$PUTER_PORT once the puter container is healthy."
log "first-boot admin password is logged once — grab it with:"
log "    cd $PUTER_DIR && docker compose logs puter | grep password"
