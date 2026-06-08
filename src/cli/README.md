# `@heyputer/cli`

> **Beta (0.x).** Deploy static sites and serverless workers to Puter from the
> terminal.

## Install

```sh
npm install -g @heyputer/cli
```

Requires Node 18+.

## Authentication

Log in once via the browser and your token is stored for later commands. For
automation, set `PUTER_AUTH_TOKEN` and the CLI skips login entirely.

```sh
puter login                                # web browser flow (interactive)
echo "$TOKEN" | puter login --with-token   # token via stdin
puter logout
puter whoami
```

## Sites

Deploy a static directory to a `*.puter.site` subdomain, then list, inspect, or
remove your sites. Run with no arguments and the CLI prompts for the directory
and subdomain.

```sh
puter site deploy [dir] [subdomain]   # both positional, both optional
puter site list
puter site get <subdomain>
puter site delete <subdomain> [-y]
```

## Workers

Deploy a JavaScript file as a serverless worker served at `<name>.puter.work`,
then list, inspect, or remove it.

```sh
puter worker deploy [file] [name]
puter worker list
puter worker get <name>
puter worker delete <name> [-y]
```

## Apps (read-only)

Browse the apps registered on your account. These commands are read-only.

```sh
puter app list
puter app get <name>
```
