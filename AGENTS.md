# AGENTS.md

Guidance for AI coding agents working in this repository, and the source of truth for how we write code, tests, and docs here. Read it before making changes. FOLLOW GUIDANCE AS CLOSELY AS POSSIBLE. If you think a rule is wrong, raise an issue or flag a maintainer instead of doing what you think is right.

## Documentation Index

Use these as the source of truth before exploring further:

- [README.md](README.md) — project overview and quickstart.
- [doc/architecture.md](doc/architecture.md) — backend layered stack (controllers → drivers → services → stores → clients), `PuterServer` wiring, `Context` (ALS), actors, and extensions.
- [doc/contributing-apis.md](doc/contributing-apis.md) — adding and maintaining public APIs end to end (backend surface → puter.js → types → docs → tests). Follow it for any API work.
- [doc/pagination.md](doc/pagination.md) — the one pagination convention for list APIs (limit/cursor/offset/includeTotal, envelope shape, cursor semantics).
- [doc/alarms.md](doc/alarms.md) — raising alarms and picking a severity (what pages, what only gets recorded), plus the config that routes them.
- [doc/self-hosting.md](doc/self-hosting.md) — running Puter outside hosted infra.
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor entry point and PR conventions.
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities (do not file them publicly).
- [BUG-BOUNTY.md](BUG-BOUNTY.md) — bounty program scope.
- [TRADEMARK.md](TRADEMARK.md) — trademark usage.

---

## Repo-wide conventions

These apply everywhere — backend, puter.js, and GUI.

### Language & files

- Write ES modules, not CommonJS — we transpile and build as needed.
- TypeScript preferred for new files in the backend and extensions; convert existing JS there opportunistically when you're already touching a file. The GUI and puter.js are plain JavaScript — don't introduce TypeScript files in them.
- In plain-JS files, typing with JSDoc (`@type`/`@param`/`@returns`, `@typedef` for shared shapes, using the TypeScript type system) is encouraged. API types must not be `unknown` or untyped `...args`: spell out the real parameter and return shapes, unless the value passes through transparently to an upstream layer that owns its type. puter.js has stricter rules ([below](#types)).
- Make new types findable: descriptive `PascalCase` names, exported from the obvious entry point. A type used from many places goes in the owning module's `types.ts` (e.g. [src/backend/controllers/types.ts](src/backend/controllers/types.ts)); a type with a single consumer can stay next to it.
- Naming: `camelCase` for variables and functions, `PascalCase` for classes and files containing a class (`AuthService.ts`). **Prefer `camelCase` for all new code**, including parameters and internal object properties. `snake_case` is reserved for external contracts that already use it: wire/JSON keys, stable API error codes, public option names that already ship as `snake_case`, and established `puter_*` namespaced fields. Don't rename those (it's a breaking change), and don't add new `snake_case` beside them; a camelCase local can carry a value into a wire key (`{ operation_id: operationId }`).

### Comments

Prefer self-documenting code. Comment only when the _why_ is non-obvious or a usage detail would trip the next reader. **A comment is a sentence or two**: one or two lines of `//`, a few of `/** ... */` JSDoc. State the constraint and stop. Don't restate the code, narrate history ("used to swallow the failure, which meant…"), argue the design, or explain parameters the signature already shows. Reasoning that needs paragraphs belongs in a design doc.

Don't reference the current task, PR, or version; those rot. **No ticket references** (`PUT-1234`, `// fix for FOO-99`) in code, comments, or test names: describe the why in domain terms. Section dividers use plain ASCII (`// -- Section --`), never box-drawing characters.

### Security & privacy

Before opening a PR, scan the diff for:

- Logs, error messages, or responses leaking internal paths, secrets, tokens, env vars, or other users' data.
- Debug routes, test credentials, commented-out auth checks.
- Endpoints returning more than the caller actually needs.

When in doubt, return less. Auth-, permission-, or data-export-related changes deserve an explicit callout in the PR description.

Commit messages and PR descriptions never credit anyone or mention a bug report. For security fixes, state what the change does mechanically ("scoped tokens do xyz now"), not the vulnerability or how it could be abused.

### Reuse and abstraction

- **Search before you build.** Before writing a type, helper, cache/TTL map, retry, lock, pagination, validator, serializer, error mapper, host/email normalizer, or provider adapter, grep `src/backend/util/`, the owning layer, and `extensions/` for one that exists, and extend it instead of adding a parallel copy. If you find two copies, consolidate them or flag it. Before opening the PR, check the diff for new helpers that duplicate existing ones.
- **One path per operation.** Single-item variants call the batch version. Legacy and v2 endpoints share one service method. A second entry point (OIDC, WebDAV, admin, cron) calls the same service as the first instead of re-implementing it.
- **No abstraction without a second caller.** No base class, interface, factory, registry, decorator, or option bag with one implementation. No wrappers that only forward, no interface methods nobody calls, no methods only tests call.
- **Variants are data.** Providers or models that differ only in constants (base URL, prices, key names) are entries in a table read by one implementation, not one file each.

### Hot paths

- No per-row queries or awaits in loops: use the store's batch method (add one if missing) or [src/backend/util/concurrency.ts](src/backend/util/concurrency.ts).
- Bound everything: queries get `LIMIT`/pagination, in-memory maps get eviction, outbound calls get a timeout and a size cap.
- Build clients, catalogs, and config-derived lookups once, not per request.
- Listeners on fleet-wide events (`fs.write.file`, route lifecycle) return before any I/O for requests they don't concern.

### Working rules of thumb

- **Run it, don't just compile it.** "It type-checks" is not "it works." Exercise the code path end-to-end at least once.
- **Read the neighbors before writing.** Match the shape of similar things already in the tree. If you think the existing pattern is wrong, raise it — don't quietly diverge.
- **Test new behavior.** Every new function, endpoint, driver method, or logic branch gets a test; every bug fix gets a regression test that fails before the fix. If something is genuinely hard to test, skip it but say so in the PR.
- **Boy Scout Rule, proportional to the change.** In files you're already touching, fix the typo, the dead import, the missing test, the bit you had to read twice. Don't ride a refactor along with a bug fix.
- **Understand what you commit.** AI assistance is fine; shipping code you couldn't have written, debugged, or defended in review is not.
- **A limit change is not done until the docs change with it.** Every rate limit, concurrency cap, quota, and allowance in the code is published in [src/docs/src/rate-limits-and-quotas.md](src/docs/src/rate-limits-and-quotas.md) — an undisclosed limit is one developers discover as a service failure. If a PR moves any of these numbers, the same PR updates that page. The numbers live in `src/backend/controllers/fs/limits.ts` (filesystem), `src/backend/drivers/util/aiLimits.ts` (all AI drivers), per-driver `rateLimit`/`concurrent` configs, and `src/backend/data/subPolicies/` (free-tier allowances).

---

## Local development

To test a local Docker build, use the gitignored `docker-compose.override.yml` described in [Self-Hosting → Building from source](doc/self-hosting.md#building-from-source-instead-of-pulling). Keep local build settings there, not in `docker-compose.yml`.

When budget checks block unrelated local API tests, you may set `"unlimitedMetering": true` without further approval. Merge it into the gitignored `config.json` (`npm start`) or `puter/config/config.json` (Docker) and restart Puter. It covers every account on that instance, guests included, and usage is still recorded. Keep normal settings when testing budget or subscription enforcement, and leave shared defaults unchanged.

---

## Backend

Controllers → drivers (optional) → services → stores → clients, all configured from `IConfig`. Each layer depends only on the layers beneath it and receives them through its constructor; `PuterServer` ([src/backend/server.ts](src/backend/server.ts)) wires them. [doc/architecture.md](doc/architecture.md) is the full reference.

A public API can be a controller or a driver. Prefer a controller when you need fine-grained control over routes and gates; [doc/contributing-apis.md](doc/contributing-apis.md#controller-or-driver) has the decision guide.

Layer rules:

- **Don't reach across layers.** Controllers don't poke clients; services don't register routes; lower layers never import from controllers. If you want to, the abstraction is wrong; fix the abstraction.
- **Gates run at the edge.** Controllers and drivers validate input and apply auth gates; services assume the caller is already authenticated and authorized.
- **Don't call sideways within a layer for code reuse.** Two services needing the same logic means a util/helper, not a service-to-service dependency.
- **A table's store owns every query against it.** Services, controllers, and extensions don't run raw SQL/redis against a table that has a store; add the store method so cache invalidation stays with the write.
- **Drivers and controllers stay thin.** Domain rules a second entry point needs (signup, app CRUD, worker deploy, AI routing/billing) live in a service, not in the first driver or controller that needed them.
- **Prefer explicit arguments over [`Context`](src/backend/core/context.ts) (ALS).** Use it only for request-scoped values that would otherwise thread through many layers; today that's mostly `actor` and `req`.

### Extensions

[extensions/](extensions/) is for **non-crucial parts of the system**: Puter must still work with the extension removed. If core needs to call it, it belongs in core ([whoami](extensions/whoami.ts) is the cautionary example). Inside an extension, follow the same layered structure, unless it only needs a few route handlers, in which case the `extension.get/post/...` helpers are enough on their own. The `extension` API is in [doc/architecture.md](doc/architecture.md#extension-api).

### Backend tests

- Vitest; test files sit next to the code they test (`*.test.ts` / `*.test.js`). Run with `npm run test:backend`.
- **Mock data, not methods.** Stub inputs (fixtures, fake rows, payloads), not the function under test or the layer beneath it — over-mocking produces tests that pass while production breaks. If you must mock, mock at a real boundary (a client/external service).
- **Prefer the test server over mocking deps.** `setupPuterTestEnv()` in [src/backend/testUtil.ts](src/backend/testUtil.ts) boots a fully in-memory backend; hit a real database/client shape where reasonable — integration shapes catch what mocked unit tests miss.
- **Test code, not docs.** Never write a test that reads a file under `src/docs/` and asserts on its wording or numbers. Docs are kept in step by the PR (see the limits rule above) and checked in review; a test that greps a markdown page fails on every rewording and verifies nothing about behavior.

---

## puter.js (the SDK)

[src/puter-js/](src/puter-js/) is the public SDK. It ships live from `https://js.puter.com/v2/` with no version pinning, so every change reaches every existing app at once; see [Rule zero](doc/contributing-apis.md#rule-zero-dont-break-callers).

Layout: SDK modules in [src/puter-js/src/modules/](src/puter-js/src/modules/) (one file or directory per area — `FileSystem/`, `kv/`, `ai/`, …), shared plumbing in [src/puter-js/src/lib/](src/puter-js/src/lib/), generated (gitignored) type declarations in `src/puter-js/types/`, API tests in [src/puter-js/tests/api/](src/puter-js/tests/api/), UI e2e tests in [src/puter-js/tests/e2e/](src/puter-js/tests/e2e/), developer docs in [src/docs/](src/docs/).

Every SDK change carries all five of these, or the PR is incomplete. [doc/contributing-apis.md](doc/contributing-apis.md) has the steps for each.

1. **Backward compatibility**, unless a maintainer explicitly signs off on a break ([rules](doc/contributing-apis.md#maintaining-an-existing-api)).
2. **Tests** in the cross-platform API suite, or the Playwright harness for desktop-rendered `puter.ui.*` ([steps](doc/contributing-apis.md#6-tests)).
3. **Docs** in [src/docs/src/](src/docs/src/) that match the implementation exactly ([steps](doc/contributing-apis.md#5-docs), [writing rules](#developer-docs)).
4. **Types**, per the rules below.
5. **Error handling**: `{ message, code }` with stable `snake_case` codes, as in [modules/kv/](src/puter-js/src/modules/kv/) ([steps](doc/contributing-apis.md#3-puterjs)).

### Types

puter.js source is plain JavaScript typed via JSDoc, and **the JSDoc is the source of truth for the SDK's types**. `src/puter-js/types/` is `tsc --emitDeclarationOnly` output: the SDK build (`npm run build` in `src/puter-js`) generates it, the npm tarball ships it, and git ignores it. Never commit or hand-edit it. `npm run check:puterjs:types` generates it and type-checks the result without `skipLibCheck`; run it after any type change. The one hand-written declaration file is [src/puter-js/index.d.ts](src/puter-js/index.d.ts): it decides what is public and re-exports the generated names, so name a new type there if consumers should be able to import it.

- Public (exposed) methods carry JSDoc types for parameters and return value, with one `@overload` block per accepted call form; those overloads _are_ the published signature. Typing private helpers is at your discretion; annotate where it helps the next reader.
- Tag members `@internal`, not `@private`, to strip them from the generated declarations.
- Declarations must match runtime behavior exactly. A wrong type is worse than a missing one.

Declare a shape where it belongs and reference it elsewhere with an `import(...)` type. A shape more than one file needs lives in the module's `types.js`; one shared across modules lives in [src/puter-js/src/lib/types.js](src/puter-js/src/lib/types.js); one with a single consumer can stay next to it:

```js
/** @typedef {import('./types.js').KVOptConfig} KVOptConfig */
```

Use `@typedef {Object}` + `@property` for any shape whose fields need documenting; it's the only JSDoc form that carries a per-field doc comment into the generated declarations. Use the inline form for small internal shapes with nothing to say per field, and prefer `unknown` over `*`:

```js
/** @typedef {{ key: string; value: unknown }} KVEntry */
```

---

## Developer docs

[src/docs/src/](src/docs/src/) is the published puter.js documentation: one reference page per method (`<Area>/<method>.md`, [steps](doc/contributing-apis.md#5-docs)) and recipes in [src/docs/src/recipes/](src/docs/src/recipes/).

### Page structure

The reference has two kinds of page:

- **API overview pages** (`<Area>.md`, such as [KV.md](src/docs/src/KV.md)) give a quick top-level picture of what the API is for and what it can do, with short examples and a list of its functions that links every function page in the area. Leave out the details. The first sentence of the intro says what the API is about. This is a judgment call too: when the API depends on a Puter concept the reader may not know, such as Teams, the first sentence can name it and the sentences after it explain it.
- **Function pages** (`<Area>/<method>.md`) hold the details: parameters, defaults, return values, errors, limits, and edge cases.

An overview page answers "what is this API and is it what I need?", and a function page answers "how exactly does this call behave?". A change to one function usually only touches that function's page, so a new `kv.list()` option goes in `KV/list.md` without a matching update to `KV.md`. Don't copy a function's options, limits, or edge cases onto the overview page for completeness. Where a detail goes is a judgment call, not a hard rule: update the overview when a change affects how someone would describe the API as a whole.

When you add a page, add it to [src/docs/src/sidebar.js](src/docs/src/sidebar.js) under its area, or it won't show up in the navigation. When you add a runnable example, add its HTML to `src/docs/src/playground/examples/<slug>.html`, register the slug in [src/docs/src/examples.js](src/docs/src/examples.js), and link the code block to it by putting the slug after the language with a semicolon (` ```html;kv-set `).

### Writing docs

These apply to reference pages and recipes alike.

- **Document the developer-facing side only.** The reader is building on top of puter.js, so cover what affects their code: signatures, defaults, return shapes, errors, limits, and behavior they can observe. Leave out internal workings (which service handles the call, storage layout, caching, retries) unless they change what the developer has to do. [rate-limits-and-quotas.md](src/docs/src/rate-limits-and-quotas.md) is the exception: it publishes every limit, including timeouts and caps that come from how the backend works.
- **Describe the current state.** Docs aren't a changelog. Write how the API behaves now, without "now", "no longer", "existing code is unaffected", or other wording that compares it to an older version.
- **Verify before you document.** Run the calls you describe against a running Puter instead of inferring behavior from the source.
- **Write plainly.** Use the literal words a developer would say out loud, with contractions and everyday words. No idioms or figurative verbs ("walk away from something shared with you" → "remove your own access", "nothing to page through" → "without pagination"). No formal register ("present only while more pages remain" → "includes a `cursor` if there are more pages to load"). Prefer dev terms such as atomic, concurrent, and insertion order.
- **State the rule, then its consequence, in short sentences.** No metaphor in place of a rule. Name a concrete action ("you can create any files and folders inside it") over an abstract permission ("yours to organize freely"). Cut a sentence that only repeats the next one.
- **Describe behavior directly.** No quoted inner-voice phrases. Write "`isNew` is `true` when the person did not have access before", not "this tells 'I just gave this to someone' from 'they already had it'".
- **Keep references easy to follow.** Name what a list or code block belongs to in the sentence directly above it. Name a thing once and keep that name. Introduce an actor as "a user" before giving them a role: "A user can create a team. The user who creates the team becomes its owner."
- **Sentence mechanics.** Never start a sentence with inline code: write "To store data, use the [`set()`](/KV/set/) method." Link every inline mention of an API to its page, every time. No em dashes, and no colons or semicolons mid-sentence; a colon that introduces a code block is fine.
- **Show the correct way.** No "don't" and no wrong-way-first examples, in recipes and playground examples alike. Mention a wrong approach only when developers already hit it in practice, and state how it fails as a fact: "`add()` reads a plain object as a path map, so the call rejects with …".

### Recipes

Recipes are tested, copy-pasteable patterns for a task, one layer above the per-method reference, often combining several APIs. Agents find them through the `## Recipes` section of `llms.txt`.

- **Files.** One `.md` per recipe in [src/docs/src/recipes/](src/docs/src/recipes/), with `title`, `description`, `tags`, and optional `order` front matter; they're picked up automatically. Tags must exist in [src/docs/src/recipe-tags.js](src/docs/src/recipe-tags.js) or the build fails. Quote a `description` that contains a colon followed by a space. Every top-level `.md` in that directory is built as a recipe, so keep other markdown out of it.
- **Title.** Short, Title Case, starts with a verb, and leaves out "to Your App" ("Add Team Support", "Deploy Workers Programmatically"). The slug is the title in kebab case, with no API-name prefix. In `llms.txt` an agent sees only the title and description before deciding to open a recipe, so word them to match the task the reader is trying to do.
- **Description.** Written for someone who has never heard of Puter. Start with "Learn how to", put the action first, and say what the reader's app gains: "Learn how to add file sharing to your app with Puter.js, so users can share files in their Puter account with other people." No API names, no mechanism, no list of example cases, and no "not just …" contrast.
- **Intro.** Explain the situation and why you'd do this, tied to something the reader already knows ("`puter.kv` is your database in Puter.js"). No "Use this when" bullet list.
- **Structure.** Get to the first working call as early as possible, then add validation, rate limits, and sign-in after it. Explain a Puter concept the first time it appears, such as what `me.puter` is or that `puter.workers.exec()` opens the Puter sign-in window. Split recipes by what the reader needs, not by technique, and give a family of recipes a shared tag.
- **Link to the reference for full option lists.** Mention only the options the recipe uses, then link to the function page for the rest ("All the sort options are listed on [`puter.fs.readdir()`](/FS/readdir/)."). A copied list of options, rules, or scopes goes stale when the reference changes.
- **Code.** Platform-neutral: just the code, with top-level `await`. No `<script>` or `<html>` wrapper, no IIFE.
- **Tradeoffs.** Justify a choice with one scenario the reader can picture right away, in about two short paragraphs, or fold each point into the section where it matters. The description states the benefit only.
- **Notes.** Leave out `## Notes` by default. Use it only to point to an architecturally different approach. A limit goes in the section it applies to; other facts belong on the linked reference page.

---

## GUI

[src/gui/](src/gui/) is the Puter desktop: deliberately plain JavaScript + jQuery with HTML-string templates. Don't introduce a UI framework or a new rendering pattern.

**Conformity over novelty**: match the existing design and code structure even where you'd choose differently. A visually or structurally divergent addition is a defect even when it works.

- **Reuse existing UI primitives before writing new ones.** Windows and dialogs are `UIWindow*` functions in [src/gui/src/UI/](src/gui/src/UI/); generic pieces already exist (`UIAlert`, `UIPrompt`, `UIContextMenu`, `UINotification`, `UIPopover`, widgets in [UI/Components/](src/gui/src/UI/Components/)). A new window should read like its neighbors: an async function taking an options object, composing an HTML string, wiring behavior with jQuery, delegating to `UIWindow(...)`.
- **Match the visual language.** Use existing CSS classes (`button`, `button-primary`, window chrome, form styles) and copy the layout patterns of neighboring windows; new styles go in [src/gui/src/css/](src/gui/src/css/) following existing conventions. Verify anything positional (menus, overlays, z-index) on both desktop and mobile viewports.
- **i18n every user-facing string.** No hardcoded UI text — use `i18n('key')` and add the key to [src/gui/src/i18n/translations/en.js](src/gui/src/i18n/translations/en.js). Run `npm run check-translations` before opening the PR.
- **Shared logic goes in helpers/services.** Reusable non-UI logic belongs in [src/gui/src/helpers/](src/gui/src/helpers/) or [src/gui/src/services/](src/gui/src/services/), not copy-pasted between windows.
- **Tests.** Vitest is wired for the GUI (`src/**/*.test.js`; see [appOrder.test.js](src/gui/src/UI/Dashboard/appOrder.test.js) for the shape). Extract pure logic into functions and test those. Desktop behavior driven through puter.js (`puter.ui.*`) is covered by the Playwright harness in [src/puter-js/tests/e2e/](src/puter-js/tests/e2e/) — add a spec there when you change how the desktop renders SDK-driven UI.
