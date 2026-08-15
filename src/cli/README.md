# `@heyputer/cli`

> **Beta (0.x).** Puter CLI — developer tooling from your terminal.

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

## Key-value store

Open an interactive JavaScript shell against one app's key-value store. Takes
an app name or a uid.

```sh
puter kv connect <app>
```

Every `puter.kv` method is bound to that app and available bare, so pasted
docs work either way:

```console
$ puter kv connect notes
✔ Connected to notes (app-1f2e3d4c…) · 12 keys
kv(notes)> set("greeting", "hi")
true
kv(notes)> get("greeting")
'hi'
kv(notes)> list("gre", true)
[ { key: 'greeting', value: 'hi' } ]
kv(notes)> puter.kv.incr("visits")
1
```

Results are awaited for you — `get("k")` prints the value, not a pending
promise — and `_` holds the last one. `.help` lists the methods, `.clear`
resets the session, `.exit` (or Ctrl-D) quits. Needs a terminal.
