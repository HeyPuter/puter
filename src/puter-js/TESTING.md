# Testing puter.js

This document covers the automated end-to-end test suite for `puter.js` UI APIs (`setMenubar`, `contextMenu`, etc.). The suite uses Playwright to drive a real Puter desktop and exercise the APIs the way real users hit them — including layout interaction bugs that pure-JS unit tests can't see.

The suite started as a regression net and is structured to grow incrementally as more `puter.ui` methods are covered.

## Quick start (first run on a new machine)

1. **Start Puter desktop** (monorepo root):
   ```sh
   cd /path/to/puter
   npm start
   ```
   On first launch this prints a credentials block:
   ```
   ************************************************************
   * Your default login credentials are:
   * Username: admin
   * Password: <hex string>
   ************************************************************
   ```
   Copy the password — it's stable across restarts.

2. **Start the puter-js dev server** (serves `dist/puter.dev.js` and the test fixture on `localhost:8080`):
   ```sh
   cd /path/to/puter/src/puter-js
   npm start
   ```
   Wait for webpack's "compiled successfully".

3. **Install Playwright browsers** (one-time):
   ```sh
   cd /path/to/puter/src/puter-js
   npm install
   npm run playwright:install
   ```

4. **Set the admin password** (one-time, see [Setting the password](#setting-the-password) below for the recommended `.env` approach).

5. **Run the tests**:
   ```sh
   cd /path/to/puter/src/puter-js
   npm run test:e2e
   ```

## Setting the password

The admin password (from step 1) is the only credential the test suite needs. **Never hardcode it.** Two ways to provide it, pick one:

### Option A: `.env` file (recommended)

The `tests/e2e/.env` file is gitignored, so credentials never leave your machine.

```sh
cd /path/to/puter/src/puter-js
cp tests/e2e/.env.example tests/e2e/.env
```

Edit `tests/e2e/.env` and set the password you copied from step 1:

```
PUTER_ADMIN_PASSWORD=<your password>
```

That's it. All `npm run test:e2e*` commands pick it up automatically via `globalSetup`.

### Option B: shell environment variable

```sh
export PUTER_ADMIN_PASSWORD=<your password>
npm run test:e2e
```

Add the `export` to your shell rc (`~/.zshrc`, `~/.bashrc`) to persist across sessions. Shell env always wins over `.env`.

### When the password changes

The admin password is stored in Puter's KV under `tmp_password` and survives restarts, so it changes rarely (typically only if you wipe the local Puter database). When it does change, update your `.env` and force a fresh login:

```sh
PUTER_TEST_RESET_AUTH=1 npm run test:e2e
```

## Running tests

All commands run from `src/puter-js`:

| Command | What it does |
| --- | --- |
| `npm run test:e2e` | Headless run, both projects (`chromium` + `mobile-chromium`). |
| `npm run test:e2e:headed` | Same, but watches the browser drive Puter desktop — useful for debugging selectors. |
| `npm run test:e2e:ui` | Playwright UI mode (timeline scrubber, retry single test, picker for selectors). |
| `npm run test:e2e:record` | Records video, trace, and screenshots for **every** test (passing or failing). Files land in `test-results/<spec>/`. |
| `npm run test:e2e:report` | Opens the HTML report from the last run. |
| `npx playwright test --project=mobile-chromium` | Run only the mobile project (the contextMenu z-index regression test lives here). |

By default, video and trace are saved **only on failure**. `test:e2e:record` enables them for everything.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│ Playwright (chromium / mobile-chromium)                     │
│   ↓ navigates to                                            │
│   http://puter.localhost:4100/app/puter-js-testing-<uuid>   │
│                                                             │
│   ┌─── Puter desktop (renders menus, contextMenus) ──────┐  │
│   │   ┌─── App iframe (the fixture) ──────────────────┐  │  │
│   │   │  loads dist/puter.dev.js                      │  │  │
│   │   │  calls puter.ui.setMenubar({...})             │  │  │
│   │   │  buttons trigger puter.ui.contextMenu({...})  │  │  │
│   │   │  logs interactions to <div id="log">          │  │  │
│   │   └───────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Authentication (once per run, cached for 24h)

`globalSetup` runs at the start of the test run:

1. Direct `POST /login` from Node with the admin credentials → JWT token.
2. Probes `window.api_origin` from Puter (server-templated) so we can pass it through.
3. Opens chromium once and navigates to `puter.localhost:4100/?auth_token=<token>&api_origin=<origin>`. Puter's `initgui` auth_token handler runs the full auth setup: `puter.setAuthToken`, `puter.setAPIOrigin`, `/session/sync-cookie`, `update_auth_data`.
4. Saves cookies + localStorage to `tests/e2e/.auth/state.json` (gitignored, cached for 24h).

Every test context loads with that `storageState` → already signed in as admin → no per-test `/login`, no `/signup`, no rate limits.

### Per-test flow

For each test:

1. **Test's `page` fixture** opens with the cached storageState — already authenticated.
2. **`registerTestApp(page)`** verifies the fixture URL is reachable, navigates to `puter.localhost:4100/`, waits for the SDK to settle, and calls `puter.apps.create('puter-js-testing-<uuid>', '<fixture URL>')`.
3. **`gotoTestApp(page, name)`** navigates to `puter.localhost:4100/app/<name>`. Puter desktop's `/app/<name>` handler calls `puter.apps.get(name)` → `launch_app(...)` → opens a window with an iframe at the fixture URL (with `?puter.app_instance_id=...` so puter.js detects `env=app`). Waits for `body.ready` inside the iframe.
4. **Test body**: clicks fixture buttons inside the iframe → fixture calls `puter.ui.setMenubar(...)` / `puter.ui.contextMenu(...)`. puter.js postMessages to Puter desktop → desktop renders `.window-menubar` / `.context-menu` in the **parent** DOM. Playwright asserts on those parent-frame elements and clicks items. Each click fires the item's `action` callback **back inside the iframe** (via Puter's RPC hydration), which appends a known string to `<div id="log">`. Assertions check that the right log entry appeared.
5. **`deleteTestApp(page, name)`** in `finally` — best-effort cleanup of the ephemeral app.

### Two viewports, one regression test

Both projects (`chromium` for desktop, `mobile-chromium` for `iPhone 13`) run the same specs. The mobile contextMenu test is the named regression for commit `aa5e398e`'s z-index bug — if the dismiss-overlay regresses to sit above the menu, the tap never reaches the item, the log stays empty, the test fails.

## File layout

```
src/puter-js/
├── playwright.config.js                        # projects, globalSetup, recording flags
├── TESTING.md                                  # this file
└── tests/e2e/
    ├── README.md                               # short pointer, defers here
    ├── .env                                    # YOUR password (gitignored)
    ├── .env.example                            # committed template, no secrets
    ├── .auth/                                  # cached auth state (gitignored)
    ├── globalSetup.js                          # signs in once, saves storageState
    ├── helpers/
    │   └── testApp.js                          # registerTestApp / gotoTestApp / deleteTestApp / waitForPuterReady
    ├── fixtures/
    │   └── menubar-contextmenu.html            # the Puter app under test
    └── specs/
        ├── menubar.spec.js
        └── contextMenu.spec.js
```

The legacy `test/` (singular) folder is the manual browser harness for `puter.ai` / `puter.fs` / `puter.kv` / `puter.txt2speech` and stays as-is — different purpose, different audience.

## Adding new tests

The harness is set up to scale linearly. To cover another `puter.ui` method (e.g. `alert`, `prompt`, `notify`, `showOpenFilePicker`):

1. Add a button to `tests/e2e/fixtures/menubar-contextmenu.html` (or create a new fixture file) that calls the method with a known spec and logs the response into `<div id="log">`.
2. Add a spec under `tests/e2e/specs/` following the same shape as `menubar.spec.js`:
   - `registerTestApp` → `gotoTestApp` → click fixture button → assert on Puter desktop's rendered DOM in the parent frame → click items / verify response → assert log entry appeared.
3. If the method has different desktop/mobile rendering, that's automatically exercised by both projects.

For methods that don't render UI (like `disableMenuItem`, `setMenuItemChecked`), assert on the resulting state changes in the menubar DOM instead of on log entries.

## Configuration reference

All env vars are optional unless marked required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUTER_ADMIN_PASSWORD` | _(required)_ | Local Puter admin password (from `npm start`'s startup banner). Stable across restarts. |
| `PUTER_ADMIN_USERNAME` | `admin` | Local Puter admin username. |
| `PUTER_TEST_ORIGIN` | `http://puter.localhost:4100` | The Puter desktop origin Playwright drives. |
| `PUTER_TEST_FIXTURE_ORIGIN` | `http://localhost:8080` | Where the fixture HTML is served. The Puter app's `indexURL` is set to `${PUTER_TEST_FIXTURE_ORIGIN}/tests/e2e/fixtures/menubar-contextmenu.html`. |
| `PUTER_TEST_RECORD` | unset | When `1`, records video for every test (default: only on failure). |
| `PUTER_TEST_RESET_AUTH` | unset | When `1`, ignores the cached auth in `tests/e2e/.auth/state.json` and forces a fresh `/login`. Use after a password change or if Puter rejects the cached token. |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PUTER_ADMIN_PASSWORD is not set` | Env var or `.env` missing. | Follow [Setting the password](#setting-the-password). |
| `POST /login → HTTP 400: Username not found` | Local Puter hasn't created the admin user yet. | Run `npm start` from monorepo root and wait for the credentials banner. |
| `POST /login → HTTP 400: Invalid password.` | Password in your `.env` is wrong. | Re-check the banner, update `.env`, then `PUTER_TEST_RESET_AUTH=1 npm run test:e2e`. |
| `POST /login → HTTP 403: Forbidden` | Puter's CSRF check rejected the request. | Should not happen — globalSetup sets the `Origin` header. If it does, confirm `PUTER_TEST_ORIGIN` matches Puter's actual origin. |
| `Fixture URL is unreachable` | puter-js dev server isn't running. | From `src/puter-js`: `npm start`, wait for "compiled successfully". |
| `puter.apps.create failed: Unauthorized` with `APIOrigin: "https://api.puter.com"` | The cached `storageState` is from before the api_origin fix. | `rm -rf tests/e2e/.auth && npm run test:e2e`. |
| Test launches a window but iframe stays blank | puter-js dev server stopped mid-run, or fixture path is wrong. | Restart `npm start` in `src/puter-js` and re-run. |
| `body.ready` timeout in `gotoTestApp` | Puter desktop didn't open the app window. Usually means `puter.apps.get(name)` 404'd. | Check the test trace for `puter.apps.create` errors above this one. |
| Mobile contextMenu test fails on `expect(log entry).toBeVisible()` | The actual bug we're guarding against — overlay z-index regression on mobile. | Fix the GUI's `.context-menu-sheet-backdrop` z-index (see commit `aa5e398e`). |

## CI

Not wired up yet. Local runs depend on Puter being started via `npm start` (which auto-creates the admin user on first launch). CI will need a different bootstrap path — TBD when we get there.
