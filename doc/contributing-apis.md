# Contributing APIs

How to add a new public API to Puter, and how to maintain one that already exists. "Public API" means anything applications can call: HTTP endpoints, `/drivers/*` methods, and the puter.js methods that wrap them. This guide is written for human contributors and AI agents alike — [AGENTS.md](../AGENTS.md) defers to it for API work.

Companion docs: [architecture.md](architecture.md) (backend layering), [pagination.md](pagination.md) (list APIs), [src/puter-js/tests/api/README.md](../src/puter-js/tests/api/README.md) (SDK test environment).

## Rule zero: don't break callers

puter.js is served live from `https://js.puter.com/v2/` with no version pinning — every app in existence picks up your change the moment it deploys, and the backend endpoints underneath have the same property. Assume every observable behavior (parameter handling, response fields, error codes, ordering) has someone depending on it.

Every change is backward compatible unless a maintainer has explicitly agreed to a break beforehand.

## Core or extension?

The first decision is where the API lives. If **nothing in core will call it, prefer an extension** over wiring it into core. [AGENTS.md](../AGENTS.md#extensions) has the rule and its test; [architecture.md](architecture.md#extension-api) documents the `extension` API.

## Adding a new API

Work through all seven steps; the PR is complete when every one is.

### 1. Design the surface first

- Sketch the signature, options, return shape, and error cases before writing code. Find the two or three most similar existing APIs and match their conventions.
- New parameter and field names follow the [naming rule](../AGENTS.md#language--files) (`camelCase`).
- Anything returning a list follows the [pagination convention](pagination.md): `limit`/`cursor` in, `{ items, cursor, total }` envelope out.
- Prefer an options object over a growing list of positional parameters, but keep the common case callable with a single argument where siblings do.

### 2. Backend

Follow the layered stack ([architecture.md](architecture.md), [layer rules](../AGENTS.md#backend)): a controller or driver at the edge, business logic in a service, persistence in a store. Return exactly what the caller needs and no more — every response field you ship is permanent — and use stable `snake_case` error codes.

#### Controller or driver?

Both are supported ways to define an API. **Prefer a controller when you need fine-grained control** — URL shape, HTTP verbs, per-route gates, response and streaming formats. A **driver** fits when the API is a set of RPC methods implementing one of the named interfaces on `/drivers/*` (`puter-kvstore`, `puter-chat-completion`, …) and the generic driver plumbing — one call envelope, interchangeable implementations, per-method policies — covers what you need.

- **Controller:** extend `PuterController` ([src/backend/controllers/types.ts](../src/backend/controllers/types.ts)) and declare routes with the `@Controller(prefix)` class decorator plus `@Get`/`@Post`/… method decorators ([src/backend/core/http/decorators.ts](../src/backend/core/http/decorators.ts)), each taking `(path, routeOptions)` — or override `registerRoutes(router)` imperatively. Core controllers register in [src/backend/controllers/index.ts](../src/backend/controllers/index.ts); extensions use `extension.registerController(...)` or the plain route helpers.
- **Driver:** extend `PuterDriver` ([src/backend/drivers/types.ts](../src/backend/drivers/types.ts)) and mark it with the `@Driver(interfaceName, opts)` decorator ([src/backend/drivers/decorators.ts](../src/backend/drivers/decorators.ts)), which also declares its policies. Core drivers register in [src/backend/drivers/index.ts](../src/backend/drivers/index.ts); extensions use `extension.registerDriver(...)`.

#### Middleware and gates

- **Controller routes** (and extension routes — same options) take [`RouteOptions`](../src/backend/core/http/types.ts): auth gates (`requireAuth`, `requireUserActor`, `noUserSession`, `adminOnly`, `allowedAppIds`, and the access-token controls), `subdomain` routing, per-route `rateLimit`, body parsers, and arbitrary extra `middleware`. The auth flavors are subtle and default-deny — read the JSDoc on each field before picking.
- **Driver methods** get their policies from the `@Driver` options: per-method `rateLimit` (limit/window/backend), `concurrent` in-flight caps (optionally `bySubscription`), `requireSubscription`, `requireReputation`, and `noUserSession`. The `/drivers/call` surface enforces them.
- **Paying accounts only:** `requireSubscription`, as a route option on a controller endpoint or in the per-method `@Driver({ requireSubscription })` block on a driver (`/drivers/call` is one shared route, so a driver's requirement can't live in route options). `true` accepts any plan that isn't free, so a plan an extension registers counts without core naming it; an array of policy ids (`['business', 'pro']`) accepts only those; `false` or leaving it out means no requirement. An empty array is a boot error, since it would read as subscribers-only while admitting everyone. The check is a map lookup on the metering service's cached per-actor subscription. It asks which plan the account is on; `requireCredits` asks whether it has budget left. Deployments with no paid plans (self-hosted installs) turn it off with `meteringEnforcement.subscriptions: false`.
- **Trusted-enough accounts only:** `requireReputation`, as a route option or in the per-method `@Driver({ requireReputation })` block. Opt-in; implies `requireAuth`. The value names a tier, and `reputationGate.tiers` in config sets the score that tier takes, so a deployment can retune it without editing the surface. A tier the running config doesn't define is inert and everyone passes, so an install that doesn't score its accounts never turns traffic away on a score it never computed. `reputationGate.enabled: false` stops every declared gate at once. Denials are a bare 403 `reputation_required` that names neither the score nor the tier. Nothing in the tree declares one yet.
- **A specific verified factor:** `requireVerified` (email, and only under `strict_email_verification_required`), `requirePhoneVerified`, `requireCardVerified`. Opt-in, and the factor must actually have been verified, unlike the default-on gate that turns away accounts still carrying a pending verification the abuse harness asked for. `requireAnyVerified: ['phone', 'card']` is the OR of the last two: any listed factor verified at any point passes, as does a paid plan when `card` is listed (a paying account already has a card on file). Otherwise only the factors the deployment can verify are asked for (an SMS provider configured, a card gate an extension reports on); with none verifiable the gate is inert rather than locking the route on a self-hosted install. A denial carries the first verifiable factor's code plus `factors` (the verifiable ones, in the route's order), so a client can lead with one flow and offer the other. `verifiedFactorGate.enabled: false` in config stops every declared gate at once, e.g. during an SMS-provider outage.
- **Metered spend:** an endpoint that spends metered resources on the caller's behalf (moving file content, object-store requests, anything else the account is billed for) declares `requireCredits: true`, which turns an account with no budget left away with a 402 before the handler runs. Endpoints that only describe or delete things deliberately don't: an account that has run out still has to see what it has, clear it, and reach its billing pages. Drivers have no route options, so they call `assertActorHasCredits` themselves ([src/backend/services/metering/enforcement.ts](../src/backend/services/metering/enforcement.ts)) — see `KVStoreDriver`, which does it once for every method.

### 3. puter.js

- Add the method to the matching module in [src/puter-js/src/modules/](../src/puter-js/src/modules/), matching the calling conventions of its siblings (promise-returning; positional shortcut plus options form where that's the local pattern).
- Validate cheap preconditions client-side and throw `{ message, code }` objects; pass backend errors through unchanged rather than swallowing or re-wrapping them.

### 4. Types

Type the method in JSDoc on the implementation, following the [puter.js type rules](../AGENTS.md#types) (overloads, where shapes live, `index.d.ts`), then run `npm run check:puterjs:types`. Declarations are generated from the JSDoc, so there is nothing to keep in sync by hand.

### 5. Docs

- Add the method page at [src/docs/src/](../src/docs/src/)`<Area>/<method>.md` — frontmatter (`title`, `description`, `platforms`), syntax, parameters, return value, and at least one runnable example — and update the area overview (`<Area>.md`). Copy the structure of an existing page.
- The docs are the contract users code against: signatures, defaults, and return shapes match the implementation exactly.

### 6. Tests

- **Backend:** see [backend tests](../AGENTS.md#backend-tests).
- **SDK:** add cases to [src/puter-js/tests/api/suites/](../src/puter-js/tests/api/suites/)`<area>.suite.ts` (register new suites in `suites/index.ts`; there is no globbing). One suite runs on node, browser, and workerd via `npm run test:puterjs`; never write per-platform tests. The runners execute the built bundle, so run `npm run build:workerLib` first or the suite silently tests stale code.
- **Desktop-rendered UI** (`puter.ui.*`): add a Playwright spec per [src/puter-js/TESTING.md](../src/puter-js/TESTING.md).

### 7. Security pass

Run the [security & privacy](../AGENTS.md#security--privacy) check on the diff, and confirm the auth gates are present.

## Maintaining an existing API

Changes are **additive by default**:

- Existing call signatures keep working, including both positional and options-object forms where a method supports them. Say in the PR how existing callers are unaffected.
- New parameters are optional, with defaults that reproduce the old behavior exactly.
- Never rename, repurpose, or remove existing parameters, response fields, or error codes. Don't change types, ordering guarantees, or which fields are present when.
- New behavior that could surprise existing callers goes behind an opt-in flag.
- Docs, types, and tests move in the same PR as the behavior; a signature change with stale docs is a bug.
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
