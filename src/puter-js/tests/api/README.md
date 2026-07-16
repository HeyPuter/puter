# puter.js API test environment

Client-agnostic test suites for puter.js, run against a self-contained
in-memory Puter server — no external server, no stdout password scraping,
no `.env`. The same suite files execute on three platforms through thin
adapters:

| Runner | Platform | How the SDK runs |
| --- | --- | --- |
| `runners/node.test.ts` | node.js | Built SDK bundle loaded into a fresh vm context per test (like `src/init.cjs`) |
| `runners/browser.test.ts` | headless Chromium (playwright) | Fixture page served same-origin on the API host loads `/puter.js/v2` from the server itself |
| `runners/workerd.test.ts` | local workerd (Miniflare) | Suite bundle deployed as a real Puter worker via `puter.workers.create`, dispatched through the local worker proxy |

## Running

Build the SDK bundle and worker preamble once (repeat after SDK changes):

```sh
npm run build:workerLib
```

Then, from the package root:

```sh
npm run test:puterjs            # all three platforms
npm run test:puterjs:node
npm run test:puterjs:browser    # needs `npx playwright install chromium` once
npm run test:puterjs:workerd
```

## How it works

Each runner boots `setupPuterTestEnv()` (from `src/backend/testUtil.ts`) in
`beforeAll`: a fully in-memory backend (sqlite / dynalite / redis-mock /
fauxqs S3) listening on a real ephemeral port, with the production
extensions loaded and two deterministic users seeded:

- `admin` — member of the admin group,
- `testuser` — a regular, non-privileged user (what suites run as).

The env manifest (`{ origin, apiOrigin, users }` with fixed passwords and
pre-minted session tokens) is JSON-serializable and crosses into whatever
runtime executes the tests. Root-only routes (e.g. `POST /login`) live on
`origin`; the SDK talks to `apiOrigin` (the `api.` subdomain host).

## Adding tests

Tests are added once and run on all three platforms — never write a
per-platform test here.

1. **Existing area** (apps, auth, fs, kv): add a test to the matching
   `suites/<name>.suite.ts` — one entry in the object, key is the test
   name, value gets the context `t`.
2. **New area** (e.g. hosting): create `suites/hosting.suite.ts` and
   register it in `suites/index.ts` (explicit list, no globbing — esbuild
   bundles exactly this list for the browser/workerd runners).

```ts
import { suite } from '../harness/types.ts';

export default suite('example', {
    'does the thing': async (t) => {
        await t.puter.fs.write(`/${t.env.users.user.username}/x.txt`, 'hi');
        t.assert.ok(await t.puter.fs.stat(/* … */));
    },
});
```

Rules that keep a suite runnable everywhere:

- **Platform-agnostic only.** No node/browser/workerd-specific imports —
  a suite may use the SDK instance (`t.puter`, authed as the regular
  user), global `fetch`, and `t.assert` (`ok/equal/deepEqual/rejects`).
- **Admin or cross-user assertions** go through plain `fetch` with
  `t.env.users.admin.token` (see `auth.suite.ts`) — that works identically
  on every platform.
- **Unique resource names per test** (file paths, kv keys): tests in a
  suite share one server and one user, so don't reuse names across tests.
- The runners in `runners/` enumerate suites automatically — adding a
  suite requires no runner changes.

Iterate fast with `npm run test:puterjs:node` (boots in ~3s); run
`npm run test:puterjs` before pushing to cover browser and workerd too.
