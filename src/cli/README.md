# `@heyputer/cli`

> **Beta (0.x).** Deploy static sites and serverless workers to Puter from the
> terminal. User-friendly for humans, automation-friendly for machines.

## Install

```sh
npm install        # from this directory
npm link           # optional: expose `puter` on your PATH
```

Requires Node 18+.

## Authentication

Token resolution order for every authenticated command:

1. `PUTER_AUTH_TOKEN` environment variable
2. Stored token (from `puter login`)
3. Otherwise: inline login prompt (interactive) or a hard error (non-interactive)

```sh
puter login                       # web browser flow (interactive)
echo "$TOKEN" | puter login --with-token   # token via stdin (never argv)
puter logout
puter whoami
```

For CI, set `PUTER_AUTH_TOKEN` instead of logging in.

The token is stored via `conf` and locked to owner read/write (`chmod 0600`).
This is plaintext-with-permissions — the same bar as `gh`/`npm`/`aws`.

## Sites

```sh
puter site deploy [dir] [subdomain]   # both positional, both optional
puter site list
puter site get <subdomain>
puter site delete <subdomain> [-y]
```

- Interactive: missing `dir`/`subdomain` are prompted (dir pre-filled with `.`,
  subdomain pre-filled with a random name).
- Non-interactive: **both** must be supplied or the command errors.
- A single positional is always the directory:
  `puter site deploy . my-app` deploys cwd to `my-app`.
- Each deploy lands in its own auto-numbered folder under
  `~/Sites/<subdomain>/`; the subdomain is repointed only after upload
  finishes, so deploys are atomic and the previous version stays intact.

## Workers

```sh
puter worker deploy [file] [name]
puter worker list
puter worker get <name>
puter worker delete <name> [-y]
```

Workers have **no versioning/rollback** — the backing file is overwritten in
place. There is also no readiness signal yet, so an effective deploy cannot be
confirmed (surfaced as a warning).

## Apps (read-only, beta)

```sh
puter app list
puter app get <name>
```

## Conventions

- Status, prompts and spinners go to **stderr**; data (URLs, list rows) goes to
  **stdout**, so output pipes cleanly.
- `CI=1` or a non-TTY disables all prompts.
- `PUTER_DEBUG=1` surfaces SDK-internal rejection details.

## Environment variables

| Variable | Purpose |
|---|---|
| `PUTER_AUTH_TOKEN` | Auth token (highest priority) |
| `PUTER_API_ORIGIN` | API endpoint (default `https://api.puter.com`) |
| `PUTER_SITE_DOMAIN` | Hosting domain (default `puter.site`) |
| `PUTER_DEBUG` | Verbose error output |
| `CI` | Forces non-interactive mode |
