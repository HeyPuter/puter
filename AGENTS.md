# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before making changes. FOLLOW GUIDANCE AS CLOSELY AS POSSIBLE. If you think the guidance is wrong, raise an issue or flag a maintainer — don't just do what you think is right. This is the source of truth for how we write code, tests, and docs in this repo.

## Documentation Index

Use these as the source of truth before exploring further:

- [README.md](README.md) — project overview and quickstart.
- [doc/architecture.md](doc/architecture.md) — backend layered stack (controllers → drivers → services → stores → clients), `PuterServer` wiring, `Context` (ALS), and extensions.
- [doc/contributing-apis.md](doc/contributing-apis.md) — adding and maintaining public APIs end to end (backend surface → puter.js → types → docs → tests). Follow it for any API work.
- [doc/pagination.md](doc/pagination.md) — the one pagination convention for list APIs (limit/cursor/offset/includeTotal, envelope shape, cursor semantics).
- [doc/self-hosting.md](doc/self-hosting.md) — running Puter outside hosted infra.
- [CONTRIBUTING.md](CONTRIBUTING.md) — testing, security, AI-assisted code, PR conventions, Boy Scout Rule.
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities (do not file them publicly).
- [BUG-BOUNTY.md](BUG-BOUNTY.md) — bounty program scope.
- [TRADEMARK.md](TRADEMARK.md) — trademark usage.

---

## Repo-wide conventions

These apply everywhere — backend, puter.js, and GUI.

### Language & files

- Write ES modules, not CommonJS — we transpile and build as needed.
- TypeScript preferred for new files in the backend and extensions; convert existing JS there opportunistically when you're already touching a file. The GUI and puter.js are plain JavaScript — don't introduce TypeScript files in them. In puter.js, type with JSDoc instead (see the puter.js section for what must be typed).
- **Reuse before adding.** Search for an existing type, helper, or implementation and extend it; only add a new one when nothing suitable exists.
- Make new types findable: descriptive `PascalCase` names, exported from the obvious entry point. A type used from many places belongs in the owning module's `types.ts` (e.g. [src/backend/controllers/types.ts](src/backend/controllers/types.ts)) rather than bloating a logic file; a type with a single consumer can stay next to it.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes and files containing a class (`AuthService.ts`).

### Comments

Keep comments light; prefer self-documenting code. Comment only when the _why_ is non-obvious or a usage detail would trip the next reader. Use `//` for single lines and `/** ... */` JSDoc when it genuinely needs more — if a comment runs long, it's probably too long. Don't restate the code and don't reference the current task, PR, or version — those rot. **No ticket references** (`PUT-1234`, `// fix for FOO-99`) in code, comments, or test names; describe the why in domain terms, not project-management terms. Use plain ASCII `-` in comment section dividers (`// -- Section --`), never box-drawing characters.

### Security & privacy

Before opening a PR, scan the diff for:

- Logs, error messages, or responses leaking internal paths, secrets, tokens, env vars, or other users' data.
- Debug routes, test credentials, commented-out auth checks.
- Endpoints returning more than the caller actually needs.

When in doubt, return less. Auth-, permission-, or data-export-related changes deserve an explicit callout in the PR description.

### Working rules of thumb

- **Run it, don't just compile it.** "It type-checks" is not "it works." Exercise the code path end-to-end at least once.
- **Read the neighbors before writing.** Match the shape of similar things already in the tree. If you think the existing pattern is wrong, raise it — don't quietly diverge.
- **Test new behavior.** Every new function, endpoint, driver method, or logic branch gets a test; every bug fix gets a regression test that fails before the fix. If something is genuinely hard to test, skip it but say so in the PR.
- **Boy Scout Rule, proportional to the change.** Fix the obvious typo or dead import in files you're already touching; don't ride a refactor along with a bug fix.
- **Understand what you commit.** AI assistance is fine; shipping code you couldn't defend in review is not.

---

## Backend

A layered stack with explicit dependency injection: each layer depends only on the layers beneath it, receives them through its constructor, and `PuterServer` ([src/backend/server.ts](src/backend/server.ts)) wires the whole thing together. [doc/architecture.md](doc/architecture.md) is the full reference.

| Layer (top → bottom) | Lives in                                             | Responsibility                                                                                                                                         |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Controllers**      | [src/backend/controllers/](src/backend/controllers/) | Route handlers: parse/validate input, per-route gates via `RouteOptions` (auth, subdomain, rate limit, body parsers), call services, format responses. |
| **Drivers**          | [src/backend/drivers/](src/backend/drivers/)         | Optional RPC-style handlers on `/drivers/*`; thin shells that validate inputs and call services/stores.                                                |
| **Services**         | [src/backend/services/](src/backend/services/)       | Business logic. Assume the caller is already authenticated/authorized.                                                                                 |
| **Stores**           | [src/backend/stores/](src/backend/stores/)           | Persistence; wraps clients in the domain shapes services consume.                                                                                      |
| **Clients**          | [src/backend/clients/](src/backend/clients/)         | Adapters for external/internal services (sql, redis, s3, email, event bus). Protocols, not domain concepts.                                            |
| **Config**           | `config.*.json` → `IConfig`                          | Flat, typed config object every layer receives at construction.                                                                                        |

A public API can be exposed through either a controller or a driver — both are supported; prefer a controller when you need fine-grained control over routes and gates. [doc/contributing-apis.md](doc/contributing-apis.md) has the decision guide with links to the decorators and middleware for each.

Cross-layer rules:

- **Don't reach across layers.** Controllers don't poke clients; services don't register routes. If you want to, the abstraction is wrong — fix the abstraction.
- **Don't call sideways within a layer for code reuse.** Two services needing the same logic means a util/helper, not a service-to-service dependency.
- **Prefer explicit arguments over `Context` (ALS).** Reach for [Context](src/backend/core/context.ts) only for genuinely request-scoped values that would otherwise thread through many layers — today mostly `actor` and `req`.

### Extensions

[extensions/](extensions/) parallels the layered stack and is for **non-crucial parts of the system** — Puter still works with the extension removed. If core needs to call it, it belongs in core, not an extension (see [whoami](extensions/whoami.ts) as the cautionary example). The `extension` global ([src/backend/extensions.ts](src/backend/extensions.ts)) exposes:

- `extension.registerClient/Store/Service/Driver/Controller(name, Class)` for first-class additions.
- `extension.on(event, handler)` and `extension.get/post/put/delete/patch/use(path, opts?, handler)` for the lightweight common case. `opts` is the same `RouteOptions` controllers use.
- `extension.import('client' | 'store' | 'service' | 'controller' | 'driver')` — lazy proxy to instantiated core objects. `extension.config` exposes live config.

Follow the same layered structure inside an extension — unless it only needs a few route handlers, in which case the lightweight helpers are enough on their own.

### Backend tests

- Vitest; test files sit next to the code they test (`*.test.ts` / `*.test.js`). Run with `npm run test:backend`.
- **Mock data, not methods.** Stub inputs (fixtures, fake rows, payloads), not the function under test or the layer beneath it — over-mocking produces tests that pass while production breaks. If you must mock, mock at a real boundary (a client/external service).
- **Prefer the test server over mocking deps.** `setupPuterTestEnv()` in [src/backend/testUtil.ts](src/backend/testUtil.ts) boots a fully in-memory backend; hit a real database/client shape where reasonable — integration shapes catch what mocked unit tests miss.

---

## puter.js (the SDK)

[src/puter-js/](src/puter-js/) is the public SDK. It ships live from `https://js.puter.com/v2/` with no version pinning — every existing app picks up changes immediately. Treat every observable behavior (signatures, response fields, error codes) as something a production app depends on.

Layout: SDK modules in [src/puter-js/src/modules/](src/puter-js/src/modules/) (one file or directory per area — `FileSystem/`, `KV.js`, `ai/`, …), shared plumbing in [src/puter-js/src/lib/](src/puter-js/src/lib/), hand-maintained type declarations in [src/puter-js/types/](src/puter-js/types/), API tests in [src/puter-js/tests/api/](src/puter-js/tests/api/), UI e2e tests in [src/puter-js/tests/e2e/](src/puter-js/tests/e2e/), developer docs in [src/docs/](src/docs/).

Language & typing: puter.js source is plain JavaScript — never TypeScript files — typed via JSDoc. Reference the hand-maintained declarations in [src/puter-js/types/](src/puter-js/types/) with `import(...)` types rather than re-declaring shapes:

```js
/** @typedef {import('../../types/modules/ai').ChatOptions} ChatOptions */

/** @type {ChatOptions} */
const options = { model: 'gpt-5-nano' };
```

When a shape only exists locally, declare it as an inline object literal — not the `@typedef {Object}` + `@property` list form — and use `unknown` over `*`:

```js
/** @typedef {{ key: string, value: unknown }} KVEntry */
```

Public (exposed) methods must carry JSDoc types — parameters and return value, matching the `.d.ts` declarations exactly. Unexposed/private helpers are typed at the contributor's discretion: annotate where it helps the next reader, and either way keep them clean.

Typing in JS files is encouraged: annotate with JSDoc `@type`/`@param`/`@returns` using the TypeScript type system, and define shared shapes with `@typedef`. API types must not be `unknown` or untyped `...args` — spell out the real parameter and return shapes; the only exception is values passed through transparently to an upstream layer that owns their type. For example:

```js
/**
 * @typedef {{key:string, value: unknown}} KVEntry
 */

/** @type {KVEntry[]} */
let entries = [];
```

Every SDK change carries all five of the following — a puter.js PR missing one is incomplete:

1. **Backward compatibility.** Mandatory unless a maintainer explicitly signs off on a break. Existing call signatures keep working (including both positional and options-object forms where a method supports them); new parameters are optional with defaults that preserve old behavior; never rename or repurpose existing params, response fields, or error codes. New parameter names are `camelCase` (existing `snake_case` stays for compatibility). Say in the PR how existing callers are unaffected.
2. **Tests.** Add or extend a suite in [tests/api/suites/](src/puter-js/tests/api/suites/) (`<area>.suite.ts`; register new suites in `suites/index.ts` — no globbing). One suite runs unchanged on node, browser, and workerd via `npm run test:puterjs`; never write a per-platform test. The runners execute the **built** bundle — run `npm run build:workerLib` after SDK changes or the suite silently tests stale code. For `puter.ui.*` methods rendered by the desktop, use the Playwright e2e harness instead — see [src/puter-js/TESTING.md](src/puter-js/TESTING.md).
3. **Docs.** New or changed APIs update [src/docs/src/](src/docs/src/): the method page (`<Area>/<method>.md`, with frontmatter and a runnable example) and the area overview when the surface changes. Docs are the contract users code against — signatures, defaults, and return shapes must match the implementation exactly.
4. **Types.** Update [src/puter-js/types/modules/](src/puter-js/types/modules/)`<module>.d.ts` and re-export new types through `index.d.ts` / `types/puter.d.ts`. Declarations must match runtime behavior exactly — a wrong type is worse than a missing one.
5. **Error handling.** Reject/throw `{ message, code }` objects with stable `snake_case` codes, matching the existing modules (see `KV.js`). Validate cheap preconditions client-side before making the network call; pass backend errors through unchanged rather than swallowing or re-wrapping them. Error codes are API surface — changing one is a breaking change.

[doc/contributing-apis.md](doc/contributing-apis.md) walks the full lifecycle of adding an API across backend + SDK.

---

## GUI

[src/gui/](src/gui/) is the Puter desktop: deliberately plain JavaScript + jQuery with HTML-string templates. Don't introduce a UI framework or a new rendering pattern.

The guiding rule here is **conformity over novelty** — match the existing design and code structure even where you'd personally choose differently. A visually or structurally divergent addition is a defect even when it works.

- **Reuse existing UI primitives before writing new ones.** Windows and dialogs are `UIWindow*` functions in [src/gui/src/UI/](src/gui/src/UI/); generic pieces already exist (`UIAlert`, `UIPrompt`, `UIContextMenu`, `UINotification`, `UIPopover`, widgets in [UI/Components/](src/gui/src/UI/Components/)). A new window should read like its neighbors: an async function taking an options object, composing an HTML string, wiring behavior with jQuery, delegating to `UIWindow(...)`.
- **Match the visual language.** Use existing CSS classes (`button`, `button-primary`, window chrome, form styles) and copy the layout patterns of neighboring windows; new styles go in [src/gui/src/css/](src/gui/src/css/) following existing conventions. Verify anything positional (menus, overlays, z-index) on both desktop and mobile viewports.
- **i18n every user-facing string.** No hardcoded UI text — use `i18n('key')` and add the key to [src/gui/src/i18n/translations/en.js](src/gui/src/i18n/translations/en.js). Run `npm run check-translations` before opening the PR.
- **Shared logic goes in helpers/services.** Reusable non-UI logic belongs in [src/gui/src/helpers/](src/gui/src/helpers/) or [src/gui/src/services/](src/gui/src/services/), not copy-pasted between windows.
- **Tests.** Vitest is wired for the GUI (`src/**/*.test.js`; see [appOrder.test.js](src/gui/src/UI/Dashboard/appOrder.test.js) for the shape). Extract pure logic into functions and test those. Desktop behavior driven through puter.js (`puter.ui.*`) is covered by the Playwright harness in [src/puter-js/tests/e2e/](src/puter-js/tests/e2e/) — add a spec there when you change how the desktop renders SDK-driven UI.
