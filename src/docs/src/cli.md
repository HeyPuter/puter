---
title: CLI
description: Manage your Puter resources directly from your terminal with the Puter CLI. Deploy static sites and serverless workers, and work with your cloud files, without leaving your shell.
---

The [Puter CLI](https://www.npmjs.com/package/@heyputer/cli) lets you manage your Puter resources straight from the terminal: deploy static websites, ship serverless workers, work with your cloud files, inspect the apps registered to your account, and explore the key-value stores behind your apps and workers, all without leaving your shell.

<div class="info">The Puter CLI is in beta (0.x). Behavior may change between releases.</div>

## Installation

Install the CLI globally with npm (requires Node 18+):

```sh
npm install -g @heyputer/cli
```

Then log in once and your token is stored for later commands:

```sh
puter login
```

This opens your browser to authenticate with Puter. Once you're logged in, you're ready to deploy.

## Authentication

`puter login` runs an interactive browser flow and saves your token for future commands. If you don't have browser access (for example, on a remote server), pipe a token in via stdin instead:

```sh
echo "$TOKEN" | puter login --with-token
```

For automation and CI, set the `PUTER_AUTH_TOKEN` environment variable and the CLI skips login entirely, reading the token from the environment on every command.

```sh
puter whoami     # show the current account
puter logout     # clear the stored token
```

## Sites

Deploy a static directory to a `<subdomain>.puter.site` address, then list, inspect, or remove your sites.

```sh
puter site deploy ./dist my-app
```

Run `puter site deploy` with no arguments and the CLI prompts you for the directory and subdomain interactively, suggesting an available name. Deploys are versioned: each deploy uploads into its own folder, so previous versions are preserved.

```sh
puter site deploy [dir] [subdomain]   # deploy a directory
puter site list                       # list your sites
puter site get <subdomain>            # show one site's details
puter site delete <subdomain>         # remove a site
```

## Workers

Deploy a single JavaScript file as a serverless [Worker](/Workers/), served at `<name>.puter.work`. Deploying with a name that already exists replaces that worker's code in place.

```sh
puter worker deploy ./api.js my-api
```

As with sites, running `puter worker deploy` with no arguments prompts you for the file and name.

```sh
puter worker deploy [file] [name]   # deploy or replace a worker
puter worker list                   # list your workers
puter worker get <name>             # show one worker's details
puter worker delete <name>          # delete a worker
```

## Apps

Browse the apps registered to your account. These commands are read-only.

```sh
puter app list           # list your apps
puter app get <name>     # show one app's details
```

## Files

Work with your [cloud storage](/FS/) from the terminal: list a directory, read a file, copy files and folders in either direction, move them, delete them, and inspect them. Remote paths carry a `puter:` prefix and are absolute from your home directory, `-` means stdin or stdout, and anything else is a local path — so the direction of a transfer comes from the paths themselves rather than from a flag.

```sh
puter fs ls puter:/Desktop
puter fs cat puter:/notes.txt
puter fs cp -r ./dist puter:/Documents/backup
```

`cp` decides what to do from the pair of paths you give it:

| From | To | What happens |
| --- | --- | --- |
| local | `puter:/…` | uploaded |
| `puter:/…` | local | downloaded |
| `puter:/…` | `puter:/…` | copied on the server, without passing through your machine |
| `-` | `puter:/…` | stdin is written to the file |
| `puter:/…` | `-` | the file's bytes are written to stdout |

Two local paths — or two of anything else — is an error rather than a guess. `mv` works within your Puter storage only; to move something between your machine and Puter, copy it, check the copy, then delete the original.

### Piping

Status messages, progress and prompts go to stderr and data goes to stdout, so output can be piped without status text mixed into it:

```sh
puter fs ls puter:/logs | xargs -n1 puter fs cat
```

In a terminal you get the readable view: bare names, aligned columns with `-l`, and a progress spinner during transfers. When output is piped or redirected, `ls` prints full `puter:` paths instead, one per line, so each line can be handed straight to another command. `--json` prints the complete entries, for both `ls` and `stat`.

### App storage

Every app has its own storage directory. `--app` resolves `puter:/` against that directory instead of your home directory, so you can read and edit the files an app works with. It accepts the same identifiers as `puter kv connect` — an app name, an app uid, a worker name, or a worker URL:

```console
$ puter fs ls --app notes puter:/
puter:/settings.json
```

`--app` is a flag and nothing else: there is no environment variable and no saved default, because it changes what an absolute path means. Every command that writes or deletes prints the path it resolved to, so you can see the difference it made:

```console
$ puter fs rm -r --app notes puter:/cache
rm -r puter:/cache → ~/AppData/app-1f2e3d4c…/cache (412 entries) [notes (app-1f2e3d4c…)]
```

Paths stay inside that directory: `puter:/../../Documents` is an error, not a way out of it.

### Deleting files

`rm` deletes a single file. Deleting a directory needs `-r`, which prints the resolved path and how many entries it holds, then asks you to confirm in a terminal, or requires `--yes` when there is nobody to ask. `puter:/` on its own is always refused. Anything recursive accepts `--dry-run`, which lists what would be deleted without deleting it.

<div class="info">Deleted files do not go to Trash — <code>puter fs rm</code> removes them.</div>

### Transfers

Copying a folder transfers 8 files at a time, which `--concurrency` adjusts (1–32), and retries a file whose failure looks temporary. If files still fail, the rest of the copy continues, the failures are listed at the end, and the command exits with a non-zero status — so a large upload does not start over because one file failed. `-n` skips files that already exist; without it, `cp` overwrites them.

## Key-value store

Open an interactive JavaScript shell against the [key-value store](/KV/) of one app or [worker](/Workers/), so you can read and edit its data directly instead of going through the app. Pass an app name, a worker name or its `*.puter.work` URL, or a uid:

```sh
puter kv connect my-app
```

The CLI resolves the app, checks the store is reachable, and drops you at a prompt:

```console
$ puter kv connect notes
✔ Connected to notes (app-1f2e3d4c…) · 12 keys
kv(notes)> set("greeting", "hi")
true
kv(notes)> get("greeting")
'hi'
kv(notes)> list("gre", true)
[ { key: 'greeting', value: 'hi' } ]
```

A worker connects the same way. Deploying a worker from your account gives it its own sandbox app, and that app's store is where the worker's `puter.kv` data lives — so naming the worker connects you to it, and the prompt says which one you're in:

```console
$ puter kv connect my-api
✔ Connected to worker my-api (app-9a8b7c6d…) · 3 keys
kv(worker:my-api)> list()
[ 'visits' ]
```

Names are looked up as apps first, so if an app and a worker share a name you get the app; pass the worker's URL (`puter kv connect https://my-api.puter.work`) to ask for the worker instead. A worker deployed by an app rather than by you has no store of its own — connect to the app that owns it.

Every [`puter.kv`](/KV/) method is bound to the connected app and available bare, as `kv.set(…)`, and as `puter.kv.set(…)`, so examples copied from these docs run as written. Results are awaited for you — `get("k")` prints the value rather than a pending promise — and `_` holds the last result.

It's a full JavaScript REPL, so multi-line input, variables, and history between sessions all work. `.help` lists the kv methods, `.clear` resets the session, and `.exit` (or Ctrl-D) quits.

<div class="info">Writes through <code>puter kv connect</code> go to the connected app's store, not your user-level store — the same data the app or worker itself reads and writes.</div>

## CLI reference

### Global options

| Option | Description |
| --- | --- |
| `-v`, `--version` | Print the CLI version. |
| `-h`, `--help` | Show help for any command, e.g. `puter site deploy --help`. |

The CLI detects whether it's running interactively. In a terminal it prompts for any missing values; in a non-interactive context (CI, piped output, or with `CI` set) it never prompts, so required arguments must be passed explicitly.

### `puter login`

Log in to Puter and store the token for later commands.

| Argument / Option | Description |
| --- | --- |
| `--with-token` | Read an auth token from stdin instead of opening a browser. |

### `puter logout`

Clear the stored auth token. Takes no arguments.

### `puter whoami`

Show the account associated with the current token. Takes no arguments.

### `puter site deploy`

Deploy a static directory to `<subdomain>.puter.site`.

| Argument | Description |
| --- | --- |
| `[dir]` | Directory to deploy. Prompted for when omitted interactively. |
| `[subdomain]` | Target subdomain. Prompted for when omitted interactively; a pasted full host like `my-app.puter.site` is accepted. |

In non-interactive mode both arguments are required. Subdomains may use lowercase letters, numbers, and hyphens (not at the ends).

### `puter site list`

List the subdomains you own, with their URLs. Takes no arguments.

### `puter site get`

Show details for one site.

| Argument | Description |
| --- | --- |
| `<subdomain>` | The subdomain to inspect. |

### `puter site delete`

Remove a subdomain.

| Argument / Option | Description |
| --- | --- |
| `<subdomain>` | The subdomain to delete. |
| `-y`, `--yes` | Skip the confirmation prompt. |

### `puter worker deploy`

Deploy a JavaScript file as a serverless worker at `<name>.puter.work`, or replace an existing one.

| Argument | Description |
| --- | --- |
| `[file]` | The worker's JavaScript file. Prompted for when omitted interactively. |
| `[name]` | Worker name. Prompted for when omitted interactively. |

In non-interactive mode both arguments are required. Names may use letters, numbers, and hyphens (not at the ends).

### `puter worker list`

List your workers, with their URLs. Takes no arguments.

### `puter worker get`

Show details for one worker.

| Argument | Description |
| --- | --- |
| `<name>` | The worker to inspect. |

### `puter worker delete`

Delete a worker and its backing file.

| Argument / Option | Description |
| --- | --- |
| `<name>` | The worker to delete. |
| `-y`, `--yes` | Skip the confirmation prompt. |

### `puter app list`

List the apps registered to your account. Takes no arguments.

### `puter app get`

Show details for one app.

| Argument | Description |
| --- | --- |
| `<name>` | The app to inspect. |

### `puter fs ls`

List a remote directory.

| Argument / Option | Description |
| --- | --- |
| `<path>` | The remote path to list (`puter:/…`). |
| `-l`, `--long` | Show type, size and modification time. |
| `--json` | Print the full entries as JSON. |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

### `puter fs cat`

Write a remote file's contents to stdout.

| Argument / Option | Description |
| --- | --- |
| `<path>` | The remote file to read (`puter:/…`). |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

### `puter fs cp`

Copy between your machine and Puter, or within your Puter storage.

| Argument / Option | Description |
| --- | --- |
| `<source>` | A local path, a remote path (`puter:/…`), or `-` to read stdin. |
| `<destination>` | A local path, a remote path (`puter:/…`), or `-` to write stdout. |
| `-r`, `--recursive` | Copy directories. |
| `-n`, `--no-clobber` | Skip files that already exist instead of overwriting them. |
| `--concurrency <n>` | How many files to transfer at once, from 1 to 32. Defaults to 8. |
| `--dry-run` | List what would be copied without copying it. |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

One of the two paths must be remote. Copying between two local paths is an error.

### `puter fs mv`

Move or rename within your Puter storage.

| Argument / Option | Description |
| --- | --- |
| `<source>` | The remote path to move (`puter:/…`). |
| `<destination>` | The remote path to move it to (`puter:/…`). |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

Both paths must be remote, and `puter:/` itself cannot be moved.

### `puter fs rm`

Delete a remote file or directory.

| Argument / Option | Description |
| --- | --- |
| `<path>` | The remote path to delete (`puter:/…`). |
| `-r`, `--recursive` | Delete a directory and everything in it. |
| `-y`, `--yes` | Skip the confirmation prompt. Required for `-r` when not running in a terminal. |
| `--dry-run` | List what would be deleted without deleting it. |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

`puter:/` on its own is refused, with or without `--app`.

### `puter fs mkdir`

Create a remote directory.

| Argument / Option | Description |
| --- | --- |
| `<path>` | The remote directory to create (`puter:/…`). |
| `-p`, `--parents` | Create missing parent directories, and succeed if the directory already exists. |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

### `puter fs stat`

Show details for one remote file or directory.

| Argument / Option | Description |
| --- | --- |
| `<path>` | The remote path to inspect (`puter:/…`). |
| `--json` | Print the full entry as JSON. |
| `--app <id>` | Resolve `puter:/` against an app's storage instead of your home directory. |

### `puter kv connect`

Open an interactive shell against an app's or worker's key-value store.

| Argument | Description |
| --- | --- |
| `<identifier>` | The store to connect to: an app name, an app uid (`app-…`), a worker name, or a worker URL (`https://my-api.puter.work`). Ambiguous names resolve to the app. |

Requires a terminal — in a non-interactive context the command exits with an error rather than hanging.

## Environment variables

| Variable | Description |
| --- | --- |
| `PUTER_AUTH_TOKEN` | Auth token to use instead of logging in. Takes precedence over the stored token. |
| `CI` | When set, the CLI runs non-interactively and never prompts. |
