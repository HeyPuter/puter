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

Open an interactive JavaScript shell against the key-value store of one app or
worker. Takes an app name, a worker name or its `*.puter.work` URL, or a uid —
a worker resolves to the sandbox app it was deployed with, which is where its
`puter.kv` data lives. An app name wins a tie with a worker of the same name;
the worker's URL asks for the worker instead.

```sh
puter kv connect <app>
puter kv connect <worker>
puter kv connect https://<worker>.puter.work
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

A worker connects the same way, and the prompt says so:

```console
$ puter kv connect my-api
✔ Connected to worker my-api (app-9a8b7c6d…) · 3 keys
kv(worker:my-api)> list()
[ 'visits' ]
```

Results are awaited for you — `get("k")` prints the value, not a pending
promise — and `_` holds the last one. `.help` lists the methods, `.clear`
resets the session, `.exit` (or Ctrl-D) quits. Needs a terminal.
