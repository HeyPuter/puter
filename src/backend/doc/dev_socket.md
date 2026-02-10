## Backend - dev socket

The "dev socket" allows you to interact with Puter's backend by running commands.
It's a UNIX socket that lets you run commands registered with
[CommandService](../../src/services/CommandService.js) (e.g. `help`, `logs:indent`, `params:get`, etc.).

### Enabling the dev socket

The dev socket is provided by the **dev-console extension** and is **opt-in**. To enable it:

1. Set the environment variable `DEVCONSOLE=1` when starting Puter (e.g. `npm run dev` already does this).
2. The extension lives in `extensions/dev-console/` and registers a `dev-socket` service when `DEVCONSOLE=1`.

### Socket location

The socket is created in a directory chosen as follows (in order):

- `PUTER_DEV_SOCKET_DIR` if set
- `./volatile/runtime` if it exists (typical local dev)
- otherwise the process current working directory

The socket file is named `dev.sock`.

### Connecting

When in that directory, connect with your tool of choice. For example, using `nc` and `rlwrap` for readline history:

```
rlwrap nc -U ./dev.sock
```

If it is successful you will see a message with instructions. Enter a command (e.g. `help`) and press Enter.
