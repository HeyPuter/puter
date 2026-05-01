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

## Utilities

### `module-docgen`

Document a module.