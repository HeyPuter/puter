# 1. Dev mode (`npm start`)

Run Puter directly from the source tree on Node. Everything runs in-process — no databases, no Redis, no external services. Best for hacking on Puter or a quick local trial on your LAN.

> ⚠️ **Not safe to expose publicly.** Default JWT secrets ship in the source tree and the in-process key store has no real security boundary.

## Requirements

- **Node.js 24+** (`nvm install 24` if you don't have it).
- **C toolchain** for native deps (`bcrypt`, `sharp`, `better-sqlite3`):
  - macOS: `xcode-select --install`
  - Debian / Ubuntu: `sudo apt install build-essential python3`

## Setup

```bash
cd packages/puter            # if you cloned the heyputer parent repo
                             # (skip this if you cloned puter directly)
npm install
npm run build                # one-time: compiles backend + GUI + puter.js
npm start                    # daily use: re-builds backend, then starts
```

Open <http://puter.localhost:4100>. Sign in as `admin` — the temp password is printed once in the boot logs.

## What runs in-process

Out of the box (no `config.json`):

- SQLite at `volatile/runtime/puter-database.sqlite` (auto-created).
- In-process S3 (`fauxqs`) with the `puter-local` bucket auto-created.
- In-process DynamoDB (`dynalite`) with its KV table auto-created.
- In-process Redis (`ioredis-mock`).

State lives under `./volatile/`. Delete the folder to reset.

## Configuring (optional)

Drop a `config.json` next to `package.json`. It deep-merges over `config.default.json` — only put what you want to change:

```json
{ "port": 5101, "domain": "myhost.local" }
```

Restart with `npm start`.

For real external services (MySQL, S3, DynamoDB, Redis), the config blocks are the same as in [docker.md → "Wiring to external services"](./docker.md#wire-to-external-services). The mode is meant for in-process defaults though — if you're wiring real services, you probably want [docker.md](./docker.md) instead.

## Daily workflow

- Backend changes → `npm start` re-runs the TS compile (~5–10s) and restarts.
- GUI / `puter.js` changes → `npm run build` (full webpack — slower).
- Reset state → `rm -rf volatile/` and start over.

## Troubleshooting

**`npm start` says missing `dist/`.**
You skipped `npm run build`. The `prestart` hook only re-builds the backend; the GUI + `puter.js` bundles need the full build at least once.

**Native module build failures during `npm install`.**
Missing C toolchain. Install it (see Requirements), delete `node_modules`, re-run `npm install`.

**Port 4100 already in use.**
Set `"port": <something else>` in `config.json`. The browser URL changes accordingly.
