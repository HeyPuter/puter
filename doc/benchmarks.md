# Benchmarks

The backend tests run against in-memory clients that answer in microseconds, so a request that makes twelve database round trips one after another passes them as easily as one that makes two. The benchmarks measure what the tests can't: how much I/O a request does, and how long it would wait on that I/O in a deployment spread over several regions ([AGENTS.md](../AGENTS.md#distributed-deployment)).

CI runs them on every pull request and on the commit it is based on, and fails the pull request if a benchmark got worse.

## Running

```sh
npm run bench                       # every benchmark
npm run bench -- src/backend/controllers/fs/FSController.bench.ts
npm run bench:compare               # this checkout against its merge base with origin/main
npm run bench:compare -- <git ref>  # against another commit
```

`bench:compare` is what CI runs. It checks the other commit out under `.bench/base-src`, copies this checkout's benchmark files and harness onto it, runs both sides, and prints the comparison. Reports land in `.bench/` (`base/report.json`, `head/report.json`, `comparison.md`). Both sides use this checkout's installed dependencies.

## Scenarios

A scenario is one operation, usually one HTTP request, run against a booted in-memory backend ([`useBenchEnv()`](../src/backend/benchUtil.ts)). While it runs, every round trip a client makes is recorded and takes a fixed time on a modeled clock, set for a region far from the SQL primary:

| Destination | Recorded as | Modeled latency |
| --- | --- | --- |
| SQL read, answered by a replica in the region (`db.read`) | `dbRead` | 2 ms |
| SQL read from the primary (`db.pread`, the primary leg of `tryHardRead`) | `dbPrimaryRead` | 40 ms |
| SQL write (`db.write`, `db.batchWrite`) | `dbWrite` | 40 ms |
| Key-value store read / write | `dynamoRead` / `dynamoWrite` | 4 ms / 6 ms |
| Redis command, or one pipeline | `redis` | 1 ms |
| Object storage request | `s3` | 12 ms |

Only round trips advance that clock: one stays pending until the process has gone a few milliseconds without issuing another, then the earliest pending ones complete together. CPU time and scheduling never reach it, so the numbers are the same on a laptop and on a loaded CI runner.

Each scenario reports three things:

- **Round trips** per destination. Work the request leaves running after it answers is counted too: it is still load.
- **Serial stages**: the longest chain of round trips where each one started after the one before had finished. Three reads issued together are one stage; three reads awaited one after another are three.
- **Latency**: the modeled time along the slowest such chain, up to the moment the server ends its response. It is how long the caller waits on I/O.

A scenario runs twice to warm caches, then the server is settled (buffered usage flushed, and the cache tombstones earlier writes left cleared, as if those writes were a few seconds old), and then it runs seven times. Round trips are the count most runs agreed on; stages and latency are the lowest reading.

### Writing one

Benchmark files are `*.bench.ts`, next to the code they exercise:

```ts
import { describe } from 'vitest';
import { useBenchEnv } from '../../benchUtil.js';

describe('fs', () => {
    const env = useBenchEnv({
        // Runs once after boot, before latency applies.
        seed: async (env) => {
            await env.request('/fs/mkdir', {
                json: { path: `/${env.users.user.username}/bench` },
            });
        },
    });

    env.scenario('stat a directory', async () => {
        await env.request('/fs/stat', {
            json: { path: `/${env.users.user.username}/bench` },
        });
    });
});
```

- `env.request()` sends an authenticated request to the API origin and rejects on a non-2xx answer, so a failing request can't pass as a fast one. Pass `token` to act as another user or with another kind of token.
- Bench mode runs no `beforeAll`/`afterAll` hooks. Put fixtures in `seed`. The server is settled after it too, so scenarios don't see the seed's writes as recent ones.
- A scenario runs nine times against one server. If it writes, make it repeatable: a fresh name per run, or an operation that is idempotent.
- The numbers must be identical from run to run. If they aren't, the scenario depends on something that varies (a cache that expires in real time, a list that grows each run); fix the scenario rather than widening a threshold.
- Names are unique within a file. A benchmark is identified as `<file> > <name>`.

Add a scenario when you add an endpoint or driver method that will be called often, and when you fix a performance problem, so the fix stays fixed.

## Plain benchmarks

A CPU-bound function can use vitest's `bench()` directly in a `*.bench.ts` file. These are timed on the wall clock and compared by median, so they are noisier: one fails only when it is more than 30% slower and the difference exceeds both runs' margin of error.

## When a benchmark regresses

A scenario regresses when any round-trip count or the stage count goes up, or its latency grows by more than 10% (and 2 ms). The comparison names what changed:

```
| `src/backend/controllers/fs/FSController.bench.ts > stat a file` | regression | 5.00 → 47.0 ms | … | +1 dbPrimaryRead, +1 serial stages, +840% time |
```

Treat it as a finding about the change, not about the benchmark:

- **More round trips of one kind**: a lookup in a loop, or the same row fetched twice. Use the store's batch method, or pass the value you already have.
- **More serial stages**: independent calls awaited one after another. Issue them together.
- **A new `dbPrimaryRead`**: a read that didn't need the primary. Read the replica, and use `tryHardRead` only where the request must see a write it just made.
- **More `dbRead`/`dynamoRead` on a path that used to hit only `redis`**: a cache was bypassed.

Don't edit a scenario to make the comparison pass.

Some changes are worth their cost: a correctness fix that needs a primary read, a feature that adds a write. Accept those in the pull request description, one line per benchmark, with the reason:

```
bench-accept: FSController.bench.ts > stat a file -- the size must be current after an upload, so this reads the primary
```

The text before `--` matches any benchmark whose identifier contains it (`*` matches all of them). The reason is required, and reviewers read it. Editing the description re-runs the check.

## CI

[benchmarks.yaml](../.github/workflows/benchmarks.yaml) splits the benchmark files over parallel runners. Each runner benchmarks its share on both commits, and the `benchmarks` job merges the reports, posts the comparison on the pull request, and fails on a regression the description doesn't accept. Pushes to `main` are compared with the previous commit and only reported.

A benchmark that exists only on one side is listed as new or removed and never fails the check.
