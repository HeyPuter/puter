# dev-console extension

The **dev-console** extension provides a **dev socket** so you can run backend commands on a local Puter instance (e.g. commands registered in [CommandService](../../../src/backend/src/services/CommandService.js)).

## Enabling

The extension is **opt-in**. Set the environment variable `DEVCONSOLE=1` when starting Puter. The `npm run dev` script already does this:

```bash
npm run dev
```

With `DEVCONSOLE=1`, the extension registers a `dev-socket` service that creates a UNIX socket and runs command lines through CommandService.

## Usage

See [Backend – dev socket](../../../src/backend/doc/dev_socket.md) for how to connect (e.g. `rlwrap nc -U ./dev.sock`) and run commands like `help`, `logs:indent`, etc.

## Location

The extension lives in `extensions/dev-console/`. It only registers the dev-socket service when `DEVCONSOLE=1`; otherwise the extension loads but does nothing, so it does not affect default runs.
