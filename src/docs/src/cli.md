---
title: CLI
description: Manage your Puter resources directly from your terminal with the Puter CLI. Deploy static sites and serverless workers without leaving your shell.
---

The [Puter CLI](https://www.npmjs.com/package/@heyputer/cli) lets you manage your Puter resources straight from the terminal: deploy static websites, ship serverless workers, and inspect the apps registered to your account, all without leaving your shell.

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

## Environment variables

| Variable | Description |
| --- | --- |
| `PUTER_AUTH_TOKEN` | Auth token to use instead of logging in. Takes precedence over the stored token. |
| `CI` | When set, the CLI runs non-interactively and never prompts. |
