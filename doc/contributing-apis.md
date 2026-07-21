# Contributing APIs

How to add a new public API to Puter, and how to maintain one that already exists. "Public API" means anything applications can call: HTTP endpoints, `/drivers/*` methods, and the puter.js methods that wrap them. This guide is written for human contributors and AI agents alike — [AGENTS.md](../AGENTS.md) defers to it for API work.

Companion docs: [architecture.md](architecture.md) (backend layering), [pagination.md](pagination.md) (list APIs), [src/puter-js/tests/api/README.md](../src/puter-js/tests/api/README.md) (SDK test environment).

## Rule zero: don't break callers

puter.js is served live from `https://js.puter.com/v2/` with no version pinning — every app in existence picks up your change the moment it deploys, and the backend endpoints underneath have the same property. Assume every observable behavior (parameter handling, response fields, error codes, ordering) has someone depending on it.

Every change is backward compatible unless a maintainer has explicitly agreed to a break beforehand.

## Core or extension?

The first decision is where the API lives.

If the API is **not crucial to core functionality — nothing in core will call it — prefer an extension** over wiring it into core. Extensions live in [extensions/](../extensions/), parallel the core layered stack, and reach core through `extension.import(...)`:

```js
const services = extension.import('service');
const stores = extension.import('store');

extension.registerDriver('myFeature', MyFeatureDriver);  // first-class driver
extension.post('/my-feature/frobnicate', opts, handler); // or plain routes
```

Follow the same layered structure inside the extension (driver/controller → service → store) unless it genuinely only needs a couple of route handlers — then the lightweight `extension.get/post/...` helpers are enough on their own.

The test is the direction of dependency: Puter must still work with the extension removed. The moment core needs to call your API, it belongs in core — see [whoami](../extensions/whoami.ts) for the cautionary example of a load-bearing "extension".

## Adding a new API

Work through all seven steps; the PR is complete when every one is.

### 1. Design the surface first

- Sketch the signature, options, return shape, and error cases before writing code. Find the two or three most similar existing APIs and match their conventions.
- New parameter and field names are `camelCase`. (Existing `snake_case` names stay where they already exist.)
- Anything returning a list follows the [pagination convention](pagination.md): `limit`/`cursor` in, `{ items, cursor, total }` envelope out.
- Prefer an options object over a growing list of positional parameters, but keep the common case callable with a single argument where siblings do.

### 2. Backend

Follow the layered stack ([architecture.md](architecture.md)): a controller or driver at the edge, business logic in a service, persistence in a store. The edge parses and validates input and applies gates; services assume the caller is already authorized. Return exactly what the caller needs and no more — every response field you ship is permanent — and use stable `snake_case` error codes.

#### Controller or driver?

Both are supported ways to define an API. **Prefer a controller when you need fine-grained control** — URL shape, HTTP verbs, per-route gates, response and streaming formats. A **driver** fits when the API is a set of RPC methods implementing one of the named interfaces on `/drivers/*` (`puter-kvstore`, `puter-chat-completion`, …) and the generic driver plumbing — one call envelope, interchangeable implementations, per-method policies — covers what you need.

- **Controller:** extend `PuterController` ([src/backend/controllers/types.ts](../src/backend/controllers/types.ts)) and declare routes with the `@Controller(prefix)` class decorator plus `@Get`/`@Post`/… method decorators ([src/backend/core/http/decorators.ts](../src/backend/core/http/decorators.ts)), each taking `(path, routeOptions)` — or override `registerRoutes(router)` imperatively. Core controllers register in [src/backend/controllers/index.ts](../src/backend/controllers/index.ts); extensions use `extension.registerController(...)` or the plain route helpers.
- **Driver:** extend `PuterDriver` ([src/backend/drivers/types.ts](../src/backend/drivers/types.ts)) and mark it with the `@Driver(interfaceName, opts)` decorator ([src/backend/drivers/decorators.ts](../src/backend/drivers/decorators.ts)), which also declares its policies. Core drivers register in [src/backend/drivers/index.ts](../src/backend/drivers/index.ts); extensions use `extension.registerDriver(...)`.

#### Middleware and gates

- **Controller routes** (and extension routes — same options) take [`RouteOptions`](../src/backend/core/http/types.ts): auth gates (`requireAuth`, `requireUserActor`, `noUserSession`, `adminOnly`, `allowedAppIds`, and the access-token controls), `subdomain` routing, per-route `rateLimit`, body parsers, and arbitrary extra `middleware`. The auth flavors are subtle and default-deny — read the JSDoc on each field before picking.
- **Driver methods** get their policies from the `@Driver` options: per-method `rateLimit` (limit/window/backend), `concurrent` in-flight caps (optionally `bySubscription`), and `noUserSession`. The `/drivers/call` surface enforces them.

### 3. puter.js

- Add the method to the matching module in [src/puter-js/src/modules/](../src/puter-js/src/modules/), matching the calling conventions of its siblings (promise-returning; positional shortcut plus options form where that's the local pattern).
- Validate cheap preconditions client-side and throw `{ message, code }` objects; pass backend errors through unchanged rather than swallowing or re-wrapping them.

### 4. Types

- Add or extend the declaration in [src/puter-js/types/modules/](../src/puter-js/types/modules/)`<module>.d.ts` and re-export new types through `index.d.ts`. Declarations must match the runtime exactly — optionality, defaults, and return types included.

### 5. Docs

- Add the method page at [src/docs/src/](../src/docs/src/)`<Area>/<method>.md` — frontmatter (`title`, `description`, `platforms`), syntax, parameters, return value, and at least one runnable example — and update the area overview (`<Area>.md`). Copy the structure of an existing page.

### 6. Tests

- **Backend:** colocated Vitest tests; prefer the in-memory test server (`setupPuterTestEnv` in [src/backend/testUtil.ts](../src/backend/testUtil.ts)) over mocking.
- **SDK:** add cases to [src/puter-js/tests/api/suites/](../src/puter-js/tests/api/suites/)`<area>.suite.ts` (register new suites in `suites/index.ts`). One suite runs on node, browser, and workerd via `npm run test:puterjs` — never write per-platform tests, and rebuild first with `npm run build:workerLib` since the runners execute the built bundle.
- **Desktop-rendered UI** (`puter.ui.*`): add a Playwright spec per [src/puter-js/TESTING.md](../src/puter-js/TESTING.md).

### 7. Security pass

Scan the diff before opening the PR: no internals leaked in errors or logs, no over-broad responses, auth gates present. Flag anything auth-, permission-, or data-export-related in the PR description.

## Maintaining an existing API

Changes are **additive by default**:

- New parameters are optional, with defaults that reproduce the old behavior exactly.
- Never rename, repurpose, or remove existing parameters, response fields, or error codes. Don't change types, ordering guarantees, or which fields are present when.
- New behavior that could surprise existing callers goes behind an opt-in flag.
- Docs, types, and tests move in the same PR as the behavior. A signature change with stale docs is a bug — the docs are the contract users code against.
- Bug fixes come with a regression test that fails before the fix. Be suspicious of fixes that change observable behavior: someone may depend on the bug. When in doubt, ask a maintainer.

### Breaking changes

Rare and deliberate. In order: explicit maintainer sign-off, a documented migration path, and a rollout plan — typically new surface added first, old surface deprecated, old surface removed much later, if ever. Never break as a side effect of a refactor.

### Deprecating

The old surface keeps working. Mark it `@deprecated` in the type declarations, note the replacement on its docs page, and stop using it in examples. Removal is a separate, maintainer-approved decision.

## Definition of done

- [ ] Backward compatible (or the break was explicitly approved)
- [ ] Right home: extension if core never calls it; layered structure either way
- [ ] puter.js method matches sibling conventions; errors are `{ message, code }` with stable codes
- [ ] Types updated and matching runtime behavior
- [ ] Docs page + area overview updated, with a runnable example
- [ ] Tests: backend + three-platform SDK suite (+ e2e for desktop-rendered UI)
- [ ] Security pass on the diff
- [ ] You ran it end to end
