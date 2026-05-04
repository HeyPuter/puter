# 2. Docker (single container)

One Puter container. You bring your own database, S3, etc. — or run with the bundled in-process defaults for a quick spin. The image is multi-arch (`linux/amd64`, `linux/arm64`).

## Requirements

- **Docker** (any recent version).

## Bare minimum — defaults, single command

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

Open <http://puter.localhost:4100>. With nothing in `puter/config/`, the in-process defaults kick in (same SQLite + dynalite + fauxqs + redis-mock as dev mode). State lands in `puter/data/`. Login is `admin` — temp password is printed once in `docker logs puter`.

That's enough to confirm the image works. Now configure for real.

## Add a config

The container reads **`/etc/puter/config.json`** and deep-merges it on top of the bundled defaults. You only put the keys you want to change.

```bash
cat > puter/config/config.json <<'JSON'
{
    "domain": "puter.example.com",
    "protocol": "https",
    "pub_port": 443,

    "jwt_secret": "REPLACE-WITH-openssl-rand-hex-64",
    "url_signature_secret": "REPLACE-WITH-A-DIFFERENT-openssl-rand-hex-64"
}
JSON

docker restart puter
```

> 🔒 **Always replace `jwt_secret` and `url_signature_secret`.** The defaults are baked into the public image. Generate with `openssl rand -hex 64`.

Watch the logs:

```bash
docker logs -f puter
```

Look for `[config] override from /etc/puter/config.json` — that's the success signal.

## Wire to external services

Drop the relevant block(s) into `config.json`. Mix and match. Restart with `docker restart puter` after any change.

### MySQL / MariaDB

Puter applies its schema on first boot when you set `migrationPaths`:

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

Two files run in order: `mysql_mig_1.sql` (tables) and `mysql_mig_2.sql` (default apps — editor, viewer, pdf, camera, player, recorder, git, dev-center, puter-linux). Both are idempotent — safe to re-run.

### S3 (real or S3-compatible)

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

> ⚠️ **S3 uses camelCase keys** (`accessKeyId` / `secretAccessKey`). DynamoDB below uses snake_case. They're not the same.

### DynamoDB (real AWS)

Provision the table externally (e.g. Terraform):

```json
{
    "dynamo": {
        "aws": { "access_key": "...", "secret_key": "...", "region": "us-east-1" }
    }
}
```

The KV table is named `store-kv-v1`. Schema: hash `namespace` (S), range `key` (S), LSI `lsi1-index` on `lsi1` (S), TTL on `ttl`.

### Redis cluster

```json
{ "redis": { "startupNodes": [{ "host": "redis-0", "port": 6379 }] } }
```

## What persists?

Anything your config points at `/var/puter/...` lives on the host via the `puter/data` mount (SQLite path, fauxqs data dirs if you use them, etc.). If you've moved every dependency to external services, the data volume is mostly empty and optional.

## Updating

```bash
docker pull ghcr.io/heyputer/puter:latest
docker rm -f puter
# re-run the docker run command above
```

Your `config.json` and persistent data are untouched.

## Building the image yourself

```bash
docker build -t puter .

# Multi-arch (requires buildx, on by default in modern Docker):
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t your-registry/puter:latest \
    --push .
```

A `docker-compose.yml` in this directory has a commented-out `build:` block — uncomment it (and flip `pull_policy` to `never`) to build from your local checkout instead of pulling.

## Troubleshooting

**`docker logs puter` shows the container restarting.**
Almost always JSON syntax in `config.json`. Validate: `jq . puter/config/config.json`.

**The config file isn't picked up.**
Confirm it resolves to `/etc/puter/config.json` *inside* the container:
```bash
docker exec puter cat /etc/puter/config.json
```
Empty / missing → the volume mount path is wrong.

**Healthcheck reports unhealthy but the site works.**
The healthcheck hits `puter.localhost:4100/test` from inside the container. If you changed `domain` or `port`, the check still uses defaults. The site itself is fine.

**`Error: DynamoDB aws config requires both access_key and secret_key`.**
You wrote `accessKeyId` / `secretAccessKey` (the AWS SDK form) under `dynamo.aws`. DynamoDB config uses snake_case. See above.

**Architecture mismatch on Apple Silicon / ARM hosts.**
Use the published `:latest` tag — it's already multi-arch. If you built locally with `docker build` on an Intel Mac, the resulting image will be `linux/amd64` only.
