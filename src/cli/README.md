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

## Files

One-shot file operations against your Puter drive. A remote path carries a
`puter:` prefix and is absolute from your home directory, `-` is stdin or
stdout, and anything else is local — so the direction of a transfer is read off
the operands and there is no `--upload` flag to remember.

```sh
puter fs ls puter:/Desktop [-l] [--json]
puter fs cat puter:/notes.txt
puter fs cp <source> <destination> [-r] [-n] [--concurrency n] [--dry-run]
puter fs mv puter:/a puter:/b
puter fs rm puter:/old [-r] [-y] [--dry-run]
puter fs mkdir puter:/logs [-p]
puter fs stat puter:/notes.txt [--json]
```

`cp` picks its implementation from the pair of operands:

| From       | To         | What happens                                 |
| ---------- | ---------- | -------------------------------------------- |
| local      | `puter:/…` | upload                                       |
| `puter:/…` | local      | download                                     |
| `puter:/…` | `puter:/…` | copied server-side, never through the client |
| `-`        | `puter:/…` | stdin is written to the file                 |
| `puter:/…` | `-`        | raw bytes to stdout                          |

Two local paths — or two of anything else — is an error rather than a guess.
`mv` is remote-to-remote only for now: deleting local files after a failed
upload is not a first impression worth making.

### Piping

Status, progress and prompts go to stderr and data goes to stdout, so a
listing feeds straight back in:

```sh
puter fs ls puter:/logs | xargs -n1 puter fs cat
```

A terminal gets the human view — bare names, aligned `-l` columns, a progress
spinner. A pipe gets `puter:`-prefixed paths, one per line, and `--json` gives
the whole entry.

### App storage

`--app` resolves `puter:/` against one app's storage directory
(`~/AppData/<uid>`) instead of your home directory. It takes the same
identifiers as `puter kv connect`: an app name, a worker name or URL, or a uid.

```console
$ puter fs ls --app notes puter:/
puter:/settings.json
$ puter fs rm -r --app notes puter:/cache
rm -r puter:/cache → ~/AppData/app-1f2e3d4c…/cache (412 entries) [notes (app-1f2e3d4c…)]
```

It is a flag and nothing else — no environment variable, no saved default.
Because it changes what an absolute path means, the rebasing has to be visible
in the command itself, so everything that changes or removes files echoes the
path it resolved to. Paths are clamped to that root: `puter:/../../Documents`
is an error, not an escape.

### Removing things

- `rm` needs `-r` for a directory, and prints the entry count before it goes.
- `-r` prompts on a terminal and requires `-y` anywhere else.
- Bare `puter:/` is refused — no one-liner should empty a whole drive or app store.
- Anything recursive takes `--dry-run`.

### Transfers

Bulk copies move 8 files at a time (`--concurrency`, 1–32) and retry what
failed for a reason that might not repeat. A partial failure doesn't abort the
run: the failures are named at the end and the exit code is non-zero, so
uploading 8,000 files doesn't start over because number 3,000 hiccuped. `-n`
skips what already exists; without it `cp` overwrites, like `cp`.

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
