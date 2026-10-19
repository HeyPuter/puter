# Realtime relay stress kit

Tools for load-testing the OpenAI Realtime relay (`/puterai/openai/v1/realtime`, `puter.ai.assistant.connect()`). The relay's behaviour, limits and quirks are documented in [`src/backend/services/realtime/README.md`](../../src/backend/services/realtime/README.md); read its **Quirks** section before interpreting any result.

| File               | What it is                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `mockUpstream.mjs` | A fake OpenAI Realtime server. It speaks the events the relay and clients use, paces audio in real time, and can inject latency and failures. It costs nothing. |
| `abuse.mjs`        | Misbehaving clients: `big-frames` (16 MiB frames back to back), `slow-reader` (stops reading its socket), `preauth-flood` (bad token, sends before rejection). Uses the repo's `ws`. |
| `loadtest.mjs`     | A load generator. It opens sessions the way puter.js does, runs scripted text or audio turns, and prints a JSON report. It exits `1` below `--min-success`. |

Both need Node 22+ and run from a repo checkout; `mockUpstream.mjs` uses the repo's `ws` package, so run `npm ci` first. `--help` lists every flag.

```sh
# 1. Fake OpenAI (on a box the Puter server can reach)
node tools/realtime-stress/mockUpstream.mjs --port 9100 --connect-delay-ms 800 --audio-ms 3000

# 2. Load (from a different box than the server, if you can)
PUTER_TOKENS=tok1,tok2,tok3 node tools/realtime-stress/loadtest.mjs \
  --url wss://api.<test-domain>/puterai/openai/v1/realtime \
  --sessions 200 --ramp 20 --turns 3 --mode audio --mic-ms 2000 --out step-200.json
```

## Report fields (`loadtest.mjs`)

| Field                        | Meaning                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `sessions.successRate`       | Share of sessions that completed every turn. This is the pass/fail number.                                    |
| `sessions.peakOpen`          | The most sessions open at once, as seen by the client.                                                        |
| `latencyMs.connect`          | Client socket open. This is the relay only (it answers `101` before auth).                                    |
| `latencyMs.sessionCreated`   | First event from upstream, so it includes auth, credit check, slot acquire and the upstream handshake.        |
| `latencyMs.firstDelta`       | `response.create` until the first `*.delta`. Relay overhead plus model think time.                            |
| `latencyMs.responseDone`     | `response.create` until `response.done`. With the mock and `--mode audio` this is about `--audio-ms` + `--first-delta-ms` when healthy. |
| `failures`                   | Count per reason: `error:<code>` (relay or OpenAI error event), `closed:<code>`, `timeout:<stage>`, `connect_error`, `response_status:<status>`. |
| `closeCodes`                 | Final close code per session. `1000` is clean; `1008` is a relay rejection; `1011` is upstream gone; `1006` is an abnormal drop. |

## Server-side signals

Each Puter node logs a `[realtime]` line every 30 s, described in the relay README. The fields that matter most under load:

- **`active`**: sessions open on this node. It must return to `0` after a run; if it doesn't, sessions leaked.
- **`upstreamFailed`**: handshakes to OpenAI (or the mock) that failed.
- **`elu`**: event-loop utilization over the last 30 s. Rises linearly with relayed bytes; this is the capacity signal.
- **`loopP99Ms`/`loopMaxMs`**: event-loop delay over the last 30 s. Flat (~12 ms, the histogram floor) until `elu` nears 1, so it tells you when you've run out, not how close you are.
- **`rssMb`/`heapMb`**: memory for the whole process.

```sh
docker logs -f --since 1m <puter-container> 2>&1 | grep -E '\[realtime\]'
docker stats --no-stream <puter-container>                          # CPU %, memory
docker exec <puter-container> sh -c 'ls /proc/1/fd | wc -l'         # open fds (≈ 2 per session + baseline)
ss -s                                                               # host socket totals
# Collateral damage: latency of an unrelated endpoint during the run
while sleep 1; do curl -s -o /dev/null -w '%{time_total}\n' https://api.<test-domain>/version; done
```

---

## Runbook for an autonomous agent

Work through the phases in order. Write every report and every server log excerpt to a run directory (`runs/<UTC timestamp>/`) as you go, then finish with the summary in [Reporting](#reporting).

### Hard rules

1. **Never target production.** Only use the test deployment URL the user gave you. If the URL's host is `api.puter.com` or anything you weren't given, stop.
2. **The mock upstream is the default.** Real OpenAI costs money per session. Run against it only in phase 7, and only if the user approved a budget. Estimate the cost first (formula in phase 7) and stay under it.
3. **Change config only on the test deployment, and only these keys:** `realtime.upstreamUrl`, `realtime.maxConnectionsPerUser` and `unlimitedMetering`. Record the original values and restore them at the end, even after a failure.
4. **Never print or commit secrets.** Keep Puter tokens in `PUTER_TOKENS` and OpenAI keys out of output, reports and logs.
5. **Don't edit code during a run.** If you find a bug, record it with evidence and carry on, or stop if it blocks the run.
6. **Stop the whole run** if the server process crashes or restarts unexpectedly, or if the host runs out of disk or memory. Report what you have.

### Inputs to collect first

Ask the user for anything you can't find:

| Input                    | Why                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Test API host            | Gives `--url wss://api.<test-domain>/puterai/openai/v1/realtime`.                                  |
| Puter tokens             | Session or full-access API tokens for test accounts, comma-separated in `PUTER_TOKENS`.             |
| Server access            | A shell or `docker` on the test host, for logs, `docker stats` and fd counts.                      |
| A host for the mock      | It must be reachable from the Puter server. Ideally not the Puter host, or the mock's CPU pollutes the results. |
| A load box               | Ideally not the Puter host either. One `loadtest.mjs` process handles roughly 1000–2000 audio sessions. |
| Budget for real OpenAI   | Phase 7 only; it is skipped if none is given.                                                       |

### Phase 0: configure and preflight

1. On the test server, set the config below, then restart Puter:

   ```jsonc
   {
       "realtime": { "upstreamUrl": "ws://<mock-host>:9100", "maxConnectionsPerUser": 100000 },
       "unlimitedMetering": true, // usage is still recorded; covers every account on this instance
   }
   ```

   `unlimitedMetering` matters because the relay meters mock usage at real prices, so accounts run dry otherwise.
2. Start the mock: `node tools/realtime-stress/mockUpstream.mjs --port 9100 --connect-delay-ms 800 --audio-ms 3000`. The 800 ms delay matches the measured OpenAI handshake.
3. Raise open-file limits on the load box (`ulimit -n` ≥ sessions + 1024). Check the server's limit too: each session uses 2 fds there.
4. **Smoke test:** `--sessions 1 --turns 1 --mode text`. It must exit `0`.
5. Wait up to 30 s for a `[realtime]` line in the server log showing `opened` ≥ 1. If none appears, the deployment isn't running this branch; stop.
6. Record a **baseline** with no load: one `[realtime]` line (`rssMb`, `loopP99Ms`), `docker stats`, the fd count, and 30 s of `/version` latency.

### Phase 1: step ramp (find the breaking point)

Run each step with:

```sh
--mode audio --mic-ms 2000 --turns 5 --think-ms 1000 --hold-ms 60000 --ramp 50 --label step-<N> --out runs/.../step-<N>.json
```

Use `--sessions` = 50, 100, 250, 500, 1000, 2000, 4000, then keep doubling. While each step runs, capture every `[realtime]` line, `docker stats` every 10 s, the fd count, and the `/version` latency loop. Between steps, wait until the server logs `active=0`, then cool down for 60 s.

**A step fails** on any of these:

- `successRate` < 0.99
- `firstDelta.p99` > 3 × the 50-session step's value
- `loopP99Ms` > 100 on two consecutive lines
- `/version` p99 > 1 s
- Failures that include `connect_error`, `timeout:open` or `timeout:session.created`
- `active` not back to `0` within 2 min after the step

The **breaking point** is the last step that passed. Stop ramping after the first failing step, but run that step once more to rule out a fluke.

If the load box's own CPU passes 80 %, its numbers are no longer trustworthy. Split the load across more processes or machines, with the same total and different `--label`s, and add the reports together.

### Phase 2: soak (leaks)

At 70 % of the breaking point, run `--mode audio --mic-ms 2000 --turns 60 --think-ms 30000`, which lasts about 30 min. Pass criteria:

- `rssMb` stays flat after the first 5 min (a slope under 1 %/10 min)
- `loopP99Ms` stays stable
- `successRate` ≥ 0.99
- After the run, `active=0`, and `rssMb` comes back within 15 % of baseline within 5 min

### Phase 3: churn (setup cost and slot release)

1. Run `--sessions 3000 --ramp 100 --turns 1 --mode text --think-ms 0`. This measures connect and setup cost, and the server CPU it costs per new session.
2. Then set `maxConnectionsPerUser` back to `20`, restart, and run `--sessions 20 --ramp 20 --turns 1 --hold-ms 5000` with **one** token, twice in a row.
   - Both runs must pass. A `rate_limit_exceeded` means concurrency slots leaked.
   - Afterwards, raise the cap again.

### Phase 4: failure injection

1. Restart the mock with `--fail-rate 0.05` and run 250 sessions with 5 audio turns. The rate applies per response, so expect:
   - `closed:1011` in roughly 1 − 0.95⁵ ≈ 23 % of sessions (25 % in a local check)
   - no other failure types
   - server `active` back to `0`
   - no crash
2. Restart the mock with `--reject-rate 0.2` and run 200 sessions. Expect:
   - about 20 % of sessions failing with `error:upstream_error` and close `1011`
   - the server's `upstreamFailed` going up by about the same count
3. **Mock dies mid-run:** start 500 sessions with `--hold-ms 120000`, kill the mock about 30 s in, and restart it about 30 s later. Expect:
   - every open session to fail with `closed:1011` within seconds (the load generator counts a close it didn't start as a failure, including during `--hold-ms`)
   - `active=0`
   - new sessions to succeed once the mock is back
   - Record how long the server took to notice.

### Phase 5: collateral damage

Repeat the passing step just below the breaking point while also running the `/version` latency loop. Compare its p50 and p99 with the baseline. This says whether realtime load hurts the rest of the API on the same node, which is the key input for the worker-vs-load-balance decision.

### Phase 5b: event-loop abuse

Run 200 normal audio sessions (`--turns 20`) and, 10 s in, one abuse mode from a separate process. Repeat per mode:

```sh
node tools/realtime-stress/abuse.mjs --url <url> --mode big-frames --sockets 10 --frame-mb 15 --duration-s 60
node tools/realtime-stress/abuse.mjs --url <url> --mode slow-reader --sockets 20 --duration-s 60
node tools/realtime-stress/abuse.mjs --url <url> --mode preauth-flood --sockets 50 --frame-mb 4 --duration-s 30
```

Pass criteria, compared with the same 200 sessions alone:

- normal sessions' `firstDelta.p99` within 1.5× and `successRate` ≥ 0.99
- `elu` below 0.7 and `loopMaxMs` below 100
- `rssMb` rises by less than 100 MB during the mode and comes back after it
- `slow-reader` sockets are closed by the relay about 30 s after they stop reading

Reference, laptop core, mock upstream: before backpressure and the upload budget, `big-frames` with 10 sockets pinned `elu` at 1.0, raised RSS from 106 MB to 1.27 GB and the normal sessions' `firstDelta.p99` from 305 to 857 ms. With them, `elu` stayed near 0.22, RSS peaked at 278 MB and `firstDelta.p99` was 319 ms.

### Phase 6: per-session cost

From the steps, derive per-session costs:

- **Memory:** (`rssMb` at peak − baseline) / `peakOpen`
- **File descriptors:** fds per session
- **CPU:** `elu` per 100 active audio sessions, and per MB/s relayed (`bytesUp` + `bytesDown` deltas). On a laptop core `elu` was about 0.0045 per MB/s; expect a Fargate vCPU to cost more.

Then project the sessions per node at 70 % CPU, at 70 % memory and at the fd limit. The lowest of the three is the capacity.

### Phase 7: real-OpenAI calibration (optional, needs a budget)

1. Restore `realtime.upstreamUrl` to unset (OpenAI) and restart.
2. Estimate the cost for a text run on `gpt-realtime-mini`: about 130 tokens per turn, so 10 sessions × 2 turns ≈ $0.001. Audio output is $20 per 1M tokens, about 20 tokens per second of speech.
3. Run `--sessions 10 --turns 2 --mode text`. Then, if the budget allows, `--sessions 50 --ramp 5 --turns 2 --mode audio`.
4. Compare `sessionCreated` and `firstDelta` with the same sizes against the mock. If they differ a lot, note that the mock's `--connect-delay-ms` and `--first-delta-ms` need retuning before trusting its absolute latencies.
5. OpenAI has its own rate limits per key. A `rate_limits.updated` event or upstream `429`s mean you are measuring OpenAI, not us.

### Phase 8: restore

Put back the original `realtime` and `unlimitedMetering` config, restart, stop the mock, and confirm the smoke test against real OpenAI still passes (only if a budget exists; otherwise just confirm the server is healthy at `/healthcheck`).

### Reporting

Write `runs/<ts>/SUMMARY.md` with:

1. **Environment:** server size (vCPU, RAM), Puter commit, load and mock hosts, and the deviations from this runbook.
2. **A step table:**

   | sessions | success | connect p99 | sessionCreated p99 | firstDelta p99 | responseDone p99 | server loopP99 max | rss peak | CPU peak | fds peak | /version p99 | notes |
   | -------- | ------- | ----------- | ------------------ | -------------- | ---------------- | ------------------ | -------- | -------- | -------- | ------------ | ----- |

3. **Results:** the breaking point and which limit hit first (CPU / memory / fds / upstream / client), the soak verdict, the churn and slot-leak verdict, the failure-injection verdicts, and the collateral-damage numbers.
4. **Per-session cost** and projected sessions per node.
5. **Anomalies:** anything erratic, with the evidence (the report file and log lines). Examples:
   - latency bimodality
   - `active` drifting
   - close codes other than `1000`/`1008`/`1011`
   - metering errors in the logs
   - event-loop spikes without load
6. **Read-out for the decision:**
   - If the limit is event-loop/CPU and `/version` degrades with it, realtime competes with the API on shared nodes. That points to a dedicated worker or a node pool routed by path.
   - If the limit is memory or fds with CPU headroom and `/version` unaffected, plain horizontal scaling behind the load balancer is viable; give the node count per N concurrent sessions.
