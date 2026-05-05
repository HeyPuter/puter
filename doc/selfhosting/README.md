# Self-hosting Puter

Two supported ways to run Puter. Pick one, follow that page.

| Mode                                             | Best for                                         | External services                                          |
| ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| [**1. Dev (npm start)**](./npm.md)               | Hacking on the source / trying it on your laptop | None — everything runs in-process                          |
| [**2. Full self-hosted stack**](./full-stack.md) | Production, single host                          | Bundled: MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx |

---

## 1. Dev (`npm start`) → [npm.md](./npm.md)

Clone, `npm install`, `npm start`. Backend, GUI, and `puter.js` run from the source tree on Node 24+. SQLite + in-process S3 / DynamoDB / Redis stand-ins start automatically — no external services needed. Best for contributing or kicking the tires.

**Not safe to expose publicly** — uses dev secrets and an in-process key store.

## 2. Full self-hosted stack → [full-stack.md](./full-stack.md)

`docker compose up -d` brings up Puter **plus every external service it needs** (MariaDB, Valkey, DynamoDB-local, RustFS S3, nginx) wired together. Closest to production you can run on a single host; supports your own domain and TLS.

The fastest path is the one-shot installer — fetches the compose file, generates secrets, writes `.env` + `config.json`, and brings the stack up:

```bash
curl -fsSL https://raw.githubusercontent.com/HeyPuter/puter/main/install.sh | sh
```

See [full-stack.md](./full-stack.md) for the manual walkthrough, TLS setup, and post-install configuration knobs.
