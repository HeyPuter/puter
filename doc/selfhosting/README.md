# Self-hosting Puter

Three supported ways to run Puter, in increasing order of effort and capability. Pick one, follow that page, ignore the others.

| Mode                                       | Best for                                              | External services                                           |
| ------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| [**1. Dev (npm start)**](./npm.md)         | Hacking on the source / trying it on your laptop      | None — everything runs in-process                           |
| [**2. Docker (single container)**](./docker.md) | Production single-host; bring your own DB / S3   | None bundled — point at services you already run            |
| [**3. Full self-hosted stack**](./full-stack.md)   | Production with a self-managed stack          | Bundled: MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx  |

---

## 1. Dev (`npm start`) → [npm.md](./npm.md)

Clone, `npm install`, `npm start`. Backend, GUI, and `puter.js` run from the source tree on Node 24+. SQLite + in-process S3 / DynamoDB / Redis stand-ins start automatically — no external services needed. Best for contributing or kicking the tires.

**Not safe to expose publicly** — uses dev secrets and an in-process key store.

## 2. Docker (single container) → [docker.md](./docker.md)

One `docker run` against `ghcr.io/heyputer/puter:latest`. Out of the box uses the same in-process defaults as dev mode; drop a `config.json` into the mounted `/etc/puter/` to point at real services (MariaDB, S3, DynamoDB, Redis) one block at a time. Best when you already operate the dependencies you want Puter to use.

## 3. Full self-hosted stack → [full-stack.md](./full-stack.md)

`docker compose -f docker-compose.full.yml up -d` brings up Puter **plus every external service it needs** (MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx) wired together. Closest to production you can run on a single host; supports your own domain and TLS. Best when you want a public Puter and don't already run the dependencies.
