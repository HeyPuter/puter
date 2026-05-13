# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before making changes. FOLLOW GUIDANCE AS CLOSELY AS POSSIBLE. If you think the guidance is wrong, raise an issue or flag a maintainer — don't just do what you think is right. This is the source of truth for how we write code, tests, and docs in this repo.

## Documentation Index

Use these as the source of truth before exploring further:

- [README.md](README.md) — project overview and quickstart.
- [doc/architecture.md](doc/architecture.md) — backend layered stack (controllers → drivers → services → stores → clients), `PuterServer` wiring, `Context` (ALS), and extensions.
- [doc/self-hosting.md](doc/self-hosting.md) — running Puter outside hosted infra.
- [CONTRIBUTING.md](CONTRIBUTING.md) — testing, security, AI-assisted code, PR conventions, Boy Scout Rule.
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities (do not file them publicly).
- [BUG-BOUNTY.md](BUG-BOUNTY.md) — bounty program scope.
- [TRADEMARK.md](TRADEMARK.md) — trademark usage.

---

## Backend

The backend is organized as a layered stack inspired by Controller–Service–Repository with dependency injection. Every layer only depends on the layers beneath it, and `PuterServer` ([src/backend/server.ts](src/backend/server.ts)) wires the whole thing together.

### Layers (top → bottom)

| Layer           | Lives in                                             | Responsibility                                                                                                                                                 |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Controllers** | [src/backend/controllers/](src/backend/controllers/) | Route handlers. Parse + validate input, apply per-route gates (auth, subdomain, rate limit, body parsers via `RouteOptions`), call services, format responses. |
| **Drivers**     | [src/backend/drivers/](src/backend/drivers/)         | Optional. RPC-style handlers exposed over `/drivers/*`. Thin shells that validate RPC inputs and call into services/stores.                                    |
| **Services**    | [src/backend/services/](src/backend/services/)       | Business logic. Assume the caller is already authenticated/authorized — services do not run auth gates themselves.                                             |
| **Stores**      | [src/backend/stores/](src/backend/stores/)           | Persistence. Wraps clients with the domain shape services consume (rows, entities, KV namespaces).                                                             |
| **Clients**     | [src/backend/clients/](src/backend/clients/)         | Adapters for external/internal services (sql, redis, s3, dynamo, email, event bus). Knows protocols, not domain concepts.                                      |
| **Config**      | `config.*.json` → `IConfig`                          | Flat, typed config object every layer receives at construction.                                                                                                |

Each layer receives the layers beneath it through its constructor. Dependencies are explicit and traceable from `PuterServer`.

### Cross-layer rules

- **Don't reach across layers.** Controllers do not poke clients directly; services do not register routes. If you want to, the abstraction is wrong — fix the abstraction.
- **Don't call sideways within a layer for code reuse.** If two services need the same logic, lift it into a util/helper. Services should not depend on other services for shared code.
- **Prefer explicit arguments over `Context` (ALS).** Reach for [Context](src/backend/core/context.ts) only when the value is genuinely request-scoped and would otherwise thread through many layers. Today it's used sparingly — mostly for `actor` and `req`.

### Extensions

Extensions live in [extensions/](extensions/) and parallel the layered stack. They are for **non-crucial parts of the system** — things Puter still works without if removed. If a feature is load-bearing for clients, it belongs in core, not in an extension (see [whoami](extensions/whoami.ts) as the cautionary example).

The `extension` global ([src/backend/extensions.ts](src/backend/extensions.ts)) exposes:

- `extension.registerClient/Store/Service/Driver/Controller(name, Class)` for first-class additions.
- `extension.on(event, handler)` and `extension.get/post/put/delete/patch/use(path, opts?, handler)` for the lightweight common case. `opts` is the same `RouteOptions` controllers use.
- `extension.import('client' | 'store' | 'service' | 'controller' | 'driver')` returns a lazy proxy to instantiated objects. `extension.config` exposes live config.

### Language & file conventions

- **Modules:** We transpile and build as needed — write ES modules, not CommonJS.
- **TypeScript preferred for new files.** Existing JS is fine; convert opportunistically when you're already touching a file.
- **Reuse types before inventing them.** Search for an existing type first; extend it if close. Only define a new type when nothing fits.
- **Make new types findable.** Co-locate them with the layer/module that owns them, export from the obvious entry point, and use a descriptive `PascalCase` name. Don't hide types in random files where future readers won't grep them.
- **Naming:** `camelCase` for variables/functions, `PascalCase` for classes and for files containing a class (`AuthService.ts`, `KVStoreDriver.ts`).

### Comments

Keep comments light. Prefer self-documenting code — clear names, small functions, obvious flow. Add a comment **only** when:

- The _why_ is non-obvious (a hidden constraint, a workaround, a subtle invariant).
- A non-trivial usage detail would otherwise trip the next reader.

Don't restate what the code already says. Don't write comments that reference the current task or PR — those rot.

### Tests

When adding new behavior (function, endpoint, driver method, branch of logic), add a test for it.

- Use Vitest for unit and integration tests. Test files go next to the code they test, named `*.test.ts` or `*.test.js`.
- **Mock data, not methods.** Stub the inputs (fixtures, fake rows, sample payloads) rather than mocking the function under test or the layer beneath it. Over-mocking produces tests that pass while production breaks. If you must mock, mock at a real boundary (a client/external service), not within the same layer you're testing.
- Prefer test server over mocking deps. We have existing test utilities for running full test server to boot deps based on config. (see [src/backend/testUtil.ts](src/backend/testUtil.ts)).
- **Hit a real database / real client where reasonable.** Integration shapes catch the things unit tests with mocks miss.
- **Regression tests for bug fixes.** A test that fails before your fix and passes after is the cheapest insurance against the bug coming back.
- If something is genuinely hard to test (UI animation, third-party glue), skip it but say so in the PR.

### Security & privacy

Before opening a PR, scan the diff for:

- Logs, error messages, or responses leaking internal paths, secrets, tokens, env vars, or other users' data.
- Debug routes, test credentials, commented-out auth checks.
- Endpoints returning more than the caller actually needs.

When in doubt, return less. Auth-, permission-, or data-export-related changes deserve an explicit callout in the PR description.

### Working rules of thumb

- **Run it, don't just compile it.** "It type-checks" is not "it works." Exercise the code path end-to-end at least once.
- **Read the neighbors before writing.** Match the shape of similar things already in the tree. If you genuinely think the existing pattern is wrong, raise it — don't quietly diverge.
- **Boy Scout Rule, proportional to the change.** Fix the obvious typo, dead import, or missing typehint in files you're already touching. Don't ride a refactor along with a bug fix — that just makes review harder.
- **Understand what you commit.** AI assistance is fine; shipping code you couldn't defend in review is not.
