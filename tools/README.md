# Tools Directory

This directory contains tools for developing and running puter.
Each directory inside `/tools` is an npm workspace, so it can have its own
package.json file and dependencies.

## Scripts

### `run-selfhosted.js`

This is the main script for running a local instance of Puter.
It verifies the version of node.js you are running and attempts to explain
any errors that come up if initiating boot fails.

Puter is booted with essential modules, and modules required for local
file storage.

### `gen-release-notes.js`

Generates release notes between a hard-coded pair of versions. These versions
need to be modified manually in the script source before running.

### `check-translations.js`

Checks for missing translations in `src/gui/src/i18n/translations`

## Utilities

### `comment-writer`

Generates comments in source files using generative AI via Puter's AI drivers.

To use this:
- `cd` into the `tools/comment-writer` directory
- Edit `config.json` and replace `auth_token` with your own
- Run with a specified direcotry; for example:
  `node main.js ../../src/backend/services`

### `module-docgen`

Document a module.

## Libraries

### comment-parser

This is a package used by the `license-headers` tool to process existing
comments.

### file-walker

This is used by `license-headers` and `comment-writer` to walk through
source files.
